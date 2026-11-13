export * as ConfigComputer from "./computer"

import { Schema } from "effect"
import { PositiveInt } from "@novaway/core/schema"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable multi-step computer-use automation. Defaults to disabled.",
  }),
  max_steps: Schema.optional(PositiveInt).annotate({
    description: "Maximum number of actions in a computer-use loop (default: 10).",
  }),
})

export type Info = Schema.Schema.Type<typeof Info>

export const DEFAULT_MAX_STEPS = 10

export function resolve(info?: Info) {
  return {
    enabled: info?.enabled ?? false,
    max_steps: Math.max(1, info?.max_steps ?? DEFAULT_MAX_STEPS),
  }
}
