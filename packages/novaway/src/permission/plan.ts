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

/**
 * `ctx.ask` 里"跑命令"用的权限名。
 *
 * 踩过的坑：shell 工具对外叫 `bash`（`ShellID.ToolID`），Windows 分支还会用
 * `powershell`；只有历史配置里残留 `shell`。少写一个名字就等于计划模式下
 * 该名字的命令**完全不设防** —— 而 agent 默认规则集是 `"*": "allow"`，
 * 结果就是 `rm -rf src` 静默执行。三个名字必须都认。
 */
export const PLAN_SHELL_PERMISSIONS = new Set(["bash", "powershell", "shell"])

/** Browser actions that only inspect or move through the isolated research browser. */
const PLAN_BROWSER_READ_ACTIONS = new Set([
  "snapshot",
  "tabs",
  "status",
  "console",
  "network",
  "accessibility",
  "screenshot",
  "close",
])

function isPlanBrowserRead(input: { patterns: readonly string[]; metadata: Record<string, unknown> }) {
  const target = input.metadata.target
  const candidate = typeof target === "string" ? target : input.patterns.length === 1 ? input.patterns[0] : undefined
  if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return true
  return input.patterns.length === 1 && PLAN_BROWSER_READ_ACTIONS.has(input.patterns[0]?.trim().toLowerCase() ?? "")
}

/**
 * 计划模式下允许继续走常规流程（规则集 / 询问用户）的权限名。
 * 注意语义：这里不是"直接放行"，而是"计划模式这一层不做裁决"。命中的权限
 * 仍然要过规则集，用户照样能看到询问 —— 计划模式只负责把明显越界的能力挡在
 * 规则集之前，不替用户做进一步的决定。
 *
 * 收录标准：只看不改 —— 读文件/搜索/联网查资料/待办/提问/子代理/技能/记忆/LSP
 * 诊断，以及计划模式自身的进出。写盘、跑非只读命令、点鼠标、建定时任务、写库、
 * git 写操作等一律不在名单里，落到 `planToolDenial`。
 *
 * `external_directory` 在这里是特例，而且是必须的：计划目录有两个，其中
 * `Global.Path.data/plans` **在工作区之外**；写全局计划时 `edit` / `apply_patch` /
 * `glob` / `shell` 会先 `ctx.ask({ permission: "external_directory" })`
 * （如 `tool/edit.ts:89`）。计划模式若在这一层就拒，合法的全局计划目录照样写不进去
 * —— 又变成"要求写计划却写不了"。它只影响**读**，且默认规则集里是 `"*": "ask"`，
 * 放过去之后用户照样能在询问里把关，安全边界不破。
 */
export const PLAN_READ_ONLY_PERMISSIONS = new Set([
  "read",
  "glob",
  "grep",
  "list",
  "search",
  "websearch",
  "webfetch",
  "external_directory",
  "todowrite",
  "todoedit",
  "todo",
  "question",
  "skill",
  "task",
  "lsp",
  "memory",
  "plan_enter",
  "plan_exit",
])

/** 计划模式对单次权限请求的裁决。 */
export type PlanVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false
      /** 拒绝类别：调用方据此把"写文件"换成带具体计划路径的文案。 */
      readonly kind: "write" | "shell" | "tool"
      readonly reason: string
    }

export function planRoot(input: { directory: string; worktree: string }) {
  return input.worktree === "/" ? input.directory : input.worktree
}

/** 计划文件允许落盘的两个目录。 */
export function planDirectories(input: { directory: string; worktree: string }) {
  return [path.join(planRoot(input), ".novaway", "plans"), path.join(Global.Path.data, "plans")]
}

/**
 * 本次会话的计划文件绝对路径（`<planRoot>/.novaway/plans/<created>-<slug>.md`）。
 *
 * 与 `Session.plan` 同源：拒绝写入时要告诉模型"到底能写哪"，两处算法必须一致，
 * 所以只有一个实现，`Session.plan` 也走它。
 */
export function planFile(input: { slug: string; created: number }, instance: { directory: string; worktree: string }) {
  const base = path.join(planRoot(instance), ".novaway", "plans")
  return path.join(base, [input.created, input.slug].join("-") + ".md")
}

