export * as ConfigMemory from "./memory"

import { NonNegativeInt, PositiveInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable persistent memory recall and the memory tool. Defaults to false while the feature is experimental.",
  }),
  prefetch_limit: Schema.optional(PositiveInt).annotate({
    description: "Maximum number of memory entries injected into the current user turn. Defaults to 5.",
  }),
  auto_extract: Schema.optional(Schema.Boolean).annotate({
    description: "Enable deterministic explicit-memory extraction from completed turns. Defaults to false.",
  }),
  review_enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable background memory review candidate generation. Defaults to false.",
  }),
  review_llm: Schema.optional(Schema.Boolean).annotate({
    description: "Enable LLM-generated memory review candidates. Defaults to false to avoid extra model calls.",
  }),
  review_interval: Schema.optional(NonNegativeInt).annotate({
    description: "Future background review cadence in user turns. 0 disables background review.",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>
