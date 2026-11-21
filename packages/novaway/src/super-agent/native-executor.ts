import { Effect, Option } from "effect"
import { createHash } from "node:crypto"
import type { Interface as ToolRegistryInterface } from "@/tool/registry"
import { SuperAgentExecutorRegistry } from "./executor-registry"
import type { SessionID, MessageID } from "@/session/schema"
import type * as Tool from "@/tool/tool"
import type { SuperAgentExecutor } from "./runtime"
import type { EvidenceKind } from "./types"
import type { Interface as SuperAgentStoreInterface } from "./store"
import type { Interface as MCPInterface } from "@/mcp"
import { makeSuperAgentToolExecutor } from "./tool-executor"

export type NativeToolExecutorInput = {
  registry: ToolRegistryInterface
  directory: string
  sessionID: SessionID
  messageID: MessageID
  agent: string
  abort?: AbortSignal
  /** Host-owned permission bridge. Omitting it fails permission requests closed. */
  ask?: Tool.Context["ask"]
  metadata?: Tool.Context["metadata"]
  messages?: Tool.Context["messages"]
  store?: SuperAgentStoreInterface
  /** MCP is separate from ToolRegistry because MCP tools are discovered lazily. */
  mcp?: MCPInterface
  allowedTools?: readonly string[]
  evidenceKind?: EvidenceKind
  acceptanceIDs?: readonly string[]
  timeoutMs?: number
  leaseMs?: number
}

/**
 * Creates the native NovaWay Tool executor used by a Super-Agent worker.
 * Tool execution remains inside the existing registry and permission boundary;
 * this adapter only supplies the context that the host already owns.
 */
export function createNativeToolExecutor(input: NativeToolExecutorInput): SuperAgentExecutor {
  return makeSuperAgentToolExecutor({
    registry: input.registry,
    store: input.store,
    mcp: input.mcp,
    allowedTools: input.allowedTools,
    evidenceKind: input.evidenceKind,
    timeoutMs: input.timeoutMs,
    context: () => ({
      sessionID: input.sessionID,
      messageID: input.messageID,
      agent: input.agent,
      directory: input.directory,
      abort: input.abort ?? new AbortController().signal,
      messages: input.messages ?? [],
      metadata: input.metadata ?? (() => Effect.void),
      ask: input.ask ?? (() => Effect.die(new Error("tool permission bridge is not configured"))),
    }),
  })
}

export const NATIVE_TOOL_EXECUTOR_ID = "builtin.native-tool"

/** Registers the bridge in the same registry used by Supervisor dispatch. */
export function registerNativeToolExecutor(registry: SuperAgentExecutorRegistry, input: NativeToolExecutorInput) {
  return registry.register({
    id: NATIVE_TOOL_EXECUTOR_ID,
    version: "1",
    capabilities: ["tool"],
    execute: createNativeToolExecutor(input),
  })
}

