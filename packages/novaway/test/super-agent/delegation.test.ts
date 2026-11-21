import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LocalAgentRuntimeAdapter, AgentRuntimeRegistry } from "../../src/super-agent/adapter"
import { SuperAgentDelegationCoordinator } from "../../src/super-agent/delegation"
import { SuperAgentStore, SuperAgentStoreLayer } from "../../src/super-agent"
import type { Goal, SuperAgentRun } from "../../src/super-agent/types"

const runStore = <A>(effect: Effect.Effect<A, unknown, SuperAgentStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SuperAgentStoreLayer)))

const goal: Goal = {
  text: "delegate work",
  constraints: [],
  acceptanceCriteria: [],
  source: "user",
  requestedBy: "test",
}

const run: SuperAgentRun = {
  id: "delegate-run",
  goal,
  status: "running",
  graph: {
    id: "delegate-run:graph",
    version: 1,
    nodes: [],
    edges: [],
    rootTaskID: "root",
    planHash: "fixture",
  },
  budget: { childAgents: 3 },
  usage: { tokens: 0, usd: 0, wallTimeMs: 0, steps: 0, toolCalls: 0, childAgents: 0 },
  createdAt: 0,
  updatedAt: 0,
}

const instruction = {
  runID: run.id,
  taskID: "root",
  instructionID: "delegate-1",
  issuedAt: Date.now(),
  policyContextHash: "test",
  capability: "agent" as const,
  idempotencyKey: "delegate-1",
}

