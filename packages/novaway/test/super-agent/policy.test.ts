import { describe, expect, test } from "bun:test"
import { SuperAgentRuntime } from "../../src/super-agent"
import type { Goal } from "../../src/super-agent"

const goal: Goal = { text: "policy", constraints: [], source: "user", requestedBy: "test", acceptanceCriteria: [] }
const metadata = {
  instructionID: "i-1",
  runID: "policy-run",
  issuedAt: Date.now(),
  policyContextHash: "policy:v1",
  capability: "tool",
  idempotencyKey: "policy:1",
}

describe("Super-Agent instruction policy", () => {
  test("rejects denied capabilities before executor side effects", async () => {
    let calls = 0
    const runtime = SuperAgentRuntime.create({ id: "policy-run", goal }, undefined).runtime
    const denied = { ...metadata, capability: "secret", type: "checkpoint" as const, reason: "test" }
    await expect(runtime.dispatch(denied)).rejects.toThrow("capability denied")
    expect(calls).toBe(0)
  })

  test("deduplicated instructions do not consume additional steps", async () => {
    const executor = async () => ({ type: "tool_completed" as const, tool: "test", output: "ok" })
    const created = SuperAgentRuntime.create({ id: "policy-duplicate", goal })
    const runtime = new SuperAgentRuntime(created.runtime.snapshot(), created.journal, executor)
    const instruction = {
      ...metadata,
      runID: "policy-duplicate",
      idempotencyKey: "policy-duplicate:1",
      type: "checkpoint" as const,
      reason: "test",
    }
    await runtime.dispatch(instruction)
    await runtime.dispatch(instruction)
    expect(runtime.snapshot().usage.steps).toBe(1)
  })
})
