import * as path from "path"
import * as Patch from "@/patch"
import type * as Tool from "@/tool/tool"

/**
 * 运行策略（§11.1）：团队策略只能**收紧**授权，不能放大。
 *
 * P1 的审查运行默认只读。只读在这里的含义很具体：
 *
 * 1. 直接改工作区的工具（`edit` / `write` / `patch` / `notebook_edit`…）一律拒绝；
 * 2. 破坏性操作（点击、输入、删定时任务、带 `allowWrite` 的数据库查询）一律拒绝；
 * 3. **不允许借道升级**：审查运行里不能再发起别的运行（`team_run` / `workflow` /
 *    `orchestrator`），也不能把会话搬到别的工作区（`enter_worktree` / `exit_worktree`）——
 *    否则成员可以用一次新的派发绕过本策略。
 *
 * 已知边界：`bash` / `powershell` 不受本策略拦截。审查需要跑测试，而「只读命令」
 * 白名单会让 `pytest`、`bun test` 全部失败，等于把验证能力一起砍掉。shell 的写风险
 * 由权限系统（每次执行仍走 `ask`）、团队内单写者（§10.1）和操作日志共同承担；
 * 想彻底隔离要等 P2 的团队 worktree。
 */

export type Policy = {
  readOnly: boolean
  /**
   * 团队声明的任务范围（§11.1）：相对 `root` 的路径前缀。空表示没声明。
   *
   * 它只拦**写**操作：审查要读遍全仓，读不是「范围」要防的事；
   * 越界地写才是「任务范围同样只能收紧」要防的事。
   */
  paths?: readonly string[]
  /** 相对路径的基准目录（团队 worktree；没有 worktree 时是运行目录）。 */
  root?: string
}

export const REVIEW: Policy = { readOnly: true }
export const WRITE: Policy = { readOnly: false }

/** 计划里没写策略时按只读处理：默认严格，放宽要显式。 */
export function fromPlan(
  plan: { policy?: { readOnly?: boolean } } | undefined,
  team?: { scope?: readonly string[] },
  root?: string,
): Policy {
  const paths = team?.scope?.length ? team.scope : undefined
  return {
    readOnly: plan?.policy?.readOnly ?? true,
    // 没有范围就没有基准目录：一个空 root 只会让策略对象和白名单比较不上。
    ...(paths ? { paths, ...(root ? { root } : {}) } : {}),
  }
}

export type Call = {
  tool: string
  /** 只需要这两个能力位；缺声明按「非只读、非破坏」处理。 */
  capabilities?: Pick<Tool.Capabilities, "readOnly" | "destructive">
  args: unknown
}

export type Decision = { kind: "allow" } | { kind: "deny"; reason: string }

/** 会把会话搬离当前工作区的工具：搬走之后快照绑定与策略作用域都对不上了。 */
const RELOCATE = new Set(["enter_worktree", "exit_worktree"])

/** 能发起新运行的入口：只读运行里禁止借道。 */
const LAUNDER = new Set(["team_run", "workflow", "orchestrator"])

const allow: Decision = { kind: "allow" }
const deny = (reason: string): Decision => ({ kind: "deny", reason })

const flag = (value: boolean | ((args: unknown) => boolean) | undefined, args: unknown) => {
  if (value === undefined) return false
  if (typeof value === "function") {
    try {
      return value(args)
    } catch {
      // 判定失败按破坏性处理：拿不准就拒绝。
      return true
    }
  }
  return value
}

export function decide(policy: Policy, call: Call): Decision {
  const outside = outsideScope(policy, call)
  if (outside) {
    return deny(
      `这次任务的范围是 ${policy.paths!.join("、")}；${outside} 不在其中。` +
        "任务范围只能收紧每次运行的授权，要改范围请在计划里改并重新批准。",
    )
  }
  if (!policy.readOnly) return allow
  if (RELOCATE.has(call.tool)) {
    return deny(`只读运行不能切换工作区（${call.tool}）：证据与快照会失去对应关系。`)
  }
  if (LAUNDER.has(call.tool)) {
    return deny(`只读运行不能借道发起新的运行（${call.tool}）：那会绕过本次运行的策略。`)
  }
  if (flag(call.capabilities?.destructive, call.args)) {
    return deny(`只读运行不允许破坏性操作（${call.tool}）。需要写操作请在计划里显式设置 readOnly=false 并重新批准。`)
  }
  return allow
}

/**
 * 直接带目标路径的写工具。
 *
 * 只收写工具：`read` / `glob` / `grep` 也带路径，但它们是只读的，不属于范围要约束的事。
 */
const PATH_ARG: Record<string, string> = {
  write: "filePath",
  edit: "filePath",
  notebook_edit: "filePath",
}

/** 补丁类工具：目标写在补丁头里（`*** Update File: …`），只能从 patchText 解析。 */
const PATCH_TOOLS = new Set(["apply_patch", "patch"])

/** 这些调用会写到哪里；看不到目标就返回空数组（不假装拦得住）。 */
function writeTargets(call: Call): string[] {
  const param = PATH_ARG[call.tool]
  if (param) {
    if (!call.args || typeof call.args !== "object") return []
    const value: unknown = Reflect.get(call.args, param)
    return typeof value === "string" && value ? [value] : []
  }
  if (PATCH_TOOLS.has(call.tool)) {
    if (!call.args || typeof call.args !== "object") return []
    const text: unknown = Reflect.get(call.args, "patchText")
    if (typeof text !== "string" || !text) return []
    try {
      // 解析不出来说明这份补丁本身不成立，工具会自己失败；这里不额外拦一道。
      return Patch.parsePatch(text).hunks.flatMap((hunk) =>
        "move_path" in hunk && hunk.move_path ? [hunk.path, hunk.move_path] : [hunk.path],
      )
    } catch {
      return []
    }
  }
  // bash / powershell 这类看不到文件目标：写风险由权限系统与操作日志承担（见文件头）。
  return []
}

const canonical = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "")

/** 目标是否在声明范围内；返回第一个越界目标（已解析成绝对路径）用于报错。 */
function outsideScope(policy: Policy, call: Call): string | undefined {
  if (!policy.paths?.length) return undefined
  // 只读工具没有「写到哪里」可言，自然不受范围限制（能力位可能是谓词，按参数判）。
  if (flag(call.capabilities?.readOnly, call.args)) return undefined
  const root = policy.root ?? "."
  const allowed = policy.paths.map((item) => canonical(path.resolve(root, item)))
  for (const target of writeTargets(call)) {
    const absolute = canonical(path.resolve(root, target))
    if (allowed.some((item) => absolute === item || absolute.startsWith(item + "/"))) continue
    return absolute
  }
  return undefined
}

export * as TeamPolicy from "./policy"
