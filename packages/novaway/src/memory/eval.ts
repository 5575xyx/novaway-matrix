export type RetrievalEvalCase = {
  query: string
  expected: string[]
  k?: number
}

export type RetrievalEvalResult = {
  query: string
  expected: string[]
  retrieved: string[]
  hits: string[]
  precisionAtK: number
  recallAtK: number
  mrr: number
  hitsAtK: number
  k: number
}

export type RetrievalEvalSummary = {
  cases: number
  expected: number
  retrievedExpected: number
  avgPrecisionAtK: number
  avgRecallAtK: number
  avgMrr: number
  hitsAtK: number
  hitRate: number
}

function firstRelevantRank(retrieved: readonly string[], expected: ReadonlySet<string>) {
  return retrieved.findIndex((id) => expected.has(id))
}

export function evaluateRetrieval(input: {
  query: string
  expected: readonly string[]
  retrieved: readonly string[]
  k?: number
}): RetrievalEvalResult {
  const k = Math.max(1, Math.floor(input.k ?? 5))
  const expected = new Set(input.expected)
  const retrieved = Array.from(input.retrieved.slice(0, k))
  const hits = retrieved.filter((id) => expected.has(id))
  const rank = firstRelevantRank(retrieved, expected)
  return {
    query: input.query,
    expected: Array.from(input.expected),
    retrieved,
    hits,
    precisionAtK: retrieved.length ? hits.length / retrieved.length : 0,
    recallAtK: input.expected.length ? hits.length / input.expected.length : 0,
    mrr: rank === -1 ? 0 : 1 / (rank + 1),
    hitsAtK: hits.length,
    k,
  }
}

export function summarizeRetrievalEval(results: readonly RetrievalEvalResult[]): RetrievalEvalSummary {
  const totalExpected = results.reduce((sum, item) => sum + item.expected.length, 0)
  const totalRetrievedExpected = results.reduce((sum, item) => sum + item.hits.length, 0)
  const cases = results.length
  return {
    cases,
    expected: totalExpected,
    retrievedExpected: totalRetrievedExpected,
    avgPrecisionAtK: cases ? results.reduce((sum, item) => sum + item.precisionAtK, 0) / cases : 0,
    avgRecallAtK: cases ? results.reduce((sum, item) => sum + item.recallAtK, 0) / cases : 0,
    avgMrr: cases ? results.reduce((sum, item) => sum + item.mrr, 0) / cases : 0,
    hitsAtK: totalRetrievedExpected,
    hitRate: totalExpected ? totalRetrievedExpected / totalExpected : 0,
  }
}
