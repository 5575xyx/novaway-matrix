/** 单个目标的持久预算与续跑许可。 */

export type Budget = {
  readonly turns: number
  readonly tokens: number
  readonly startedAt: number
}

export type Limits = {
  /** 累计 token 上限;undefined 表示不限制。 */
  maxTokens?: number
  /** 从目标创建起的累计时长上限(毫秒);undefined 表示不限制。 */
  maxActiveMs?: number
}

export type ContinuationPermit =
  | { allowed: true }
  | { allowed: false; reason: "max_tokens" | "max_active_ms"; detail: string }

export function allowGoalContinuation(input: { budget: Budget; limits: Limits; now: number }): ContinuationPermit {
  const { maxTokens, maxActiveMs } = input.limits
  if (maxTokens !== undefined && maxTokens >= 0 && input.budget.tokens >= maxTokens) {
    return {
      allowed: false,
      reason: "max_tokens",
      detail: `token 预算已用 ${input.budget.tokens}/${maxTokens}`,
    }
  }
  if (maxActiveMs !== undefined && maxActiveMs >= 0) {
    const elapsed = Math.max(0, input.now - input.budget.startedAt)
    if (elapsed >= maxActiveMs) {
      return {
        allowed: false,
        reason: "max_active_ms",
        detail: `已执行 ${Math.round(elapsed / 1000)}s，上限 ${Math.round(maxActiveMs / 1000)}s`,
      }
    }
  }
  return { allowed: true }
}

export * as GoalBudget from "./goal-budget"
