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
})
export type Info = Schema.Schema.Type<typeof Info>

export function resolve(input?: Info) {
  return {
    enabled: input?.enabled ?? false,
    interval: input?.interval ?? 8,
  }
}
