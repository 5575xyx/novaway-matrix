// Git 工作区外壳:左列五面板 + 右侧差异 + 底部键位条。
//
// 布局与焦点在这里,每个面板的渲染在 git-workspace/*.tsx,数据在 git-workspace/state.ts,
// 键位表在 git-workspace/focus.ts(纯数据,已单独单测)。
//
// 宽度规则(规格「布局」):左列固定 36,70-79 列收到 30,低于 70 直接提示太窄 ——
// 差异视图窄于 30 列就没法读,硬挤只会得到一个谁也看不懂的界面。
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { gitExec } from "../util/git-exec"
import type { GitStatusSummary } from "../util/git-status"
import {
  DANGEROUS_COMMANDS,
  PANEL_ORDER,
  PANEL_TITLE,
  panelAt,
  keyOfParsed,
  resolveWorkspaceCommand,
  type PanelID,
  type WorkspaceCommand,
} from "./git-workspace/focus"
import { createConfirm, type ArmedConfirm } from "./git-workspace/confirm"
import {
  deriveBranchRows,
  deriveFileRows,
  deriveStatusRows,
  hintFromError,
  loadWorkspace,
  pickDefaultRemote,
  type WorkspaceData,
} from "./git-workspace/state"
import { GitDiffPanel, type DiffTarget } from "./git-workspace/diff-panel"
import { BranchesPanel } from "./git-workspace/branches-panel"
import { CommitsPanel } from "./git-workspace/commits-panel"
import { FilesPanel } from "./git-workspace/files-panel"
import { StashPanel } from "./git-workspace/stash-panel"
import { StatusPanel } from "./git-workspace/status-panel"

const LEFT_WIDE = 36
const LEFT_NARROW = 30
const TOO_NARROW = 70

/** 行内输入的三种触发来源(规格「提交」:三处共用同一个行内输入组件)。 */
type InlineInputRequest = { kind: "commit" } | { kind: "branch-new" } | { kind: "remote-add" }

/** 危险操作拍板的目标。三种形状合成一个联合,联合成员的判别键就是面板归属。 */
type ArmedTarget = { file: string } | { branch: string } | { ref: string }

export interface GitWorkspaceProps {
  rootPath?: string
  onClose: () => void
  /** 工作区可用总列数。由调用方按侧栏挤占后的实际宽度给,别自己去猜 —— 组件看不见侧栏。 */
  width: number
}

