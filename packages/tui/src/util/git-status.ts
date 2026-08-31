// git status --porcelain 输出的纯解析。放 util 是为了能脱离终端单测;
// 面板组件只负责起进程和渲染。porcelain v1 每行 "XY <path>",X 暂存区、Y 工作区。
export type GitFileStatus = "added" | "deleted" | "modified" | "renamed" | "untracked" | "other"

export interface GitFileEntry {
  file: string
  /** 原始 XY 两位码,想细看暂存/未暂存时用 */
  code: string
  status: GitFileStatus
  /** X 位有内容:这个文件有已暂存的改动 */
  staged: boolean
  /** Y 位有内容(含未跟踪):这个文件有未暂存的改动 */
  unstaged: boolean
}

export interface GitStatusSummary {
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  entries: GitFileEntry[]
}

// XY 里取"更严重"的那半:X 是暂存后的状态,Y 是工作区状态;?? 是未跟踪。
function letterStatus(x: string, y: string): GitFileStatus {
  if (x === "?" || y === "?") return "untracked"
  const both = x + y
  if (both.includes("D")) return "deleted"
  if (both.includes("A")) return "added"
  if (both.includes("R")) return "renamed"
  if (both.includes("M") || both.includes("T")) return "modified"
  return "other"
}

export function parseGitStatus(output: string): GitStatusSummary {
  const lines = output.split("\n").filter((line) => line.length > 0)
  const summary: GitStatusSummary = { ahead: 0, behind: 0, entries: [] }

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const head = line.slice(3)
      // "## main...origin/main [ahead 1, behind 2]" / "## No commits yet on main"
      const dot = head.indexOf("...")
      const bracket = head.indexOf("[")
      summary.branch = (dot === -1 ? (bracket === -1 ? head : head.slice(0, bracket)) : head.slice(0, dot)).trim()
      if (dot !== -1) {
        summary.upstream = (bracket === -1 ? head.slice(dot + 3) : head.slice(dot + 3, bracket)).trim()
      }
      summary.ahead = Number(/\bahead (\d+)/.exec(head)?.[1] ?? 0)
      summary.behind = Number(/\bbehind (\d+)/.exec(head)?.[1] ?? 0)
      continue
    }
    if (line.length < 4) continue
    const code = line.slice(0, 2)
    let file = line.slice(3)
    // 重命名在 porcelain v1 里是 "old -> new",列表里只关心新路径。
    const arrow = file.indexOf(" -> ")
    if (arrow !== -1) file = file.slice(arrow + 4)
    const x = code[0]!
    const y = code[1]!
    summary.entries.push({
      file,
      code,
      status: letterStatus(x, y),
      // 未跟踪文件的 XY 是 "??",X 那个 ? 不是"已暂存",所以要单独排除。
      staged: x !== " " && x !== "?",
      unstaged: y !== " ",
    })
  }
  return summary
}

// 一条 git log --oneline 的输出("abc1234 标题")拆成 [hash, 标题]。
export function parseGitCommit(line: string): { hash: string; subject: string } | undefined {
  const match = /^(\S+)\s+(.*)$/.exec(line.trim())
  if (!match) return undefined
  return { hash: match[1]!, subject: match[2]! }
}

// git branch 的输出:当前分支带 "* " 前缀,其余缩进两格;detached 状态原样透传。
export interface GitBranch {
  name: string
  current: boolean
}

export function parseGitBranches(output: string): GitBranch[] {
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => ({ name: line.replace(/^\*?\s+/, "").trim(), current: line.startsWith("* ") }))
}

// git stash list 的输出:"stash@{0}: WIP on main: abc1234 说明"。
export interface GitStashEntry {
  ref: string
  message: string
}

export function parseGitStashList(output: string): GitStashEntry[] {
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const sep = line.indexOf(": ")
      return sep === -1 ? { ref: line.trim(), message: "" } : { ref: line.slice(0, sep), message: line.slice(sep + 2) }
    })
}

// git remote -v 的输出:每个远程两行(fetch/push),取 fetch 行的地址,按名字去重。
export interface GitRemote {
  name: string
  url: string
}

export function parseGitRemotes(output: string): GitRemote[] {
  const byName = new Map<string, string>()
  for (const line of output.split("\n")) {
    const match = /^(\S+)\t(\S+) \(fetch\)$/.exec(line.trim())
    if (match) byName.set(match[1]!, match[2]!)
  }
  return [...byName].map(([name, url]) => ({ name, url }))
}
