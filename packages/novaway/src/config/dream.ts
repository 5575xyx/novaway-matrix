export * as ConfigDream from "./dream"

import { NonNegativeInt } from "@novaway/core/schema"
import { Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description:
      "启用 dream/distill 自我改进:按 interval 轮用 LLM 反思整段会话,提炼经验并蒸馏进长期记忆。默认 false(会产生额外 LLM 调用)。",
  }),
  interval: Schema.optional(NonNegativeInt).annotate({
    description: "dream 反思的轮次间隔。默认 8。0 关闭。",
  }),
  consolidation_enabled: Schema.optional(Schema.Boolean).annotate({
    description:
      "启用跨会话整合:满足 min_hours/min_sessions 后汇总近期会话,产出经记忆审核管线与审计清单的整合结果。默认 false。",
  }),
  min_hours: Schema.optional(NonNegativeInt).annotate({
    description: "两次跨会话整合之间的最小间隔小时数。默认 24。",
  }),
  min_sessions: Schema.optional(NonNegativeInt).annotate({
    description: "触发跨会话整合所需的最少有效会话数。默认 5。",
  }),
  user_scope_enabled: Schema.optional(Schema.Boolean).annotate({
    description: "跨会话整合是否同时沉淀用户级(global)记忆。默认 false,只写项目级。",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>

export function resolve(input?: Info) {
  return {
    enabled: input?.enabled ?? false,
    interval: input?.interval ?? 8,
    consolidation_enabled: input?.consolidation_enabled ?? false,
    min_hours: input?.min_hours ?? 24,
    min_sessions: input?.min_sessions ?? 5,
    user_scope_enabled: input?.user_scope_enabled ?? false,
  }
}
