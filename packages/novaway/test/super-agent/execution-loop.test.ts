import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  MemorySuperAgentJournal,
  SuperAgentExecutionLoop,
  SuperAgentRuntime,
  SuperAgentStore,
  SuperAgentStoreLayer,
} from "../../src/super-agent"
import type { Goal } from "../../src/super-agent"

const goal: Goal = {
  text: "run three tools",
  constraints: [],
  source: "user",
  requestedBy: "test",
  acceptanceCriteria: [],
}

const runStore = <A>(effect: Effect.Effect<A, unknown, SuperAgentStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SuperAgentStoreLayer)))

describe("Super-Agent execution loop", () => {
  test("runs ready native tool instructions with bounded concurrency", async () => {
    const created = SuperAgentRuntime.create({ id: "run-parallel", goal })
    const run = created.runtime.snapshot()
    const root = run.graph.nodes[0]!
    run.status = "running"
    run.graph.nodes = [0, 1, 2].map((index) => ({
      ...root,
      id: `run-parallel:task:${index}`,
      status: "pending" as const,
      title: `Tool ${index}`,
      objective: `tool ${index}`,
      input: { tool: "fixture.echo", input: { index } },
    }))
    let active = 0
    let maximum = 0
    const runtime = new SuperAgentRuntime(run, new MemorySuperAgentJournal(), async (instruction) => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return {
        type: "tool_completed",
        tool: instruction.type === "run_tool" ? instruction.tool : "unknown",
        output: "ok",
      }
    })
    const loop = new SuperAgentExecutionLoop(runtime, undefined, 2)
    const step = await loop.step()

    expect(step.results).toHaveLength(3)
    expect(maximum).toBe(2)
    expect(loop.snapshot().graph.nodes.every((task) => task.status === "succeeded")).toBe(true)
  })

  test("retains successful results when one parallel task fails", async () => {
    const created = SuperAgentRuntime.create({ id: "run-partial", goal })
    const run = created.runtime.snapshot()
    const root = run.graph.nodes[0]!
    run.status = "running"
    run.graph.nodes = [0, 1, 2].map((index) => ({
      ...root,
      id: `run-partial:task:${index}`,
      status: "pending" as const,
      input: { tool: "fixture.echo", input: { index } },
    }))
    const runtime = new SuperAgentRuntime(run, new MemorySuperAgentJournal(), async (instruction) => {
      const index = instruction.type === "run_tool" ? (instruction.input as { index: number }).index : -1
      if (index === 1) return { type: "agent_failed" as const, agentID: "fixture", code: "failed", message: "fixture" }
      return { type: "tool_completed" as const, tool: "fixture.echo", output: index }
    })
    const loop = new SuperAgentExecutionLoop(runtime, undefined, 3)
    const step = await loop.step()
    const statuses = loop
      .snapshot()
      .graph.nodes.map((task) => task.status)
      .sort()

    expect(step.results).toHaveLength(3)
    expect(statuses).toEqual(["failed", "succeeded", "succeeded"])
    expect(loop.snapshot().status).toBe("needs_review")
  })

  test("automatically schedules a retry with bounded attempts", async () => {
    const created = SuperAgentRuntime.create({ id: "run-auto-retry", goal })
    const run = created.runtime.snapshot()
    run.status = "running"
    run.graph.nodes[0]!.input = { tool: "fixture.echo", input: { value: "retry" } }
    run.graph.nodes[0]!.retryPolicy = { maxAttempts: 2, backoffMs: 0, retryable: true }
    let attempts = 0
    const runtime = new SuperAgentRuntime(run, new MemorySuperAgentJournal(), async () => {
      attempts += 1
      if (attempts === 1)
        return { type: "agent_failed" as const, agentID: "fixture", code: "temporary", message: "retry me" }
      return { type: "tool_completed" as const, tool: "fixture.echo", output: "recovered" }
    })
    const loop = new SuperAgentExecutionLoop(runtime)
    await loop.step()
    expect(loop.snapshot().graph.nodes[0]?.status).toBe("ready")
    expect(loop.snapshot().status).toBe("running")
    await loop.step()
    expect(loop.snapshot().graph.nodes[0]?.status).toBe("succeeded")
    expect(attempts).toBe(2)
  })

  test("persists retry state through the durable Store for restart scheduling", async () => {
    const id = `run-durable-retry-${Date.now()}`
    const created = await runStore(
      SuperAgentStore.use((store) => store.create({ id, directory: "/tmp/super-agent", goal })),
    )
    const run = created
    run.status = "running"
    run.graph.nodes[0]!.input = { tool: "fixture.echo", input: { value: "durable-retry" } }
    run.graph.nodes[0]!.retryPolicy = { maxAttempts: 2, backoffMs: 0, retryable: true }
    let attempts = 0
    const runtime = new SuperAgentRuntime(run, new MemorySuperAgentJournal(), async () => {
      attempts += 1
      return attempts === 1
        ? { type: "agent_failed" as const, agentID: "fixture", code: "temporary", message: "retry" }
        : { type: "tool_completed" as const, tool: "fixture.echo", output: "ok" }
    })
    const store = await runStore(SuperAgentStore.use((service) => Effect.succeed(service)))
    const loop = new SuperAgentExecutionLoop(runtime, undefined, 1, store)
    await loop.step()
    const persisted = await runStore(SuperAgentStore.use((service) => service.get(id)))
    expect(persisted?.graph.nodes[0]?.status).toBe("ready")
    expect(persisted?.graph.nodes[0]?.retryAt).toBeDefined()
    expect((await runStore(SuperAgentStore.use((service) => service.events(id)))).some((event) => event.type === "task_retry_scheduled")).toBe(true)
    await loop.step()
    expect((await runStore(SuperAgentStore.use((service) => service.get(id))))?.graph.nodes[0]?.status).toBe("succeeded")
  })
})
