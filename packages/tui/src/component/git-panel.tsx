// 侧栏 Git 页:直接在 TUI 进程里异步跑 git(和剪贴板/编辑器起子进程同一套路),
// 不经过服务器。查询只读;可逆操作(暂存/提交/贮藏/切分支)直接做;
// 不可逆或对外的操作(推送/拉取/丢弃/删分支/撤销提交)一律先弹确认框再执行。
// 轮询自动刷新;点变更文件名开"改动差异"标签页。
// 版式:「分支」「变更」两块是各自的霓虹卡(SidebarCard),其余还是 crush 式节标题
// (标题 + ─ 填满);危险按钮(丢弃/删分支)平时隐形、悬停行才显形,避免满屏红字。
import { createMemo, createSignal, For, Show } from "solid-js"
import path from "node:path"
import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { useTuiConfig } from "../config"
import { SidebarCard } from "./sidebar-card"
import {
  BRANCH_FORMAT,
  parseGitBranches,
  parseGitCommit,
  parseGitNumstat,
  parseGitRemotes,
  parseGitStatus,
  parseGitStashList,
  type GitBranch,
  type GitFileEntry,
  type GitNumstatEntry,
  type GitRemote,
  type GitStashEntry,
} from "../util/git-status"
import { icon } from "../util/panel-icons"
import { useAutoRefresh } from "../util/auto-refresh"
import { gitExec } from "../util/git-exec"
import { Locale } from "../util/locale"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogConfirm } from "../ui/dialog-confirm"
import { useToast } from "../ui/toast"
import { GIT_FILE_LABEL_MAX, SIDEBAR_CARD_MIN_CONTENT, SIDEBAR_SECTION_MIN_CONTENT } from "../util/sidebar-metrics"

const COMMIT_LIMIT = 8
// 每组文件最多显示几行:用户改动几十个文件时,不把"历史"段挤出屏幕。
const FILE_GROUP_MAX = 12
// 贮藏列表最多显示几条:点哪条弹哪条,不再只能盲弹最近一次。
const STASH_MAX = 3
// 下面这四个上限全部按**显示列**算(配合 Locale.oneLineToWidth),按码元算的话
// 一条中文贮藏说明就是 52 列,直接把边框顶掉。
//
// 贮藏行落在「变更」卡里(卡内容区最窄 36 列):行内左内边距 1 + 最长的 ref
// 「stash@{99}」10 + 标题后的空格 1 = 12,再留 2 列余量。
export const STASH_MESSAGE_MAX = SIDEBAR_CARD_MIN_CONTENT - 14
// 提交行在「历史」节里(分区卡外面,内容区 38 列):左内边距 1 + 「● 」2 + 标题后的
// 空格 1 + 短 hash 7 = 11,再留 2 列余量。
// (旧值 30 是按码元定的:1+2+30+1+7 = 41 > 38,纯 ASCII 就已经超 3 列。)
export const COMMIT_SUBJECT_MAX = SIDEBAR_SECTION_MIN_CONTENT - 13
const COMMIT_MESSAGE_MAX = 200
// 分支列表最多显示几行,再多走"还有 N 个"。
const BRANCH_MAX = 10
/**
 * 分支行在没有计数时,名字能拿到的列数。
 *
 * 算式(与上面那些上限同一套口径,按显示列):
 *   1  行左内边距
 * + 2  标记段(「● 」/「○ 」;这两个字形是 East-Asian Ambiguous,按标准口径记 1 列 ——
 *       与本面板早就在用的 ● 同一档口径,见 util/panel-icons 的文件头)
 * + 名字
 * + 3  悬停才显形的「 删」(恒定占位,当前分支没有它 —— 删不掉正在用的分支)
 * = 6 + 名字
 * 卡里放得下 36 − 6 = 30,这里留 8 列余量:分支名超长时截尾比把「删」挤掉好。
 * **带计数时另算**:那一段的列数逐仓库不同,见 branchRowColumns。
 */
export const BRANCH_LABEL_MAX = SIDEBAR_CARD_MIN_CONTENT - 6 - 8

