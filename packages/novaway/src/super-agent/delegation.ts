import { Effect } from "effect"
import type { Interface as SuperAgentStoreInterface } from "./store"
import type { AgentInstruction, Budget, ExecutorResult, SuperAgentRun, TaskNodeStatus } from "./types"
import type { AgentHandle, AgentRuntimeAdapter, AgentRuntimeRegistry } from "./adapter"
import type { SuperAgentExecutor } from "./runtime"
import type { SuperAgentWatchdog } from "./watchdog"
import { assertRuntimeType, type SuperAgentSecurityPolicy } from "./security"

type AgentCall = Extract<AgentInstruction, { type: "call_agent" }>

export type DelegationOutcome =
  | { status: "completed"; agentID: string; output: unknown }
  | { status: "failed"; agentID: string; code: string; message: string }

export type DelegationAggregate =
  | { status: "completed"; outcomes: readonly DelegationOutcome[]; output: readonly unknown[] }
  | { status: "partial_failure"; outcomes: readonly DelegationOutcome[]; output: readonly unknown[]; failures: readonly DelegationOutcome[] }
  | { status: "conflict"; outcomes: readonly DelegationOutcome[]; output: readonly unknown[]; reason: string }

function stableValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableValue((value as Record<string, unknown>)[key])}`)
    .join(",")}}`
}

/**
 * Parent tasks never silently choose one child result. Successful outputs are
 * retained in call order; mixed success/failure is partial_failure and
 * divergent successful outputs are conflict/needs_review by default.
 */
export function aggregateDelegationOutcomes(
  outcomes: readonly DelegationOutcome[],
  options: { conflict?: "needs_review" | "first_success" } = {},
): DelegationAggregate {
  const completed = outcomes.filter((outcome) => outcome.status === "completed")
  const failures = outcomes.filter((outcome) => outcome.status === "failed")
  const output = completed.map((outcome) => outcome.output)
  const divergent = completed.length > 1 && new Set(completed.map((outcome) => stableValue(outcome.output))).size > 1
  if (divergent && options.conflict !== "first_success")
    return {
      status: "conflict",
      outcomes,
      output,
      reason: "successful child Agent outputs conflict; explicit parent resolution is required",
    }
  if (failures.length > 0 && completed.length > 0)
    return { status: "partial_failure", outcomes, output, failures }
  if (failures.length > 0)
    return { status: "partial_failure", outcomes, output, failures }
  return { status: "completed", outcomes, output }
}

export type SuperAgentDelegationInput = {
  runtimes: AgentRuntimeRegistry
  runtimeType: string
  store?: SuperAgentStoreInterface
  childBudget?: Budget
  timeoutMs?: number
  watchdog?: SuperAgentWatchdog
  securityPolicy?: SuperAgentSecurityPolicy
  maxParallelism?: number
}

/**
 * Executes child-agent instructions through the registered runtime boundary.
 * A child gets its own durable child-agent reservation; an adapter failure never
 * becomes a successful parent result and parallel outcomes retain partial data.
 */
export class SuperAgentDelegationCoordinator {
  constructor(private readonly input: SuperAgentDelegationInput) {}

