import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SuperAgentStore, SuperAgentStoreLayer, SuperAgentRuntime, TaskScheduler } from "../../src/super-agent"
import type { Goal } from "../../src/super-agent/types"

const runStore = <A>(effect: Effect.Effect<A, unknown, SuperAgentStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SuperAgentStoreLayer)))

const goal: Goal = {
  text: "performance fixture",
  constraints: [],
  source: "user",
  requestedBy: "performance-test",
  acceptanceCriteria: [],
}

function p95(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

describe("Super-Agent performance and resource gate", () => {
  test("keeps durable create, state, append, and replay within the release budget", async () => {
    const createSamples: number[] = []
    const querySamples: number[] = []
    const appendSamples: number[] = []
    let runID = ""
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now()
      const created = await runStore(
        SuperAgentStore.use((store) => store.create({ id: `performance-${Date.now()}-${index}`, directory: "/tmp/performance", goal })),
      )
      createSamples.push(performance.now() - started)
      runID = created.id
      const queried = performance.now()
      await runStore(SuperAgentStore.use((store) => store.get(runID)))
      querySamples.push(performance.now() - queried)
      const appended = performance.now()
      await runStore(SuperAgentStore.use((store) => store.appendEvent({ runID, type: "performance_sample", at: Date.now(), payload: { index } })))
      appendSamples.push(performance.now() - appended)
    }

    const append1000Started = performance.now()
    for (let index = 0; index < 1_000; index += 1)
      await runStore(SuperAgentStore.use((store) => store.appendEvent({ runID, type: "replay_sample", at: index, payload: { index } })))
    const append1000Ms = performance.now() - append1000Started
    const replayStarted = performance.now()
    const events = await runStore(SuperAgentStore.use((store) => store.events(runID, 0, 10_000)))
    const replayMs = performance.now() - replayStarted
    const pauseCancelSamples: number[] = []
    for (let index = 0; index < 10; index += 1) {
      const id = `performance-pause-${Date.now()}-${index}`
      await runStore(SuperAgentStore.use((store) => store.create({ id, directory: "/tmp/performance", goal })))
      for (const status of ["planning", "ready", "running"] as const)
        await runStore(SuperAgentStore.use((store) => store.transition(id, status)))
      const lifecycleStarted = performance.now()
      await runStore(SuperAgentStore.use((store) => store.checkpoint(id, "performance pause")))
      await runStore(SuperAgentStore.use((store) => store.transition(id, "paused")))
      await runStore(SuperAgentStore.use((store) => store.transition(id, "running")))
      await runStore(SuperAgentStore.use((store) => store.transition(id, "cancelling")))
      await runStore(SuperAgentStore.use((store) => store.transition(id, "cancelled")))
      pauseCancelSamples.push(performance.now() - lifecycleStarted)
    }
    const schedulerSamples: number[] = []
    for (let index = 0; index < 100; index += 1) {
      const { runtime } = SuperAgentRuntime.create({ id: `performance-scheduler-${index}`, goal })
      const schedulerStarted = performance.now()
      const scheduler = new TaskScheduler(runtime.snapshot(), 8)
      scheduler.start(runtime.snapshot().graph.rootTaskID)
      scheduler.settle(runtime.snapshot().graph.rootTaskID, "succeeded", "ok")
      schedulerSamples.push(performance.now() - schedulerStarted)
    }
    console.info("super-agent performance gate", {
      createP95Ms: Number(p95(createSamples).toFixed(2)),
      stateQueryP95Ms: Number(p95(querySamples).toFixed(2)),
      eventAppendP95Ms: Number(p95(appendSamples).toFixed(2)),
      replay1000Ms: Number(replayMs.toFixed(2)),
      pauseCancelP95Ms: Number(p95(pauseCancelSamples).toFixed(2)),
      schedulerP95Ms: Number(p95(schedulerSamples).toFixed(2)),
    })
    expect(p95(createSamples)).toBeLessThanOrEqual(300)
    expect(p95(querySamples)).toBeLessThanOrEqual(150)
    expect(p95(appendSamples)).toBeLessThanOrEqual(100)
    expect(events.length).toBeGreaterThanOrEqual(1_001)
    expect(replayMs).toBeLessThanOrEqual(2_000)
    expect(p95(pauseCancelSamples)).toBeLessThanOrEqual(300)
    expect(p95(schedulerSamples)).toBeLessThanOrEqual(20)
  })
})
