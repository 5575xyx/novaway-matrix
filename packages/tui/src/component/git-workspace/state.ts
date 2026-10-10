// 工作区的数据层:一次性把 git 拉齐,并把原始解析结果**派生**成面板直接能渲染的行。
//
// 派生逻辑单独成纯函数(deriveStatusRows / deriveFileRows / pickDefaultRemote)是有意的:
// 组件里写派生就等于把「↑91 怎么拼」「中文状态词是哪个」埋进 JSX,测不到。
import { gitExec } from "../../util/git-exec"
import {
  BRANCH_FORMAT,
  type GitBranch,
  type GitNumstatEntry,
  type GitRemote,
  type GitStashEntry,
  type GitStatusSummary,
  parseGitBranches,
  parseGitCommit,
  parseGitNumstat,
  parseGitRemotes,
  parseGitStashList,
  parseGitStatus,
} from "../../util/git-status"

export interface GitCommitRow {
  hash: string
  subject: string
}

export interface WorkspaceData {
  status: GitStatusSummary
  numstat: GitNumstatEntry[]
  branches: GitBranch[]
  commits: GitCommitRow[]
  stash: GitStashEntry[]
  remotes: GitRemote[]
  /** git 命令失败时的原因;成功时 undefined。渲染层把它画进状态面板的「提示」行。 */
  error?: string
}

const COMMIT_LIMIT = 40

/**
 * 并行拉齐工作区需要的全部数据。
 *
 * 每个分支都 `.catch` 而不是整体 try/catch:工作区要**部分可用** —— 一个仓库没有 stash、
 * 没有 remote、甚至还没有任何 commit 都是常态,任何一个命令失败都不该让整个面板白屏。
 * 只有 `status` 是硬依赖(它同时提供 branch 与文件列表),它失败才返回 error。
 */
export function loadWorkspace(rootPath: string): Promise<WorkspaceData> {
  return gitExec(rootPath, ["status", "--porcelain=v1", "-b"])
    .then((statusOut) =>
      Promise.all([
        gitExec(rootPath, ["diff", "--numstat", "--", "."]).catch(() => ({ stdout: "" })),
        gitExec(rootPath, ["diff", "--cached", "--numstat", "--", "."]).catch(() => ({ stdout: "" })),
        gitExec(rootPath, ["branch", BRANCH_FORMAT]).catch(() => ({ stdout: "" })),
        gitExec(rootPath, ["log", "--oneline", "-n", String(COMMIT_LIMIT)]).catch(() => ({ stdout: "" })),
        gitExec(rootPath, ["stash", "list"]).catch(() => ({ stdout: "" })),
        gitExec(rootPath, ["remote", "-v"]).catch(() => ({ stdout: "" })),
      ]).then(([worktreeOut, indexOut, branchOut, logOut, stashOut, remoteOut]) => ({
        status: parseGitStatus(statusOut.stdout),
        // numstat 要跑两条:工作区的和暂存区的。只跑一条会漏掉「已暂存但工作区又改了」的文件。
        numstat: [...parseGitNumstat(indexOut.stdout), ...parseGitNumstat(worktreeOut.stdout)],
        branches: parseGitBranches(branchOut.stdout),
        commits: logOut.stdout
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .flatMap((line) => {
            const parsed = parseGitCommit(line)
            return parsed ? [parsed] : []
          }),
        stash: parseGitStashList(stashOut.stdout),
        remotes: parseGitRemotes(remoteOut.stdout),
      })),
    )
    .catch((e: unknown) => emptyWorkspace(hintFromError(e)))
}

/**
 * git 报错 → 状态面板「提示」行的文案。
 *
 * 不能把 git 的原始英文串直接怼进中文界面 —— 用户在一个非仓库目录打开工作区时,
 * 看到 `fatal: not a git repository (or any of the parent directories): .git` 是纯噪音。
 * 但也不能一律猜成「不是 git 仓库」:超时、权限不足都可能让 status 失败,那两种情况下
 * 猜错比透出原文更坏。所以只认已知串给中文,其余统一说「git 执行失败」——
 * 不把原始英文串怼进中文界面,也免得一条超长的 fatal 串撑破状态行的布局。
 * 规则照抄自 git-panel.tsx:253 的既有形态。
 *
 * 外壳执行 stage/discard/pull/push 失败时也走同一套映射(见 git-workspace.tsx 的 runGit)——
 * 两处各写一份中文映射表,改一处漏一处就会在提示行出现两套口径。
 */
export function hintFromError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.includes("not a git repository") ? "不是 git 仓库" : "git 执行失败"
}

export function emptyWorkspace(error?: string): WorkspaceData {
  return {
    status: { ahead: 0, behind: 0, entries: [] },
    numstat: [],
    branches: [],
    commits: [],
    stash: [],
    remotes: [],
    error,
  }
}

