export const memoryReviewQueryKeys = [
  ["settings", "memory", "review-status"],
  ["settings", "memory", "review-candidates"],
] as const

export const evolutionQueryKeys = [
  ["settings", "evolution", "status"],
  ["settings", "evolution", "candidates"],
] as const

type QueryInvalidator = {
  invalidateQueries: (input: { queryKey: readonly unknown[] }) => unknown
}

export function memoryEvolutionRefreshQueryKeys(event: { type: string }) {
  if (event.type === "memory.review.updated") return memoryReviewQueryKeys
  if (event.type === "evolution.updated") return evolutionQueryKeys
  return []
}

export function invalidateMemoryEvolutionQueries(queryClient: QueryInvalidator, event: { type: string }) {
  const queryKeys = memoryEvolutionRefreshQueryKeys(event)
  for (const queryKey of queryKeys) {
    void queryClient.invalidateQueries({ queryKey })
  }
  return queryKeys.length
}
