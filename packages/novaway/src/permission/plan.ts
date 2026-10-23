import path from "node:path"
import { Global } from "@novaway/core/global"
import { AppFileSystem } from "@novaway/core/filesystem"

/**
 * 计划模式的写入白名单。
 *
 * 「只读」不等于「什么都做不了」：规划蓝图需要把方案落成 markdown，
 * 而在对话中途切到计划模式的人往往只想跑几个只读命令看看现状。
 * 所以计划模式按下面两条放行：
 *
 * 1. 文件写入只能落在计划目录（`.novaway/plans` 或内置计划目录）里的 `.md`；
 * 2. shell 只放行只读命令（ls / cat / grep / git status …）。
 *
 * 其余写入一律硬拒绝。判断刻意保守：拿不准就拒绝，用户切回其它档位即可。
 */

/** 这些工具名会被视为"写文件"。注意：edit/write/apply_patch/patch 都走 `edit` 权限名。 */
export const PLAN_WRITE_TOOLS = new Set(["edit", "write", "apply_patch", "patch"])

export function planRoot(input: { directory: string; worktree: string }) {
  return input.worktree === "/" ? input.directory : input.worktree
}

/** 计划文件允许落盘的两个目录。 */
export function planDirectories(input: { directory: string; worktree: string }) {
  return [path.join(planRoot(input), ".novaway", "plans"), path.join(Global.Path.data, "plans")]
}

/**
 * 所有 pattern 都指向计划目录里的 markdown 才算"写计划"。
 * `pattern` 是相对 project root 的路径（工具就是这么传的），先 resolve 再判断包含关系。
 */
export function isPlanWrite(patterns: readonly string[], input: { directory: string; worktree: string }) {
  if (patterns.length === 0) return false
  const root = planRoot(input)
  const dirs = planDirectories(input)
  return patterns.every((pattern) => {
    if (!pattern.endsWith(".md")) return false
    const file = path.resolve(root, AppFileSystem.windowsPath(pattern))
    return dirs.some((dir) => AppFileSystem.contains(dir, file))
  })
}

/** 明确会写盘的命令/子命令，命中即拒绝。 */
const WRITE_HINTS = [
  /\brm\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\brmdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bln\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\btee\b/i,
  /\bsed\b.*\s-i/i,
  /\bperl\b.*\s-i/i,
  /\bgit\s+(commit|push|pull|merge|rebase|checkout|switch|reset|clean|stash|apply|am|cherry-pick|tag\s+-d)/i,
  /\b(npm|pnpm|yarn|bun)\s+(install|add|remove|uninstall|update|upgrade|link|publish)\b/i,
  /\bpip\s+install\b/i,
  /\b(apt|apt-get|dnf|yum|apk|brew)\s+(install|remove|upgrade)\b/i,
  /\bdocker\s+(rm|run|exec|build|push|pull|compose)\b/i,
  /\bkubectl\s+(apply|delete|patch|edit|create|scale|rollout)\b/i,
]

/** 天然只读的命令。 */
const SAFE_COMMANDS = new Set([
  "ls",
  "dir",
  "pwd",
  "cd",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "wc",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "find",
  "fd",
  "file",
  "stat",
  "du",
  "df",
  "tree",
  "which",
  "whereis",
  "whoami",
  "who",
  "id",
  "date",
  "echo",
  "printf",
  "type",
  "sort",
  "uniq",
  "cut",
  "tr",
  "diff",
  "cmp",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "env",
  "printenv",
  "uname",
  "hostname",
  "nproc",
  "free",
  "ps",
])

/** git 的只读子命令。 */
const SAFE_GIT = new Set([
  "status",
  "diff",
  "log",
  "show",
  "blame",
  "branch",
  "remote",
  "tag",
  "rev-parse",
  "rev-list",
  "describe",
  "shortlog",
  "ls-files",
  "ls-tree",
  "cat-file",
  "show-ref",
  "for-each-ref",
  "grep",
  "config",
])

/** 包管理器的只读子命令。 */
const SAFE_PKG = new Set(["ls", "list", "view", "info", "outdated", "why", "--version", "-v"])

const VERSION_ONLY = /^(-{1,2}(v|version)|-V)$/

/**
 * 判断一条 shell 命令是不是只读。
 *
 * 保守策略：
 * - 出现写入重定向、命令替换、写盘特征词 → 不是只读；
 * - 首命令必须在白名单里；
 * - git / 包管理器再看子命令；
 * - node / python / curl 这类可执行任意逻辑的，只放行版本查询或输出到 stdout 的用法。
 */
export function isReadOnlyShell(patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false
  return patterns.every((raw) => {
    const command = raw.trim()
    if (!command) return false
    // 输出重定向、命令替换、子 shell 都可能写盘或执行任意代码。
    if (/(^|[^0-9])>{1,2}|`|\$\(|<\s*\(/.test(command)) return false
    if (WRITE_HINTS.some((pattern) => pattern.test(command))) return false

    const tokens = command.split(/\s+/).filter(Boolean)
    const head = tokens[0]?.toLowerCase() ?? ""
    const rest = tokens.slice(1)

    if (head === "git") return SAFE_GIT.has(rest[0]?.toLowerCase() ?? "")
    if (head === "npm" || head === "pnpm" || head === "yarn" || head === "bun") {
      return SAFE_PKG.has(rest[0]?.toLowerCase() ?? "")
    }
    if (head === "curl" || head === "wget") {
      // 只放行打印到 stdout 的用法。
      return !rest.some((token) => /^(-o|-O|--output|--remote-name)/i.test(token)) && !command.includes("|")
    }
    if (head === "node" || head === "python" || head === "python3" || head === "deno") {
      return rest.length === 1 && VERSION_ONLY.test(rest[0] ?? "")
    }
    return SAFE_COMMANDS.has(head)
  })
}