/**
 * 分支行里计数那一段的列数:「 ⇡ 2」/「 ⇣ 1」,**为 0 的那一枚不画**(不占列)。
 *
 *   ⇡ / ⇣ 与箭头一样是 East-Asian Ambiguous,按 1 列记;于是每一枚是
 *   1(字形)+ 1(字形后的空格)+ 位数 = 2 + 位数,前面再加 1 列与名字之间的空格,
 *   两枚都在时中间再加 1 列分隔:「 ⇡ 999 ⇣ 999」= 1 + 5 + 1 + 5 = 12 列。
 * 0 的那一枚整个不画 —— 画成「⇡ 0」等于给每一行都加一条恒定噪声(而绝大多数分支
 * 恰恰是 0/0),而且它会把名字的预算白白吃掉 4 列。
 */
export function branchCounterColumns(ahead: number, behind: number) {
  const one = (count: number) => (count > 0 ? 2 + Locale.displayWidth(String(count)) : 0)
  const both = ahead > 0 && behind > 0 ? 1 : 0
  return (ahead > 0 || behind > 0 ? 1 : 0) + one(ahead) + one(behind) + both
}

/** 分支行除名字以外的全部固定列(左内边距 + 标记 + 计数 + 悬停「 删」)。 */
export function branchRowColumns(input: { ahead: number; behind: number; current: boolean }) {
  return 1 + 2 + branchCounterColumns(input.ahead, input.behind) + (input.current ? 0 : 3)
}

/**
 * 分支行上那个名字的显示文本 —— 预算 = min(没有计数时的上限, 这一行剩下的列)。
 *
 * 两个上限都必要:BRANCH_LABEL_MAX 保住「分支名超长时截尾比把「删」挤掉好」那 8 列余量
 * (没有计数时卡里明明放得下 30 列,但那 8 列是留给悬停态与将来那几段的);
 * 减掉固定段那一条则保证**有计数的行**不会把名字顶到右边框 —— 计数逐仓库不同
 * (最坏 12 列,常见 4 列),拍死的上限做不到这一点。名字至少留 4 列,
 * 再短也是一个可辨认的残段 + 省略号。
 */
export function branchRowName(input: {
  name: string
  ahead: number
  behind: number
  current: boolean
  columns: number
}) {
  return Locale.truncateToWidth(
    input.name,
    Math.min(BRANCH_LABEL_MAX, Math.max(4, input.columns - branchRowColumns(input))),
  )
}
// 「分支」卡头的徽标就是当前分支名,**不在这里给上限**:卡壳按显示列封顶本来就是这行的
// 职责(固定段 = 图标 2 + 标题「分支 N」≤ 8 + 动作「+ 新建分支」10 + 两个 gap = 22,
// 36 − 22 − 2 余量,徽标实际最多拿到 12 列),再在这里写一个永远不生效的常量只会误导。
// 分支名在这一行之外的完整形态见下面的 branchHeadline(正文那一行)。
// 远程行在分区卡外面(还是普通的节标题 + 行),内容区 38 列:
// 左内边距 1 + 「● 」2 + 名字 10 + 地址 20 + 悬停「 删」3 = 36,留 2 列余量。
export const REMOTE_NAME_MAX = SIDEBAR_SECTION_MIN_CONTENT - 28
export const REMOTE_URL_MAX = SIDEBAR_SECTION_MIN_CONTENT - 18
// 节标题的横线填充。三个节标题(同步 / 远程 / 历史)都在分区卡**外面**,那一层是 38~54 列。
// 40 是按窄端取的:够填到右边框,宽端(54)则不够长、会留一小段空白 —— 这没问题,
// 标题文本永远在前,横线只是个填充,被 overflow="hidden" 裁掉也不会顶到别的东西。
const DASH_RUN = "─".repeat(40)

/**
 * 「当前分支 → 上游 领先/落后」那一行的两段文本,按实际可用列截断。
 *
 * 这一行以前完全不截断:一个 46 字符的分支名会画 55 列,被视口静默裁掉且没有省略号。
 * 上游和领先数逐仓库不同,所以预算按它们的**实际宽度**现算,而不是拍一个固定上限。
 * `columns` 由调用方给(卡内容区的最窄值),测试可以直接传别的值。
 */
