export * as ConfigGoal from "./goal"

import { NonNegativeInt } from "@novaway/core/schema"
import { Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description:
      "启用目标驱动的自主执行:Agent 持续规划、执行并验证活动目标,未达成则继续迭代,直到目标完成或达到最大轮数。默认 false。",
  }),
  max_iterations: Schema.optional(NonNegativeInt).annotate({
    description: "普通目标循环的最大追加轮数。交互式目标模式可传 0 表示自动模式；配置值为 0 仍表示关闭后台自动追加。默认 20。",
  }),
  judge_model: Schema.optional(Schema.String).annotate({
    description: '裁判模型,格式 "providerID/modelID"。省略则复用当轮 assistant 模型。',
  }),
  max_tokens: Schema.optional(NonNegativeInt).annotate({
    description: "单个目标的累计 token 预算(跨重启持久计数)。达到上限即停止追加并暂停目标。默认不限制。",
  }),
  max_active_ms: Schema.optional(NonNegativeInt).annotate({
    description: "单个目标从创建起的累计执行时长预算(毫秒)。达到上限即停止追加并暂停目标。默认不限制。",
  }),
  verifier: Schema.optional(Schema.Literals(["judge", "agent"])).annotate({
    description:
      '目标完成的判定方式:"judge" 用裁判模型做进程内判定;"agent" 复用只读 verification 子代理的报告。默认 "judge"。',
  }),
  evidence_min_bytes: Schema.optional(NonNegativeInt).annotate({
    description: "判定目标完成所需的最小证据字节数;证据不足时视为未达成并要求继续验证。默认 0(不限制)。",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>

export type Verifier = "judge" | "agent"

export function resolve(input?: Info) {
  return {
    enabled: input?.enabled ?? false,
    max_iterations: input?.max_iterations ?? 20,
    judge_model: input?.judge_model,
    max_tokens: input?.max_tokens,
    max_active_ms: input?.max_active_ms,
    verifier: (input?.verifier ?? "judge") as Verifier,
    evidence_min_bytes: input?.evidence_min_bytes ?? 0,
  }
}
