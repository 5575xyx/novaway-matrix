export * as ConfigGoal from "./goal"

import { NonNegativeInt } from "@novaway/core/schema"
import { Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description:
      "启用目标驱动的自主执行:Agent 持续规划、执行并验证活动目标,未达成则继续迭代,直到目标完成或达到最大轮数。默认 false。",
  }),
  max_iterations: Schema.optional(NonNegativeInt).annotate({
    description: "单次目标执行的最大追加轮数。可选 5、10、15、20、50、100;默认 20,0 关闭自主追加。",
  }),
  judge_model: Schema.optional(Schema.String).annotate({
    description: '裁判模型,格式 "providerID/modelID"。省略则复用当轮 assistant 模型。',
  }),
})
export type Info = Schema.Schema.Type<typeof Info>

export function resolve(input?: Info) {
  return {
    enabled: input?.enabled ?? false,
    max_iterations: input?.max_iterations ?? 20,
    judge_model: input?.judge_model,
  }
}
