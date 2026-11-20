import { Effect, Schema } from "effect"
import * as Log from "@novaway/core/util/log"
import { Bus } from "@/bus"
import * as BusEvent from "@/bus/bus-event"
import type { InstanceContext } from "@/project/instance-context"
import { InstanceRef } from "@/effect/instance-ref"
import { registerDisposer } from "@/effect/instance-registry"
import type { Interface as PermissionInterface } from "@/permission"
import { MessageID, SessionID } from "@/session/schema"
import { PermissionID } from "@/permission/schema"
import type { Interface as ToolRegistryInterface } from "@/tool/registry"
import type { Interface as MCPInterface } from "@/mcp"
import type { AgentRuntimeRegistry } from "./adapter"
import type { Interface as SuperAgentStoreInterface } from "./store"
import { SuperAgentOutboxHost, type SuperAgentEventPublisher } from "./outbox"
import { createSuperAgentExternalPublisher } from "./external-publisher"
import { createNativeToolExecutorEffect } from "./native-executor"
import { SuperAgentVerificationCoordinator } from "./verification-coordinator"
import { SuperAgentDelegationCoordinator } from "./delegation"
import { builtinArtifactVerifier, builtinTestVerifier, VerifierRegistry } from "./verification"
import { DeterministicSupervisor } from "./supervisor"
import { MemorySuperAgentJournal, SuperAgentRuntime } from "./runtime"
import { SuperAgentWatchdog, SuperAgentWatchdogHost } from "./watchdog"
import type { AgentInstruction, ExecutorResult, SuperAgentRun, TaskGraph } from "./types"

export const SuperAgentOutboxPublished = BusEvent.define(
  "super-agent.outbox.published",
  Schema.Struct({
    runID: Schema.String,
    eventID: Schema.String,
    sequence: Schema.Number,
    eventType: Schema.String,
    payload: Schema.Record(Schema.String, Schema.Unknown),
  }),
)

export type SuperAgentExecutionHostOptions = {
  registry: ToolRegistryInterface
  permission: PermissionInterface
  mcp?: MCPInterface
  delegation?: AgentRuntimeRegistry
  cleanup?: () => void
  /** Recover a Goal-linked run that committed before its start request finished. */
  recover?: (runID: string) => Promise<SuperAgentRun | undefined>
}

type SuperAgentHost = {
  outbox: SuperAgentOutboxHost
  watchdog: SuperAgentWatchdogHost
  execution?: SuperAgentExecutionHost
}

export type SuperAgentHostOptions = {
  externalPublisher?: SuperAgentEventPublisher
  execution?: SuperAgentExecutionHostOptions
}

const hosts = new Map<string, SuperAgentHost>()
const EXECUTION_INTERVAL_MS = 250
const DEFAULT_OPERATION_LEASE_MS = 60_000
const operationLeaseMs = () => {
  const configured = Number(process.env.NOVAWAY_SUPER_AGENT_OPERATION_LEASE_MS)
  return Number.isFinite(configured) && configured >= 1_000 ? Math.floor(configured) : DEFAULT_OPERATION_LEASE_MS
}
const log = Log.create({ service: "super-agent-execution" })

function configuredExternalPublisher() {
  const endpoint = process.env.NOVAWAY_SUPER_AGENT_OUTBOX_ENDPOINT
  if (!endpoint) return undefined
  return createSuperAgentExternalPublisher({
    endpoint,
    policy: {
      allowHttp: process.env.NOVAWAY_SUPER_AGENT_OUTBOX_ALLOW_HTTP === "1",
      allowPrivateNetwork: process.env.NOVAWAY_SUPER_AGENT_OUTBOX_ALLOW_PRIVATE_NETWORK === "1",
    },
  })
}

/**
 * Durable task worker. It dispatches persisted native-tool and Agent tasks;
 * model planning remains explicit, while a persisted task can resume after a
 * process restart or an approval gate without another UI request.
 */
