import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import type * as Tool from "../../src/tool/tool"
import type { SessionID, MessageID } from "../../src/session/schema"
import { makeSuperAgentToolExecutor } from "../../src/super-agent/tool-executor"
import { createNativeToolExecutorEffect } from "../../src/super-agent/native-executor"
import type { AgentInstruction, Goal } from "../../src/super-agent/types"

const goal: Goal = {
  text: "execute a native tool",
  constraints: [],
  source: "user",
  requestedBy: "test",
  acceptanceCriteria: [],
}

const instruction: AgentInstruction = {
  type: "run_tool",
  taskID: "run-tool:root",
  tool: "fixture.echo",
  input: { value: "ok" },
  runID: "run-tool",
  instructionID: "instruction-1",
  issuedAt: Date.now(),
  policyContextHash: "test",
  capability: "tool",
  idempotencyKey: "run-tool:fixture:1",
}

describe("Super-Agent native tool executor", () => {
  test("resolves and executes a registered Tool.Def with the full context", async () => {
    let seenContext: Tool.Context | undefined
    let asked = false
    const definition: Tool.Def = {
      id: "fixture.echo",
      description: "echo fixture",
      parameters: Schema.Unknown,
      capabilities: {
        checkPermissions: () => Effect.succeed("ask" as const),
      },
      execute: (args, context) => {
        seenContext = context
        return Effect.succeed({ title: "echo", metadata: {}, output: JSON.stringify(args) })
      },
    }
    const registry = {
      all: () => Effect.succeed([definition]),
    } as never
    const executor = makeSuperAgentToolExecutor({
      registry,
      context: () => ({
        sessionID: "session-super-agent" as SessionID,
        messageID: "message-super-agent" as MessageID,
        agent: "super-agent",
        directory: "C:\\workspace",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => {
          asked = true
          return Effect.void
        },
      }),
    })

    const result = await executor(instruction, {
      id: "run-tool",
      goal,
      status: "running",
      graph: {
        id: "run-tool:graph",
        version: 1,
        nodes: [],
        edges: [],
        rootTaskID: "run-tool:root",
        planHash: "fixture",
      },
      budget: {},
      usage: { tokens: 0, usd: 0, wallTimeMs: 0, steps: 0, toolCalls: 0, childAgents: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    expect(result).toEqual({ type: "tool_completed", tool: "fixture.echo", output: '{"value":"ok"}' })
    expect(seenContext?.sessionID).toBe("session-super-agent" as SessionID)
    expect(seenContext?.messageID).toBe("message-super-agent" as MessageID)
    expect(seenContext?.directory).toBe("C:\\workspace")
    expect(asked).toBe(true)
  })

  test("persists operation, evidence, and audit events without replaying a duplicate", async () => {
    let acquired = true
    let executions = 0
    const events: string[] = []
    const evidence: unknown[] = []
    const definition: Tool.Def = {
      id: "fixture.durable",
      description: "durable fixture",
      parameters: Schema.Unknown,
      execute: () => {
        executions += 1
        return Effect.succeed({ title: "durable", metadata: { exit: 0 }, output: "durable-output" })
      },
    }
    const operation = {
      id: "run-tool:tool:instruction-1",
      runID: "run-tool",
      instructionID: "instruction-1",
      idempotencyKey: "run-tool:fixture:1",
      status: "started" as const,
      leaseUntil: Date.now() + 60_000,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      acquired: true,
    }
    const store = {
      beginOperation: () => {
        const result = { ...operation, acquired }
        acquired = false
        return Effect.succeed(result)
      },
      appendEvent: (event: { type: string }) => {
        events.push(event.type)
        return Effect.succeed(event)
      },
      reserveBudget: () => Effect.succeed({} as never),
      settleBudget: () => Effect.succeed({} as never),
      releaseBudget: () => Effect.succeed({} as never),
      evidence: (item: unknown) => {
        evidence.push(item)
        return Effect.succeed(item)
      },
      resolveOperation: (_id: string, status: string, result?: unknown) => {
        operation.status = status as "started"
        if (result) (operation as { result?: unknown }).result = result
        return Effect.succeed(operation)
      },
    } as never
    const executor = makeSuperAgentToolExecutor({
      registry: { all: () => Effect.succeed([definition]) } as never,
      store,
      evidenceKind: "test",
      context: () => ({
        sessionID: "session" as SessionID,
        messageID: "message" as MessageID,
        agent: "agent",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }),
    })
    const run = {
      id: "run-tool",
      goal,
      status: "running" as const,
      graph: { id: "graph", version: 1, nodes: [], edges: [], rootTaskID: "root", planHash: "fixture" },
      budget: {},
      usage: { tokens: 0, usd: 0, wallTimeMs: 0, steps: 0, toolCalls: 0, childAgents: 0 },
      createdAt: 0,
      updatedAt: 0,
    }

    const first = await executor({ ...instruction, tool: "fixture.durable" }, run)
    const second = await executor({ ...instruction, tool: "fixture.durable" }, run)
    expect(first).toMatchObject({ type: "tool_completed", evidenceIDs: ["run-tool:tool:instruction-1:evidence"] })
    expect(second).toEqual(first)
    expect(executions).toBe(1)
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({ kind: "test", measured: "pass" })
    expect(events).toEqual(["tool_operation_started", "tool_operation_progress", "tool_operation_completed"])
  })

  test("times out a native tool, aborts its context, and releases its reservation", async () => {
    let observedAbort = false
    let operationStatus = "started"
    let released = false
    const evidence: unknown[] = []
    const definition: Tool.Def = {
      id: "fixture.slow",
      description: "slow fixture",
      parameters: Schema.Unknown,
      execute: (_args, context) =>
        Effect.sleep("100 millis").pipe(
          Effect.map(() => ({ title: "slow", metadata: {}, output: "too-late" })),
          Effect.ensuring(Effect.sync(() => {
            observedAbort = context.abort.aborted
          })),
        ),
    }
    const operation = {
      id: "run-tool:tool:instruction-1",
      runID: "run-tool",
      instructionID: "instruction-1",
      idempotencyKey: "run-tool:fixture:1",
      status: "started" as const,
      leaseUntil: Date.now() + 60_000,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      acquired: true,
    }
    const store = {
      beginOperation: () => Effect.succeed(operation),
      appendEvent: (event: { type: string }) => Effect.succeed(event),
      reserveBudget: () => Effect.succeed({} as never),
      settleBudget: () => Effect.succeed({} as never),
      releaseBudget: () => {
        released = true
        return Effect.succeed({} as never)
      },
      evidence: (item: unknown) => {
        evidence.push(item)
        return Effect.succeed(item)
      },
      resolveOperation: (_id: string, status: string) => {
        operationStatus = status
        return Effect.succeed(operation)
      },
    } as never
    const executor = makeSuperAgentToolExecutor({
      registry: { all: () => Effect.succeed([definition]) } as never,
      store,
      timeoutMs: 5,
      context: () => ({
        sessionID: "session" as SessionID,
        messageID: "message" as MessageID,
        agent: "agent",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }),
    })
    const timeoutInstruction = { ...instruction, tool: "fixture.slow" }

    const result = await executor(timeoutInstruction, {
      id: "run-tool",
      goal,
      status: "running",
      graph: { id: "graph", version: 1, nodes: [], edges: [], rootTaskID: "root", planHash: "fixture" },
      budget: {},
      usage: { tokens: 0, usd: 0, wallTimeMs: 0, steps: 0, toolCalls: 0, childAgents: 0 },
      createdAt: 0,
      updatedAt: 0,
    })

    expect(result).toMatchObject({ type: "agent_failed", code: "tool_timeout" })
    expect(result).toMatchObject({ message: "tool timed out after 5ms" })
    expect(observedAbort).toBe(true)
    expect(operationStatus).toBe("failed")
    expect(released).toBe(true)
    expect(evidence).toHaveLength(0)
  })
  test("maps Effect-native timeout failures and releases durable state", async () => {
    let observedAbort = false
    let operationStatus = "started"
    let released = false
    const definition: Tool.Def = {
      id: "fixture.native-slow",
      description: "native slow fixture",
      parameters: Schema.Unknown,
      execute: (_args, context) => {
        context.abort.addEventListener("abort", () => {
          observedAbort = true
        }, { once: true })
        return Effect.sleep("100 millis").pipe(
          Effect.map(() => ({ title: "slow", metadata: {}, output: "too-late" })),
          Effect.ensuring(Effect.sync(() => {
            observedAbort = observedAbort || context.abort.aborted
          })),
        )
      },
    }
    const operation = {
      id: "run-tool:tool:instruction-1",
      runID: "run-tool",
      instructionID: "instruction-1",
      idempotencyKey: "run-tool:fixture:1",
      status: "started" as const,
      leaseUntil: Date.now() + 60_000,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      acquired: true,
    }
    const store = {
      beginOperation: () => Effect.succeed(operation),
      appendEvent: (event: unknown) => Effect.succeed(event),
      reserveBudget: () => Effect.succeed({} as never),
      settleBudget: () => Effect.succeed({} as never),
      releaseBudget: () => {
        released = true
        return Effect.succeed({} as never)
      },
      evidence: (item: unknown) => Effect.succeed(item),
      resolveOperation: (_id: string, status: string) => {
        operationStatus = status
        return Effect.succeed(operation)
      },
    } as never
    const executor = createNativeToolExecutorEffect({
      registry: { all: () => Effect.succeed([definition]) } as never,
      directory: "C:\\workspace",
      sessionID: "session" as SessionID,
      messageID: "message" as MessageID,
      agent: "agent",
      store,
      timeoutMs: 5,
    })

    const result = await Effect.runPromise(
      executor(
        { ...instruction, tool: "fixture.native-slow" },
        {
          id: "run-tool",
          goal,
          status: "running",
          graph: { id: "graph", version: 1, nodes: [], edges: [], rootTaskID: "root", planHash: "fixture" },
          budget: {},
          usage: { tokens: 0, usd: 0, wallTimeMs: 0, steps: 0, toolCalls: 0, childAgents: 0 },
          createdAt: 0,
          updatedAt: 0,
        },
      ),
    )

    expect(result).toMatchObject({ type: "agent_failed", code: "tool_timeout" })
    expect(result).toMatchObject({ message: "tool timed out after 5ms" })
    expect(observedAbort).toBe(true)
    expect(operationStatus).toBe("failed")
    expect(released).toBe(true)
  })
  test("requires an explicit gate for destructive non-idempotent tools", async () => {
    const permissions: string[] = []
    const definition: Tool.Def = {
      id: "fixture.external-write",
      description: "external write fixture",
      parameters: Schema.Unknown,
      capabilities: { destructive: true, idempotent: false, readOnly: false },
      execute: () => Effect.succeed({ title: "written", metadata: {}, output: "written" }),
    }
    const executor = makeSuperAgentToolExecutor({
      registry: { all: () => Effect.succeed([definition]) } as never,
      context: () => ({
        sessionID: "session" as SessionID,
        messageID: "message" as MessageID,
        agent: "agent",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: (request) => {
          permissions.push(request.permission)
          return Effect.void
        },
      }),
    })
    const result = await executor(
      { ...instruction, tool: definition.id },
      {
        id: "run-tool",
        goal,
        status: "running",
        graph: { id: "graph", version: 1, nodes: [], edges: [], rootTaskID: "root", planHash: "fixture" },
        budget: {},
        usage: { tokens: 0, usd: 0, wallTimeMs: 0, steps: 0, toolCalls: 0, childAgents: 0 },
        createdAt: 0,
        updatedAt: 0,
      },
    )
    expect(result).toMatchObject({ type: "tool_completed", tool: definition.id })
    expect(permissions).toEqual(["super-agent.external_side_effect"])
  })

  test("executes a dynamically discovered MCP tool through the durable native boundary", async () => {
    let called: { toolID: string; args: Record<string, unknown> } | undefined
    let operationStatus = "started"
    const operation = {
      id: "run-tool:mcp:instruction-1",
      runID: "run-tool",
      instructionID: "instruction-1",
      idempotencyKey: "run-tool:fixture:1",
      status: "started" as const,
      leaseUntil: Date.now() + 60_000,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      acquired: true,
    }
    const store = {
      beginOperation: () => Effect.succeed(operation),
      appendEvent: (event: unknown) => Effect.succeed(event),
      reserveBudget: () => Effect.succeed({} as never),
      settleBudget: () => Effect.succeed({} as never),
      releaseBudget: () => Effect.succeed({} as never),
      evidence: (item: unknown) => Effect.succeed(item),
      resolveOperation: (_id: string, status: string) => {
        operationStatus = status
        return Effect.succeed(operation)
      },
    } as never
    const executor = createNativeToolExecutorEffect({
      registry: { all: () => Effect.succeed([]) } as never,
      mcp: {
        callTool: (toolID: string, args: Record<string, unknown>) => {
          called = { toolID, args }
          return Effect.succeed({ content: [{ type: "text", text: "mcp-result" }] })
        },
      } as never,
      directory: "C:\\workspace",
      sessionID: "session" as SessionID,
      messageID: "message" as MessageID,
      agent: "agent",
      ask: () => Effect.void,
      store,
    })

    const result = await Effect.runPromise(
      executor(
        { ...instruction, tool: "demo_mcp_lookup", input: { query: "NovaWay" } },
        {
          id: "run-tool",
          goal,
          status: "running",
          graph: { id: "graph", version: 1, nodes: [], edges: [], rootTaskID: "root", planHash: "fixture" },
          budget: {},
          usage: { tokens: 0, usd: 0, wallTimeMs: 0, steps: 0, toolCalls: 0, childAgents: 0 },
          createdAt: 0,
          updatedAt: 0,
        },
      ),
    )

    expect(called).toEqual({ toolID: "demo_mcp_lookup", args: { query: "NovaWay" } })
    expect(result).toMatchObject({ type: "tool_completed", tool: "demo_mcp_lookup", output: expect.stringContaining("mcp-result") })
    expect(operationStatus).toBe("succeeded")
  })

  test("does not execute a tool outside the allowlist", async () => {
    let executed = false
    const definition: Tool.Def = {
      id: "fixture.denied",
      description: "denied fixture",
      parameters: Schema.Unknown,
      execute: () => {
        executed = true
        return Effect.succeed({ title: "denied", metadata: {}, output: "no" })
      },
    }
    const executor = makeSuperAgentToolExecutor({
      registry: { all: () => Effect.succeed([definition]) } as never,
      allowedTools: ["fixture.other"],
      context: () => ({
        sessionID: "session" as SessionID,
        messageID: "message" as MessageID,
        agent: "agent",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }),
    })

    await expect(
      executor(
        { ...instruction, tool: "fixture.denied" },
        {
          id: "run-tool",
          goal,
          status: "running",
          graph: { id: "graph", version: 1, nodes: [], edges: [], rootTaskID: "root", planHash: "fixture" },
          budget: {},
          usage: { tokens: 0, usd: 0, wallTimeMs: 0, steps: 0, toolCalls: 0, childAgents: 0 },
          createdAt: 0,
          updatedAt: 0,
        },
      ),
    ).resolves.toMatchObject({ type: "agent_failed", code: "tool_denied" })
    expect(executed).toBe(false)
  })
})
