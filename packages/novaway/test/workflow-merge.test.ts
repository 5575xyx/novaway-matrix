import { describe, expect, test } from "bun:test"
import { merge } from "../src/workflow/merge"
const state = (phase: any, revision: number): any => ({ sessionID: "s", turnID: "t", route: "l2", phase, routeLocked: true, questionCalls: 0, questionBudget: 2, verificationStatus: "pending", deliveryStatus: "not_started", updatedAt: new Date(revision), revision })
describe("workflow stale-client merge", () => {
  test("keeps the most advanced phase and monotonic safety counters", () => {
    const result = merge(state("design", 1), { ...state("implementation", 1), questionCalls: 1 }, { ...state("review", 2), questionCalls: 2 })
    expect(result.merged.phase).toBe("review")
    expect(result.merged.questionCalls).toBe(2)
    expect(result.conflicted).toBe(true)
  })
})