export function GitWorkspace(props: GitWorkspaceProps) {
  const { theme } = useTheme()

  const [data, setData] = createSignal<WorkspaceData | undefined>(undefined)
  const [panel, setPanel] = createSignal<PanelID>("status")
  const [statusRow, setStatusRow] = createSignal(0)
  const [fileRow, setFileRow] = createSignal(0)
  // 提交面板继续复用 fileRow(计划 1 已如此):提交与文件两个面板不同时显示,复用不会互相影响。
  // 换成独立 commitRow 要多写一个信号 + 一个 clamp effect,收益只有整齐,留给计划 3 一起收拾。
  const [branchRow, setBranchRow] = createSignal(0)
  const [stashRow, setStashRow] = createSignal(0)
  const [diffTarget, setDiffTarget] = createSignal<DiffTarget>({ kind: "none" })
  const [armed, setArmed] = createSignal<ArmedConfirm<ArmedTarget> | undefined>(undefined)
  // 行内输入的触发来源。三种来源共用同一个组件(规格「提交」),差别只在标题和回调。
  // Task 8 才接上 <InlineInput>;此刻只声明状态 —— 它是 openInput 的唯一写入方,没人读也不会出错。
  const [inlineInput, setInlineInput] = createSignal<InlineInputRequest | undefined>(undefined)
  // 差异视图获得焦点(差异激活模式)。Task 9 才接上键位拦截,这里先声明:
  // focusPanel 已经要调 setDiffFocus,声明晚了 run 的闭包就找不到这个绑定。
  const [diffFocus, setDiffFocus] = createSignal(false)
  const [remote, setRemote] = createSignal<string | undefined>(undefined)
  // 最后一次 git 命令失败的原因(中文,经 hintFromError 映射)。写进状态面板的「提示」行 ——
  // 失败必须有反馈:早先版本 gitExec 失败时既不刷新也无提示,用户按了 p 拉取毫无动静,
  // 只剩控制台里一条没人看的 unhandled rejection。
  const [actionHint, setActionHint] = createSignal<string | undefined>(undefined)

  // 真实时钟注入给确认态。测试里换假时钟就能推时间(见 git-workspace-confirm.test.ts)。
  const confirm = createConfirm<ArmedTarget>(() => Date.now())

  /**
   * 危险操作的「不许做」前置检查。返回非空文案就写进提示行 —— 静默拒绝会让人以为按了
   * 没生效然后去按别的键,比提示更糟。
   *
   * 当前分支的删除在这里挡,而不是让 git 报错:git 会拒绝,但 hintFromError 只会翻译成
   * 一句「git 执行失败」,用户看不出到底为什么不能删。
   */
  const blockedDanger = (command: WorkspaceCommand): string | undefined => {
    if (command !== "branches.delete") return undefined
    const row = branchRows()[branchRow()]
    if (!row) return undefined
    if (row.current || row.name.startsWith("(HEAD")) return "当前分支不能删除"
  }

  /** 目标在武装瞬间拍板(计划 1 已有这条理由:武装到 fire 之间列表可能被后台刷新换掉)。 */
  const dangerTarget = (command: WorkspaceCommand): ArmedTarget | undefined => {
    if (command === "files.discard" || command === "files.delete") {
      const row = fileRows()[fileRow()]
      return row ? { file: row.file } : undefined
    }
    if (command === "branches.delete") {
      const row = branchRows()[branchRow()]
      return row && !row.current ? { branch: row.name } : undefined
    }
    if (command === "stash.discard") {
      const row = stashRows()[stashRow()]
      return row ? { ref: row.ref } : undefined
    }
    return undefined
  }

  /** 只把「属于这个面板」的确认态交给对应面板渲染;联合的判别键就是面板归属。 */
  const armedFor = (kind: "file" | "branch" | "ref") => {
    const current = armed()
    const target = current?.target
    return target && kind in target ? current : undefined
  }

  /** 打开左列底部的行内输入。开输入框是明确的「改主意」:任何待确认态到此作废。 */
  const openInput = (request: InlineInputRequest) => {
    confirm.clear()
    setArmed(undefined)
    setInlineInput(request)
  }

  // 世代计数器:连按 r、或 stage 后连续 gitExec().then(refresh) 时,先发的可能后回来。
  // 没有它,旧快照会盖掉新快照 —— 而这份数据是整仓状态,显示过期状态会误导接下来的危险操作。
  // 和 component/git-workspace/diff-panel.tsx 的 loadSeq 同款写法。
  let refreshSeq = 0
  const refresh = () => {
    const cwd = props.rootPath
    if (!cwd) return
    const seq = ++refreshSeq
    loadWorkspace(cwd).then((next) => {
      if (seq !== refreshSeq) return
      setData(next)
      // 选中远端跟着数据走,但用户手动切过就以用户的选择为准。
      setRemote((prev) => prev ?? pickDefaultRemote(next.remotes)?.name)
    })
  }

  createEffect(() => refresh())
  onCleanup(() => setArmed(undefined))

  // armed 的 3 秒超时要有人在视觉上接住:confirm.pending() 只在被读取时判过期,没有定时器
  // 驱动重渲染的话,「再按一次 d」的黄条会一直挂到下一次按键才消失。tick 到点对表,
  // pending 空了就清 armed —— effect 依赖 armed(),清掉后 interval 随本次 effect 的
  // onCleanup 自动拆除;下一次武装再重新拉起。粒度 100ms:比确认窗口小一个量级即可,
  // 不值得为更准的到点时刻引入独立定时器调度。
  createEffect(() => {
    if (armed() === undefined) return
    const timer = setInterval(() => {
      if (confirm.pending() === undefined) setArmed(undefined)
    }, 100)
    onCleanup(() => clearInterval(timer))
  })

  /** 跑一条会改动仓库的 git 命令。成功清掉上一次的动作提示;失败把原因写进提示行。
   *  两条路径都要 refresh() —— 失败后视图同样可能已过期(比如 pull 冲突时索引变了),
   *  不刷新会让下一次危险操作落在过期的文件列表上。 */
  const runGit = (args: string[]) => {
    const cwd = props.rootPath
    if (!cwd) return
    gitExec(cwd, args)
      .then(() => {
        setActionHint(undefined)
        refresh()
      })
      .catch((e: unknown) => {
        setActionHint(hintFromError(e))
        refresh()
      })
  }

  const selectedRemote = createMemo(() => {
    const list = data()?.remotes ?? []
    return list.find((item) => item.name === remote()) ?? pickDefaultRemote(list)
  })

  const statusRows = createMemo(() =>
    deriveStatusRows(
      data()?.status ?? EMPTY_STATUS,
      data()?.numstat ?? [],
      data()?.remotes ?? [],
      selectedRemote(),
      // 动作失败的原因优先于数据加载的 error:前者是用户刚按下的键的直接反馈,
      // 过一会被后台刷新的旧 error 盖掉会让人以为按键没生效。
      actionHint() ?? data()?.error,
    ),
  )
  const fileRows = createMemo(() => deriveFileRows(data()?.status ?? EMPTY_STATUS, data()?.numstat ?? []))
  // 分支行要从原始 GitBranch 派生(领先/落后要拼成 ↑N ↓M);commits 与 stash 拉回来就已经是行形状。
  const branchRows = createMemo(() => deriveBranchRows(data()?.branches ?? []))
  const commitRows = createMemo(() => data()?.commits ?? [])
  const stashRows = createMemo(() => data()?.stash ?? [])

  const tooNarrow = () => props.width < TOO_NARROW
  const leftWidth = () => (props.width < 80 ? LEFT_NARROW : LEFT_WIDE)

  const moveRow = (delta: number) => {
    if (panel() === "status") {
      setStatusRow((n) => clamp(n + delta, 0, statusRows().length - 1))
      return
    }
    if (panel() === "files") {
      setFileRow((n) => clamp(n + delta, 0, fileRows().length - 1))
      return
    }
    if (panel() === "branches") {
      setBranchRow((n) => clamp(n + delta, 0, branchRows().length - 1))
      return
    }
    // 提交面板复用 fileRow,但 clamp 的上限得用提交自己的行数:两份表的长度完全不同。
    if (panel() === "commits") {
      setFileRow((n) => clamp(n + delta, 0, commitRows().length - 1))
      return
    }
    if (panel() === "stash") setStashRow((n) => clamp(n + delta, 0, stashRows().length - 1))
  }

  // 列表收缩时把选中行夹回范围内:moveRow 每一步都 clamp,但 refresh() 换掉整个列表时
  // 没人管 —— discard/delete 后列表变少,fileRow 会越界:文件面板不再高亮任何行,
  // 差异面板、键位条却还按旧行说事。四个面板各夹各的。commits 复用 fileRow,它的行数由
  // moveRow 里用 commitRows 单独算,这里夹的仍是文件表 —— 已知瑕疵:文件表比提交表短时,
  // refresh 会把提交面板的选中行夹回文件表长度(症状是「我刚选的那行跳回去了」),
  // 换独立 commitRow 时一并修。
  createEffect(() => {
    const max = Math.max(0, statusRows().length - 1)
    if (statusRow() > max) setStatusRow(max)
  })
  createEffect(() => {
    const max = Math.max(0, fileRows().length - 1)
    if (fileRow() > max) setFileRow(max)
  })
  createEffect(() => {
    const max = Math.max(0, branchRows().length - 1)
    if (branchRow() > max) setBranchRow(max)
  })
  createEffect(() => {
    const max = Math.max(0, stashRows().length - 1)
    if (stashRow() > max) setStashRow(max)
  })

  /** 把焦点切到某个面板,同时退出差异激活模式。 */
  const focusPanel = (id: PanelID) => {
    // 切面板必须退出差异激活模式(Task 9):两个面板不能同时「有焦点」,否则差异模式下 tab 之后
    // j/k 还在滚动差异而不是移动行。Task 9 接上拦截器之前 setDiffFocus 只有写入没有读取。
    setDiffFocus(false)
    setPanel(id)
  }

  /** 循环切到下一个远端(规格「多远程」)。 */
  const switchRemote = () => {
    const list = data()?.remotes ?? []
    // 没有远端时不提示、直接开输入框:「未配置远端」那一行本身就是给一个可按键的入口。
    if (list.length === 0) return openInput({ kind: "remote-add" })
    // 切换本身不执行任何 git 命令,只改选中状态:推送/拉取时才拿这个值。
    const index = list.findIndex((item) => item.name === remote())
    setRemote(list[(index + 1) % list.length]?.name)
  }

  /** 执行一条工作区命令。所有键位处理最终都汇到这里。 */
  const run = (command: WorkspaceCommand) => {
    const cwd = props.rootPath

    // 窄宽度下整个工作区只剩一句「请加宽」——面板、确认行都不在,键位自然也该整体静默。
    // 只放行 global.close:用户得能退出去。其余键(尤其危险键)在这里按了也看不见任何效果,
    // 危险键更是「无提示的破坏」—— 宽屏下 d d 连按有「再按一次」黄条兜底,窄屏下什么都没有。
    if (tooNarrow() && command !== "global.close") {
      confirm.clear()
      setArmed(undefined)
      return
    }

    // 非危险命令一律清掉待确认态:用户按了别的键就说明他改主意了。
    // 不清的话,d 武装后按 j 移动一下光标,那行「再按一次 d 确认」会一直挂到超时。
    // (press 只在下面的 DANGEROUS_COMMANDS 分支里被调用,非危险键走不到那里。)
    if (!DANGEROUS_COMMANDS.has(command) && armed()) {
      confirm.clear()
      setArmed(undefined)
    }

    if (command === "panel.next") return setPanel((p) => panelAt(PANEL_ORDER.indexOf(p) + 1))
    if (command === "panel.prev") return setPanel((p) => panelAt(PANEL_ORDER.indexOf(p) - 1))
    if (command.startsWith("panel.jump:")) return focusPanel(panelAt(Number(command.slice("panel.jump:".length))))
    if (command === "row.up") return moveRow(-1)
    if (command === "row.down") return moveRow(1)
    if (command === "global.close") return props.onClose()
    // 手动刷新是用户主动「重新对一遍账」:上一次失败的原因到此为止,别继续挂在提示行上。
    if (command === "global.refresh") {
      setActionHint(undefined)
      return refresh()
    }

    // 危险命令先进确认态;fire 才真往下走,armed/cancel 都只是状态变化。
    if (DANGEROUS_COMMANDS.has(command)) {
      const blocked = blockedDanger(command)
      if (blocked) return setActionHint(blocked)
      const target = dangerTarget(command)
      const result = confirm.press(command, dangerLabel(command), target)
      setArmed(confirm.pending())
      if (result !== "fire") return
    }

    if (!cwd) return

    if (command === "files.stage") {
      const row = fileRows()[fileRow()]
      if (!row) return
      // 已暂存的再按空格是取消暂存(restore 撤回索引),没暂存的才是 add。
      const args = row.staged ? ["restore", "--staged", "--", row.file] : ["add", "--", row.file]
      runGit(args)
      return
    }
    if (command === "files.stageAll") {
      runGit(["add", "-A"])
      return
    }
    if (command === "files.focusDiff") {
      const row = fileRows()[fileRow()]
      if (row) setDiffTarget({ kind: "file", path: row.file })
      return
    }
    if (command === "commits.focusDiff") {
      const row = data()?.commits[fileRow()]
      if (row) setDiffTarget({ kind: "commit", hash: row.hash })
      return
    }
    if (command === "files.discard" || command === "files.delete") {
      // 按武装时拍下的目标执行,不重读选中行 —— 武装到 fire 之间列表可能已被后台刷新换掉,
      // 重读会把丢弃/删除落到另一个文件头上。
      const target = confirm.takeFiredTarget()
      if (!target || !("file" in target)) return
      const args =
        command === "files.delete"
          ? ["clean", "-f", "--", target.file]
          : ["restore", "--worktree", "--staged", "--", target.file]
      runGit(args)
      return
    }
    if (command === "branches.delete" || command === "stash.discard") {
      // 和 files.* 同理:按武装时拍下的目标执行,不重读选中行。
      const target = confirm.takeFiredTarget()
      if (!target) return
      if ("branch" in target) return runGit(["branch", "-D", target.branch])
      if ("ref" in target) return runGit(["stash", "drop", target.ref])
    }
    if (command === "status.m") return switchRemote()
    if (command === "status.space") {
      // 空格按当前行分派(规格「状态」):分支行跳面板、远程行切远端、变更行全暂存/全取消。
      // 「提示」行不做任何事 —— 空格落在这一行时静默,而不是报一条没用的提示。
      const row = statusRows()[statusRow()]
      if (!row) return
      if (row.kind === "branch") return focusPanel("branches")
      if (row.kind === "remote") return switchRemote()
      if (row.kind === "changes") {
        // 有未暂存改动就全暂存,一个都没有就全取消 —— 同一个键在两种状态下互为逆操作。
        const unstaged = (data()?.status.entries ?? []).some((entry) => entry.unstaged)
        return unstaged ? runGit(["add", "-A"]) : runGit(["restore", "--staged", "--", "."])
      }
    }
    if (command === "branches.checkout") {
      const row = branchRows()[branchRow()]
      // detached 的哨兵行不是引用,切过去必然报错。
      if (!row || row.name.startsWith("(HEAD")) return
      // 远程分支(带 /)也直接 switch:git 会给它建一个本地跟踪分支。失败时 runGit 写提示行,
      // 不比我们自己判一遍本地是否已存在更糟 —— 而自己判就有两套真相源。
      return runGit(["switch", row.name])
    }
    if (command === "branches.new") return openInput({ kind: "branch-new" })
    if (command === "commits.undo") {
      if ((data()?.commits.length ?? 0) === 0) return
      // 规格「提交」:只回退最近一次提交到暂存区,不做操作级撤销栈。
      return runGit(["reset", "--soft", "HEAD~1"])
    }
    if (command === "stash.pop") {
      const row = stashRows()[stashRow()]
      if (!row) return
      return runGit(["stash", "pop", row.ref])
    }
    if (command === "global.pull" || command === "global.push") {
      const name = selectedRemote()?.name
      const branch = data()?.status.branch
      if (!name || !branch) return
      const args = command === "global.pull" ? ["pull", name, branch] : ["push", name, branch]
      runGit(args)
      return
    }
    if (command === "global.commit") {
      // 计划 1 里提交是「还不可用」的占位,计划 2 才接上行内输入。
      // 但**两种情况都得给反馈**:早先版本只在没有暂存内容时提示,已暂存时按 c 什么也不发生 ——
      // 用户照着提示暂存完,按下去却毫无反应,比不放这个键还糟。
      const staged = (data()?.status.entries ?? []).filter((entry) => entry.staged)
      setArmed({
        key: "c",
        label: staged.length === 0 ? "先暂存改动(空格)再提交" : "提交输入框还没接上,本版暂不能提交",
        deadline: Date.now() + 3000,
      })
      return
    }
  }

  // tab/shift+tab 不能只靠上面的 useKeyboard:keymap host 用 prependListener 抢在所有
  // useKeyboard 前面收事件,而 app.tsx 的 agent.cycle(切代理)正绑着这俩键 —— keymap 命中
  // binding 就 stopPropagation,工作区的拦截器根本看不见它们(实测:按 tab 只会静默切代理)。
  // 对策与 diff-viewer 绑 tab 同款:组件挂载期间注册一个自己的层,同键冲突时**后注册的层
  // 优先**(层按 priority 降序、注册序降序排),tab 由 keymap 直接派发到 run()。
  // 组件卸载(切回聊天 tab)即自动注销,agent.cycle 随之恢复 —— 不 push mode,是因为 push 会把
  // 整个 mode: base 层一起弄失活(含 ctrl+c 退出),爆炸半径远大于这两个键。
  useBindings(() => ({
    bindings: [
      { key: "tab", desc: "下一个面板", group: "Git 工作区", cmd: () => run("panel.next") },
      { key: "shift+tab", desc: "上一个面板", group: "Git 工作区", cmd: () => run("panel.prev") },
    ],
  }))

  // 键位拦截:先问工作区,答得上来就吃掉;答不上来就放行(聊天输入框还能打字)。
  // 没解析出命令的键(要漏给聊天输入框的那些)一律取消确认态。和 run() 里的那次清理
  // 合起来才构成完整契约:**除危险命令的 press 之外,任何按键路径都清武装态**。
  // 漏了这条会出事:d 武装后按 q(漏过)、3 秒内再按 d —— 直接就 discard 了。
  useKeyboard((event) => {
    const command = resolveWorkspaceCommand(panel(), keyOfParsed(event))
    if (command) {
      event.preventDefault()
      event.stopPropagation()
      run(command)
      return
    }
    if (armed() !== undefined) {
      confirm.clear()
      setArmed(undefined)
    }
  })

  // 太窄提示必须是响应式的(Show),不能用裸 early-return —— 组件体只在挂载时执行一次,
  // 裸 if 在终端拉窄后不会重新求值,提示永远停在挂载时的那一帧。
  // 键位静默的闸门在 run() 顶部(只放行 global.close),和这里的显示闸门是同一条件的两半。
  return (
    <Show
      when={!tooNarrow()}
      fallback={
        <box flexGrow={1} minHeight={0} alignItems="center" justifyContent="center">
          <text fg={theme.warning}>终端太窄,请加宽到 70 列以上</text>
        </box>
      }
    >
      <box flexDirection="column" flexGrow={1} minHeight={0}>
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <box flexDirection="column" width={leftWidth()} flexShrink={0} minHeight={0}>
            <For each={PANEL_ORDER}>
              {(id) => (
                <PanelFrame title={PANEL_TITLE[id]} focused={panel() === id}>
                  <Show when={id === "status"}>
                    <StatusPanel
                      rows={statusRows()}
                      selected={() => (panel() === "status" ? statusRow() : -1)}
                      remoteUrl={selectedRemote()?.url}
                      // 边框吃掉左右各 1 列:面板内部的截断算式量的是**内容宽**,不是框外宽。
                      // 少这 2 列修正,状态行的计数就会顶破右边框(与 Task 6/7 的宽度账目同类)。
                      width={leftWidth() - 2}
                    />
                  </Show>
                  <Show when={id === "files"}>
                    <FilesPanel
                      rows={fileRows()}
                      selected={() => (panel() === "files" ? fileRow() : -1)}
                      armed={armedFor("file")}
                      width={leftWidth() - 2}
                    />
                  </Show>
                  {/* 三块新面板的宽度账目与状态/文件面板同源:边框吃掉左右各 1 列,面板内截断算式量的是内容宽。
                    selected 非当前面板一律传 -1(没有任何行带焦点标记),否则切走焦点后旧面板还亮着一行。 */}
                  <Show when={id === "branches"}>
                    <BranchesPanel
                      rows={branchRows()}
                      selected={() => (panel() === "branches" ? branchRow() : -1)}
                      armed={armedFor("branch")}
                      width={leftWidth() - 2}
                    />
                  </Show>
                  <Show when={id === "commits"}>
                    <CommitsPanel
                      rows={commitRows()}
                      selected={() => (panel() === "commits" ? fileRow() : -1)}
                      width={leftWidth() - 2}
                    />
                  </Show>
                  <Show when={id === "stash"}>
                    <StashPanel
                      rows={stashRows()}
                      selected={() => (panel() === "stash" ? stashRow() : -1)}
                      armed={armedFor("ref")}
                      width={leftWidth() - 2}
                    />
                  </Show>
                </PanelFrame>
              )}
            </For>
          </box>
          {/* 差异区同样上整圈边框(Lazygit 主视图也是带框的),标题固定「差异」——
            看的是哪个文件/提交由面板内的标题行交代,两层各说各的。 */}
          <box
            border
            borderStyle="rounded"
            borderColor={theme.border}
            title=" 差异 "
            titleColor={theme.textMuted}
            flexGrow={1}
            minHeight={0}
          >
            <GitDiffPanel target={diffTarget()} rootPath={props.rootPath} />
          </box>
        </box>
        {/* 底部键位条:全局段常驻,焦点段跟着焦点面板变(规格「底部键位提示条跟着焦点面板变」)。
          拆两行而不是拼一行:拼起来超过 70 列,规格要求 70 列终端可用,单行在窄档会把尾部裁掉。
          确认态时全局段让位、整条换成确认文案 —— 这是「不弹窗」方案里唯一的强提示位。 */}
        <box flexDirection="column" flexShrink={0} paddingLeft={1} paddingTop={1}>
          <Show when={armed() === undefined}>
            <text fg={theme.textMuted} wrapMode="none">
              {GLOBAL_KEYBAR}
            </text>
          </Show>
          <text fg={armed() === undefined ? theme.textMuted : theme.warning} wrapMode="none">
            {keybarText(panel(), armed())}
          </text>
        </box>
      </box>
    </Show>
  )
}