function mergeGraphAfterConcurrentMutation(base: TaskGraph, desired: TaskGraph, current: TaskGraph): TaskGraph {
  const baseByID = new Map(base.nodes.map((node) => [node.id, node]))
  const desiredByID = new Map(desired.nodes.map((node) => [node.id, node]))
  const nodes = current.nodes.map((node) => {
    const original = baseByID.get(node.id)
    const changed = desiredByID.get(node.id)
    return original && changed && JSON.stringify(original) !== JSON.stringify(changed) ? changed : node
  })
  for (const node of desired.nodes) {
    if (!current.nodes.some((item) => item.id === node.id)) nodes.push(node)
  }
  const edgeKeys = new Set<string>()
  const edges = [...current.edges, ...desired.edges].filter((edge) => {
    const key = JSON.stringify(edge)
    if (edgeKeys.has(key)) return false
    edgeKeys.add(key)
    return true
  })
  return {
    ...current,
    nodes,
    edges,
    rootTaskID: current.rootTaskID || desired.rootTaskID,
    planHash: current.planHash || desired.planHash,
    version: current.version,
  }
}

async function persistGraphWithRetry(
  store: SuperAgentStoreInterface,
  run: SuperAgentRun,
  desired: TaskGraph,
): Promise<SuperAgentRun | undefined> {
  let current = run
  let candidate = desired
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const updated = await Effect.runPromise(store.updateGraph(run.id, candidate, current.graph.version))
      if (updated) return updated
    } catch (error) {
      if (!String(error).includes("version conflict")) throw error
    }
    const latest = await Effect.runPromise(store.get(run.id))
    if (!latest) return undefined
    current = latest
    candidate = mergeGraphAfterConcurrentMutation(run.graph, desired, latest.graph)
  }
  log.warn("durable worker graph update exhausted retries", { runID: run.id })
  return undefined
}

class SuperAgentExecutionHost {
  private timer: ReturnType<typeof setInterval> | undefined
  private ticking = false
  private readonly activeRuns = new Set<string>()

  constructor(
    private readonly store: SuperAgentStoreInterface,
    private readonly context: InstanceContext,
    private readonly options: SuperAgentExecutionHostOptions,
  ) {}

  start() {
    if (this.timer) return
    // Let the lifecycle request finish and persist its graph before the first
    // dispatch. This also gives a just-started process a clean recovery point.
    this.timer = setInterval(() => void this.tick(), EXECUTION_INTERVAL_MS)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.activeRuns.clear()
    this.ticking = false
    this.options.cleanup?.()
  }

  get active() {
    return this.timer !== undefined
  }