/** Effect-native variant for hosts already running inside an Effect service context. */
export function createNativeToolExecutorEffect(input: NativeToolExecutorInput) {
  return (instruction: import("./types").AgentInstruction, run: import("./types").SuperAgentRun) => {
    const operationID = `${run.id}:tool:${instruction.instructionID}`
    let reservationID: string | undefined
    let timedOut = false
    let timeoutMsForError: number | undefined
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined
    return Effect.gen(function* () {
      if (instruction.type !== "run_tool")
        return { type: "unknown" as const, operationID: instruction.instructionID, reason: "not a tool instruction" }
      if (input.allowedTools && !input.allowedTools.includes(instruction.tool))
        return {
          type: "agent_failed" as const,
          agentID: "super-agent-tool",
          code: "tool_denied",
          message: `tool denied: ${instruction.tool}`,
        }
      const operation = input.store
        ? yield* input.store.beginOperation({
            id: operationID,
            runID: run.id,
            instructionID: instruction.instructionID,
            idempotencyKey: instruction.idempotencyKey,
            leaseMs: input.leaseMs ?? 60_000,
          })
        : undefined
      if (operation && !operation.acquired) {
        if (operation.status === "succeeded" && operation.result) return operation.result
        return { type: "unknown" as const, operationID, reason: `operation is already ${operation.status}` }
      }
      if (input.store) {
        reservationID = `${operationID}:budget`
        yield* input.store.reserveBudget(run.id, reservationID, { toolCalls: 1 })
        yield* input.store.appendEvent({
          runID: run.id,
          type: "tool_operation_started",
          at: Date.now(),
          payload: { operationID, tool: instruction.tool },
        })
        const leaseMs = input.leaseMs ?? 60_000
        heartbeatTimer = setInterval(() => {
          void Effect.runPromise(input.store!.heartbeatOperation(operationID, leaseMs)).catch(() => undefined)
        }, Math.max(10, Math.floor(leaseMs / 3)))
      }
      const definition = (yield* input.registry.all()).find((item) => item.id === instruction.tool)
      const complete = (rawOutput: unknown, rawMetadata?: unknown) =>
        Effect.gen(function* () {
          const output = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput) ?? String(rawOutput)
          if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
          if (!input.store) return { type: "tool_completed" as const, tool: instruction.tool, output }
          const evidenceID = `${operationID}:evidence`
          const exitCode =
            rawMetadata && typeof rawMetadata === "object" && "exit" in rawMetadata
              ? Number((rawMetadata as { exit?: unknown }).exit)
              : undefined
          const measured =
            input.evidenceKind === "test"
              ? exitCode === 0
                ? "pass"
                : "fail"
              : "tool execution completed"
          yield* input.store.evidence({
            id: evidenceID,
            runID: run.id,
            taskID: instruction.taskID,
            kind: input.evidenceKind ?? "artifact",
            source: definition ? `tool:${instruction.tool}` : `mcp:${instruction.tool}`,
            ...(input.acceptanceIDs?.length ? { acceptanceIDs: input.acceptanceIDs } : {}),
            contentHash: createHash("sha256").update(output).digest("hex"),
            measured,
            capturedAt: Date.now(),
          })
          const completed = { type: "tool_completed" as const, tool: instruction.tool, output, evidenceIDs: [evidenceID] }
          yield* input.store.resolveOperation(operationID, "succeeded", completed)
          if (reservationID) yield* input.store.settleBudget(reservationID, { toolCalls: 1 })
          yield* input.store.appendEvent({
            runID: run.id,
            type: "tool_operation_completed",
            at: Date.now(),
            payload: { operationID, tool: instruction.tool, evidenceID, source: definition ? "tool" : "mcp" },
          })
          return completed
        })
      if (!definition) {
        if (!input.mcp) throw new Error(`tool not found: ${instruction.tool}`)
        yield* inputContext(input, run, instruction).ask({
          permission: instruction.tool,
          patterns: ["*"],
          always: [],
          metadata: { source: "mcp", tool: instruction.tool },
        })
        const result = yield* input.mcp.callTool(instruction.tool, (instruction.input ?? {}) as Record<string, unknown>)
        return yield* complete(result)
      }
      const baseContext = inputContext(input, run, instruction)
      const timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : undefined
      timeoutMsForError = timeoutMs
      const timeoutController = new AbortController()
      const context = {
        ...baseContext,
        abort: timeoutMs === undefined ? baseContext.abort : AbortSignal.any([baseContext.abort, timeoutController.signal]),
      }
      yield* definition.capabilities?.validateInput?.(instruction.input, context) ?? Effect.void
      const decision = yield* definition.capabilities?.checkPermissions?.(instruction.input, context) ??
        Effect.succeed("allow" as const)
      if (decision === "deny") {
        if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
        const message = `The ${definition.id} tool is not allowed in the current context.`
        if (input.store) {
          yield* input.store.resolveOperation(operationID, "failed", undefined, message)
          if (reservationID) yield* input.store.releaseBudget(reservationID)
          yield* input.store.appendEvent({
            runID: run.id,
            type: "tool_operation_failed",
            at: Date.now(),
            payload: { operationID, message },
          })
        }
        return {
          type: "agent_failed" as const,
          agentID: "super-agent-tool",
          code: "tool_denied" as const,
          message,
        }
      }
      if (decision === "ask")
        yield* context.ask({ permission: definition.id, patterns: ["*"], always: ["*"], metadata: {} })
      const requiresExternalApproval =
        definition.capabilities?.destructive === true ||
        (definition.capabilities?.readOnly === false && definition.capabilities?.idempotent === false)
      if (requiresExternalApproval && decision === "allow") {
        if (input.store)
          yield* input.store.appendEvent({
            runID: run.id,
            type: "external_side_effect_gate",
            at: Date.now(),
            payload: { operationID, tool: definition.id, policy: "non_idempotent_or_destructive" },
          })
        yield* context.ask({
          permission: "super-agent.external_side_effect",
          patterns: [definition.id],
          always: [],
          metadata: { tool: definition.id, operationID, nonIdempotent: definition.capabilities?.idempotent === false },
        })
      }
      const effect = definition.execute(instruction.input as never, context)
      const timedResult = yield* timeoutMs === undefined
        ? effect.pipe(Effect.map(Option.some))
        : effect.pipe(Effect.timeoutOption(timeoutMs))
      if (Option.isNone(timedResult)) {
        timedOut = true
        timeoutController.abort()
        return yield* Effect.fail(new Error(`tool timed out after ${timeoutMs}ms`))
      }
      return yield* complete(timedResult.value.output, timedResult.value.metadata)
    }).pipe(
      Effect.catch((error: unknown) =>
        Effect.gen(function* () {
          if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
          const message = timedOut
            ? `tool timed out after ${timeoutMsForError}ms`
            : error instanceof Error
              ? error.message
              : String(error)
          if (input.store) {
            yield* input.store.resolveOperation(operationID, "failed", undefined, message)
            if (reservationID) yield* input.store.releaseBudget(reservationID)
            yield* input.store.appendEvent({
              runID: run.id,
              type: "tool_operation_failed",
              at: Date.now(),
              payload: { operationID, message },
            })
          }
          return {
            type: "agent_failed" as const,
            agentID: "super-agent-tool",
            code: timedOut ? "tool_timeout" : "tool_failed",
            message,
          }
        }),
      ),
    )
  }
}

function inputContext(
  input: NativeToolExecutorInput,
  _run: import("./types").SuperAgentRun,
  instruction: Extract<import("./types").AgentInstruction, { type: "run_tool" }>,
): Tool.Context {
  return {
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: input.agent,
    directory: input.directory,
    abort: input.abort ?? new AbortController().signal,
    messages: input.messages ?? [],
    metadata: input.metadata ?? (() => Effect.void),
    ask: input.ask ?? (() => Effect.die(new Error("tool permission bridge is not configured"))),
    callID: instruction.instructionID,
  }
}