  async call(instruction: AgentCall, run: SuperAgentRun, reservationSuffix = instruction.instructionID) {
    const adapter = this.resolveAdapter()
    const reservationID = `${run.id}:child:${reservationSuffix}`
    let reserved = false
    let handle: AgentHandle | undefined
    const childTaskID = `${run.id}:child:${reservationSuffix}`
    try {
      if (this.input.store) {
        await this.persistChildTask(run.id, instruction.taskID, childTaskID, "running")
        await Effect.runPromise(
          this.input.store.reserveBudget(run.id, reservationID, {
            childAgents: 1,
            ...(this.input.childBudget ?? {}),
          }),
        )
        reserved = true
      }
      handle = await adapter.start({
        runID: run.id,
        taskID: instruction.taskID,
        agentID: instruction.agentID,
        instruction: instruction.instruction,
      })
      const output = await this.collect(adapter, handle)
      if (this.input.store) {
        await this.persistChildTask(run.id, instruction.taskID, childTaskID, "succeeded", output)
        await Effect.runPromise(this.input.store.settleBudget(reservationID, { childAgents: 1, ...(this.input.childBudget ?? {}) }))
      }
      return { status: "completed", agentID: instruction.agentID, output } satisfies DelegationOutcome
    } catch (error) {
      if (this.input.store)
        await this.persistChildTask(
          run.id,
          instruction.taskID,
          childTaskID,
          "failed",
          error instanceof Error ? { error: error.message } : { error: String(error) },
        ).catch(() => undefined)
      if (this.input.store && error instanceof Error && error.message.startsWith("child agent heartbeat failed")) {
        if (this.input.watchdog) {
          await this.input.watchdog
            .recordHeartbeatFailure({
              runID: run.id,
              taskID: instruction.taskID,
              childTaskID,
              message: error.message,
            })
            .catch(() => undefined)
        } else {
          await Effect.runPromise(
            this.input.store.appendEvent({
              runID: run.id,
              type: "child_agent_heartbeat_failed",
              at: Date.now(),
              payload: { taskID: instruction.taskID, childTaskID, message: error.message },
            }),
          ).catch(() => undefined)
        }
      }
      if (handle) await adapter.cancel(handle).catch(() => undefined)
      if (this.input.store && reserved) await Effect.runPromise(this.input.store.releaseBudget(reservationID)).catch(() => undefined)
      return {
        status: "failed",
        agentID: instruction.agentID,
        code: "child_agent_failed",
        message: error instanceof Error ? error.message : String(error),
      } satisfies DelegationOutcome
    } finally {
      if (handle) await adapter.dispose(handle).catch(() => undefined)
    }
  }

  async parallel(
    instruction: Extract<AgentInstruction, { type: "parallel_call_agents" }>,
    run: SuperAgentRun,
  ) {
    const limit = Math.max(1, Math.min(8, this.input.maxParallelism ?? 8))
    const outcomes: DelegationOutcome[] = []
    for (let offset = 0; offset < instruction.calls.length; offset += limit) {
      const batch = instruction.calls.slice(offset, offset + limit)
      outcomes.push(
        ...(await Promise.all(
          batch.map((call, index) =>
            this.call(
              {
                type: "call_agent",
                taskID: instruction.taskID,
                agentID: call.agentID,
                instruction: call.instruction,
                runID: instruction.runID,
                instructionID: `${instruction.instructionID}:${offset + index}`,
                issuedAt: instruction.issuedAt,
                policyContextHash: instruction.policyContextHash,
                capability: "agent",
                idempotencyKey: `${instruction.idempotencyKey}:${offset + index}`,
              },
              run,
              `${instruction.instructionID}:${offset + index}`,
            ),
          ),
        )),
      )
    }
    return outcomes
  }

  executor(): SuperAgentExecutor {
    return async (instruction, run): Promise<ExecutorResult> => {
      if (instruction.type === "call_agent") {
        const outcome = await this.call(instruction, run)
        if (outcome.status === "failed")
          return { type: "agent_failed", agentID: outcome.agentID, code: outcome.code, message: outcome.message }
        return { type: "agent_completed", agentID: outcome.agentID, output: outcome.output }
      }
      if (instruction.type === "parallel_call_agents") {
        const outcomes = await this.parallel(instruction, run)
        const aggregate = aggregateDelegationOutcomes(outcomes)
        if (aggregate.status !== "completed")
          return {
            type: "agent_failed",
            agentID: "parallel-agents",
            code: aggregate.status === "conflict" ? "child_agent_conflict" : "child_agent_partial_failure",
            message: aggregate.status === "conflict" ? aggregate.reason : `${aggregate.failures.length} child Agent call(s) failed`,
            outcomes,
          }
        return { type: "agent_completed", agentID: "parallel-agents", output: aggregate.output }
      }
      return { type: "unknown", operationID: instruction.instructionID, reason: "not an agent delegation instruction" }
    }
  }

