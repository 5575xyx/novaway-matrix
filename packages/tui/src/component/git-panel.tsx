// 侧栏 Git 页:直接在 TUI 进程里异步跑 git(和剪贴板/编辑器起子进程同一套路),
// 不经过服务器。查询只读;可逆操作(暂存/提交/贮藏/切分支)直接做;
// 不可逆或对外的操作(推送/拉取/丢弃/删分支/撤销提交)一律先弹确认框再执行。
// 轮询自动刷新;点变更文件名开"改动差异"标签页。
// 版式:crush 式节标题(标题 + ─ 填满)把面板切成 同步/变更/分支/历史 四段;
// 危险按钮(丢弃/删分支)平时隐形、悬停行才显形,避免满屏红字。
import { createMemo, createSignal, For, Show } from "solid-js"
import path from "node:path"
import { useTheme } from "../context/theme"
import {
  parseGitBranches,
  parseGitCommit,
  parseGitStatus,
  parseGitStashList,
  type GitBranch,
  type GitFileEntry,
  type GitStashEntry,
} from "../util/git-status"
import { useAutoRefresh } from "../util/auto-refresh"
import { gitExec } from "../util/git-exec"
import { Locale } from "../util/locale"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogAlert } from "../ui/dialog-alert"
import { useToast } from "../ui/toast"

const COMMIT_LIMIT = 8
// 每组文件最多显示几行:用户改动几十个文件时,不把"历史"段挤出屏幕。
const FILE_GROUP_MAX = 12
// 文件名截断宽度:侧栏 42 列减去状态码、悬停出现的"丢弃"按钮和内边距。
const FILE_LABEL_MAX = 24
const COMMIT_SUBJECT_MAX = 30
const COMMIT_MESSAGE_MAX = 200
// 提交详情弹窗最多展示的行数,大提交的 --stat 清单截断。
const COMMIT_DETAIL_MAX = 40
// 分支列表最多显示几行,再多走"还有 N 个"。
const BRANCH_MAX = 10
const BRANCH_LABEL_MAX = 22
// 节标题的横线填充,行宽 40 足够溢出被裁掉。
const DASH_RUN = "─".repeat(40)

export interface GitPanelProps {
  rootPath?: string
  /** 点变更文件名:打开该文件的"改动差异"标签页 */
  onOpenDiff?: (filePath: string) => void
}

// 状态字母 -> 颜色语义:新增是好事用绿,删除是破坏用红,修改用警告黄,未跟踪最弱。
function statusColor(status: GitFileEntry["status"], theme: ReturnType<typeof useTheme>["theme"]) {
  switch (status) {
    case "added":
    case "renamed":
      return theme.success
    case "deleted":
      return theme.error
    case "modified":
      return theme.warning
    default:
      return theme.textMuted
  }
}

function statusLetter(entry: GitFileEntry) {
  if (entry.code === "??") return "?"
  return entry.code.trim() || "?"
}