/**
 * 所有 pattern 都指向计划目录里的 markdown 才算"写计划"。
 *
 * pattern 通常相对 project root（工具就是这么传的），但会话跑在 worktree / 子目录
 * 时相对基准会和 `planRoot` 不一致，所以调用方应优先传入 `metadata.filepath`
 * （工具给的绝对路径）——绝对路径按自身解析，不再叠加 root。
 */
function samePath(a: string, b: string) {
  const left = AppFileSystem.windowsPath(path.normalize(a))
  const right = AppFileSystem.windowsPath(path.normalize(b))
  // `contains` uses the platform path implementation and also handles Windows
  // drive roots correctly. Checking both directions gives us equality without
  // accidentally treating a sibling (for example `plan.md.bak`) as a match.
  return AppFileSystem.contains(left, right) && AppFileSystem.contains(right, left)
}

export function isPlanWrite(
  patterns: readonly string[],
  input: { directory: string; worktree: string },
  /** When known, only this session's plan may be changed. */
  sessionPlanPath?: string,
) {
  if (patterns.length === 0) return false
  const root = planRoot(input)
  const dirs = planDirectories(input)
  const exactPlan = sessionPlanPath ? AppFileSystem.windowsPath(path.normalize(sessionPlanPath)) : undefined
  return patterns.every((pattern) => {
    const normalized = AppFileSystem.windowsPath(pattern)
    const file = path.isAbsolute(normalized) ? path.normalize(normalized) : path.resolve(root, normalized)
    if (!file.toLowerCase().endsWith(".md")) return false
    // Permission.ask knows the session id and therefore can enforce the exact
    // deterministic plan path. The directory check remains as a safe fallback
    // for embedders/tests that call this pure helper without a session row.
    if (exactPlan) {
      // Project plans are session-scoped. The managed global plan directory is
      // intentionally shared because global sessions do not belong to one
      // project/worktree and the existing plan store uses it as a valid target.
      return samePath(file, exactPlan) || AppFileSystem.contains(path.join(Global.Path.data, "plans"), file)
    }
    return dirs.some((dir) => AppFileSystem.contains(dir, file))
  })
}

/**
 * 判定"写计划"用的路径清单。
 *
 * 工具给的 `metadata.filepath` 是绝对路径时优先用它：`patterns` 是相对「会话目录」
 * 算的，会话跑在 worktree / 子目录时基准与计划目录不一致，会误判越界。
 * `apply_patch` 还会提供 `filepaths`，因为它一次调用可能包含多个文件或 Move to
 * 的源/目标；不能只拿一个逗号拼接的展示字符串做安全判定。
 */
export function planWriteTargets(input: {
  patterns: readonly string[]
  metadata: Record<string, unknown>
}): readonly string[] {
  const filepaths = input.metadata.filepaths
  if (Array.isArray(filepaths) && filepaths.every((item): item is string => typeof item === "string")) {
    return filepaths
  }
  const filepath = input.metadata.filepath
  if (typeof filepath !== "string") return input.patterns
  return path.isAbsolute(AppFileSystem.windowsPath(filepath)) ? [filepath] : input.patterns
}

/**
 * 计划模式拒绝写文件时给模型的可操作说明：唯一可写的文件 + 下一步动作。
 * 只提本次会话的计划文件，不暴露别的路径。
 */
export function planWriteDenial(input: { planPath?: string; directory: string; worktree: string }): string {
  const target = input.planPath ?? path.join(planDirectories(input)[0] ?? planRoot(input), "*.md")
  return (
    `Plan mode is read-only: the only file you may write is the session plan at ${target}. ` +
    `Write the plan there (markdown only), then call plan_exit to ask for approval. ` +
    `Other project files stay read-only until the permission mode changes.`
  )
}

/** 计划模式拒绝 shell 时给模型的可操作说明。 */
export function planShellDenial(): string {
  return (
    "Plan mode allows read-only shell commands only, so nothing was executed. " +
    "Use read/glob/grep or a read-only command (git status, ls, cat) until the permission mode changes."
  )
}

