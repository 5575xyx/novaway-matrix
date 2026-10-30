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

export type Policy = { readOnly: boolean }

export const REVIEW: Policy = { readOnly: true }
export const WRITE: Policy = { readOnly: false }

/** 计划里没写策略时按只读处理：默认严格，放宽要显式。 */
export function fromPlan(plan: { policy?: { readOnly?: boolean } } | undefined): Policy {
  return { readOnly: plan?.policy?.readOnly ?? true }
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

export * as TeamPolicy from "./policy"
