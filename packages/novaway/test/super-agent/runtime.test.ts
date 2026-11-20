import { describe, expect, test } from "bun:test"
import { SuperAgentRuntime } from "../../src/super-agent/runtime"
import { InvalidRunTransition, canCompleteRun, readyTasks } from "../../src/super-agent/state"
import type { Goal, Verification } from "../../src/super-agent/types"

const goal: Goal = {
  text: "run the project checks",
  constraints: [],
  source: "user",
  requestedBy: "test-user",
  acceptanceCriteria: [{ id: "tests", text: "tests pass", required: true }],
}

describe("SuperAgentRuntime", () => {
  test("creates a durable-shaped run and emits ordered events", () => {
    const { runtime, journal } = SuperAgentRuntime.create({ id: "run-1", goal })
    expect(runtime.snapshot().status).toBe("draft")
    runtime.transition("planning")
    runtime.transition("ready")
    runtime.transition("running")
    expect(journal.events().map((event) => event.sequence)).toEqual([1, 2, 3])
    expect(journal.events().map((event) => event.type)).toEqual([
      "run_status_changed",
      "run_status_changed",
      "run_status_changed",
    ])
  })

  test("materializes a persisted multi-task plan with independent work and dependencies", () => {
    const plannedGoal: Goal = {
      ...goal,
      plan: [
        {
          id: "plan-discover",
          kind: "tool",
          title: "Discover inputs",
          objective: "Discover the inputs for the durable task",
          input: { tool: "read", input: { filePath: "inputs.txt" } },
        },
        {
          id: "plan-prepare",
          kind: "tool",
          title: "Prepare output",
          objective: "Prepare the output independently",
          input: { tool: "read", input: { filePath: "output.txt" } },
        },
        {
          id: "plan-verify",
          kind: "tool",
          title: "Verify output",
          objective: "Verify after both preparation tasks complete",
          dependencies: ["plan-discover", "plan-prepare"],
          input: { tool: "read", input: { filePath: "output.txt" } },
        },
      ],
    }
    const run = SuperAgentRuntime.create({ id: "run-planned", goal: plannedGoal }).runtime.snapshot()
    expect(run.graph.nodes.map((task) => task.id)).toEqual(["plan-discover", "plan-prepare", "plan-verify"])
    expect(readyTasks(run).map((task) => task.id)).toEqual(["plan-discover", "plan-prepare"])
    expect(run.graph.nodes.find((task) => task.id === "plan-verify")?.dependencies).toEqual([
      "plan-discover",
      "plan-prepare",
    ])
    expect(run.graph.planHash).not.toBe("initial")
  })

  test("rejects invalid terminal transitions", () => {
    const { runtime } = SuperAgentRuntime.create({ id: "run-2", goal })
    runtime.transition("planning")
    runtime.transition("ready")
    runtime.transition("running")
    const verification: Verification = {
      id: "verification-2",
      runID: "run-2",
      acceptanceID: "tests",
      verifierID: "test-verifier",
      verifierVersion: "1",
      outcome: "pass",
      evidenceIDs: ["evidence-2"],
      reason: "test fixture passed",
      createdAt: Date.now(),
    }
    runtime.complete([verification], "done")
    expect(() => runtime.transition("running")).toThrow(InvalidRunTransition)
  })

  test("does not complete without a passing verification", () => {
    const { runtime } = SuperAgentRuntime.create({ id: "run-3", goal })
    runtime.transition("planning")
    runtime.transition("ready")
    runtime.transition("running")
    const result = runtime.complete([], "model claims success")
    expect(result.completed).toBe(false)
    expect(runtime.snapshot().status).toBe("needs_review")
  })

  test("completes only after required verification passes", () => {
    const { runtime } = SuperAgentRuntime.create({ id: "run-4", goal })
    runtime.transition("planning")
    runtime.transition("ready")
    runtime.transition("running")
    const verification: Verification = {
      id: "verification-1",
      runID: "run-4",
      acceptanceID: "tests",
      verifierID: "test-verifier",
      verifierVersion: "1",
      outcome: "pass",
      evidenceIDs: ["evidence-1"],
      reason: "test fixture passed",
      createdAt: Date.now(),
    }
    const result = runtime.complete([verification], "checks passed")
    expect(result.completed).toBe(true)
    expect(runtime.snapshot().status).toBe("completed")
  })

  test("requires an executor and leaves the task ready", async () => {
    const { runtime, journal } = SuperAgentRuntime.create({ id: "run-5", goal })
    runtime.transition("planning")
    runtime.transition("ready")
    runtime.transition("running")
    const taskID = runtime.snapshot().graph.rootTaskID
    await expect(
      runtime.dispatch({
        type: "run_tool",
        taskID,
        tool: "shell",
        input: { command: "echo ok" },
        instructionID: "instruction-5",
        runID: "run-5",
        issuedAt: Date.now(),
        policyContextHash: "test-policy",
        capability: "tool",
        idempotencyKey: "run-5:tool:1",
      }),
    ).rejects.toThrow("executor is not configured")
    expect(journal.events().some((event) => event.type === "instruction_issued")).toBe(true)
    expect(readyTasks(runtime.snapshot()).map((task) => task.id)).toEqual([taskID])
    expect(canCompleteRun(runtime.snapshot(), [])).toEqual({ ok: false, reason: "run is not verifying" })
  })

  test("settles a tool task and records usage after executor completion", async () => {
    const created = SuperAgentRuntime.create({ id: "run-tool", goal })
    const runtime = new SuperAgentRuntime(created.runtime.snapshot(), created.journal, async () => ({
      type: "tool_completed",
      tool: "fixture.echo",
      output: "ok",
      evidenceIDs: ["evidence-tool"],
    }))
    runtime.transition("planning")
    runtime.transition("ready")
    runtime.transition("running")
    const taskID = runtime.snapshot().graph.rootTaskID
    const result = await runtime.dispatch({
      type: "run_tool",
      taskID,
      tool: "fixture.echo",
      input: { value: "ok" },
      runID: "run-tool",
      instructionID: "instruction-tool",
      issuedAt: Date.now(),
      policyContextHash: "test-policy",
      capability: "tool",
      idempotencyKey: "run-tool:tool:1",
    })
    const task = result.run.graph.nodes.find((item) => item.id === taskID)
    expect(task).toMatchObject({ status: "succeeded", output: "ok", evidenceIDs: ["evidence-tool"] })
    expect(result.run.usage.toolCalls).toBe(1)
    expect(created.journal.events().some((event) => event.type === "tool_completed")).toBe(true)
  })

  test("moves an external operation to needs_review", async () => {
    const created = SuperAgentRuntime.create({ id: "run-6", goal })
    const run = created.runtime.snapshot()
    const runtime = new SuperAgentRuntime(run, created.journal, async () => ({
      type: "unknown",
      operationID: "operation-1",
      reason: "worker disconnected",
    }))
    runtime.transition("planning")
    runtime.transition("ready")
    runtime.transition("running")
    await runtime.dispatch({
      type: "run_tool",
      taskID: run.graph.rootTaskID,
      tool: "shell",
      input: { command: "echo ok" },
      instructionID: "instruction-6",
      runID: "run-6",
      issuedAt: Date.now(),
      policyContextHash: "test-policy",
      capability: "tool",
      idempotencyKey: "run-6:tool:1",
    })
    expect(runtime.snapshot().status).toBe("needs_review")
  })
})
