import { describe, expect, test } from "bun:test"
import {
  evolutionQueryKeys,
  invalidateMemoryEvolutionQueries,
  memoryEvolutionRefreshQueryKeys,
  memoryReviewQueryKeys,
} from "./memory-evolution-events"

describe("memory evolution event refresh keys", () => {
  test("refreshes memory review queries for memory review events", () => {
    expect(memoryEvolutionRefreshQueryKeys({ type: "memory.review.updated" })).toEqual(memoryReviewQueryKeys)
  })

  test("refreshes evolution queries for evolution events", () => {
    expect(memoryEvolutionRefreshQueryKeys({ type: "evolution.updated" })).toEqual(evolutionQueryKeys)
  })

  test("ignores unrelated events", () => {
    expect(memoryEvolutionRefreshQueryKeys({ type: "session.updated" })).toEqual([])
  })

  test("invalidates memory queries through the query client", () => {
    const calls: { queryKey: readonly unknown[] }[] = []
    const count = invalidateMemoryEvolutionQueries(
      {
        invalidateQueries: (input) => calls.push(input),
      },
      { type: "memory.review.updated" },
    )

    expect(count).toBe(2)
    expect(calls).toEqual(memoryReviewQueryKeys.map((queryKey) => ({ queryKey })))
  })

  test("invalidates evolution queries through the query client", () => {
    const calls: { queryKey: readonly unknown[] }[] = []
    const count = invalidateMemoryEvolutionQueries(
      {
        invalidateQueries: (input) => calls.push(input),
      },
      { type: "evolution.updated" },
    )

    expect(count).toBe(2)
    expect(calls).toEqual(evolutionQueryKeys.map((queryKey) => ({ queryKey })))
  })

  test("does not invalidate queries for unrelated events", () => {
    const calls: { queryKey: readonly unknown[] }[] = []
    const count = invalidateMemoryEvolutionQueries(
      {
        invalidateQueries: (input) => calls.push(input),
      },
      { type: "session.updated" },
    )

    expect(count).toBe(0)
    expect(calls).toEqual([])
  })
})
