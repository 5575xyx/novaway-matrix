export * as ConfigCheckpoint from "./checkpoint"

import { NonNegativeInt } from "@novaway/core/schema"
import { Schema } from "effect"

export const Info = Schema.Struct({
  auto_enabled: Schema.optional(Schema.Boolean).annotate({
    description:
      "启用自动检查点:每完成 auto_interval 轮 assistant 回合后,自动捕获会话消息与文件快照落库,便于回滚。默认 false。",
  }),
  auto_interval: Schema.optional(NonNegativeInt).annotate({
    description: "自动检查点的轮次间隔。默认 5。0 关闭自动检查点。",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>

export function resolve(input?: Info) {
  return {
    auto_enabled: input?.auto_enabled ?? false,
    auto_interval: input?.auto_interval ?? 5,
  }
}