  private async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      const runs = await Effect.runPromise(this.store.list(this.context.directory))
      const candidates = []
      for (const run of runs) {
        if (this.activeRuns.has(run.id)) continue
        if (
          this.options.recover &&
          run.goal.goalId &&
          run.goal.sessionId &&
          (run.status === "draft" || run.status === "planning" || run.status === "ready")
        ) {
          try {
            const recovered = await this.options.recover(run.id)
            if (recovered) {
              if (recovered.status === "running" || recovered.status === "needs_review") candidates.push(recovered)
              continue
            }
          } catch (error) {
            log.warn("durable Goal startup recovery failed", { runID: run.id, error: String(error) })
          }
        }
        if (run.status === "running" || run.status === "needs_review") {
          candidates.push(run)
          continue
        }
        if (run.status === "waiting_approval") {
          const operations = await Effect.runPromise(this.store.operations(run.id))
          const recoverable = operations.filter(
            (operation) => operation.status === "started" || operation.status === "waiting",
          )
          if (recoverable.length > 0) {
            for (const operation of recoverable) {
              if (operation.status === "started") await Effect.runPromise(this.store.requeueOperation(operation.id))
            }
            candidates.push(run)
          }
        }
      }
      await Promise.all(
        candidates.map((run) => {
          this.activeRuns.add(run.id)
          return this.execute(run.id).finally(() => this.activeRuns.delete(run.id))
        }),
      )
    } catch (error) {
      log.warn("durable worker tick failed", { directory: this.context.directory, error: String(error) })
    } finally {
      this.ticking = false
    }
  }

  private async execute(runID: string) {
    const run = await Effect.runPromise(this.store.get(runID))
    if (
      !run ||
      !run.goal.sessionId ||
      (run.status !== "running" && run.status !== "waiting_approval" && run.status !== "needs_review")
    )
      return
    const decision = new DeterministicSupervisor().decide(run)
    const instruction = decision.instructions.find(
      (item): item is Extract<AgentInstruction, { type: "run_tool" | "call_agent" | "parallel_call_agents" }> =>
        item.type === "run_tool" || item.type === "call_agent" || item.type === "parallel_call_agents",
    )
    if (!instruction) return

    const task = run.graph.nodes.find((item) => item.id === instruction.taskID)
    const taskInput = task?.input && typeof task.input === "object" ? (task.input as Record<string, unknown>) : {}
    const store = this.store
    const permission = this.options.permission
    const sessionID = SessionID.make(run.goal.sessionId)
    const operationID = `${run.id}:tool:${instruction.instructionID}`
    const permissionRequestID = `per_${run.id}`
    const workerPermission = (request: Parameters<PermissionInterface["ask"]>[0]) =>
      Effect.gen(function* () {
        const current = yield* store.get(run.id)
        if (current?.status === "running")
          yield* store.transitionWithEvent(run.id, "waiting_approval", {
            type: "run_status_changed",
            at: Date.now(),
            payload: { from: "running", to: "waiting_approval", source: "permission-gate" },
          })
        const resume = Effect.gen(function* () {
          yield* store.resolveOperation(operationID, "started")
          yield* store.heartbeatOperation(operationID, operationLeaseMs())
          const latest = yield* store.get(run.id)
          if (latest?.status === "waiting_approval")
            yield* store.transitionWithEvent(run.id, "running", {
              type: "run_status_changed",
              at: Date.now(),
              payload: { from: "waiting_approval", to: "running", source: "permission-resolved" },
            })
        })
        yield* store.resolveOperation(operationID, "waiting", undefined, "permission request pending")
        return yield* permission
          .ask({
            ...request,
            id: PermissionID.make(permissionRequestID),
            sessionID,
            tool: {
              messageID: MessageID.make(`msg_${run.id}_worker_permission`),
              callID: instruction.instructionID,
            },
            ruleset: [],
          })
          .pipe(Effect.ensuring(resume))
      }).pipe(Effect.orDie)
    const executor = createNativeToolExecutorEffect({
      registry: this.options.registry,
      directory: this.context.directory,
      sessionID,
      messageID: MessageID.make(`msg_${run.id}_worker_${Date.now()}`),
      agent: "super-agent-worker",
      store: this.store,
      mcp: this.options.mcp,
      timeoutMs: typeof taskInput.timeoutMs === "number" ? taskInput.timeoutMs : undefined,
      leaseMs: operationLeaseMs(),
      ask: workerPermission,
    })
    const delegatedExecutor = this.options.delegation
      ? new SuperAgentDelegationCoordinator({
          runtimes: this.options.delegation,
          runtimeType:
            typeof taskInput.runtimeType === "string"
              ? taskInput.runtimeType
              : (this.options.delegation.list()[0]?.type ?? ""),
          store: this.store,
          timeoutMs: typeof taskInput.timeoutMs === "number" ? taskInput.timeoutMs : undefined,
          childBudget:
            taskInput.childBudget && typeof taskInput.childBudget === "object"
              ? (taskInput.childBudget as Record<string, number>)
              : undefined,
          securityPolicy: { allowedRuntimeTypes: this.options.delegation.list().map((runtime) => runtime.type) },
          maxParallelism: 8,
        }).executor()
      : undefined
    const runtime = new SuperAgentRuntime(run, new MemorySuperAgentJournal(), (nextInstruction, snapshot) => {
      if (nextInstruction.type === "call_agent" || nextInstruction.type === "parallel_call_agents") {
        if (!delegatedExecutor)
          return Promise.resolve({
            type: "agent_failed" as const,
            agentID: "super-agent-worker",
            code: "agent_runtime_unavailable",
            message: "no executable Agent runtime is installed",
          })
        return delegatedExecutor(nextInstruction, snapshot)
      }
      return Effect.runPromise(
        executor(nextInstruction, snapshot).pipe(Effect.provideService(InstanceRef, this.context)),
      )
    })
    let dispatched: ExecutorResult
    try {
      const result = await runtime.dispatch(instruction)
      dispatched = result.result
    } catch (error) {
      log.warn("durable worker dispatch failed", { runID, error: String(error) })
      return
    }

    if (dispatched.type === "unknown" && dispatched.reason.startsWith("operation is already")) return

    const next = runtime.snapshot()
    const updated = await persistGraphWithRetry(this.store, run, next.graph)
    if (!updated) return
    let latest = updated
    if (next.status !== run.status) {
      const transitioned = await Effect.runPromise(
        this.store.transitionWithEvent(run.id, next.status, {
          type: "run_status_changed",
          at: next.updatedAt,
          payload: { from: run.status, to: next.status, source: "durable-worker" },
        }),
      )
      if (transitioned) latest = transitioned.run
    }

    const successful = dispatched.type === "tool_completed" || dispatched.type === "agent_completed"
    const allTasksSucceeded =
      latest.graph.nodes.length > 0 &&
      latest.graph.nodes.every((item) => ["succeeded", "completed"].includes(item.status))
    const repairSucceeded = task?.kind === "repair" && successful
    if (successful && (allTasksSucceeded || repairSucceeded) && ["running", "needs_review"].includes(latest.status)) {
      const verifiers = new VerifierRegistry()
      verifiers.register(builtinTestVerifier)
      verifiers.register(builtinArtifactVerifier)
      await Effect.runPromise(
        new SuperAgentVerificationCoordinator(this.store, verifiers).verifyAndFinish({
          runID: latest.id,
          verifierID: "builtin.artifact",
          summary: repairSucceeded ? "durable repair completed" : "durable execution completed",
        }),
      ).catch((error) => log.warn("durable worker verification failed", { runID: latest.id, error: String(error) }))
    }
  }
}