export function branchHeadline(input: { name: string; upstream?: string; tracking: string; columns: number }): {
  name: string
  upstream: string
} {
  const MARGIN = 2
  // 固定段:` → ` 3 列,加上 tracking 前面那个空格(没有领先/落后时就没有这 1 列)。
  const fixed = 3 + (input.tracking ? 1 + Locale.displayWidth(input.tracking) : 0) + MARGIN
  // 上游最多拿 12 列:它只是补充信息,分支名才是这一行的主体。
  const upstream = Locale.truncateToWidth(input.upstream ?? "", Math.min(Locale.displayWidth(input.upstream ?? ""), 12))
  const nameColumns = Math.max(4, input.columns - fixed - Locale.displayWidth(upstream))
  return { name: Locale.truncateToWidth(input.name, nameColumns), upstream }
}

// 下面这几个是「窄行上的一段文本」的生产实现。抽成函数不是为了好看,而是为了让测试
// 打到真正的调用点:只测常量的测试在有人把 oneLineToWidth 换回 oneLine 时照样绿,
// 而那正是这批上限一开始按码元定的原因。
export function stashMessageText(message: string): string {
  return Locale.oneLineToWidth(message, STASH_MESSAGE_MAX)
}

export function commitSubjectText(subject: string): string {
  return Locale.oneLineToWidth(subject, COMMIT_SUBJECT_MAX)
}

export function remoteNameText(name: string): string {
  return Locale.oneLineToWidth(name, REMOTE_NAME_MAX)
}

export function remoteUrlText(url: string): string {
  return Locale.oneLineToWidth(url, REMOTE_URL_MAX)
}

