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
  deriveFileRows,
  deriveStatusRows,
  loadWorkspace,
  pickDefaultRemote,
  type WorkspaceData,
} from "./git-workspace/state"
import { GitDiffPanel, type DiffTarget } from "./git-workspace/diff-panel"
import { FilesPanel } from "./git-workspace/files-panel"
import { StatusPanel } from "./git-workspace/status-panel"

const LEFT_WIDE = 36
const LEFT_NARROW = 30
const TOO_NARROW = 70

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
  const [diffTarget, setDiffTarget] = createSignal<DiffTarget>({ kind: "none" })
  const [armed, setArmed] = createSignal<ArmedConfirm | undefined>(undefined)
  const [remote, setRemote] = createSignal<string | undefined>(undefined)

  // 真实时钟注入给确认态。测试里换假时钟就能推时间(见 git-workspace-confirm.test.ts)。
  const confirm = createConfirm(() => Date.now())

  const refresh = () => {
    const cwd = props.rootPath
    if (!cwd) return
    loadWorkspace(cwd).then((next) => {
      setData(next)
      // 选中远端跟着数据走,但用户手动切过就以用户的选择为准。
      setRemote((prev) => prev ?? pickDefaultRemote(next.remotes)?.name)
    })
  }

  createEffect(() => refresh())
  onCleanup(() => setArmed(undefined))

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
      data()?.error,
    ),
  )
  const fileRows = createMemo(() => deriveFileRows(data()?.status ?? EMPTY_STATUS, data()?.numstat ?? []))

  const tooNarrow = () => props.width < TOO_NARROW
  const leftWidth = () => (props.width < 80 ? LEFT_NARROW : LEFT_WIDE)

  const moveRow = (delta: number) => {
    if (panel() === "status") {
      setStatusRow((n) => clamp(n + delta, 0, statusRows().length - 1))
      return
    }
    if (panel() === "files") setFileRow((n) => clamp(n + delta, 0, fileRows().length - 1))
  }

  /** 执行一条工作区命令。所有键位处理最终都汇到这里。 */
  const run = (command: WorkspaceCommand) => {
    const cwd = props.rootPath

    // 非危险命令一律清掉待确认态:用户按了别的键就说明他改主意了。
    // 不清的话,d 武装后按 j 移动一下光标,那行「再按一次 d 确认」会一直挂到超时。
    // (press 只在下面的 DANGEROUS_COMMANDS 分支里被调用,非危险键走不到那里。)
    if (!DANGEROUS_COMMANDS.has(command) && armed()) {
      confirm.clear()
      setArmed(undefined)
    }

    if (command === "panel.next") return setPanel((p) => panelAt(PANEL_ORDER.indexOf(p) + 1))
    if (command === "panel.prev") return setPanel((p) => panelAt(PANEL_ORDER.indexOf(p) - 1))
    if (command.startsWith("panel.jump:")) return setPanel(panelAt(Number(command.slice("panel.jump:".length))))
    if (command === "row.up") return moveRow(-1)
    if (command === "row.down") return moveRow(1)
    if (command === "global.close") return props.onClose()
    if (command === "global.refresh") return refresh()

    // 危险命令先进确认态;fire 才真往下走,armed/cancel 都只是状态变化。
    if (DANGEROUS_COMMANDS.has(command)) {
      const result = confirm.press(command, dangerLabel(command))
      setArmed(confirm.pending())
      if (result !== "fire") return
    }

    if (!cwd) return

    if (command === "files.stage") {
      const row = fileRows()[fileRow()]
      if (!row) return
      // 已暂存的再按空格是取消暂存(restore 撤回索引),没暂存的才是 add。
      const args = row.staged ? ["restore", "--staged", "--", row.file] : ["add", "--", row.file]
      gitExec(cwd, args).then(() => refresh())
      return
    }
    if (command === "files.stageAll") {
      gitExec(cwd, ["add", "-A"]).then(() => refresh())
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
      const row = fileRows()[fileRow()]
      if (!row) return
      const args =
        command === "files.delete"
          ? ["clean", "-f", "--", row.file]
          : ["restore", "--worktree", "--staged", "--", row.file]
      gitExec(cwd, args).then(() => refresh())
      return
    }
    if (command === "status.space" || command === "status.m") {
      // 远程行:循环切远端。切换本身不执行任何 git 命令,只改选中状态(规格「多远程」)。
      const list = data()?.remotes ?? []
      if (list.length === 0) return
      const index = list.findIndex((item) => item.name === remote())
      setRemote(list[(index + 1) % list.length]?.name)
      return
    }
    if (command === "global.pull" || command === "global.push") {
      const name = selectedRemote()?.name
      const branch = data()?.status.branch
      if (!name || !branch) return
      const args = command === "global.pull" ? ["pull", name, branch] : ["push", name, branch]
      gitExec(cwd, args).then(() => refresh())
      return
    }
    if (command === "global.commit") {
      // 计划 1 里提交是「还不可用」的占位:没有暂存内容时给一句提示,计划 2 接上行内输入。
      const staged = (data()?.status.entries ?? []).filter((entry) => entry.staged)
      if (staged.length === 0) setArmed({ key: "c", label: "没有可提交的暂存内容", deadline: Date.now() + 3000 })
      return
    }
  }

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

  if (tooNarrow()) {
    return (
      <box flexGrow={1} minHeight={0} alignItems="center" justifyContent="center">
        <text fg={theme.warning}>终端太窄,请加宽到 70 列以上</text>
      </box>
    )
  }

  return (
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
                    width={leftWidth()}
                  />
                </Show>
                <Show when={id === "files"}>
                  <FilesPanel
                    rows={fileRows()}
                    selected={() => (panel() === "files" ? fileRow() : -1)}
                    armed={armed()}
                    width={leftWidth()}
                  />
                </Show>
              </PanelFrame>
            )}
          </For>
        </box>
        <box flexGrow={1} minHeight={0}>
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
  )
}

function PanelFrame(props: { title: string; focused: boolean; children?: JSX.Element }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      {/* ⚠️ paddingLeft 必须包 <box> —— 写在 <text> 上在 opentui 里无效(见本计划开头的通用约定)。 */}
      <box paddingLeft={1}>
        <text fg={props.focused ? theme.primary : theme.textMuted} wrapMode="none">
          {props.focused ? `┌ ${props.title} ─` : `┌ ${props.title}`}
        </text>
      </box>
      <box flexDirection="column" flexGrow={1} minHeight={0}>
        {props.children}
      </box>
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
 * `c 提交` 写明前置条件 —— 计划 1 里提交是占位,暂存区为空时按 c 只会得到
 * 「没有可提交的暂存内容」,先把前置条件摆在键位条上比让用户撞一次好。
 * `tab 切面板` 同理:五个面板靠它来回走,原先只活在键位表里、提示条上一个字都没有。
 */
const GLOBAL_KEYBAR = "tab 切面板 c 提交(需先暂存)"

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
