import type { HookActiveView } from "@novaway/sdk/v2"

export type ActiveHook = HookActiveView

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/** Panel summary: the count of running hooks. */
export function activeHooksLabel(hooks: readonly ActiveHook[]): string {
  return String(hooks.length)
}

/**
 * Elapsed time for a running hook.
 *
 * Hooks are usually sub-second, so the first second is shown in milliseconds —
 * `0s` for a hook that has clearly been running would look broken.
 */
export function formatHookElapsed(startedAt: number, now: number): string {
  const ms = Math.max(0, num(now) - num(startedAt))
  if (ms < 1_000) return `${ms}ms`
  const seconds = Math.round(ms / 1_000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}
