export * as ConfigArena from "./arena"

import { Schema } from "effect"
import { PositiveInt } from "@novaway/core/schema"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable the arena: run the same task in N isolated worktrees. Defaults to disabled.",
  }),
  concurrency: Schema.optional(PositiveInt).annotate({
    description: "How many contenders run at the same time (default: 2).",
  }),
  max_contenders: Schema.optional(PositiveInt).annotate({
    description: "Maximum number of contenders per run (default: 4).",
  }),
  models: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: 'Default contenders in "provider/model" form, used when arena_run omits contenders.',
  }),
  keep_worktrees: Schema.optional(Schema.Boolean).annotate({
    description: "Keep contender worktrees after the run for manual review. Defaults to false.",
  }),
})

export type Info = Schema.Schema.Type<typeof Info>

export function resolve(info?: Info) {
  return {
    enabled: info?.enabled ?? false,
    concurrency: Math.max(1, info?.concurrency ?? 2),
    max_contenders: Math.max(1, info?.max_contenders ?? 4),
    models: info?.models ?? [],
    keep_worktrees: info?.keep_worktrees ?? false,
  }
}
