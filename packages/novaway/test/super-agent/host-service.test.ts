import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { disposeInstance } from "../../src/effect/instance-registry"
import { ensureSuperAgentHost, superAgentHostDiagnostics, superAgentHostFor } from "../../src/super-agent/host-service"
import { AgentRuntimeRegistry, LocalAgentRuntimeAdapter } from "../../src/super-agent/adapter"
import type { SuperAgentRun } from "../../src/super-agent/types"

describe("Super-Agent production host lifecycle", () => {
  test("starts one per instance and disposes both background workers with the instance", async () => {
    const directory = `host-service-${Date.now()}`
    const store = {
      list: () => Effect.succeed([]),
      listAll: () => Effect.succeed([]),
      outbox: () => Effect.succeed([]),
      ackOutbox: () => Effect.succeed(undefined),
      failOutbox: () => Effect.succeed(undefined),
      recoverExpiredOperations: () => Effect.succeed([]),
    } as never
    const ctx = { directory } as never
    const first = ensureSuperAgentHost(ctx, store)
    const second = ensureSuperAgentHost(ctx, store)
    expect(first).toBe(second)
    expect(first.outbox.active).toBe(true)
    expect(first.watchdog.active).toBe(true)
    await disposeInstance(directory)
    expect(superAgentHostFor(directory)).toBeUndefined()
    expect(superAgentHostDiagnostics()).toMatchObject({ activeOutboxWorkers: 0, activeWatchdogWorkers: 0 })
    expect(first.outbox.active).toBe(false)
    expect(first.watchdog.active).toBe(false)
  })

  test("automatically dispatches persisted Agent tasks through the runtime registry", async () => {
    const directory = `host-agent-${Date.now()}`
    let dispatches = 0
    const taskID = "agent-task"
    let current: SuperAgentRun = {
      id: `host-agent-run-${Date.now()}`,
      goal: {
        text: "run an Agent task",
        constraints: [],
        acceptanceCriteria: [],
        source: "user",
        requestedBy: "test",
        sessionId: "session-host-agent",
      },
      status: "running",
      graph: {
        id: "host-agent-graph",
        version: 1,
        nodes: [
          {
            id: taskID,
            graphID: "host-agent-graph",
            kind: "agent",
            title: "Agent task",
            objective: "delegate this task",
            status: "ready",
            dependencies: [],
            input: { agentID: "fixture-agent" },
            acceptanceCriteria: [],
            retryPolicy: { maxAttempts: 1, backoffMs: 0, retryable: false },
            attempts: 0,
            evidenceIDs: [],
            verificationIDs: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        edges: [],
        rootTaskID: taskID,
        planHash: "fixture",
      },
      budget: { childAgents: 1 },
      usage: { tokens: 0, usd: 0, wallTimeMs: 0, steps: 0, toolCalls: 0, childAgents: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const store = {
      list: () => Effect.succeed([current]),
      get: () => Effect.succeed(current),
      operations: () => Effect.succeed([]),
      updateGraph: (_runID: string, graph: SuperAgentRun["graph"], expectedVersion: number) => {
        if (current.graph.version !== expectedVersion) return Effect.succeed(undefined)
        current = { ...current, graph: { ...graph, version: expectedVersion + 1 } }
        return Effect.succeed(current)
      },
      transitionWithEvent: (_runID: string, status: SuperAgentRun["status"]) => {
        current = { ...current, status }
        return Effect.succeed({ run: current, event: {} as never })
      },
      reserveBudget: () => Effect.succeed({} as never),
      releaseBudget: () => Effect.succeed(undefined),
    } as never
    const runtimes = new AgentRuntimeRegistry()
    runtimes.register(
      new LocalAgentRuntimeAdapter({
        descriptor: {
          id: "fixture-agent",
          pluginID: "host-test",
          version: "1",
          displayName: "Fixture Agent",
          runtimeType: "local-agent",
          role: "worker",
          capabilities: ["agent"],
          tools: [],
          supports: { streaming: true, pause: true, resume: true, cancellation: true, delegation: false, localExecution: true },
        },
        execute: async () => {
          dispatches += 1
          throw new Error("fixture failure")
        },
      }),
    )
    const host = ensureSuperAgentHost({ directory } as never, store, {
      execution: { registry: {} as never, permission: {} as never, delegation: runtimes },
    })
    for (let attempt = 0; attempt < 60 && current.status === "running"; attempt += 1) await Bun.sleep(50)
    await disposeInstance(directory)
    expect(dispatches).toBeGreaterThanOrEqual(1)
    expect(current.status).toBe("failed")
    expect(current.graph.nodes.find((task) => task.id === taskID)?.status).toBe("failed")
    expect(host.execution?.active).toBe(false)
  })
})