function PanelFrame(props: { title: string; focused: boolean; children?: JSX.Element }) {
  const { theme } = useTheme()
  // Lazygit 式整圈边框:聚焦面板边框走 primary 高亮,其余走普通 border 色。
  // 标题嵌在**上边框那行**(opentui 原生 title,写法先例 error-component.tsx:121-124),
  // 不再像旧版那样自画一行 `┌ 状态 ─` 前缀。
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={props.focused ? theme.primary : theme.border}
      title={` ${props.title} `}
      titleColor={props.focused ? theme.primary : theme.textMuted}
      flexGrow={1}
      minHeight={0}
    >
      {props.children}
    </box>
  )
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function dangerLabel(command: WorkspaceCommand): string {
  if (command === "files.discard") return "再按一次 d 丢弃这个文件的改动"
  if (command === "files.delete") return "再按一次 x 删除这个未跟踪文件"
  if (command === "branches.delete") return "再按一次 d 删除这个分支"
  return "再按一次 d 丢弃这个贮藏"
}

/**
 * 键位条的全局段:跨面板都成立的键,常驻显示(不随焦点变)。
 * 只写**真能按出结果**的键:`tab 切面板` 和 `r 刷新` 都完整可用。
 * `c 提交` 保留但不再写「(需先暂存)」—— 计划 1 里提交还是占位,按 c 会弹一句
 * 「输入框还没接上」。把前置条件印在键位条上会让人以为照做就能提交,
 * 比诚实地说它还不可用更糟(见 run() 里两种情况都给反馈的原因)。
 */
const GLOBAL_KEYBAR = "tab 切面板 c 提交 r 刷新"

/**
 * 键位条的焦点段文字,内容跟着焦点面板变(规格「底部键位提示条跟着焦点面板变」)。
 * 确认态时整条换成确认文案 —— 这是「不弹窗」方案里唯一的强提示位。
 */
function keybarText(panel: PanelID, armed?: ArmedConfirm): string {
  if (armed) return armed.label
  if (panel === "files") return "j/k 选 空格 暂存 a 全部暂存 enter 看差异 d 丢弃 ? 帮助"
  if (panel === "status") return "j/k 选行 空格 作用于当前行 p 拉取 f 推送 ? 帮助"
  if (panel === "branches") return "j/k 选 空格 切换 n 新建 d 删除 ? 帮助"
  if (panel === "commits") return "j/k 选 enter 看差异 z 撤销上次提交 ? 帮助"
  return "j/k 选 空格 弹出 d 丢弃 ? 帮助"
}

/** 数据还没回来(或不是 git 仓库)时的空状态。显式标类型,免得 `??` 右边的字面量把联合类型撑开。 */
const EMPTY_STATUS: GitStatusSummary = { ahead: 0, behind: 0, entries: [] }
