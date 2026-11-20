import { describe, expect, test } from "bun:test"
import {
  AgentRuntimeAlreadyRegistered,
  AgentRuntimeNotFound,
  AgentRuntimeRegistry,
  createSuperAgentContributionRegistries,
  LocalAgentRuntimeAdapter,
  ProcessAgentRuntimeAdapter,
  DeterministicSupervisor,
  ExecutorAlreadyRegistered,
  ExecutorNotFound,
  SuperAgentExecutorRegistry,
  SuperAgentRuntime,
  RepairStrategyRegistry,
  builtinRepairStrategy,
} from "../../src/super-agent"
import type { Goal } from "../../src/super-agent"

const goal: Goal = {
  text: "registry",
  constraints: [],
  source: "user",
  requestedBy: "test",
  acceptanceCriteria: [],
}

describe("Super-Agent executor and supervisor boundaries", () => {
  test("registers, disables, and disposes executors deterministically", async () => {
    const registry = new SuperAgentExecutorRegistry()
    const executor = {
      id: "test.executor",
      version: "1",
      capabilities: ["test"],
      execute: async () => ({ type: "tool_completed" as const, tool: "test", output: "ok" }),
    }
    const handle = registry.register(executor)
    expect(registry.resolve(executor.id)?.version).toBe("1")
    expect(() => registry.register(executor)).toThrow(ExecutorAlreadyRegistered)
    expect(
      await registry.execute(
        executor.id,
        {
          type: "checkpoint",
          runID: "r",
          reason: "x",
          instructionID: "i",
          issuedAt: 1,
          policyContextHash: "p",
          capability: "checkpoint",
          idempotencyKey: "k",
        },
        SuperAgentRuntime.create({ id: "r", goal }).runtime.snapshot(),
      ),
    ).toMatchObject({ type: "tool_completed" })
    handle.dispose()
    expect(registry.resolve(executor.id)).toBeUndefined()
    await expect(registry.execute(executor.id, {} as never, {} as never)).rejects.toThrow(ExecutorNotFound)
  })

  test("discovers heterogeneous Agent Runtime adapters without bypassing the registry", async () => {
    const registry = new AgentRuntimeRegistry()
    const adapter = {
      type: "test-runtime",
      version: "1",
      discover: async () => [],
      start: async () => ({ id: "handle-1", runID: "run-1", taskID: "task-1" }),
      send: async () => undefined,
      events: async function* () {},
      pause: async () => ({ checkpointID: "checkpoint-1" }),
      resume: async () => undefined,
      cancel: async () => undefined,
      dispose: async () => undefined,
    }
    registry.register(adapter)
    expect(await registry.discover("test-runtime")).toEqual([])
    expect(() => registry.register(adapter)).toThrow(AgentRuntimeAlreadyRegistered)
    await expect(registry.discover("missing-runtime")).rejects.toThrow(AgentRuntimeNotFound)
  })

  test("executes a local native Agent Runtime through the adapter boundary", async () => {
    const adapter = new LocalAgentRuntimeAdapter({
      descriptor: {
        id: "native.test",
        pluginID: "builtin",
        version: "1",
        displayName: "Native test agent",
        runtimeType: "local",
        role: "worker",
        capabilities: ["test"],
        tools: [],
        supports: {
          streaming: true,
          pause: true,
          resume: true,
          cancellation: true,
          delegation: false,
          localExecution: true,
        },
      },
      execute: async ({ instruction }) => ({ instruction, ok: true }),
    })
    const handle = await adapter.start({
      runID: "run-native",
      taskID: "task-native",
      agentID: "native.test",
      instruction: "hello",
    })
    const events = []
    for await (const event of adapter.events(handle)) {
      events.push(event.type)
      if (event.type === "completed") break
    }
    expect(events).toEqual(["started", "completed"])
    expect((await adapter.pause(handle)).checkpointID).toContain("checkpoint")
    await adapter.dispose(handle)
  })
  test("executes an external process Agent Runtime through the adapter boundary", async () => {
    const adapter = new ProcessAgentRuntimeAdapter({
      command: process.execPath,
      args: ["-e", "process.stdin.on('data',()=>{}); process.stdin.on('end',()=>console.log('external-ok'))"],
      descriptor: {
        id: "process.test",
        pluginID: "builtin",
        version: "1",
        displayName: "Process test agent",
        runtimeType: "process",
        role: "worker",
        capabilities: ["test"],
        tools: [],
        supports: {
          streaming: false,
          pause: false,
          resume: false,
          cancellation: true,
          delegation: false,
          localExecution: false,
        },
      },
    })
    const handle = await adapter.start({
      runID: "run-process",
      taskID: "task-process",
      agentID: "process.test",
      instruction: "hello",
    })
    const events = []
    for await (const event of adapter.events(handle)) {
      events.push(event.type)
      if (event.type === "completed" || event.type === "failed") break
    }
    expect(events).toEqual(["started", "completed"])
    await adapter.dispose(handle)
  })
  test("reports an external Agent Runtime process crash and disposes the owned child", async () => {
    const adapter = new ProcessAgentRuntimeAdapter({
      command: process.execPath,
      args: ["-e", "process.exit(7)"],
      descriptor: {
        id: "process.crash",
        pluginID: "builtin",
        version: "1",
        displayName: "Process crash fixture",
        runtimeType: "process",
        role: "worker",
        capabilities: ["test"],
        tools: [],
        supports: {
          streaming: false,
          pause: false,
          resume: false,
          cancellation: true,
          delegation: false,
          localExecution: false,
        },
      },
    })
    const handle = await adapter.start({ runID: "run-crash", taskID: "task-crash", agentID: "process.crash", instruction: "crash" })
    const terminal: string[] = []
    for await (const event of adapter.events(handle)) {
      if (event.type === "failed" || event.type === "unknown") {
        terminal.push(event.type)
        break
      }
    }
    expect(terminal).toEqual(["failed"])
    await adapter.dispose(handle)
    await expect(adapter.heartbeat(handle)).rejects.toThrow("agent handle not found")
  })
  test("keeps plugin-contributed runtime capabilities independently disposable", () => {
    const registries = createSuperAgentContributionRegistries()
    const handle = registries.taskKinds.register({ id: "plugin.task", version: "1", entry: "./task" })
    expect(registries.taskKinds.resolve("plugin.task")?.entry).toBe("./task")
    handle.dispose()
    expect(registries.taskKinds.resolve("plugin.task")).toBeUndefined()
  })
  test("binds executable plugin verifier, repair, and runtime contributions to kernel registries", async () => {
    const contributions = createSuperAgentContributionRegistries()
    const verifier = {
      id: "plugin.verifier",
      version: "1",
      entry: "./verifier",
      kinds: ["artifact"],
      verify: async () => ({ outcome: "pass" as const, evidenceIDs: [], reason: "plugin" }),
    }
    const repair = {
      id: "plugin.repair",
      version: "1",
      entry: "./repair",
      create: () => ({}) as never,
    }
    const adapter = {
      id: "plugin.runtime",
      version: "1",
      runtimeType: "plugin-runtime",
      capabilities: ["agent"],
      entry: "./runtime",
      supports: { streaming: false, pause: false, resume: false, cancellation: true },
      type: "plugin-runtime",
      discover: async () => [],
      start: async () => ({ id: "handle", runID: "run", taskID: "task" }),
      send: async () => undefined,
      events: async function* () {},
      pause: async () => ({ checkpointID: "checkpoint" }),
      resume: async () => undefined,
      cancel: async () => undefined,
      dispose: async () => undefined,
    }
    contributions.verifiers.register(verifier)
    contributions.repairStrategies.register(repair)
    contributions.agentRuntimes.register(adapter)
    const bindings = (await import("../../src/super-agent")).bindExecutableSuperAgentContributions(contributions)
    expect(bindings.verifiers.resolve("plugin.verifier")?.version).toBe("1")
    expect(bindings.repairStrategies.resolve("plugin.repair")?.version).toBe("1")
    expect(bindings.runtimes.resolve("plugin-runtime")).toBeDefined()
    bindings.dispose()
    expect(bindings.verifiers.list()).toHaveLength(0)
    expect(bindings.repairStrategies.list()).toHaveLength(0)
    expect(bindings.runtimes.list()).toHaveLength(0)
  })
  test("creates a repair task from failed verification evidence", () => {
    const registry = new RepairStrategyRegistry()
    registry.register(builtinRepairStrategy)
    const source = SuperAgentRuntime.create({ id: "run-repair", goal }).runtime.snapshot().graph.nodes[0]!
    source.input = { tool: "fixture.echo", input: { value: "repair" } }
    const repair = registry.create("builtin.repair", {
      runID: "run-repair",
      failed: [
        {
          id: "verification-failed",
          runID: "run-repair",
          acceptanceID: "checks",
          verifierID: "builtin.test",
          verifierVersion: "1",
          outcome: "fail",
          evidenceIDs: [],
          reason: "failed",
          createdAt: Date.now(),
        },
      ],
      sourceTask: source,
    })
    expect(repair.kind).toBe("repair")
    expect(repair.input).toMatchObject({
      tool: "fixture.echo",
      input: { value: "repair" },
      failedVerificationIDs: ["verification-failed"],
    })
  })
  test("plans a typed native tool instruction from task input", () => {
    const runtime = SuperAgentRuntime.create({ id: "run-tool-supervisor", goal }).runtime
    const run = runtime.snapshot()
    run.graph.nodes[0]!.input = { tool: "fixture.echo", input: { value: "ok" } }
    const decision = new DeterministicSupervisor().decide(run)
    expect(decision.instructions[0]).toMatchObject({
      type: "run_tool",
      taskID: run.graph.rootTaskID,
      tool: "fixture.echo",
      capability: "tool",
    })
  })
  test("deterministic supervisor only emits scoped typed instructions", () => {
    const runtime = SuperAgentRuntime.create({ id: "run-supervisor", goal }).runtime
    const decision = new DeterministicSupervisor().decide(runtime.snapshot())
    expect(decision.instructions[0]).toMatchObject({ type: "checkpoint", runID: "run-supervisor" })
    expect(decision.instructions[0]?.idempotencyKey).toContain("run-supervisor")
  })
})