/**
 * Starts the durable Super-Agent background workers for one NovaWay instance.
 * The instance registry stops all workers when that instance is disposed.
 */
export function ensureSuperAgentHost(
  ctx: InstanceContext,
  store: SuperAgentStoreInterface,
  options: SuperAgentHostOptions = {},
) {
  const existing = hosts.get(ctx.directory)
  if (existing) return existing
  const localPublisher: SuperAgentEventPublisher = (event) =>
    Effect.promise(() =>
      Bus.publish(ctx, SuperAgentOutboxPublished, {
        runID: event.runID,
        eventID: event.eventID,
        sequence: event.sequence,
        eventType: event.type,
        payload: event.payload,
      }),
    )
  const externalPublisher = options.externalPublisher ?? configuredExternalPublisher()
  const publisher: SuperAgentEventPublisher = externalPublisher
    ? (event) => externalPublisher(event).pipe(Effect.andThen(() => localPublisher(event)))
    : localPublisher
  const outbox = new SuperAgentOutboxHost(store, publisher, { directory: ctx.directory })
  const watchdog = new SuperAgentWatchdogHost(store, new SuperAgentWatchdog(store), { directory: ctx.directory })
  const execution = options.execution ? new SuperAgentExecutionHost(store, ctx, options.execution) : undefined
  const host = { outbox, watchdog, ...(execution ? { execution } : {}) }
  hosts.set(ctx.directory, host)
  outbox.start()
  watchdog.start()
  execution?.start()
  return host
}

registerDisposer(async (directory) => {
  const host = hosts.get(directory)
  if (!host) return
  host.outbox.stop()
  host.watchdog.stop()
  host.execution?.stop()
  hosts.delete(directory)
})

export function superAgentHostFor(directory: string) {
  return hosts.get(directory)
}

export function superAgentHostDiagnostics() {
  return {
    instances: hosts.size,
    activeOutboxWorkers: [...hosts.values()].filter((host) => host.outbox.active).length,
    activeWatchdogWorkers: [...hosts.values()].filter((host) => host.watchdog.active).length,
    activeExecutionWorkers: [...hosts.values()].filter((host) => host.execution?.active).length,
  }
}
