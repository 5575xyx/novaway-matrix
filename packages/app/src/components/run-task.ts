/** User-facing task input helpers. Keep task creation permissive while preserving a verifiable fallback. */
export function linesOf(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Acceptance is optional at the task入口. When the user does not provide one,
 * create a visible, reviewable baseline from the goal instead of silently
 * creating a run with no delivery criterion.
 */
export function acceptanceForGoal(goal: string, declared: string, fallbackPrefix: string): string[] {
  const text = goal.trim()
  if (!text) return []
  const declaredLines = linesOf(declared)
  return declaredLines.length > 0 ? declaredLines : [`${fallbackPrefix}${text}`]
}
