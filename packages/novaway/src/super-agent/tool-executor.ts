import { createHash } from "node:crypto"
import { Effect, Option } from "effect"
import type { Interface as ToolRegistryInterface } from "@/tool/registry"
import type { Interface as SuperAgentStoreInterface } from "./store"
import type { Interface as MCPInterface } from "@/mcp"
import type {
  AgentInstruction,
  ExecutorResult,
  Evidence,
  EvidenceKind,
  SuperAgentEventInput,
  SuperAgentRun,
} from "./types"
import type * as Tool from "@/tool/tool"

export type SuperAgentToolContextFactory = (
  run: SuperAgentRun,
  instruction: Extract<AgentInstruction, { type: "run_tool" }>,
) => Tool.Context

type ToolInstruction = Extract<AgentInstruction, { type: "run_tool" }>

const serialize = (value: unknown) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex")

/** Bridges the typed Super-Agent executor boundary to NovaWay's existing ToolRegistry. */
export function makeSuperAgentToolExecutor(input: {
  registry: ToolRegistryInterface
  context: SuperAgentToolContextFactory
  /** MCP tools are discovered outside ToolRegistry and use the same durable operation boundary. */
  mcp?: MCPInterface
  allowedTools?: readonly string[]
  evidenceKind?: EvidenceKind
  timeoutMs?: number
  /** When supplied, operation/evidence/audit records survive process restart. */
  store?: SuperAgentStoreInterface
  leaseMs?: number
}) {
  const event = (
    run: SuperAgentRun,
    type: string,
    payload: Record<string, unknown>,
    key: string,
  ): SuperAgentEventInput => ({
    eventID: `${run.id}:tool:${key}`,
    idempotencyKey: `${run.id}:tool-event:${key}`,
    runID: run.id,
    type,
    at: Date.now(),
    payload,
  })

  const append = async (run: SuperAgentRun, type: string, payload: Record<string, unknown>, key: string) => {
    if (!input.store) return
    await Effect.runPromise(input.store.appendEvent(event(run, type, payload, key)))
  }

  return async (instruction: AgentInstruction, run: SuperAgentRun): Promise<ExecutorResult> => {
    if (instruction.type !== "run_tool")
      return { type: "unknown", operationID: instruction.instructionID, reason: "not a tool instruction" }
    const toolInstruction = instruction as ToolInstruction
    if (input.allowedTools && !input.allowedTools.includes(toolInstruction.tool))
      return {
        type: "agent_failed",
        agentID: "super-agent-tool",
        code: "tool_denied",
        message: `tool denied: ${toolInstruction.tool}`,
      }

    const operationID = `${run.id}:tool:${toolInstruction.instructionID}`
    const startedAt = Date.now()
    let reservationID: string | undefined
    let timedOut = false
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined
    try {
      if (input.store) {
        const operation = await Effect.runPromise(
          input.store.beginOperation({
            id: operationID,
            runID: run.id,
            instructionID: toolInstruction.instructionID,
            idempotencyKey: toolInstruction.idempotencyKey,
            leaseMs: input.leaseMs ?? 60_000,
          }),
        )
        if (!operation.acquired) {
          if (operation.status === "succeeded" && operation.result) return operation.result
          return { type: "unknown", operationID, reason: `operation is already ${operation.status}` }
        }
        if (operation.status !== "started")
          return { type: "unknown", operationID, reason: `operation is ${operation.status}` }
        reservationID = `${operationID}:budget`
        await Effect.runPromise(input.store.reserveBudget(run.id, reservationID, { toolCalls: 1 }))
        await append(
          run,
          "tool_operation_started",
          { operationID, tool: toolInstruction.tool },
          toolInstruction.instructionID,
        )
        const leaseMs = input.leaseMs ?? 60_000
        heartbeatTimer = setInterval(() => {
          void Effect.runPromise(input.store!.heartbeatOperation(operationID, leaseMs)).catch(() => undefined)
        }, Math.max(10, Math.floor(leaseMs / 3)))
      }

      const definition = (await Effect.runPromise(input.registry.all())).find(
        (item) => item.id === toolInstruction.tool,
      )
      if (!definition && !input.mcp) throw new Error(`tool not found: ${toolInstruction.tool}`)
      await append(
        run,
        "tool_operation_progress",
        { operationID, phase: "executing", source: definition ? "tool" : "mcp" },
        `${toolInstruction.instructionID}:progress`,
      )
      const baseContext = input.context(run, toolInstruction)
      const timeoutController = new AbortController()
      const timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : undefined
      const timeoutTimer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true
              timeoutController.abort()
            }, timeoutMs)
      const context = {
        ...baseContext,
        abort: timeoutMs === undefined ? baseContext.abort : AbortSignal.any([baseContext.abort, timeoutController.signal]),
      }
      let result: { output: unknown; metadata?: unknown }
      if (!definition) {
        await Effect.runPromise(
          context.ask({
            permission: toolInstruction.tool,
            patterns: ["*"],
            always: [],
            metadata: { source: "mcp", tool: toolInstruction.tool },
          }),
        )
        const raw = await Effect.runPromise(
          input.mcp!.callTool(toolInstruction.tool, (toolInstruction.input ?? {}) as Record<string, unknown>),
        )
        result = { output: typeof raw === "string" ? raw : JSON.stringify(raw) ?? String(raw) }
      } else {
        const capability = definition.capabilities
        await Effect.runPromise(capability?.validateInput?.(toolInstruction.input, context) ?? Effect.void)
        const decision = await Effect.runPromise(
          capability?.checkPermissions?.(toolInstruction.input, context) ?? Effect.succeed("allow" as const),
        )
        if (decision === "deny") throw new Error(`The ${definition.id} tool is not allowed in the current context.`)
        if (decision === "ask")
          await Effect.runPromise(
            context.ask({ permission: definition.id, patterns: ["*"], always: ["*"], metadata: {} }),
          )
        const requiresExternalApproval =
          definition.capabilities?.destructive === true ||
          (definition.capabilities?.readOnly === false && definition.capabilities?.idempotent === false)
        if (requiresExternalApproval && decision === "allow") {
          await append(
            run,
            "external_side_effect_gate",
            { operationID, tool: definition.id, policy: "non_idempotent_or_destructive" },
            `${toolInstruction.instructionID}:external-gate`,
          )
          await Effect.runPromise(
            context.ask({
              permission: "super-agent.external_side_effect",
              patterns: [definition.id],
              always: [],
              metadata: { tool: definition.id, operationID, nonIdempotent: definition.capabilities?.idempotent === false },
            }),
          )
        }
        try {
          const effect = definition.execute(toolInstruction.input as never, context)
          const timedResult = await Effect.runPromise(
            timeoutMs === undefined
              ? effect.pipe(Effect.map(Option.some))
              : effect.pipe(Effect.timeoutOption(timeoutMs)),
          )
          if (Option.isNone(timedResult)) {
            timedOut = true
            timeoutController.abort()
            throw new Error(`tool timed out after ${timeoutMs}ms`)
          }
          result = timedResult.value
        } catch (error) {
          if (timedOut || timeoutController.signal.aborted) throw new Error(`tool timed out after ${timeoutMs}ms`)
          throw error
        }
      }
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
      const output = typeof result.output === "string" ? result.output : JSON.stringify(result.output) ?? String(result.output)
      const capturedAt = Date.now()
      const evidenceID = `${operationID}:evidence`
      if (input.store) {
        const evidence: Evidence = {
          id: evidenceID,
          runID: run.id,
          taskID: toolInstruction.taskID,
          kind: input.evidenceKind ?? "artifact",
          source: definition ? `tool:${toolInstruction.tool}` : `mcp:${toolInstruction.tool}`,
          acceptanceIDs: run.graph.nodes.find((task) => task.id === toolInstruction.taskID)?.acceptanceCriteria.map(
            (criterion) => criterion.id,
          ),
          contentHash: hash(output),
          measured:
            input.evidenceKind === "test"
              ? (result.metadata as { exit?: number } | undefined)?.exit === 0
                ? "pass"
                : "fail"
              : "tool execution completed",
          capturedAt,
        }
        await Effect.runPromise(input.store.evidence(evidence))
        await Effect.runPromise(
          input.store.resolveOperation(operationID, "succeeded", {
            type: "tool_completed",
            tool: toolInstruction.tool,
            output,
            evidenceIDs: [evidenceID],
          }),
        )
        if (reservationID)
          await Effect.runPromise(
            input.store.settleBudget(reservationID, { toolCalls: 1, wallTimeMs: Math.max(0, Date.now() - startedAt) }),
          )
        await append(
          run,
          "tool_operation_completed",
          { operationID, tool: toolInstruction.tool, evidenceID },
          `${toolInstruction.instructionID}:completed`,
        )
        return { type: "tool_completed", tool: toolInstruction.tool, output, evidenceIDs: [evidenceID] }
      }
      return { type: "tool_completed", tool: toolInstruction.tool, output }
    } catch (error) {
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
      const message = error instanceof Error ? error.message : String(error)
      if (input.store) {
        await Effect.runPromise(input.store.resolveOperation(operationID, "failed", undefined, message)).catch(
          () => undefined,
        )
        if (reservationID) await Effect.runPromise(input.store.releaseBudget(reservationID)).catch(() => undefined)
        await append(
          run,
          "tool_operation_failed",
          { operationID, message },
          `${toolInstruction.instructionID}:failed`,
        ).catch(() => undefined)
      }
      return {
        type: "agent_failed",
        agentID: "super-agent-tool",
        code: timedOut ? "tool_timeout" : "tool_failed",
        message,
      }
    }
  }
}
