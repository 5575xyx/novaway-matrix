import { Duration, Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./sleep.txt"

/** A single wait longer than this is pointless: prompt caching expires at 5 minutes. */
const MAX_DURATION_MS = 5 * 60 * 1000

/** Coerce the requested wait into a sane range: finite, non-negative, at most 5 minutes. */
export function clampDuration(value: number) {
  const requested = Number.isFinite(value) ? Math.trunc(value) : 0
  return Math.min(Math.max(requested, 0), MAX_DURATION_MS)
}

export const Parameters = Schema.Struct({
  duration_ms: Schema.Number.annotate({
    description: "How long to wait, in milliseconds. Clamped to a maximum of 300000 (5 minutes).",
  }),
})

export const SleepTool = Tool.define(
  "sleep",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const duration = clampDuration(params.duration_ms)

          if (duration > 0) {
            yield* Effect.callback<void>((resume) => {
              if (ctx.abort.aborted) {
                resume(Effect.interrupt)
                return
              }
              const timer = setTimeout(() => resume(Effect.void), duration)
              const onAbort = () => {
                clearTimeout(timer)
                resume(Effect.interrupt)
              }
              ctx.abort.addEventListener("abort", onAbort, { once: true })
              return Effect.sync(() => {
                clearTimeout(timer)
                ctx.abort.removeEventListener("abort", onAbort)
              })
            })
          }

          const label = Duration.format(Duration.millis(duration))
          return {
            title: `Slept ${label}`,
            output: duration > 0 ? `Slept for ${label}.` : "Nothing to wait for.",
            metadata: { duration_ms: duration },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