export interface GitPanelProps {
  rootPath?: string
  /** 点变更文件名:打开该文件的"改动差异"标签页 */
  onOpenDiff?: (filePath: string) => void
  /**
   * 点提交行:在主区打开该提交的"提交详情"标签页。
   * 不在侧栏里弹窗 —— --stat 清单动辄几十行,弹窗宽度只有侧栏那几列,读起来憋屈;
   * 而且这个视图是只读的,标签页自带 ✕,不需要弹窗那套确认语义。
   */
  onOpenCommit?: (hash: string) => void
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
  const tuiConfig = useTuiConfig()
  const dialog = useDialog()
  const toast = useToast()
  const [summary, setSummary] = createSignal<ReturnType<typeof parseGitStatus> | null>(null)
  const [commits, setCommits] = createSignal<string[]>([])
  const [branches, setBranches] = createSignal<GitBranch[]>([])
  const [stashes, setStashes] = createSignal<GitStashEntry[]>([])
  const [remotes, setRemotes] = createSignal<GitRemote[]>([])
  // 未暂存和已暂存是两次不同的 diff,同一个文件两边的数字不一样,分开存。
  const [unstagedNumstat, setUnstagedNumstat] = createSignal<GitNumstatEntry[]>([])
  const [stagedNumstat, setStagedNumstat] = createSignal<GitNumstatEntry[]>([])
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
      const [status, log, branchOut, stashOut, remoteOut, unstagedOut, stagedOut] = await Promise.all([
        git(["status", "--porcelain=v1", "-b"]),
        // 单独兜底:空仓库(一个提交都没有)时 log 会失败,但 status 是好的,别让 log 把整页拖成报错。
        git(["log", "--oneline", "-n", String(COMMIT_LIMIT)]).catch(() => ({ stdout: "" })),
        git(["branch", BRANCH_FORMAT]).catch(() => ({ stdout: "" })),
        git(["stash", "list"]).catch(() => ({ stdout: "" })),
        git(["remote", "-v"]).catch(() => ({ stdout: "" })),
        // numstat 只算行号,比完整 diff 便宜很多,但大仓库仍要 100ms 上下;
        // 失败就留空,文件行不显示统计,不让它把整页拖成报错。
        git(["diff", "--numstat", "--", "."]).catch(() => ({ stdout: "" })),
        git(["diff", "--cached", "--numstat", "--", "."]).catch(() => ({ stdout: "" })),
      ])
      setSummary(parseGitStatus(status.stdout))
      setCommits(log.stdout.split("\n").filter((line) => line.length > 0))
      setBranches(parseGitBranches(branchOut.stdout))
      setStashes(parseGitStashList(stashOut.stdout))
      setRemotes(parseGitRemotes(remoteOut.stdout))
      setUnstagedNumstat(parseGitNumstat(unstagedOut.stdout))
      setStagedNumstat(parseGitNumstat(stagedOut.stdout))
      setError("")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setSummary(null)
      setCommits([])
      setBranches([])
      setStashes([])
      setRemotes([])
      setUnstagedNumstat([])
      setStagedNumstat([])
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
  // 文件列表和 numstat 是两次独立查询,按路径对上号;按路径索引比每行线性找便宜。
  const toNumstatMap = (entries: GitNumstatEntry[]) =>
    new Map<string, GitNumstatEntry>(entries.map((entry) => [entry.file, entry]))
  const unstagedNumstatByFile = createMemo(() => toNumstatMap(unstagedNumstat()))
  const stagedNumstatByFile = createMemo(() => toNumstatMap(stagedNumstat()))
  // 空仓库的分支行是 "No commits yet on main"、detached 是 "(HEAD detached at …)",
  // 都不是可操作的分支名,提交/推送/切换一律当成"没有分支"。
  const branchName = createMemo(() => {
    const name = branch()
    if (!name || name.startsWith("No commits yet") || name.startsWith("(HEAD detached")) return undefined
    return name
  })
  // 当前分支的推送/拉取目标 = 上游里的远程名("github/main" → "github")。
  const currentRemote = createMemo(() => upstream()?.split("/")[0])
  // 「当前分支 → 上游 领先/落后」那一行的两段文本:按实际可用列截断(见 branchHeadline)。
  const headline = createMemo(() => {
    const name = branch()
    if (!name) return undefined
    return branchHeadline({ name, upstream: upstream(), tracking: tracking(), columns: SIDEBAR_CARD_MIN_CONTENT })
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

  // VS Code 式内联提交:说明输入框常驻面板里,回车提交;
  // 暂存区是空的就先自动暂存全部(对应 VS Code 的"始终暂存全部并提交")。
  const [commitMessage, setCommitMessage] = createSignal("")
  const [commitInputTarget, setCommitInputTarget] = createSignal<TextareaRenderable>()

  // 输入框聚焦时把回车从"发送聊天消息"抢回来当"提交 commit"(和文件编辑器同一招)。
  useBindings(() => ({
    target: commitInputTarget,
    enabled: commitInputTarget() !== undefined,
    priority: 1,
    bindings: [{ key: "return", cmd: () => void submitCommit() }],
  }))

  const submitCommit = async () => {
    const message = commitMessage().trim()
    if (!message) {
      toast.show({ variant: "warning", message: "先写一句提交说明" })
      return
    }
    if (!hasChanges() || busy()) return
    setBusy(true)
    try {
      if (staged().length === 0) await git(["add", "-A"])
      await git(["commit", "-m", Locale.oneLine(message, COMMIT_MESSAGE_MAX)])
      setCommitMessage("")
      commitInputTarget()?.setText("")
      toast.show({ variant: "success", message: "提交完成" })
      await load()
    } catch (e) {
      toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
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

  // 弹出贮藏会把那条 stash 从贮藏里移除,不可逆,先确认;点哪条弹哪条,不再只弹最近一次。
  const stashPop = async (ref: string) => {
    const confirmed = await confirm("弹出贮藏", `将把 ${ref} 恢复回工作区并从贮藏里移除，确定?`)
    if (!confirmed) return
    await run(["stash", "pop", ref], `已弹出 ${ref}`)
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

  // 远程仓库管理:多仓库维护时添加多个 remote,点一个就把它设为当前分支的推送/拉取目标。
  const addRemote = async () => {
    const name = await DialogPrompt.show(dialog, "远程名称", { placeholder: "如 github、gitee、company" })
    const cleanName = name?.trim().replace(/\s+/g, "-")
    if (!cleanName) return
    const url = await DialogPrompt.show(dialog, "远程地址", { placeholder: "https://github.com/用户/仓库.git" })
    const cleanUrl = url?.trim()
    if (!cleanUrl) return
    await run(["remote", "add", cleanName, cleanUrl], `已添加远程 ${cleanName}`)
  }

  // 切换远程:先 fetch 把该远程的分支信息拉下来(只读),再把当前分支的上游指过去;
  // 不推送任何东西。远程上还没有这个分支时 set-upstream-to 会报错,原样提示。
  const switchRemote = async (name: string) => {
    const b = branchName()
    if (!b) {
      toast.show({ variant: "error", message: "当前没有可跟踪的分支" })
      return
    }
    if (name === currentRemote()) return
    const confirmed = await confirm("切换远程", `将把 ${b} 的推送/拉取目标切换到 ${name}（先同步该远程信息），确定?`)
    if (!confirmed) return
    setBusy(true)
    try {
      await git(["fetch", name])
      await git(["branch", "--set-upstream-to", `${name}/${b}`, b])
      toast.show({ variant: "success", message: `推送/拉取目标已切换到 ${name}` })
      await load()
    } catch (e) {
      toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const removeRemote = async (name: string) => {
    const confirmed = await confirm("删除远程", `将移除远程 ${name}（只删配置，不影响仓库内容），确定?`)
    if (!confirmed) return
    await run(["remote", "remove", name], `已移除远程 ${name}`)
  }

  // 点提交行:交给调用方在主区开一个标签页(见 GitCommitView)。这里不跑 git ——
  // 标签页自己去 show,省掉「点了先等一次 IO、再等标签页又去 show 一次」。
  const showCommit = (hash: string) => props.onOpenCommit?.(hash)

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

  // 文件行:+M(点击 = 暂存/取消暂存)+ 文件名(点击 = 看改动差异)+ +N/-M 统计 + 悬停才显形的"丢弃"。
  // "丢弃"占位恒定:隐形时用背景色渲染,不改变行宽,避免悬停瞬间抖动。
  // span 挂不了鼠标事件,可点的部分必须是独立的 text 元素。
  // 二进制文件 numstat 给的是 "0/0" 占位,不算改动量,不显示统计以免误导。
  const FileRow = (entryProps: {
    entry: GitFileEntry
    mode: "staged" | "unstaged"
    stats: GitNumstatEntry | undefined
  }) => {
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
          onMouseUp={() => (entryProps.mode === "staged" ? unstage(entryProps.entry) : stage(entryProps.entry))}
        >
          {entryProps.mode === "staged" ? "−" : "+"}
          {statusLetter(entryProps.entry)}
        </text>
        <text flexGrow={1} fg={theme.text} wrapMode="none" onMouseUp={() => openDiff(entryProps.entry)}>
          {/* 文件行落在「变更」分区卡里:GIT_FILE_LABEL_MAX = 卡内容区最窄值 36
              − 状态码/统计/悬停「 丢弃」/内边距 18 − 余量 2。按显示列截,中文路径也不会撑破。 */}
          {Locale.truncateToWidth(entryProps.entry.file, GIT_FILE_LABEL_MAX)}
        </text>
        {entryProps.stats && !entryProps.stats.binary ? (
          <text flexShrink={0} paddingLeft={1} wrapMode="none">
            <span style={{ fg: theme.diffAdded }}>+{entryProps.stats.added}</span>
            <span style={{ fg: theme.diffRemoved }}> -{entryProps.stats.removed}</span>
          </text>
        ) : null}
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

  // 分支行:● 标当前分支(名字同色,原型 `.branch-row .cur { color: var(--green) }`,
  // card-design-v7.html:259),后面跟 ⇡/⇣ 两个计数(为 0 的那一枚不画);
  // 点名字切换;悬停显形"删"(同样占位恒定)。
  //
  // 颜色:当前分支走 success —— 它是「我现在在这一行」这条语义,原型也是绿。
  // 计数:领先用 warning(琥珀,正是原型 `.ahead` 那一档 :260),落后用 error ——
  // 原型没给 behind 配色(它只画了 ahead),而终端里的惯例是「落后 = 红色警示」;
  // 两枚都不与当前分支的绿撞。
  const BranchRow = (rowProps: { name: string; current: boolean; ahead: number; behind: number }) => {
    const [rowHover, setRowHover] = createSignal(false)
    return (
      <box
        flexDirection="row"
        paddingLeft={1}
        onMouseOver={() => setRowHover(true)}
        onMouseOut={() => setRowHover(false)}
      >
        <text flexShrink={0} wrapMode="none">
          {/* 非当前分支用 ○ 占位,而不是留空 —— 两个标记都恒定 2 列,名字的起点不因
              「这一行是不是当前分支」而挪一列(预算见 branchRowColumns)。 */}
          <span style={{ fg: rowProps.current ? theme.success : theme.textMuted }}>
            {rowProps.current ? "● " : "○ "}
          </span>
        </text>
        <text
          flexGrow={1}
          fg={rowProps.current ? theme.success : theme.text}
          wrapMode="none"
          onMouseUp={() => void switchBranch(rowProps.name)}
        >
          {branchRowName({ ...rowProps, columns: SIDEBAR_CARD_MIN_CONTENT })}
        </text>
        <Show when={rowProps.ahead > 0 || rowProps.behind > 0}>
          <text flexShrink={0} wrapMode="none">
            <Show when={rowProps.ahead > 0}>
              <span style={{ fg: theme.warning }}>{` ⇡ ${rowProps.ahead}`}</span>
            </Show>
            <Show when={rowProps.behind > 0}>
              <span style={{ fg: theme.error }}>{` ⇣ ${rowProps.behind}`}</span>
            </Show>
          </text>
        </Show>
        {/* 当前分支没有「删」那一格:git 本身也拒绝删正在用的分支,给一个点不动的按钮
            只会让人以为面板坏了。 */}
        <Show when={!rowProps.current}>
          <text
            flexShrink={0}
            fg={rowHover() ? theme.error : theme.backgroundPanel}
            onMouseUp={() => void deleteBranch(rowProps.name)}
          >
            {" 删"}
          </text>
        </Show>
      </box>
    )
  }

  // 远程行:● 标出当前推送/拉取目标;点行 = 切换目标;悬停显形"删"。
  const RemoteRow = (rowProps: GitRemote) => {
    const [rowHover, setRowHover] = createSignal(false)
    const isCurrent = () => rowProps.name === currentRemote()
    return (
      <box
        flexDirection="row"
        paddingLeft={1}
        onMouseOver={() => setRowHover(true)}
        onMouseOut={() => setRowHover(false)}
      >
        <text flexShrink={0} wrapMode="none" onMouseUp={() => void switchRemote(rowProps.name)}>
          <span style={{ fg: isCurrent() ? theme.success : theme.backgroundPanel }}>{isCurrent() ? "● " : "  "}</span>
          <span style={{ fg: theme.text }}>{remoteNameText(rowProps.name)}</span>
        </text>
        <text flexGrow={1} fg={theme.textMuted} wrapMode="none" onMouseUp={() => void switchRemote(rowProps.name)}>
          {remoteUrlText(rowProps.url)}
        </text>
        <text
          flexShrink={0}
          fg={rowHover() ? theme.error : theme.backgroundPanel}
          onMouseUp={() => void removeRemote(rowProps.name)}
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
      <Show when={!error()} fallback={<text fg={theme.textMuted}>{error()}</text>}>
        {/* 分支卡:标题带分支总数(卡片化之前「分支 N」那个节标题就在这儿,信息不能丢),
            徽标是当前分支名 —— 标题给「一共几个」,徽标给「我在哪个」,
            正文第一行补上「它跟着谁、差几个提交」。卡头右侧的「+ 新建分支」原来也挂在
            节标题上,一并挪到卡头。 */}
        <SidebarCard
          title={`分支 ${branches().length}`}
          icon={icon("git")}
          badge={branchName() ?? "无"}
          action="+ 新建分支"
          onAction={() => void newBranch()}
        >
          <box flexDirection="column" gap={1}>
            {/* 这一行的名字与上游按实际剩余列截断(branchHeadline),否则长分支名会被
                视口静默裁掉、没有省略号。徽标那点宽度是卡壳封的,正文这一行才是
                完整分支名该待的地方。 */}
            <text fg={theme.text} wrapMode="none">
              <Show when={headline()} fallback={<span style={{ fg: theme.textMuted }}>无</span>}>
                <span style={{ fg: theme.text }}>{headline()?.name}</span>
                <Show when={upstream()}>
                  <span style={{ fg: theme.textMuted }}> → {headline()?.upstream}</span>
                </Show>
                <Show when={tracking()}>
                  <span style={{ fg: theme.warning }}> {tracking()}</span>
                </Show>
              </Show>
            </text>
            {/* 分支列表:点名字切换;当前分支标 ● 且名字同色;每行右侧跟 ⇡/⇣ 计数。
                「分支 N」那个节标题去掉了 —— 它和卡头是同一句话;动作已移到卡头。 */}
            <Show when={branches().length > 0}>
              <For each={branches().slice(0, BRANCH_MAX)}>
                {(item) => (
                  <BranchRow name={item.name} current={item.current} ahead={item.ahead} behind={item.behind} />
                )}
              </For>
              <Show when={branches().length > BRANCH_MAX}>
                <text fg={theme.textMuted}>… 还有 {branches().length - BRANCH_MAX} 个分支</text>
              </Show>
            </Show>
          </box>
        </SidebarCard>

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

        {/* 变更卡:徽标是未暂存 + 已暂存的文件数。提交说明框常驻卡内(VS Code 式),
            底下是未暂存/已暂存两组 + 组尾操作。 */}
        <Show when={unstaged().length > 0 || staged().length > 0}>
          <SidebarCard title="变更" icon={icon("diff")} badge={`${staged().length + unstaged().length} 个文件`}>
            <box flexDirection="column" gap={1}>
              {/* 提交说明框:点击聚焦,回车提交;暂存区空时自动先暂存全部。
                不能自动聚焦 —— 一开 Git 页就把聊天输入框的焦点抢走了。 */}
              <box flexDirection="column" gap={1} flexShrink={0}>
                <textarea
                  height={3}
                  ref={(val: TextareaRenderable) => setCommitInputTarget(val)}
                  initialValue=""
                  onContentChange={() => {
                    const input = commitInputTarget()
                    if (input) setCommitMessage(input.plainText)
                  }}
                  onMouseUp={() => commitInputTarget()?.focus()}
                  placeholder={busy() ? "提交中..." : `消息（点击这里输入，回车在 ${branch() ?? "当前分支"} 上提交）`}
                  placeholderColor={theme.textMuted}
                  backgroundColor={theme.backgroundElement}
                  textColor={theme.text}
                  focusedTextColor={theme.text}
                  cursorColor={theme.text}
                  cursorStyle={tuiConfig.cursor}
                  wrapMode="none"
                />
                {/* 全宽提交按钮:灰底、居中,和 VS Code 的"✓ 提交"一个样子 */}
                <box
                  height={1}
                  justifyContent="center"
                  backgroundColor={theme.backgroundMenu}
                  onMouseUp={() => void submitCommit()}
                >
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {busy()
                      ? "提交中..."
                      : staged().length > 0
                        ? `✓ 提交 ${staged().length} 个文件`
                        : hasChanges()
                          ? "✓ 暂存全部并提交"
                          : "✓ 提交"}
                  </text>
                </box>
              </box>
              <Show when={unstaged().length > 0}>
                <box flexDirection="row">
                  <text fg={theme.textMuted}>未暂存 ({unstaged().length})</text>
                  <text fg={theme.primary} onMouseUp={stageAll}>
                    {"  暂存全部"}
                  </text>
                </box>
                <For each={unstaged().slice(0, FILE_GROUP_MAX)}>
                  {(entry) => <FileRow entry={entry} mode="unstaged" stats={unstagedNumstatByFile().get(entry.file)} />}
                </For>
                <Show when={unstaged().length > FILE_GROUP_MAX}>
                  <text fg={theme.textMuted}>… 还有 {unstaged().length - FILE_GROUP_MAX} 个文件</text>
                </Show>
              </Show>
              <Show when={staged().length > 0}>
                <text fg={theme.textMuted}>已暂存 ({staged().length})</text>
                <For each={staged().slice(0, FILE_GROUP_MAX)}>
                  {(entry) => <FileRow entry={entry} mode="staged" stats={stagedNumstatByFile().get(entry.file)} />}
                </For>
                <Show when={staged().length > FILE_GROUP_MAX}>
                  <text fg={theme.textMuted}>… 还有 {staged().length - FILE_GROUP_MAX} 个文件</text>
                </Show>
              </Show>
              <Show when={hasChanges() && !busy()}>
                <text fg={theme.secondary} onMouseUp={() => void stash()}>
                  贮藏
                </text>
              </Show>
              {/* 贮藏列表:多条时点哪条弹哪条,不再只能盲弹最近一次。说明可能很长,截断显示。 */}
              <Show when={stashes().length > 0 && !busy()}>
                <box flexDirection="column" gap={1}>
                  <text fg={theme.textMuted}>贮藏 ({stashes().length}) — 点一条弹出</text>
                  <For each={stashes().slice(0, STASH_MAX)}>
                    {(item) => (
                      <text
                        fg={theme.secondary}
                        paddingLeft={1}
                        wrapMode="none"
                        onMouseUp={() => void stashPop(item.ref)}
                      >
                        <span style={{ fg: theme.primary }}>{item.ref}</span> {stashMessageText(item.message)}
                      </text>
                    )}
                  </For>
                  <Show when={stashes().length > STASH_MAX}>
                    <text fg={theme.textMuted}>… 还有 {stashes().length - STASH_MAX} 个贮藏</text>
                  </Show>
                </box>
              </Show>
            </box>
          </SidebarCard>
        </Show>

        <Show when={!hasChanges() && !loading()}>
          <text fg={theme.textMuted}>工作区干净</text>
        </Show>

        {/* 远程节:多仓库维护 —— 添加多个远程,点一个设为当前分支的推送/拉取目标 */}
        <box flexDirection="column" gap={1}>
          <SectionHeader text={`远程 ${remotes().length}`} action="+ 添加远程" onAction={() => void addRemote()} />
          <For each={remotes().slice(0, BRANCH_MAX)}>{(item) => <RemoteRow name={item.name} url={item.url} />}</For>
          <Show when={remotes().length === 0}>
            <text fg={theme.textMuted}>还没有远程,点标题行的"+ 添加远程"</text>
          </Show>
        </box>

        {/* 历史节:点一条 = 弹详情(作者/时间/标题 + 改动文件清单) */}
        <Show when={commits().length > 0}>
          <box flexDirection="column" gap={1}>
            <SectionHeader text="历史" action="撤销上次提交" onAction={() => void undoCommit()} />
            <For each={commits()}>
              {(line, i) => {
                const commitInfo = parseGitCommit(line)
                if (!commitInfo) return null
                return (
                  <text wrapMode="none" paddingLeft={1} onMouseUp={() => void showCommit(commitInfo.hash)}>
                    {/* 图表风格:● 节点 + 标题 + 短 hash,最新一条节点用强调色 */}
                    <span style={{ fg: i() === 0 ? theme.primary : theme.secondary }}>● </span>
                    <span style={{ fg: theme.text }}>{commitSubjectText(commitInfo.subject)}</span>{" "}
                    <span style={{ fg: theme.textMuted }}>{commitInfo.hash.slice(0, 7)}</span>
                  </text>
                )
              }}
            </For>
          </box>
        </Show>

        <text fg={theme.textMuted}>提示: 点击消息框填写说明,悬停文件行可丢弃,点远程行切换推送目标</text>
      </Show>
    </box>
  )
}
