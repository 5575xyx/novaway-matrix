import type { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import type { SessionContextBreakdownSegment } from "@/components/session/session-context-breakdown"

type SessionContextMetrics = ReturnType<typeof getSessionContextMetrics>

// 收起摘要有两种口径：模型给了上下文限制时是百分比，限制缺失（usage 为 null）时回落到已用 token 总数。
export type ContextUsageSummary = { kind: "percent"; value: number } | { kind: "tokens"; value: number }

export interface ContextSectionModel {
  summary: ContextUsageSummary
  usage: number | null
  limit: number | undefined
  total: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  breakdown: SessionContextBreakdownSegment[]
}

export function contextUsageSummary(usage: number | null, total: number): ContextUsageSummary {
  return usage === null ? { kind: "tokens", value: total } : { kind: "percent", value: usage }
}

// 「无会话」与「无数据」在 getSessionContextMetrics 里收敛成同一个信号（context === undefined），
// 所以一次判空就同时覆盖规格里的两种不挂载条件。usage/total 原样保留，展开态的统计行仍需各自格式化。
export function contextSectionModel(
  metrics: SessionContextMetrics | undefined,
  breakdown: SessionContextBreakdownSegment[],
): ContextSectionModel | null {
  const ctx = metrics?.context
  if (!ctx) return null

  return {
    summary: contextUsageSummary(ctx.usage, ctx.total),
    usage: ctx.usage,
    limit: ctx.limit,
    total: ctx.total,
    input: ctx.input,
    output: ctx.output,
    reasoning: ctx.reasoning,
    cacheRead: ctx.cacheRead,
    cacheWrite: ctx.cacheWrite,
    breakdown,
  }
}
