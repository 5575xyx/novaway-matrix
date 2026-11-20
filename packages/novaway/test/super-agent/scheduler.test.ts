import { describe, expect, test } from "bun:test"
import { SuperAgentRuntime, TaskScheduler } from "../../src/super-agent"
import type { Goal } from "../../src/super-agent"

const goal: Goal = { text: "schedule", constraints: [], source: "user", requestedBy: "test", acceptanceCriteria: [] }

describe("Super-Agent task scheduler", () => {
  test("runs a task through dependency-aware execution states", () => {
    const runtime = SuperAgentRuntime.create({ id: "run-scheduler", goal }).runtime
    const scheduler = new TaskScheduler(runtime.snapshot())
    const taskID = scheduler.ready()[0]!.id
    expect(scheduler.start(taskID).status).toBe("running")
    expect(scheduler.settle(taskID, "succeeded", "output").status).toBe("succeeded")
    expect(scheduler.verify(taskID).status).toBe("verifying")
    expect(scheduler.complete(taskID).status).toBe("completed")
  })

  test("applies retry backoff and refuses exhausted retries", () => {
    const runtime = SuperAgentRuntime.create({ id: "run-retry", goal }).runtime
    const run = runtime.snapshot()
    run.graph.nodes[0]!.retryPolicy = { maxAttempts: 2, backoffMs: 50, retryable: true }
    const scheduler = new TaskScheduler(run)
    const taskID = scheduler.ready(100)[0]!.id
    scheduler.start(taskID)
    expect(scheduler.settle(taskID, "failed").status).toBe("failed")
    const retried = scheduler.retry(taskID, 100)
    expect(retried.status).toBe("ready")
    expect(retried.retryAt).toBe(150)
    expect(scheduler.ready(149)).toHaveLength(0)
    expect(scheduler.ready(150)).toHaveLength(1)
    scheduler.start(taskID)
    scheduler.settle(taskID, "failed")
    expect(() => scheduler.retry(taskID, 200)).toThrow("exhausted")
  })
})
