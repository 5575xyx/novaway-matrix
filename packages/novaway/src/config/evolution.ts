export * as ConfigEvolution from "./evolution"

import { NonNegativeInt } from "@novaway/core/schema"
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
  auto_skill: Schema.optional(Schema.Boolean).annotate({
    description: "是否在单轮工具调用达到阈值时自动抽取可复用技能候选（仍需人工确认后写盘）。默认 false。",
  }),
  auto_skill_threshold: Schema.optional(NonNegativeInt).annotate({
    description: "触发自动技能抽取的本轮工具调用数阈值。默认 20。",
  }),
  curator_enabled: Schema.optional(Schema.Boolean).annotate({
    description: "启用技能生命周期巡检（长期未使用的技能标记 stale / 归档）。默认 false。",
  }),
  curator_stale_days: Schema.optional(NonNegativeInt).annotate({
    description: "技能超过多少天未使用标记为 stale。默认 30。",
  }),
  curator_archive_days: Schema.optional(NonNegativeInt).annotate({
    description: "技能超过多少天未使用归档。默认 90。",
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
    auto_skill: input?.auto_skill ?? false,
    auto_skill_threshold: input?.auto_skill_threshold ?? 20,
    curator_enabled: input?.curator_enabled ?? false,
    curator_stale_days: input?.curator_stale_days ?? 30,
    curator_archive_days: input?.curator_archive_days ?? 90,
  }
}
