import { describe, expect, test } from "bun:test"
import { summarize } from "../src/workflow/metrics"

describe("workflow metrics", () => {
  test("counts durable events without treating unknown events as success", () => {
    const result = summarize("session-1", {
      sessionID: "session-1" as any, turnID: "turn-1", route: "l1", phase: "verification",
      routeLocked: true, questionCalls: 1, questionBudget: 1, verificationStatus: "unverified",
      deliveryStatus: "blocked", updatedAt: new Date(),
    }, [
      { type: "turn.started", route: "l1", phase: "grill-me" },
      { type: "route.escalated", route: "l2", phase: "design" },
      { type: "tool.blocked", route: "l2", phase: "verification" },
      { type: "verification.changed", route: "l2", phase: "verification", payload: { status: "unverified" } },
      { type: "unknown.success", route: "l2", phase: "completed" },
    ])
    expect(result.escalationCount).toBe(1)
    expect(result.blockedToolCount).toBe(1)
    expect(result.verification.passed).toBe(0)
    expect(result.delivery.completed).toBe(0)
    expect(result.questionCalls).toBe(1)
  })
})
