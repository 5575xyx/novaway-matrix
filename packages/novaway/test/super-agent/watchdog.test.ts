import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SuperAgentStore, SuperAgentStoreLayer } from "../../src/super-agent"
import { SuperAgentOutboxHost } from "../../src/super-agent/outbox"
import { SuperAgentWatchdog, SuperAgentWatchdogHost } from "../../src/super-agent/watchdog"
import type { Goal } from "../../src/super-agent/types"

const runStore = <A>(effect: Effect.Effect<A, unknown, SuperAgentStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SuperAgentStoreLayer)))

const goal: Goal = {
  text: "watchdog fixture",
  constraints: [],
  source: "user",
  requestedBy: "test",
  acceptanceCriteria: [],
}

describe("Super-Agent watchdog and host workers", () => {
  test("counts heartbeat misses and escalates only at the configured threshold", async () => {
    const id = `watchdog-heartbeat-${Date.now()}`
    const created = await runStore(SuperAgentStore.use((store) => store.create({ id, directory: "/tmp/watchdog", goal })))
    for (const status of ["planning", "ready", "running"] as const)
      await runStore(SuperAgentStore.use((store) => store.transition(id, status)))
    const store = await runStore(SuperAgentStore.use((current) => Effect.succeed(current)))
    const watchdog = new SuperAgentWatchdog(store, { heartbeatEscalationThreshold: 2 })
    const first = await watchdog.recordHeartbeatFailure({
      runID: id,
      taskID: created.graph.rootTaskID,
      childTaskID: `${id}:child`,
      message: "lost connection",
    })
    const second = await watchdog.recordHeartbeatFailure({
      runID: id,
      taskID: created.graph.rootTaskID,
      childTaskID: `${id}:child`,
      message: "lost connection",
    })
    expect(first).toMatchObject({ count: 1, escalated: false })
    expect(second).toMatchObject({ count: 2, escalated: true })
    expect((await runStore(SuperAgentStore.use((current) => current.get(id))))?.status).toBe("needs_review")
    expect((await runStore(SuperAgentStore.use((current) => current.events(id)))).filter((event) => event.type === "child_agent_heartbeat_failed")).toHaveLength(2)
  })

  test("recovers expired operations and records a durable escalation event", async () => {
    const id = `watchdog-operation-${Date.now()}`
    await runStore(SuperAgentStore.use((store) => store.create({ id, directory: "/tmp/watchdog", goal })))
    for (const status of ["planning", "ready", "running"] as const)
      await runStore(SuperAgentStore.use((store) => store.transition(id, status)))
    await runStore(
      SuperAgentStore.use((store) =>
        store.beginOperation({
          id: `${id}:operation`,
          runID: id,
          instructionID: `${id}:instruction`,
          idempotencyKey: `${id}:key`,
          leaseMs: 1,
        }),
      ),
    )
    const store = await runStore(SuperAgentStore.use((current) => Effect.succeed(current)))
    const result = await new SuperAgentWatchdog(store).tick(id, Date.now() + 100)
    expect(result.operations[0]?.status).toBe("unknown")
    expect(result.escalated[0]?.status).toBe("needs_review")
    expect((await runStore(SuperAgentStore.use((current) => current.events(id)))).map((event) => event.type)).toContain("operation_lease_expired")
  })

  test("host workers start, publish durable events, and release their timers", async () => {
    const id = `watchdog-host-${Date.now()}`
    await runStore(SuperAgentStore.use((store) => store.create({ id, directory: "/tmp/watchdog", goal })))
    await runStore(SuperAgentStore.use((store) => store.appendEvent({ runID: id, type: "host_event", at: Date.now(), payload: {} })))
    const store = await runStore(SuperAgentStore.use((current) => Effect.succeed(current)))
    const published: string[] = []
    const outbox = new SuperAgentOutboxHost(store, (event) => Effect.sync(() => void published.push(event.eventID)), { intervalMs: 25 })
    const watchdog = new SuperAgentWatchdog(store)
    const health = new SuperAgentWatchdogHost(store, watchdog, { intervalMs: 25 })
    const drained = await outbox.drainOnce()
    expect(drained.published.length).toBeGreaterThan(0)
    expect(published.length).toBe(drained.published.length)
    outbox.start()
    health.start()
    expect(outbox.active).toBe(true)
    expect(health.active).toBe(true)
    outbox.stop()
    health.stop()
    expect(outbox.active).toBe(false)
    expect(health.active).toBe(false)
  })
})