/**
 * 多远程的默认选中。优先 `origin` —— 它是绝大多数仓库的约定默认,选错的代价又很高
 * (推送是不可逆动作),所以宁可按约定走,也不按字母序取第一个。
 */
export function pickDefaultRemote(remotes: GitRemote[]): GitRemote | undefined {
  return remotes.find((r) => r.name === "origin") ?? remotes[0]
}

/** 领先/落后的显示文本。**0 不画** —— 画一个「↑ 0」是纯噪音。 */
function trackCount(ahead: number, behind: number): string | undefined {
  const parts: string[] = []
  if (ahead > 0) parts.push(`↑${ahead}`)
  if (behind > 0) parts.push(`↓${behind}`)
  return parts.length > 0 ? parts.join(" ") : undefined
}

export interface StatusRow {
  kind: "branch" | "remote" | "changes" | "hint"
  label: string
  detail?: string
  count?: string
}

/**
 * 状态面板的四行。顺序固定:分支 / 远程 / 变更 / 提示(规格「状态面板的四行」)。
 * `selectedRemote` 由调用方传入 —— 选中哪个远端是工作区状态,不是 git 的输出。
 */
export function deriveStatusRows(
  status: GitStatusSummary,
  numstat: GitNumstatEntry[],
  remotes: GitRemote[],
  selectedRemote?: GitRemote,
  error?: string,
): StatusRow[] {
  const files = status.entries.length
  const added = numstat.reduce((sum, item) => sum + item.added, 0)
  const removed = numstat.reduce((sum, item) => sum + item.removed, 0)
  // 「有改动」看的是**有没有条目**,不是工作区位。只看 unstaged 会让「已 git add 但工作区
  // 干净」的文件不计数 —— 那时「变更」行说「1 个文件」,下面「提示」行却说「工作区干净」,
  // 同一个面板自相矛盾。已暂存未提交当然算未提交。
  const dirty = files > 0
  const remote = selectedRemote ?? pickDefaultRemote(remotes)
  // 分叉:两边都有新提交。push 会被拒、pull 会冲突,是必须让用户看见的阻塞态,
  // 所以排在「有未提交改动」前面 —— 后者只是待办,前者是卡住。
  const diverged = status.ahead > 0 && status.behind > 0
  // branch 为空意味着 `git status` 没给出分支行 —— 要么不在仓库里,要么是 detached。
  // 空仓库的 `No commits yet on main` 和 detached 的 `(HEAD detached at ...)` 不是分支名,
  // 原样进中文界面也是噪音(判定口径照抄 git-panel.tsx:281-283 的 branchName())。
  const branch = status.branch ?? ""
  const inRepo = branch !== "" && !branch.startsWith("No commits yet") && !branch.startsWith("(HEAD detached")

  return [
    {
      kind: "branch",
      label: "分支",
      detail: inRepo ? branch : "(不在分支上)",
      count: trackCount(status.ahead, status.behind),
    },
    { kind: "remote", label: "远程", detail: remote?.name ?? "未配置远端" },
    { kind: "changes", label: "变更", detail: `${files} 个文件`, count: `+${added} -${removed}` },
    {
      kind: "hint",
      label: "提示",
      // error 优先:loadWorkspace 只在 status 命令失败时才带 error,这时「不是 git 仓库」
      // 未必是真因(可能是超时、权限)。把真实原因透出来比猜一个原因好。
      detail:
        error ??
        (!inRepo ? "不是 git 仓库" : diverged ? "分支与远程 diverged" : dirty ? "有未提交的改动" : "工作区干净"),
    },
  ]
}

/** 文件面板一行的中文状态词。规格要求用中文而不是 git 的 XY 字母。 */
const STATUS_LABEL: Record<string, string> = {
  modified: "已改",
  added: "新增",
  deleted: "删除",
  renamed: "重命名",
  untracked: "未跟踪",
}

export interface FileRow {
  file: string
  label: string
  /** `+N -M`;没有 numstat(例如未跟踪文件)时 undefined。 */
  count?: string
  staged: boolean
  unstaged: boolean
}

export function deriveFileRows(status: GitStatusSummary, numstat: GitNumstatEntry[]): FileRow[] {
  // 同一个文件可能在 numstat 里出现两次(工作区改了、暂存区也改了)。Map 后者覆盖前者,
  // 而 concat 的顺序是「暂存区在前、工作区在后」—— 所以取到的是**工作区侧**的行数。
  // 这是取舍:工作区一文件一行,没法同时显示两组数字。要显式说明,免得后来者以为是巧合。
  const byFile = new Map(numstat.map((item) => [item.file, item]))
  return status.entries.map((entry) => {
    const stat = byFile.get(entry.file)
    return {
      file: entry.file,
      label: STATUS_LABEL[entry.status] ?? "已改",
      count: stat ? `+${stat.added} -${stat.removed}` : undefined,
      staged: entry.staged,
      unstaged: entry.unstaged,
    }
  })
}
