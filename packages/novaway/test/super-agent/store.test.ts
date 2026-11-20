import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  SuperAgentStore,
  SuperAgentStoreLayer,
  SuperAgentRecoveryCoordinator,
  SuperAgentRepairCoordinator,
  RepairStrategyRegistry,
  builtinRepairStrategy,
  SuperAgentOutboxWorker,
} from "../../src/super-agent"
import type { Goal } from "../../src/super-agent"

const goal: Goal = {
  text: "persist a super-agent run",
  constraints: [],
  source: "user",
  requestedBy: "test-user",
  acceptanceCriteria: [{ id: "persisted", text: "the run is readable after a store reload", required: true }],
}

const run = <A>(effect: Effect.Effect<A, unknown, SuperAgentStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SuperAgentStoreLayer)))

describe("SuperAgentStore", () => {
  test("persists runs, ordered events, and verification records", async () => {
    const created = await run(
      SuperAgentStore.use((store) =>
        Effect.gen(function* () {
          const created = yield* store.create({ id: `sa_store_${Date.now()}`, directory: "/tmp/super-agent", goal })
          yield* store.appendEvent({
            runID: created.id,
            type: "run_created",
            at: 1,
            payload: { status: created.status },
          })
          yield* store.appendEvent({
            runID: created.id,
            type: "plan_created",
            at: 2,
            payload: { graphID: created.graph.id },
          })
          yield* store.evidence({
            id: `${created.id}:evidence-1`,
            runID: created.id,
            taskID: created.graph.rootTaskID,
            kind: "test",
            source: "store test",
            measured: "pass",
            capturedAt: 2,
          })
          yield* store.verification({
            id: `${created.id}:verification`,
            runID: created.id,
            acceptanceID: "persisted",
            verifierID: "test",
            verifierVersion: "1",
            outcome: "pass",
            evidenceIDs: [`${created.id}:evidence-1`],
            reason: "store test",
            createdAt: 3,
          })
          return created
        }),
      ),
    )

    const loaded = await run(SuperAgentStore.use((store) => store.get(created.id)))
    expect(loaded?.id).toBe(created.id)
    expect(loaded?.goal.acceptanceCriteria[0]?.id).toBe("persisted")

    const events = await run(SuperAgentStore.use((store) => store.events(created.id)))
    expect(events.map((event) => event.sequence)).toEqual([1, 2])
    expect(events.map((event) => event.type)).toEqual(["run_created", "plan_created"])

    const pendingOutbox = await run(SuperAgentStore.use((store) => store.outbox(created.id)))
    expect(pendingOutbox).toHaveLength(2)
    expect(pendingOutbox.every((event) => event.status === "pending")).toBe(true)
    const acknowledged = await run(
      SuperAgentStore.use((store) => store.ackOutbox(pendingOutbox[0]!.eventID)),
    )
    expect(acknowledged?.status).toBe("acked")
    expect(acknowledged?.attempts).toBe(1)
    const duplicateAck = await run(SuperAgentStore.use((store) => store.ackOutbox(pendingOutbox[0]!.eventID)))
    expect(duplicateAck?.attempts).toBe(1)
    expect((await run(SuperAgentStore.use((store) => store.outbox(created.id)))).map((event) => event.eventID)).toEqual([
      pendingOutbox[1]!.eventID,
    ])

    const verifications = await run(SuperAgentStore.use((store) => store.verifications(created.id)))
    expect(verifications).toHaveLength(1)
    expect(verifications[0]?.outcome).toBe("pass")
  })

  test("deduplicates idempotent events and persists resumable checkpoints", async () => {
    const created = await run(
      SuperAgentStore.use((store) =>
        store.create({ id: `sa_checkpoint_${Date.now()}`, directory: "/tmp/super-agent", goal }),
      ),
    )
    const input = {
      runID: created.id,
      type: "operation_started",
      at: 4,
      idempotencyKey: `${created.id}:operation:1`,
      payload: { operationID: "operation-1" },
    } as const
    const first = await run(SuperAgentStore.use((store) => store.appendEvent(input)))
    const duplicate = await run(SuperAgentStore.use((store) => store.appendEvent(input)))
    expect(duplicate).toMatchObject({ eventID: first.eventID, sequence: first.sequence })

    const checkpoint = await run(SuperAgentStore.use((store) => store.checkpoint(created.id, "manual pause")))
    expect(checkpoint?.runID).toBe(created.id)
    const loaded = await run(SuperAgentStore.use((store) => store.get(created.id)))
    expect(loaded?.checkpointID).toBe(checkpoint?.id)

    const paused = await run(SuperAgentStore.use((store) => store.transition(created.id, "planning")))
    expect(paused?.status).toBe("planning")
    const ready = await run(SuperAgentStore.use((store) => store.transition(created.id, "ready")))
    expect(ready?.status).toBe("ready")
    const running = await run(SuperAgentStore.use((store) => store.transition(created.id, "running")))
    expect(running?.status).toBe("running")
    const suspended = await run(SuperAgentStore.use((store) => store.transition(created.id, "paused")))
    expect(suspended?.status).toBe("paused")
  })

  test("does not rerun an operation after its lease becomes unknown", async () => {
    const created = await run(
      SuperAgentStore.use((store) =>
        store.create({ id: `sa_operation_${Date.now()}`, directory: "/tmp/super-agent", goal }),
      ),
    )
    const input = {
      id: `${created.id}:operation:1`,
      runID: created.id,
      instructionID: `${created.id}:instruction:1`,
      idempotencyKey: `${created.id}:idempotency:1`,
      leaseMs: 1,
    }
    const first = await run(SuperAgentStore.use((store) => store.beginOperation(input)))
    const duplicate = await run(SuperAgentStore.use((store) => store.beginOperation(input)))
    expect(duplicate).toMatchObject({ id: first.id, status: "started" })

    const heartbeat = await run(SuperAgentStore.use((store) => store.heartbeatOperation(first.id, 100)))
    expect(heartbeat?.status).toBe("started")
    expect(heartbeat?.leaseUntil).toBeGreaterThan(first.leaseUntil)

    const recovered = await run(
      SuperAgentStore.use((store) => store.recoverExpiredOperations(created.id, heartbeat!.leaseUntil + 1)),
    )
    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.status).toBe("unknown")
    const stillUnknown = await run(SuperAgentStore.use((store) => store.beginOperation(input)))
    expect(stillUnknown.status).toBe("unknown")
  })
  test("gates a run for review after crash recovery finds an expired operation", async () => {
    const created = await run(
      SuperAgentStore.use((store) =>
        store.create({ id: `sa_recovery_${Date.now()}`, directory: "/tmp/super-agent", goal }),
      ),
    )
    await run(
      SuperAgentStore.use((store) =>
        Effect.gen(function* () {
          yield* store.transition(created.id, "planning")
          yield* store.transition(created.id, "ready")
          yield* store.transition(created.id, "running")
          yield* store.beginOperation({
            id: `${created.id}:operation:recovery`,
            runID: created.id,
            instructionID: `${created.id}:instruction:recovery`,
            idempotencyKey: `${created.id}:idempotency:recovery`,
            leaseMs: 1,
          })
        }),
      ),
    )
    const recovered = await run(
      SuperAgentStore.use((store) => new SuperAgentRecoveryCoordinator(store).recover(created.id, Date.now() + 100)),
    )
    expect(recovered.reviewRequired).toBe(true)
    expect(recovered.operations[0]?.status).toBe("unknown")
    expect(recovered.run?.status).toBe("needs_review")
  })
  test("enforces verification before a persisted run can complete", async () => {
    const created = await run(
      SuperAgentStore.use((store) =>
        store.create({ id: `sa_complete_${Date.now()}`, directory: "/tmp/super-agent", goal }),
      ),
    )
    for (const status of ["planning", "ready", "running", "verifying"] as const)
      await run(SuperAgentStore.use((store) => store.transition(created.id, status)))
    await expect(run(SuperAgentStore.use((store) => store.transition(created.id, "completed")))).rejects.toThrow(
      "cannot complete Super-Agent run",
    )
    await run(
      SuperAgentStore.use((store) =>
        store.evidence({
          id: `${created.id}:evidence:1`,
          runID: created.id,
          taskID: created.graph.rootTaskID,
          kind: "test",
          source: "bun test",
          measured: "pass",
          capturedAt: Date.now(),
        }),
      ),
    )
    await run(
      SuperAgentStore.use((store) =>
        store.verification({
          id: `${created.id}:verification:1`,
          runID: created.id,
          acceptanceID: "persisted",
          verifierID: "test",
          verifierVersion: "1",
          outcome: "pass",
          evidenceIDs: [`${created.id}:evidence:1`],
          reason: "test passed",
          createdAt: Date.now(),
        }),
      ),
    )
    const completed = await run(SuperAgentStore.use((store) => store.transition(created.id, "completed")))
    expect(completed?.status).toBe("completed")
  })
  test("versions task graph updates and rejects stale writers", async () => {
    const created = await run(
      SuperAgentStore.use((store) =>
        store.create({ id: `sa_graph_${Date.now()}`, directory: "/tmp/super-agent", goal }),
      ),
    )
    const replacement = {
      ...created.graph,
      nodes: created.graph.nodes.map((node) => ({ ...node, title: "Updated root" })),
    }
    const updated = await run(SuperAgentStore.use((store) => store.updateGraph(created.id, replacement, 1)))
    expect(updated?.graph.version).toBe(2)
    const mutations = await run(SuperAgentStore.use((store) => store.taskMutations(created.id)))
    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toMatchObject({
      graphVersion: 2,
      taskID: created.graph.rootTaskID,
      fromStatus: "pending",
      toStatus: "pending",
    })
    const reloaded = await run(SuperAgentStore.use((store) => store.get(created.id)))
    expect(reloaded?.graph.version).toBe(2)
    expect(reloaded?.graph.nodes[0]?.title).toBe("Updated root")
    await expect(run(SuperAgentStore.use((store) => store.updateGraph(created.id, replacement, 1)))).rejects.toThrow(
      "version conflict",
    )
  })
  test("creates a durable repair task from a failed verification", async () => {
    const created = await run(
      SuperAgentStore.use((store) =>
        store.create({
          id: `sa_repair_${Date.now()}`,
          directory: "/tmp/super-agent",
          goal: { ...goal, acceptanceCriteria: [{ id: "checks", text: "checks pass", required: true }] },
        }),
      ),
    )
    const taskID = created.graph.rootTaskID
    await run(
      SuperAgentStore.use((store) =>
        Effect.gen(function* () {
          for (const status of ["planning", "ready", "running", "verifying"] as const)
            yield* store.transition(created.id, status)
          yield* store.evidence({
            id: `${created.id}:evidence:failed`,
            runID: created.id,
            taskID,
            kind: "test",
            source: "fixture",
            measured: "fail",
            capturedAt: Date.now(),
          })
          yield* store.verification({
            id: `${created.id}:verification:failed`,
            runID: created.id,
            taskID,
            acceptanceID: "checks",
            verifierID: "builtin.test",
            verifierVersion: "1",
            outcome: "fail",
            evidenceIDs: [`${created.id}:evidence:failed`],
            reason: "fixture failed",
            createdAt: Date.now(),
          })
          yield* store.transition(created.id, "needs_review")
        }),
      ),
    )
    const strategies = new RepairStrategyRegistry()
    strategies.register(builtinRepairStrategy)
    const result = await run(
      SuperAgentStore.use((store) =>
        new SuperAgentRepairCoordinator(store, strategies).create({
          runID: created.id,
          sourceTaskID: taskID,
          failedVerificationIDs: [`${created.id}:verification:failed`],
          strategyID: "builtin.repair",
        }),
      ),
    )
    expect(result.task.kind).toBe("repair")
    expect(result.run.graph.version).toBe(2)
    expect(result.run.graph.nodes).toHaveLength(2)
  })
  test("reserves, settles, and enforces budget before execution", async () => {
    const created = await run(
      SuperAgentStore.use((store) =>
        store.create({
          id: `sa_budget_${Date.now()}`,
          directory: "/tmp/super-agent",
          goal,
          budget: { tokens: 10 },
        }),
      ),
    )
    const reservation = await run(
      SuperAgentStore.use((store) => store.reserveBudget(created.id, `${created.id}:r1`, { tokens: 6 })),
    )
    expect(reservation.status).toBe("reserved")
    await expect(
      run(SuperAgentStore.use((store) => store.reserveBudget(created.id, `${created.id}:r2`, { tokens: 5 }))),
    ).rejects.toThrow("budget exceeded")
    const settled = await run(SuperAgentStore.use((store) => store.settleBudget(reservation.id, { tokens: 4 })))
    expect(settled?.status).toBe("settled")
    expect((await run(SuperAgentStore.use((store) => store.get(created.id))))?.usage.tokens).toBe(4)
    await run(SuperAgentStore.use((store) => store.settleBudget(reservation.id, { tokens: 4 })))
    expect((await run(SuperAgentStore.use((store) => store.get(created.id))))?.usage.tokens).toBe(4)
    const released = await run(SuperAgentStore.use((store) => store.releaseBudget(reservation.id)))
    expect(released?.status).toBe("released")
  })
  test("uses the kernel state transition rules before persisting", async () => {
    const created = await run(
      SuperAgentStore.use((store) =>
        store.create({ id: `sa_transition_${Date.now()}`, directory: "/tmp/super-agent", goal }),
      ),
    )
    const planning = await run(SuperAgentStore.use((store) => store.transition(created.id, "planning")))
    expect(planning?.status).toBe("planning")
    await expect(run(SuperAgentStore.use((store) => store.transition(created.id, "completed")))).rejects.toThrow(
      "invalid Super-Agent run transition",
    )
  })
})
