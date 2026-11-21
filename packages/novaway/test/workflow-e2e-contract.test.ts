import { describe, expect, test } from "bun:test"
import { memoryInput } from "../src/workflow/evidence"
import { updateWithConflictRetry } from "../src/workflow/client"
const state = (revision: number, phase: any = "design"): any => ({ sessionID: "s", turnID: "t", route: "l2", phase, routeLocked: true, questionCalls: 0, questionBudget: 2, verificationStatus: "pending", deliveryStatus: "not_started", updatedAt: new Date(), revision })
describe("workflow integration contracts", () => {
  test("evidence becomes session memory input with trace tag", () => { const item = memoryInput({ sessionID: "s" as any, source: "verification", evidence: { sha: "abc" } }); expect(item.scope).toBe("session"); expect(item.tags).toContain("workflow-evidence"); expect(item.content).toContain("abc") })
  test("stale update reloads, merges, and retries", async () => { let calls = 0; const result = await updateWithConflictRetry({ base: state(1), local: state(1, "implementation"), patch: { phase: "implementation" }, update: async (revision) => { calls++; if (calls === 1) throw new Error("409"); return state(revision + 1, "review") }, reload: async () => state(2, "review") }); expect(calls).toBe(2); expect(result.phase).toBe("review") })
})