  private async persistChildTask(
    runID: string,
    parentTaskID: string,
    childTaskID: string,
    status: Extract<TaskNodeStatus, "running" | "succeeded" | "failed">,
    output?: unknown,
  ) {
    const store = this.input.store
    if (!store || typeof store.get !== "function" || typeof store.updateGraph !== "function") return
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await Effect.runPromise(store.get(runID))
      if (!current) throw new Error(`run not found: ${runID}`)
      const parent = current.graph.nodes.find((task) => task.id === parentTaskID)
      if (!parent) throw new Error(`parent task not found: ${parentTaskID}`)
      const timestamp = Date.now()
      const existing = current.graph.nodes.find((task) => task.id === childTaskID)
      const child = existing
        ? {
            ...existing,
            status,
            ...(output === undefined ? {} : { output }),
            updatedAt: timestamp,
          }
        : {
            id: childTaskID,
            graphID: current.graph.id,
            kind: "child-agent",
            title: `Child agent: ${childTaskID}`,
            objective: `Delegated by ${parentTaskID}`,
            status,
            dependencies: [],
            assignedAgent: parent.assignedAgent,
            input: { parentTaskID },
            ...(output === undefined ? {} : { output }),
            acceptanceCriteria: parent.acceptanceCriteria,
            retryPolicy: { maxAttempts: 1, backoffMs: 0, retryable: false },
            attempts: status === "running" ? 1 : 0,
            evidenceIDs: [],
            verificationIDs: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          }
      const graph = {
        ...current.graph,
        nodes: existing ? current.graph.nodes.map((task) => (task.id === childTaskID ? child : task)) : [...current.graph.nodes, child],
        edges: current.graph.edges.some((edge) => edge.from === parentTaskID && edge.to === childTaskID && edge.kind === "delegates_to")
          ? current.graph.edges
          : [...current.graph.edges, { from: parentTaskID, to: childTaskID, kind: "delegates_to" as const }],
      }
      try {
        const updated = await Effect.runPromise(store.updateGraph(runID, graph, current.graph.version))
        if (updated) return
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`could not persist child task: ${childTaskID}`)
  }

  private resolveAdapter() {
    assertRuntimeType(this.input.runtimeType, this.input.securityPolicy)
    const adapter = this.input.runtimes.resolve(this.input.runtimeType)
    if (!adapter) throw new Error(`agent runtime not found: ${this.input.runtimeType}`)
    return adapter
  }

  private async collect(adapter: AgentRuntimeAdapter, handle: AgentHandle) {
    const events = this.collectUntilTerminal(adapter, handle)
    if (this.input.timeoutMs === undefined || this.input.timeoutMs <= 0) return events
    let timer: ReturnType<typeof setTimeout> | undefined
    let rejectHeartbeat: ((error: unknown) => void) | undefined
    const heartbeatFailure = adapter.heartbeat
      ? new Promise<never>((_, reject) => {
          rejectHeartbeat = reject
        })
      : undefined
    const heartbeatTimer = adapter.heartbeat
      ? setInterval(() => {
          void adapter.heartbeat!(handle).catch((error) => {
            rejectHeartbeat?.(new Error(`child agent heartbeat failed: ${error instanceof Error ? error.message : String(error)}`))
            void adapter.cancel(handle).catch(() => undefined)
          })
        }, Math.max(100, Math.min(5_000, Math.floor(this.input.timeoutMs / 3))))
      : undefined
    try {
      return await Promise.race([
        events,
        ...(heartbeatFailure ? [heartbeatFailure] : []),
        new Promise<unknown>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`child agent timed out after ${this.input.timeoutMs}ms`)), this.input.timeoutMs)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
    }
  }

  private async collectUntilTerminal(adapter: AgentRuntimeAdapter, handle: AgentHandle) {
    for await (const event of adapter.events(handle)) {
      if (event.type === "completed") return event.output
      if (event.type === "failed") throw new Error(`${event.code}: ${event.message}`)
      if (event.type === "unknown") throw new Error(`agent runtime unknown: ${event.reason}`)
    }
    throw new Error("agent runtime ended without a terminal event")
  }
}