describe("Super-Agent child delegation", () => {
  test("runs a child through the runtime adapter and settles a child budget slice", async () => {
    const reservations: string[] = []
    const settled: string[] = []
    const registry = new AgentRuntimeRegistry()
    registry.register(
      new LocalAgentRuntimeAdapter({
        descriptor: {
          id: "fixture-agent",
          pluginID: "test",
          version: "1",
          displayName: "Fixture Agent",
          runtimeType: "fixture",
          role: "worker",
          capabilities: ["agent"],
          tools: [],
          supports: { streaming: true, pause: true, resume: true, cancellation: true, delegation: false, localExecution: true },
        },
        execute: async ({ instruction: text }) => ({ text, evidenceIDs: ["child:evidence"] }),
      }),
    )
    const store = {
      reserveBudget: (_runID: string, id: string) => {
        reservations.push(id)
        return Effect.succeed({} as never)
      },
      settleBudget: (id: string) => {
        settled.push(id)
        return Effect.succeed({} as never)
      },
      releaseBudget: () => Effect.succeed(undefined),
    } as never
    const coordinator = new SuperAgentDelegationCoordinator({ runtimes: registry, runtimeType: "local-agent", store })

    const result = await coordinator.executor()(
      {
        ...instruction,
        type: "call_agent",
        agentID: "fixture-agent",
        instruction: "inspect the fixture",
      },
      run,
    )

    expect(result).toMatchObject({ type: "agent_completed", agentID: "fixture-agent" })
    expect((result as { output: { text: string; evidenceIDs: string[] } }).output.text).toBe("inspect the fixture")
    expect(reservations).toEqual(["delegate-run:child:delegate-1"])
    expect(settled).toEqual(["delegate-run:child:delegate-1"])
  })

  test("persists child Task linkage and terminal status in the durable graph", async () => {
    const id = `delegate-persisted-${Date.now()}`
    const persisted = await runStore(
      SuperAgentStore.use((store) => store.create({ id, directory: "/tmp/super-agent", goal })),
    )
    const runtimeRun = { ...persisted, status: "running" as const }
    const registry = new AgentRuntimeRegistry()
    registry.register(
      new LocalAgentRuntimeAdapter({
        descriptor: {
          id: "persistent-agent",
          pluginID: "test",
          version: "1",
          displayName: "Persistent agent",
          runtimeType: "fixture",
          role: "worker",
          capabilities: ["agent"],
          tools: [],
          supports: { streaming: true, pause: true, resume: true, cancellation: true, delegation: false, localExecution: true },
        },
        execute: async () => "persisted child output",
      }),
    )
    const coordinator = new SuperAgentDelegationCoordinator({
      runtimes: registry,
      runtimeType: "local-agent",
      store: await runStore(SuperAgentStore.use((store) => Effect.succeed(store))),
    })
    const result = await coordinator.call(
      {
        ...instruction,
        type: "call_agent",
        taskID: persisted.graph.rootTaskID,
        instructionID: `${id}:call`,
        idempotencyKey: `${id}:call`,
        agentID: "persistent-agent",
        instruction: "persist this child",
      },
      runtimeRun,
    )
    expect(result.status).toBe("completed")
    const loaded = await runStore(SuperAgentStore.use((store) => store.get(id)))
    const child = loaded?.graph.nodes.find((task) => task.kind === "child-agent")
    expect(child).toMatchObject({ status: "succeeded", output: "persisted child output" })
    expect(loaded?.graph.edges).toContainEqual({
      from: persisted.graph.rootTaskID,
      to: child!.id,
      kind: "delegates_to",
    })
    expect((await runStore(SuperAgentStore.use((store) => store.taskMutations(id)))).length).toBeGreaterThanOrEqual(2)
  })

  test("preserves partial outcomes when one parallel child fails", async () => {
    const registry = new AgentRuntimeRegistry()
    registry.register(
      new LocalAgentRuntimeAdapter({
        descriptor: {
          id: "fixture-agent",
          pluginID: "test",
          version: "1",
          displayName: "Fixture Agent",
          runtimeType: "fixture",
          role: "worker",
          capabilities: ["agent"],
          tools: [],
          supports: { streaming: true, pause: true, resume: true, cancellation: true, delegation: false, localExecution: true },
        },
        execute: async ({ instruction: text }) => {
          if (text === "fail") throw new Error("child fixture failed")
          return text
        },
      }),
    )
    const coordinator = new SuperAgentDelegationCoordinator({ runtimes: registry, runtimeType: "local-agent" })
    const result = await coordinator.executor()(
      {
        ...instruction,
        type: "parallel_call_agents",
        instructionID: "parallel-1",
        idempotencyKey: "parallel-1",
        calls: [
          { agentID: "fixture-agent", instruction: "keep" },
          { agentID: "fixture-agent", instruction: "fail" },
        ],
      },
      run,
    )

    expect(result).toMatchObject({ type: "agent_failed", code: "child_agent_partial_failure" })
    const outcomes = (result as unknown as { outcomes: Array<{ status: string; agentID: string }> }).outcomes
    expect(outcomes).toHaveLength(2)
    expect(outcomes.filter((outcome) => outcome.status === "completed")).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === "failed")).toHaveLength(1)
  })

  test("classifies divergent successful child outputs as a conflict", async () => {
    const registry = new AgentRuntimeRegistry()
    registry.register(
      new LocalAgentRuntimeAdapter({
        descriptor: {
          id: "conflict-agent",
          pluginID: "test",
          version: "1",
          displayName: "Conflict agent",
          runtimeType: "fixture",
          role: "worker",
          capabilities: ["agent"],
          tools: [],
          supports: { streaming: true, pause: true, resume: true, cancellation: true, delegation: false, localExecution: true },
        },
        execute: async ({ instruction: text }) => ({ answer: text }),
      }),
    )
    const result = await new SuperAgentDelegationCoordinator({ runtimes: registry, runtimeType: "local-agent" }).executor()(
      {
        ...instruction,
        type: "parallel_call_agents",
        instructionID: "parallel-conflict",
        idempotencyKey: "parallel-conflict",
        calls: [
          { agentID: "conflict-agent", instruction: "one" },
          { agentID: "conflict-agent", instruction: "two" },
        ],
      },
      run,
    )
    expect(result).toMatchObject({ type: "agent_failed", code: "child_agent_conflict" })
    expect((result as unknown as { outcomes: unknown[] }).outcomes).toHaveLength(2)
  })

  test("bounds parallel child execution to the configured scheduler limit", async () => {
    let active = 0
    let maximum = 0
    const registry = new AgentRuntimeRegistry()
    registry.register(
      new LocalAgentRuntimeAdapter({
        descriptor: {
          id: "bounded-agent",
          pluginID: "test",
          version: "1",
          displayName: "Bounded agent",
          runtimeType: "fixture",
          role: "worker",
          capabilities: ["agent"],
          tools: [],
          supports: { streaming: true, pause: true, resume: true, cancellation: true, delegation: false, localExecution: true },
        },
        execute: async () => {
          active += 1
          maximum = Math.max(maximum, active)
          await new Promise((resolve) => setTimeout(resolve, 10))
          active -= 1
          return "same"
        },
      }),
    )
    const calls = Array.from({ length: 7 }, (_, index) => ({ agentID: "bounded-agent", instruction: String(index) }))
    const outcomes = await new SuperAgentDelegationCoordinator({ runtimes: registry, runtimeType: "local-agent", maxParallelism: 2 }).parallel(
      { ...instruction, type: "parallel_call_agents", instructionID: "bounded", idempotencyKey: "bounded", calls },
      run,
    )
    expect(outcomes).toHaveLength(7)
    expect(maximum).toBeLessThanOrEqual(2)
  })

  test("records a durable diagnostic when a child heartbeat fails", async () => {
    const id = `delegate-heartbeat-${Date.now()}`
    const persisted = await runStore(
      SuperAgentStore.use((store) => store.create({ id, directory: "/tmp/super-agent", goal })),
    )
    const runtimeRun = { ...persisted, status: "running" as const }
    const events: string[] = []
    const registry = new AgentRuntimeRegistry()
    registry.register({
      type: "heartbeat-fixture",
      version: "1",
      discover: async () => [],
      start: async () => ({ id: "heartbeat-handle", runID: id, taskID: persisted.graph.rootTaskID }),
      send: async () => undefined,
      events: async function* () {
        await new Promise<void>(() => undefined)
      },
      pause: async () => ({ checkpointID: "checkpoint" }),
      resume: async () => undefined,
      cancel: async () => undefined,
      dispose: async () => undefined,
      heartbeat: async () => {
        throw new Error("heartbeat connection lost")
      },
    })
    const store = await runStore(SuperAgentStore.use((current) => Effect.succeed(current)))
    const originalAppendEvent = store.appendEvent
    ;(store as { appendEvent: typeof store.appendEvent }).appendEvent = ((event) => {
      events.push(event.type)
      return originalAppendEvent(event)
    }) as typeof store.appendEvent
    const coordinator = new SuperAgentDelegationCoordinator({
      runtimes: registry,
      runtimeType: "heartbeat-fixture",
      store,
      timeoutMs: 500,
    })
    const result = await coordinator.call(
      {
        ...instruction,
        type: "call_agent",
        taskID: persisted.graph.rootTaskID,
        instructionID: `${id}:call`,
        idempotencyKey: `${id}:call`,
        agentID: "heartbeat-fixture",
        instruction: "heartbeat",
      },
      runtimeRun,
    )
    expect(result.status).toBe("failed")
    expect(events).toContain("child_agent_heartbeat_failed")
  })
  test("re-executes a repair task through the deterministic Supervisor", async () => {
    const { SuperAgentRuntime } = await import("../../src/super-agent/runtime")
    const { builtinRepairStrategy, SuperAgentRepairCoordinator } = await import("../../src/super-agent/repair")
    const { runtime } = SuperAgentRuntime.create({ id: "repair-run", goal })
    const run = runtime.snapshot()
    run.status = "needs_review"
    const source = run.graph.nodes[0]!
    source.status = "failed"
    source.input = { tool: "fixture.echo", input: { value: "repaired" } }
    const repair = builtinRepairStrategy.create({
      runID: run.id,
      failed: [
        {
          id: "verification:failed",
          runID: run.id,
          acceptanceID: "checks",
          verifierID: "fixture",
          verifierVersion: "1",
          outcome: "fail",
          evidenceIDs: ["evidence:failed"],
          reason: "fixture failure",
          createdAt: Date.now(),
        },
      ],
      sourceTask: source,
    })
    run.graph = {
      ...run.graph,
      nodes: [source, repair],
      edges: [{ from: repair.id, to: source.id, kind: "repairs" }],
    }
    const events: string[] = []
    const store = {
      get: () => Effect.succeed({ ...run }),
      updateGraph: (_id: string, graph: typeof run.graph) => Effect.succeed({ ...run, graph }),
      appendEvent: (event: { type: string }) => {
        events.push(event.type)
        return Effect.succeed(event)
      },
    } as never
    const coordinator = new SuperAgentRepairCoordinator(store, {} as never)
    const result = await Effect.runPromise(
      coordinator.execute({
        runID: run.id,
        taskID: repair.id,
        executor: async (instruction) => {
          expect(instruction.type).toBe("run_tool")
          return { type: "tool_completed", tool: "fixture.echo", output: "repaired" }
        },
      }),
    )

    expect(result.result.type).toBe("tool_completed")
    expect(result.run.graph.nodes.find((node) => node.id === repair.id)?.status).toBe("succeeded")
    expect(events).toEqual(["repair_task_executed"])
  })

  test("runs repair, records fresh Evidence, verifies, and finishes", async () => {
    const { SuperAgentRuntime } = await import("../../src/super-agent/runtime")
    const { builtinRepairStrategy, SuperAgentRepairCoordinator } = await import("../../src/super-agent/repair")
    const { VerifierRegistry, builtinTestVerifier } = await import("../../src/super-agent/verification")
    const verificationGoal = {
      ...goal,
      acceptanceCriteria: [{ id: "checks", text: "checks pass", required: true }],
    }
    const { runtime } = SuperAgentRuntime.create({ id: "repair-verify-run", goal: verificationGoal })
    const run = runtime.snapshot()
    run.status = "needs_review"
    const source = run.graph.nodes[0]!
    source.status = "failed"
    source.input = { tool: "fixture.echo", input: { value: "repaired" } }
    const repair = builtinRepairStrategy.create({
      runID: run.id,
      failed: [
        {
          id: "verification:failed",
          runID: run.id,
          acceptanceID: "checks",
          verifierID: "fixture",
          verifierVersion: "1",
          outcome: "fail",
          evidenceIDs: ["evidence:failed"],
          reason: "fixture failure",
          createdAt: Date.now(),
        },
      ],
      sourceTask: source,
    })
    run.graph = {
      ...run.graph,
      nodes: [source, repair],
      edges: [{ from: repair.id, to: source.id, kind: "repairs" }],
    }
    let current = { ...run }
    const verifications: unknown[] = []
    const store = {
      get: () => Effect.succeed(current),
      updateGraph: (_id: string, graph: typeof run.graph) => {
        current = { ...current, graph }
        return Effect.succeed(current)
      },
      appendEvent: (event: { type: string }) => Effect.succeed(event),
      evidences: () => Effect.succeed([
        {
          id: "repair:evidence",
          runID: run.id,
          taskID: repair.id,
          kind: "test" as const,
          source: "fixture",
          measured: "pass",
          acceptanceIDs: ["checks"],
          capturedAt: Date.now(),
        },
      ]),
      verifications: () => Effect.succeed(verifications as never[]),
      verification: (verification: unknown) => {
        verifications.push(verification)
        return Effect.succeed(verification as never)
      },
      transitionWithEvent: (_id: string, status: string) => {
        current = { ...current, status: status as typeof current.status }
        return Effect.succeed({ run: current, event: {} as never })
      },
    } as never
    const verifiers = new VerifierRegistry()
    verifiers.register(builtinTestVerifier)
    const coordinator = new SuperAgentRepairCoordinator(store, {} as never)
    const result = await Effect.runPromise(
      coordinator.executeAndVerify({
        runID: run.id,
        taskID: repair.id,
        executor: () => Effect.succeed({
          type: "tool_completed" as const,
          tool: "fixture.echo",
          output: "repaired",
          evidenceIDs: ["repair:evidence"],
        }),
        verifiers,
        verifierID: "builtin.test",
        summary: "repair passed",
      }),
    )

    expect(result.execution.result.type).toBe("tool_completed")
    expect(result.verification.completed).toBe(true)
    expect(result.verification.run.status).toBe("completed")
    expect(verifications).toHaveLength(1)
  })
})
