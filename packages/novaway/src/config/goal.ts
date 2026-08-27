export * as ConfigGoal from "./goal"

import { NonNegativeInt } from "@novaway/core/schema"
import { Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description:
      "启用目标驱动的自主循环:每轮结束后用裁判模型判断活动目标是否达成,未达成则自动追加一轮。默认 false(自主跑工具需显式开启)。",
  }),
  max_iterations: Schema.optional(NonNegativeInt).annotate({
    description: "自主循环单个目标的硬性最大追加轮次,防跑飞。默认 8。0 关闭自主追加。",
  }),
  judge_model: Schema.optional(Schema.String).annotate({
    description: '裁判模型,格式 "providerID/modelID"。省略则复用当轮 assistant 模型。',
  }),
})
export type Info = Schema.Schema.Type<typeof Info>

export function resolve(input?: Info) {
  return {
    enabled: input?.enabled ?? false,
    max_iterations: input?.max_iterations ?? 8,
    judge_model: input?.judge_model,
  }
}
