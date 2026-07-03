export * as ConfigEvolution from "./evolution"

import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable self-evolution candidate review. Defaults to false while the feature is experimental.",
  }),
  review_llm: Schema.optional(Schema.Boolean).annotate({
    description: "Enable LLM-generated self-evolution candidates. Defaults to false to avoid extra model calls.",
  }),
  review_interval: Schema.optional(NonNegativeInt).annotate({
    description: "Background self-evolution review cadence in user turns. 0 disables background review.",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>
