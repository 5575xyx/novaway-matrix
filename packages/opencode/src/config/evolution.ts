export * as ConfigEvolution from "./evolution"

import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "启用自我进化候选生成。默认 true。写盘 apply 仍建议人工确认。",
  }),
  review_llm: Schema.optional(Schema.Boolean).annotate({
    description: "用 LLM 生成自我进化候选。默认 true。",
  }),
  review_interval: Schema.optional(NonNegativeInt).annotate({
    description: "背景自我进化审查间隔（用户轮次）。0 关闭。默认 2。",
  }),
  auto_apply: Schema.optional(Schema.Boolean).annotate({
    description: "是否自动 apply 进化候选（仅标记 applied，不含写盘）。默认 false，避免静默改系统行为。",
  }),
  auto_apply_file: Schema.optional(Schema.Boolean).annotate({
    description:
      "是否自动将进化候选写入磁盘。默认 false。开启后会直接修改 .novaway 下的技能、Agent、工作流等文件，写盘后自动校验，校验失败自动回滚，建议仅在可信环境使用。",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>

export function resolve(input?: Info) {
  return {
    enabled: input?.enabled ?? true,
    review_llm: input?.review_llm ?? true,
    review_interval: input?.review_interval ?? 2,
    auto_apply: input?.auto_apply ?? false,
    auto_apply_file: input?.auto_apply_file ?? false,
  }
}