/**
 * 计划模式拒绝"不在只读清单里"的权限名时给模型的可操作说明。
 *
 * 这类权限（点鼠标、建定时任务、写库、git 写操作……）没有任何只读用法，
 * 计划模式下只能整类拒绝；文案要说明"为什么"和"换什么"。
 */
export function planToolDenial(permission: string): string {
  return (
    `Plan mode allows read-only tools only, so \`${permission}\` was not used. ` +
    `Inspect the project with read/glob/grep or a read-only shell command (git status, ls, cat), ` +
    `write the plan to the session plan file, then call plan_exit to ask for approval.`
  )
}

/**
 * 计划模式的权限裁决（纯函数，必须在规则集之前调用）。
 *
 * 三类处理：
 * 1. 写文件 → 只有计划目录里的 `.md` 放行（`isPlanWrite`）；
 * 2. 跑命令 → 只有只读命令放行（`isReadOnlyShell`）；
 * 3. 其它 → 在只读清单里就交给后续流程，不在就整类拒绝。
 *
 * 放行意味着"继续走规则集"，不是"跳过规则集"：用户的 deny 规则依然生效。
 */
export function planVerdict(input: {
  permission: string
  patterns: readonly string[]
  metadata: Record<string, unknown>
  instance: { directory: string; worktree: string }
  /** The deterministic plan belonging to the session making this request. */
  planPath?: string
}): PlanVerdict {
  if (PLAN_WRITE_TOOLS.has(input.permission)) {
    if (isPlanWrite(planWriteTargets(input), input.instance, input.planPath)) return { allowed: true }
    return {
      allowed: false,
      kind: "write",
      reason: planWriteDenial({ directory: input.instance.directory, worktree: input.instance.worktree }),
    }
  }
  if (PLAN_SHELL_PERMISSIONS.has(input.permission)) {
    if (isReadOnlyShell(input.patterns)) return { allowed: true }
    return { allowed: false, kind: "shell", reason: planShellDenial() }
  }
  if (input.permission === "browser") {
    if (isPlanBrowserRead(input)) return { allowed: true }
    return { allowed: false, kind: "tool", reason: planToolDenial("browser interaction") }
  }
  // `git` 是"按动作分级"的权限名（`tool/git.ts` 传的是 `patterns: [action]`）。
  //
  // 生产路径其实到不了这里：`tool/git.ts:126` 是 `if (!READ_ONLY.has(action))` 才
  // ask，只读动作根本不进权限层。这段是防御性的 —— 别把它当成"git 只读要过权限"的
  // 依据，也别据此把 `"git"` 塞进 `PLAN_READ_ONLY_PERMISSIONS`（那会放行 `git push`）。
  // `SAFE_GIT` 已不含 `config`，所以 `git config …` 在这条路径上同样是拒绝。
  if (input.permission === "git") {
    if (input.patterns.length > 0 && input.patterns.every((action) => SAFE_GIT.has(action.trim().toLowerCase()))) {
      return { allowed: true }
    }
    return { allowed: false, kind: "tool", reason: planToolDenial("git") }
  }
  if (input.permission === "external_directory") {
    // A worktree-isolated session may keep its plan under the instance root,
    // while the session directory is a child worktree. The write tool asks for
    // external_directory before it asks for edit. Do not turn that legitimate
    // plan write into a second, contradictory approval; only the exact current
    // plan file gets this exception. Shell/read requests without this filepath
    // still go through the normal external-directory rules.
    const filepath = input.metadata.filepath
    if (input.planPath && typeof filepath === "string" && samePath(filepath, input.planPath)) {
      return { allowed: true }
    }
  }
  if (PLAN_READ_ONLY_PERMISSIONS.has(input.permission)) return { allowed: true }
  return { allowed: false, kind: "tool", reason: planToolDenial(input.permission) }
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

/**
 * git 的只读子命令。
 *
 * 刻意**不含 `config`**：`git config core.hooksPath /tmp/evil` 会写 `.git/config`，
 * 之后任何 git 命令都会执行攻击者的 hook —— 这是一条"只读命令"变"任意代码执行"的
 * 升级路径。代价是 `git config --get user.name` 这类查询也会被拒：可接受，
 * 规划阶段不需要读 git 配置，要看就退出计划模式。
 */
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
