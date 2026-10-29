import type { AcceptanceKind } from "./verification"

/**
 * 验证开销的三档策略（设计文档 §19.1）。
 *
 * 唯一硬约束：**档位由调度器按规则判定，不接受成员自报**。
 * 成员如果把任务描述成「只改了一个文件」，不能因此把验证降成轻档。
 */

export type Tier = "light" | "medium" | "heavy"

/** 调度器掌握的任务事实，全部来自任务元数据与 diff，不来自成员陈述。 */
export type Facts = {
  kind: AcceptanceKind
  /** 改动涉及的文件数。 */
  paths: number
  /** 是否跨模块（命中多个包 / 目录）。 */
  crossModule?: boolean
  /** 是否存在不可逆副作用：安装依赖、写外部系统、改数据库。 */
  irreversible?: boolean
  /** 是否能推导出受影响的测试。 */
  hasAffectedTests?: boolean
  /** 是否为合并后的全局验收。 */
  merged?: boolean
}

export type Decision = {
  tier: Tier
  /** 判定理由，写进运行事件，便于用户追问「为什么这么贵/这么快」。 */
  reason: string
}

export type CoverageViolation = {
  index: number
  code: "merged-must-be-heavy" | "irreversible-must-not-be-light" | "subjective-must-not-be-light"
  message: string
}

export function classify(facts: Facts): Decision {
  // 合并后的全局验收永远重档，不接受缓存与子集。
  if (facts.merged) return { tier: "heavy", reason: "合并后全局验收：无条件全量" }
  if (facts.irreversible) return { tier: "heavy", reason: "存在不可逆副作用或依赖安装：必须全量" }
  if (facts.crossModule) return { tier: "heavy", reason: "跨模块改动：必须全量" }
  // 主观验收至少要人/模型复核，不能只做结构校验。
  if (facts.kind === "rubric" || facts.kind === "human")
    return { tier: "medium", reason: "主观验收：需复核而非结构校验" }
  if (facts.kind === "test" && facts.hasAffectedTests && facts.paths > 2)
    return { tier: "medium", reason: "能推导受影响测试：跑子集" }
  if (facts.paths <= 2) return { tier: "light", reason: "影响面 ≤ 2 个文件：结构校验 + 抽样" }
  return { tier: "medium", reason: "影响面超过 2 个文件但未跨模块：跑子集" }
}

/**
 * 对一组任务给出档位分配。
 * `facts` 与 `acceptances` 一一对应，顺序即索引。
 */
export function plan(facts: readonly Facts[]): Decision[] {
  return facts.map(classify)
}

/**
 * 发布前的自检：档位不能明显配不上事实。
 * 这些是「轻档冒充验证」的典型形态，命中就说明规则被绕过了。
 */
export function violations(decisions: readonly Decision[], facts: readonly Facts[]): CoverageViolation[] {
  const out: CoverageViolation[] = []
  decisions.forEach((decision, index) => {
    const fact = facts[index]
    if (!fact) return
    if (fact.merged && decision.tier !== "heavy")
      out.push({ index, code: "merged-must-be-heavy", message: "合并后验收被降为非重档" })
    if ((fact.irreversible || fact.crossModule) && decision.tier === "light")
      out.push({ index, code: "irreversible-must-not-be-light", message: "高风险改动被降为轻档" })
    if ((fact.kind === "rubric" || fact.kind === "human") && decision.tier === "light")
      out.push({ index, code: "subjective-must-not-be-light", message: "主观验收被降为轻档" })
  })
  return out
}

/** 粗略开销预估，用于在计划审批时给用户一个区间，而不是精确承诺。 */
export function estimate(decisions: readonly Decision[]): { light: number; medium: number; heavy: number } {
  return decisions.reduce(
    (acc, decision) => {
      acc[decision.tier] += 1
      return acc
    },
    { light: 0, medium: 0, heavy: 0 },
  )
}