export function GitPanel(props: GitPanelProps) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const [summary, setSummary] = createSignal<ReturnType<typeof parseGitStatus> | null>(null)
  const [commits, setCommits] = createSignal<string[]>([])
  const [branches, setBranches] = createSignal<GitBranch[]>([])
  const [stashes, setStashes] = createSignal<GitStashEntry[]>([])
  const [error, setError] = createSignal<string>("")
  const [loading, setLoading] = createSignal(true)
  const [busy, setBusy] = createSignal(false)

  const git = (args: string[]) => {
    const cwd = props.rootPath
    if (!cwd) throw new Error("no cwd")
    return gitExec(cwd, args)
  }

  const load = async () => {
    const cwd = props.rootPath
    if (!cwd) return
    setLoading(true)
    try {
      const [status, log, branchOut, stashOut] = await Promise.all([
        git(["status", "--porcelain=v1", "-b"]),
        // 单独兜底:空仓库(一个提交都没有)时 log 会失败,但 status 是好的,别让 log 把整页拖成报错。
        git(["log", "--oneline", "-n", String(COMMIT_LIMIT)]).catch(() => ({ stdout: "" })),
        git(["branch"]).catch(() => ({ stdout: "" })),
        git(["stash", "list"]).catch(() => ({ stdout: "" })),
      ])
      setSummary(parseGitStatus(status.stdout))
      setCommits(log.stdout.split("\n").filter((line) => line.length > 0))
      setBranches(parseGitBranches(branchOut.stdout))
      setStashes(parseGitStashList(stashOut.stdout))
      setError("")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setSummary(null)
      setCommits([])
      setBranches([])
      setStashes([])
      setError(message.includes("not a git repository") ? "不是 git 仓库" : "git 不可用")
    } finally {
      setLoading(false)
    }
  }

  useAutoRefresh(load)

  const branch = createMemo(() => summary()?.branch)
  const upstream = createMemo(() => summary()?.upstream)
  const tracking = createMemo(() => {
    const data = summary()
    if (!data) return ""
    const parts: string[] = []
    if (data.ahead > 0) parts.push(`↑${data.ahead}`)
    if (data.behind > 0) parts.push(`↓${data.behind}`)
    return parts.join(" ")
  })
  // 未跟踪文件算"未暂存"组,和 lazygit 的分法一致。
  const staged = createMemo(() => (summary()?.entries ?? []).filter((entry) => entry.staged))
  const unstaged = createMemo(() => (summary()?.entries ?? []).filter((entry) => entry.unstaged))
  // 空仓库的分支行是 "No commits yet on main"、detached 是 "(HEAD detached at …)",
  // 都不是可操作的分支名,提交/推送/切换一律当成"没有分支"。
  const branchName = createMemo(() => {
    const name = branch()
    if (!name || name.startsWith("No commits yet") || name.startsWith("(HEAD detached")) return undefined
    return name
  })
  const hasChanges = createMemo(() => staged().length + unstaged().length > 0)

  const openDiff = (entry: GitFileEntry) => {
    if (!props.rootPath) return
    props.onOpenDiff?.(path.join(props.rootPath, entry.file))
  }

  const run = async (args: string[], successText: string) => {
    setBusy(true)
    try {
      await git(args)
      toast.show({ variant: "success", message: successText })
      await load()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      toast.show({ variant: "error", message })
    } finally {
      setBusy(false)
    }
  }

  // 确认框快捷方式:取消返回 undefined,确认返回 true。
  const confirm = (title: string, message: string) => DialogConfirm.show(dialog, title, message)

  const stage = (entry: GitFileEntry) => void run(["add", "--", entry.file], `已暂存 ${entry.file}`)
  const unstage = (entry: GitFileEntry) => void run(["reset", "HEAD", "--", entry.file], `已取消暂存 ${entry.file}`)
  const stageAll = () => void run(["add", "-A"], "已暂存全部变更")

  // 丢弃:未跟踪文件直接删除,已跟踪文件把工作区恢复到暂存区版本。都不可恢复,先确认。
  const discard = async (entry: GitFileEntry) => {
    const isUntracked = entry.status === "untracked"
    const confirmed = await confirm(
      isUntracked ? "删除未跟踪文件" : "丢弃未暂存改动",
      isUntracked
        ? `将删除 ${entry.file}，删除后无法恢复，确定?`
        : `将丢弃 ${entry.file} 的未暂存改动，无法恢复，确定?`,
    )
    if (!confirmed) return
    await run(isUntracked ? ["clean", "-f", "--", entry.file] : ["checkout", "--", entry.file], `已丢弃 ${entry.file}`)
  }

  const commit = async () => {
    if (staged().length === 0) return
    const message = await DialogPrompt.show(dialog, "提交说明", {
      placeholder: "一句话说明这次提交",
    })
    if (!message?.trim()) return
    await run(["commit", "-m", Locale.oneLine(message.trim(), COMMIT_MESSAGE_MAX)], "提交完成")
  }

  // 什么都不想挑时的快捷路径:先把全部变更暂存,再走同一条提交流程。
  const commitAll = async () => {
    setBusy(true)
    try {
      await git(["add", "-A"])
    } catch (e) {
      toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e) })
      setBusy(false)
      return
    }
    setBusy(false)
    await commit()
  }

  // 撤销上次提交:改动退回已暂存区,不丢内容;确认后执行。
  const undoCommit = async () => {
    if (commits().length === 0) return
    const confirmed = await confirm("撤销上次提交", "改动会回到已暂存区，提交本身被撤销，确定?")
    if (!confirmed) return
    await run(["reset", "--soft", "HEAD~1"], "已撤销上次提交")
  }

  // 推送:对外操作,弹确认框;没有上游时挑第一个 remote 用 push -u 建立跟踪。
  const push = async () => {
    const name = branchName()
    if (!name) return
    const aheadCount = summary()?.ahead ?? 0
    const target = upstream() ?? "远程仓库"
    const confirmed = await confirm(
      "推送到远程",
      aheadCount > 0
        ? `将把 ${name} 的 ${aheadCount} 个提交推送到 ${target}，确定?`
        : `将推送 ${name} 到 ${target}${upstream() ? "" : "（首次推送会建立跟踪）"}，确定?`,
    )
    if (!confirmed) return
    if (upstream()) {
      await run(["push"], "已推送到远程")
      return
    }
    try {
      const remotes = await git(["remote"])
      const remote = remotes.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)[0]
      if (!remote) {
        toast.show({ variant: "error", message: "没有配置远程仓库,先 git remote add" })
        return
      }
      await run(["push", "-u", remote, name], `已推送到 ${remote} 并建立跟踪`)
    } catch (e) {
      toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e) })
    }
  }

  // 拉取:合并远程改动,需要上游;落后 N 个提交时在确认框里说清楚。
  const pull = async () => {
    if (!upstream()) return
    const behindCount = summary()?.behind ?? 0
    const confirmed = await confirm(
      "拉取远程",
      behindCount > 0 ? `远程有 ${behindCount} 个新提交，将合并进 ${branchName()}，确定?` : "拉取远程最新改动，确定?",
    )
    if (!confirmed) return
    await run(["pull", "--no-edit"], "已拉取远程改动")
  }

  // 贮藏:全部改动(含未跟踪文件)收进贮藏,工作区恢复干净;弹出恢复最近一次。
  const stash = async () => {
    if (!hasChanges()) return
    const confirmed = await confirm("贮藏改动", "将把全部改动（含未跟踪文件）收进贮藏，工作区恢复干净，确定?")
    if (!confirmed) return
    await run(["stash", "push", "--include-untracked"], "已贮藏全部改动")
  }

  const stashPop = async () => {
    if (stashes().length === 0) return
    await run(["stash", "pop"], "已弹出最近的贮藏")
  }

  const newBranch = async () => {
    const name = await DialogPrompt.show(dialog, "新建分支", {
      placeholder: "分支名，如 feat/git-panel",
    })
    const clean = name?.trim().replace(/\s+/g, "-")
    if (!clean) return
    await run(["checkout", "-b", clean], `已创建并切换到 ${clean}`)
  }

  // 切分支:工作区脏的时候 git 会尝试把改动带过去,带不动就报错留在原地。
  const switchBranch = async (name: string) => {
    if (name === branchName()) return
    const confirmed = await confirm(
      "切换分支",
      hasChanges() ? `有未提交的改动，会尝试带到 ${name}；带不动就留在原地，确定?` : `切换到 ${name}?`,
    )
    if (!confirmed) return
    await run(["checkout", name], `已切换到 ${name}`)
  }

  const deleteBranch = async (name: string) => {
    const confirmed = await confirm("删除分支", `将删除 ${name}（只删已合并的分支），确定?`)
    if (!confirmed) return
    await run(["branch", "-d", name], `已删除分支 ${name}`)
  }

  // 提交详情:git show 的元信息 + --stat 文件清单,行数封顶防止大提交把弹窗撑爆。
  const showCommit = async (hash: string) => {
    try {
      const out = await git(["show", hash, "--stat", "--no-color", "--format=%h  %an  %ad%n%s%n"])
      const lines = out.stdout.trimEnd().split("\n")
      const body =
        lines.length > COMMIT_DETAIL_MAX
          ? [...lines.slice(0, COMMIT_DETAIL_MAX), `… 还有 ${lines.length - COMMIT_DETAIL_MAX} 行`].join("\n")
          : lines.join("\n")
      DialogAlert.show(dialog, "提交详情", body)
    } catch (e) {
      toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e) })
    }
  }

  // crush 式节标题:标题 + 可选动作 + "─"填满剩余宽,给面板分区让层次一眼可辨。
  const SectionHeader = (p: { text: string; action?: string; onAction?: () => void }) => (
    <box flexDirection="row" gap={1} overflow="hidden" flexShrink={0}>
      <text flexShrink={0} fg={theme.text}>
        {p.text}
      </text>
      <Show when={p.action}>
        <text flexShrink={0} fg={theme.primary} onMouseUp={p.onAction}>
          {p.action}
        </text>
      </Show>
      <text fg={theme.border} wrapMode="none">
        {DASH_RUN}
      </text>
    </box>
  )

  // 文件行:+M(点击 = 暂存/取消暂存)+ 文件名(点击 = 看改动差异)+ 悬停才显形的"丢弃"。
  // "丢弃"占位恒定:隐形时用背景色渲染,不改变行宽,避免悬停瞬间抖动。
  // span 挂不了鼠标事件,可点的部分必须是独立的 text 元素。
  const FileRow = (entryProps: { entry: GitFileEntry; mode: "staged" | "unstaged" }) => {
    const [rowHover, setRowHover] = createSignal(false)
    return (
      <box
        flexDirection="row"
        paddingLeft={1}
        onMouseOver={() => setRowHover(true)}
        onMouseOut={() => setRowHover(false)}
      >
        <text
          width={2}
          flexShrink={0}
          fg={statusColor(entryProps.entry.status, theme)}
          onMouseUp={() =>
            entryProps.mode === "staged" ? unstage(entryProps.entry) : stage(entryProps.entry)
          }
        >
          {entryProps.mode === "staged" ? "−" : "+"}
          {statusLetter(entryProps.entry)}
        </text>
        <text flexGrow={1} fg={theme.text} wrapMode="none" onMouseUp={() => openDiff(entryProps.entry)}>
          {Locale.oneLine(entryProps.entry.file, FILE_LABEL_MAX)}
        </text>
        <Show when={entryProps.mode === "unstaged"}>
          <text
            flexShrink={0}
            fg={rowHover() ? theme.error : theme.backgroundPanel}
            onMouseUp={() => void discard(entryProps.entry)}
          >
            {" 丢弃"}
          </text>
        </Show>
      </box>
    )
  }

  // 分支行:点名字切换;悬停显形"删"(同样占位恒定)。
  const BranchRow = (rowProps: { name: string }) => {
    const [rowHover, setRowHover] = createSignal(false)
    return (
      <box
        flexDirection="row"
        paddingLeft={1}
        onMouseOver={() => setRowHover(true)}
        onMouseOut={() => setRowHover(false)}
      >
        <text flexGrow={1} fg={theme.textMuted} wrapMode="none" onMouseUp={() => void switchBranch(rowProps.name)}>
          {Locale.oneLine(rowProps.name, BRANCH_LABEL_MAX)}
        </text>
        <text
          flexShrink={0}
          fg={rowHover() ? theme.error : theme.backgroundPanel}
          onMouseUp={() => void deleteBranch(rowProps.name)}
        >
          {" 删"}
        </text>
      </box>
    )
  }

  const showPush = () => {
    if (!branchName()) return false
    return (summary()?.ahead ?? 0) > 0 || !upstream()
  }

  return (
    <box flexDirection="column" gap={1}>
      <Show
        when={!error()}
        fallback={<text fg={theme.textMuted}>{error()}</text>}
      >
        {/* 头部:分支名 + 上游 + 领先/落后,一眼看到"我在哪" */}
        <text fg={theme.text} wrapMode="none">
          <span style={{ fg: theme.primary }}>分支 </span>
          <Show when={branch()} fallback={<span style={{ fg: theme.textMuted }}>无</span>}>
            {(name) => (
              <>
                <span style={{ fg: theme.text }}>{name()}</span>
                <Show when={upstream()}>
                  <span style={{ fg: theme.textMuted }}> → {upstream()}</span>
                </Show>
                <Show when={tracking()}>
                  <span style={{ fg: theme.warning }}> {tracking()}</span>
                </Show>
              </>
            )}
          </Show>
        </text>

        {/* 同步节:拉取(有上游才有得拉)+ 推送(有领先提交,或还没建立跟踪) */}
        <Show when={upstream() || showPush()}>
          <box flexDirection="column" gap={1}>
            <SectionHeader text="同步" />
            <box flexDirection="row" gap={2}>
              <Show when={upstream()}>
                <text fg={theme.secondary} onMouseUp={() => void pull()}>
                  {busy() ? "拉取中..." : "拉取"}
                </text>
              </Show>
              <Show when={showPush()}>
                <text fg={theme.secondary} onMouseUp={() => void push()}>
                  {busy() ? "推送中..." : (summary()?.ahead ?? 0) > 0 ? `推送 ${summary()!.ahead} 个提交` : "推送"}
                </text>
              </Show>
            </box>
          </box>
        </Show>

        {/* 变更节:未暂存/已暂存两组;操作按钮统一放组尾,不散在文件行里 */}
        <Show when={unstaged().length > 0 || staged().length > 0}>
          <box flexDirection="column" gap={1}>
            <SectionHeader text={`变更 ${staged().length + unstaged().length}`} />
            <Show when={unstaged().length > 0}>
              <box flexDirection="row">
                <text fg={theme.textMuted}>未暂存 ({unstaged().length})</text>
                <text fg={theme.primary} onMouseUp={stageAll}>
                  {"  暂存全部"}
                </text>
              </box>
              <For each={unstaged().slice(0, FILE_GROUP_MAX)}>
                {(entry) => <FileRow entry={entry} mode="unstaged" />}
              </For>
              <Show when={unstaged().length > FILE_GROUP_MAX}>
                <text fg={theme.textMuted}>… 还有 {unstaged().length - FILE_GROUP_MAX} 个文件</text>
              </Show>
            </Show>
            <Show when={staged().length > 0}>
              <text fg={theme.textMuted}>已暂存 ({staged().length})</text>
              <For each={staged().slice(0, FILE_GROUP_MAX)}>{(entry) => <FileRow entry={entry} mode="staged" />}</For>
              <Show when={staged().length > FILE_GROUP_MAX}>
                <text fg={theme.textMuted}>… 还有 {staged().length - FILE_GROUP_MAX} 个文件</text>
              </Show>
            </Show>
            <box flexDirection="row" gap={2} flexWrap="wrap">
              <Show when={staged().length > 0}>
                <text fg={theme.primary} onMouseUp={() => void commit()}>
                  {busy() ? "提交中..." : `提交 ${staged().length} 个文件`}
                </text>
              </Show>
              <Show when={staged().length === 0 && unstaged().length > 0 && !busy()}>
                <text fg={theme.primary} onMouseUp={() => void commitAll()}>
                  暂存全部并提交
                </text>
              </Show>
              <Show when={hasChanges() && !busy()}>
                <text fg={theme.secondary} onMouseUp={() => void stash()}>
                  贮藏
                </text>
              </Show>
              <Show when={stashes().length > 0 && !busy()}>
                <text fg={theme.secondary} onMouseUp={() => void stashPop()}>
                  弹出贮藏 ({stashes().length})
                </text>
              </Show>
            </box>
          </box>
        </Show>

        <Show when={!hasChanges() && !loading()}>
          <text fg={theme.textMuted}>工作区干净</text>
        </Show>

        {/* 分支节:点名字切换;当前分支标 ●;悬停行显形"删" */}
        <Show when={branches().length > 0}>
          <box flexDirection="column" gap={1}>
            <SectionHeader text={`分支 ${branches().length}`} action="+ 新建分支" onAction={() => void newBranch()} />
            <For each={branches().slice(0, BRANCH_MAX)}>
              {(item) => (
                <Show
                  when={!item.current}
                  fallback={
                    <text wrapMode="none" paddingLeft={1}>
                      <span style={{ fg: theme.success }}>● </span>
                      <span style={{ fg: theme.text }}>{item.name}</span>
                    </text>
                  }
                >
                  <BranchRow name={item.name} />
                </Show>
              )}
            </For>
            <Show when={branches().length > BRANCH_MAX}>
              <text fg={theme.textMuted}>… 还有 {branches().length - BRANCH_MAX} 个分支</text>
            </Show>
          </box>
        </Show>

        {/* 历史节:点一条 = 弹详情(作者/时间/标题 + 改动文件清单) */}
        <Show when={commits().length > 0}>
          <box flexDirection="column" gap={1}>
            <SectionHeader text="历史" action="撤销上次提交" onAction={() => void undoCommit()} />
            <For each={commits()}>
              {(line) => {
                const commitInfo = parseGitCommit(line)
                if (!commitInfo) return null
                return (
                  <text
                    fg={theme.textMuted}
                    wrapMode="none"
                    paddingLeft={1}
                    onMouseUp={() => void showCommit(commitInfo.hash)}
                  >
                    <span style={{ fg: theme.text }}>{Locale.oneLine(commitInfo.subject, COMMIT_SUBJECT_MAX)}</span>{" "}
                    {commitInfo.hash.slice(0, 7)}
                  </text>
                )
              }}
            </For>
          </box>
        </Show>

        <text fg={theme.textMuted}>提示: 悬停文件行可丢弃,点文件名看改动差异</text>
      </Show>
    </box>
  )
}
