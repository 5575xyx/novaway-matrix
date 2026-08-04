export type TaskComparisonScenario = {
  id: string
  task: string
  expectedMemoryIds: string[]
  expectedRelationClues?: string[]
}

export type TaskComparisonResult = {
  id: string
  task: string
  noMemoryCoverage: number
  memoryOnlyCoverage: number
  memoryPlusRelationsCoverage: number
  relationCoverage: number
  missingMemory: string[]
  missingRelations: string[]
}

function coverage(expected: readonly string[], actual: ReadonlySet<string>) {
  if (!expected.length) return 1
  return expected.filter((id) => actual.has(id)).length / expected.length
}

export function evaluateTaskCoverage(input: {
  scenario: TaskComparisonScenario
  memoryIds: readonly string[]
  prefetchText: string
}): TaskComparisonResult {
  const expected = new Set(input.scenario.expectedMemoryIds)
  const actual = new Set(input.memoryIds)
  const expectedRelations = input.scenario.expectedRelationClues ?? []
  const includedRelations = expectedRelations.filter((clue) => input.prefetchText.includes(clue))
  const missingMemory = input.scenario.expectedMemoryIds.filter((id) => !actual.has(id))
  const missingRelations = expectedRelations.filter((clue) => !input.prefetchText.includes(clue))
  return {
    id: input.scenario.id,
    task: input.scenario.task,
    noMemoryCoverage: 0,
    memoryOnlyCoverage: coverage(input.scenario.expectedMemoryIds, actual),
    memoryPlusRelationsCoverage: coverage(
      input.scenario.expectedMemoryIds,
      new Set(input.scenario.expectedMemoryIds.filter((id) => input.prefetchText.includes(id))),
    ),
    relationCoverage: expectedRelations.length ? includedRelations.length / expectedRelations.length : 1,
    missingMemory,
    missingRelations,
  }
}

export function summarizeTaskComparison(results: readonly TaskComparisonResult[]) {
  const cases = results.length
  const average = (pick: (item: TaskComparisonResult) => number) =>
    cases ? results.reduce((sum, item) => sum + pick(item), 0) / cases : 0
  return {
    cases,
    noMemoryCoverage: 0,
    memoryOnlyCoverage: average((item) => item.memoryOnlyCoverage),
    memoryPlusRelationsCoverage: average((item) => item.memoryPlusRelationsCoverage),
    relationCoverage: average((item) => item.relationCoverage),
  }
}
