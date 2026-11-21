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
import { builtinArtifactVerifier, builtinTestVerifier, VerifierRegistry, type Verifier, type VerifierResult } from "./verification"
import { DeterministicSupervisor } from "./supervisor"
import { MemorySuperAgentJournal, SuperAgentRuntime } from "./runtime"
import { SuperAgentWatchdog, SuperAgentWatchdogHost } from "./watchdog"
import type { AgentInstruction, ExecutorResult, SuperAgentRun, TaskGraph } from "./types"
import { nextTaskGraph } from "./graph"

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
  /** Execute the configured model-backed durable Goal verifier. */
  judge?: (input: {
    run: SuperAgentRun
    criterion: Parameters<Verifier["verify"]>[0]["criterion"]
    evidence: Parameters<Verifier["verify"]>[0]["evidence"]
  }) => Promise<VerifierResult>
  /** Re-plan after an exhausted task failure while preserving terminal work. */
  replan?: (input: { run: SuperAgentRun; reason: string }) => Promise<TaskGraph | undefined>
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
const DEFAULT_RUN_LEASE_MS = 30_000
const operationLeaseMs = () => {
  const configured = Number(process.env.NOVAWAY_SUPER_AGENT_OPERATION_LEASE_MS)
  return Number.isFinite(configured) && configured >= 1_000 ? Math.floor(configured) : DEFAULT_OPERATION_LEASE_MS
}
const runLeaseMs = () => {
  const configured = Number(process.env.NOVAWAY_SUPER_AGENT_RUN_LEASE_MS)
  return Number.isFinite(configured) && configured >= 5_000 ? Math.floor(configured) : DEFAULT_RUN_LEASE_MS
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

function mergeReplannedGraph(current: TaskGraph, planned: TaskGraph): TaskGraph | undefined {
  const terminal = current.nodes.filter((task) => ["succeeded", "completed"].includes(task.status))
  const terminalIDs = new Set(terminal.map((task) => task.id))
  const replanned = planned.nodes.filter((task) => !terminalIDs.has(task.id))
  if (replanned.length === 0) return undefined
  const nodes = [...terminal, ...replanned]
  const nodeIDs = new Set(nodes.map((task) => task.id))
  const edges = planned.edges.filter((edge) => nodeIDs.has(edge.from) && nodeIDs.has(edge.to))
  const rootTaskID = nodeIDs.has(current.rootTaskID) ? current.rootTaskID : planned.rootTaskID
  return nextTaskGraph(
    current,
    { ...current, nodes, edges, rootTaskID, planHash: planned.planHash, version: current.version },
    current.version,
  )
}

class SuperAgentExecutionHost {
  private timer: ReturnType<typeof setInterval> | undefined
  private ticking = false
  private readonly activeRuns = new Set<string>()
  private readonly runAborts = new Map<string, AbortController>()
  private readonly owner = `sa-host:${process.pid}:${Math.random().toString(36).slice(2, 10)}`

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
    for (const abort of this.runAborts.values()) abort.abort()
    this.runAborts.clear()
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
              // A recovered review-gated run must wait for an explicit human
              // resume or verify-finish action. Only a run that is already
              // running may be dispatched automatically; otherwise a restart
              // could silently bypass an unknown side-effect boundary.
              if (recovered.status === "running") candidates.push(recovered)
              continue
            }
          } catch (error) {
            log.warn("durable Goal startup recovery failed", { runID: run.id, error: String(error) })
          }
        }
        if (run.status === "running") {
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
    const leaseMs = runLeaseMs()
    const leaseStore = this.store as SuperAgentStoreInterface & {
      claimRunLease?: SuperAgentStoreInterface["claimRunLease"]
      renewRunLease?: SuperAgentStoreInterface["renewRunLease"]
      releaseRunLease?: SuperAgentStoreInterface["releaseRunLease"]
    }
    const claimed = leaseStore.claimRunLease
      ? await Effect.runPromise(leaseStore.claimRunLease({ runID, owner: this.owner, leaseMs }))
      : true
    if (!claimed) return

    let leaseLost = false
    const heartbeat = leaseStore.renewRunLease
      ? setInterval(() => {
          void Effect.runPromise(
            leaseStore.renewRunLease!({ runID, owner: this.owner, leaseMs }),
          )
            .then((renewed) => {
              if (!renewed) leaseLost = true
            })
            .catch(() => {
              leaseLost = true
            })
        }, Math.max(1_000, Math.floor(leaseMs / 3)))
      : undefined
    try {
      await this.executeClaimed(runID, () => leaseLost)
    } finally {
      if (heartbeat) clearInterval(heartbeat)
      if (leaseStore.releaseRunLease)
        await Effect.runPromise(leaseStore.releaseRunLease({ runID, owner: this.owner })).catch(() => false)
    }
  }

  private async executeClaimed(runID: string, leaseLost: () => boolean) {
    const run = await Effect.runPromise(this.store.get(runID))
    if (
      !run ||
      !run.goal.sessionId ||
      (run.status !== "running" && run.status !== "waiting_approval" && run.status !== "needs_review")
    )
      return

    const executionConfig = run.goal.executionConfig
    const attempts = run.graph.nodes.reduce((sum, task) => sum + task.attempts, 0)
    const stopForBudget = async (reason: string) => {
      const current = await Effect.runPromise(this.store.get(run.id))
      if (!current || current.status !== "running") return
      const checkpoint = await Effect.runPromise(this.store.checkpoint(run.id, reason))
      if (!checkpoint) return
      await Effect.runPromise(
        this.store.transitionWithEvent(run.id, "paused", {
          type: "run_budget_exhausted",
          at: Date.now(),
          payload: { reason, checkpointID: checkpoint.id },
        }),
      )
    }

    // Durable execution must enforce the profile captured on Goal launch. A
    // missing/zero maxIterations means model-driven continuation, but the
    // caller can still provide a finite safety limit. Do this before dispatch
    // so a restart cannot spend one extra operation beyond the limit.
    if (
      executionConfig?.maxTokens !== undefined &&
      executionConfig.maxTokens > 0 &&
      run.usage.tokens >= executionConfig.maxTokens
    ) {
      await stopForBudget("durable Goal token budget exhausted")
      return
    }
    if (executionConfig?.maxActiveMs !== undefined && Date.now() - run.createdAt >= executionConfig.maxActiveMs) {
      await stopForBudget("durable Goal wall-time budget exhausted")
      return
    }
    if (
      executionConfig?.maxIterations !== undefined &&
      executionConfig.maxIterations > 0 &&
      attempts >= executionConfig.maxIterations
    ) {
      await stopForBudget("durable Goal iteration budget exhausted")
      return
    }

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
    const runAbort = new AbortController()
    this.runAborts.set(run.id, runAbort)
    const runMonitor = setInterval(() => {
      void Effect.runPromise(this.store.get(run.id))
        .then((current) => {
          if (leaseLost() || current?.status === "cancelled" || current?.status === "cancelling") runAbort.abort()
        })
        .catch(() => undefined)
    }, 250)
    const executor = createNativeToolExecutorEffect({
      registry: this.options.registry,
      directory: this.context.directory,
      sessionID,
      messageID: MessageID.make(`msg_${run.id}_worker_${Date.now()}`),
      agent: "super-agent-worker",
      abort: runAbort.signal,
      store: this.store,
      mcp: this.options.mcp,
      evidenceKind:
        taskInput.evidenceKind === "test" ||
        taskInput.evidenceKind === "file" ||
        taskInput.evidenceKind === "artifact" ||
        taskInput.evidenceKind === "http" ||
        taskInput.evidenceKind === "log" ||
        taskInput.evidenceKind === "screenshot" ||
        taskInput.evidenceKind === "external" ||
        taskInput.evidenceKind === "human"
          ? taskInput.evidenceKind
          : undefined,
      acceptanceIDs: task?.acceptanceCriteria.map((criterion) => criterion.id),
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
          abort: runAbort.signal,
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
    } finally {
      clearInterval(runMonitor)
      this.runAborts.delete(run.id)
    }

    if (dispatched.type === "unknown" && dispatched.reason.startsWith("operation is already")) return
    if (leaseLost()) return

    const next = runtime.snapshot()
    const updated = await persistGraphWithRetry(this.store, run, next.graph)
    if (!updated) return

    // Do not let a stale worker resurrect a user pause/cancel that happened
    // while the tool was in flight. Graph persistence is still useful for
    // recovery, but status transitions must be based on the latest durable row.
    const observed = await Effect.runPromise(this.store.get(run.id))
    if (!observed || observed.status === "cancelled" || observed.status === "cancelling" || observed.status === "paused")
      return

    let latest = updated
    if (next.status !== run.status && observed.status === run.status) {
      const transitioned = await Effect.runPromise(
        this.store.transitionWithEvent(run.id, next.status, {
          type: "run_status_changed",
          at: next.updatedAt,
          payload: { from: run.status, to: next.status, source: "durable-worker" },
        }),
      )
      if (transitioned) latest = transitioned.run
    } else {
      latest = observed
    }

    if (
      next.status === "failed" &&
      latest.status === "failed" &&
      latest.goal.planningMode === "model" &&
      this.options.replan
    ) {
      const reason = dispatched.type === "agent_failed" ? dispatched.message : "durable task execution failed"
      try {
        const planned = await this.options.replan({ run: latest, reason })
        const merged = planned ? mergeReplannedGraph(latest.graph, planned) : undefined
        if (merged) {
          const replanned = await Effect.runPromise(this.store.updateGraph(latest.id, merged, latest.graph.version))
          if (replanned) {
            await Effect.runPromise(
              this.store.appendEvent({
                runID: latest.id,
                type: "dynamic_replan_created",
                at: Date.now(),
                payload: { reason, graphVersion: replanned.graph.version },
              }),
            )
            const review = await Effect.runPromise(
              this.store.transitionWithEvent(latest.id, "needs_review", {
                type: "run_status_changed",
                at: Date.now(),
                payload: { from: "failed", to: "needs_review", source: "dynamic-replan" },
              }),
            )
            if (review) {
              await Effect.runPromise(
                this.store.transitionWithEvent(latest.id, "running", {
                  type: "run_status_changed",
                  at: Date.now(),
                  payload: { from: "needs_review", to: "running", source: "dynamic-replan" },
                }),
              )
            }
          }
        }
      } catch (error) {
        log.warn("durable dynamic re-plan failed", { runID: latest.id, error: String(error) })
      }
      return
    }

    const successful = dispatched.type === "tool_completed" || dispatched.type === "agent_completed"
    const allTasksSucceeded =
      latest.graph.nodes.length > 0 &&
      latest.graph.nodes.every((item) => ["succeeded", "completed"].includes(item.status))
    const repairSucceeded = task?.kind === "repair" && successful
    if (successful && (allTasksSucceeded || repairSucceeded) && ["running", "needs_review"].includes(latest.status)) {
      const configuredVerifier = latest.goal.executionConfig?.verifier
      if (configuredVerifier === "judge") {
        if (!this.options.judge) {
          await Effect.runPromise(
            this.store.transitionWithEvent(latest.id, "needs_review", {
              type: "verification_required",
              at: Date.now(),
              payload: { verifier: "judge", reason: "no durable judge model is configured" },
            }),
          ).catch((error) => log.warn("durable judge gate failed", { runID: latest.id, error: String(error) }))
          return
        }
        const judgeVerifier: Verifier = {
          id: "builtin.judge",
          version: "1",
          verify: (input) => this.options.judge!({ run: latest, criterion: input.criterion, evidence: input.evidence }),
        }
        const verifiers = new VerifierRegistry()
        verifiers.register(judgeVerifier)
        await Effect.runPromise(
          new SuperAgentVerificationCoordinator(this.store, verifiers).verifyAndFinish({
            runID: latest.id,
            verifierID: judgeVerifier.id,
            summary: repairSucceeded ? "durable judge repair verified" : "durable judge verification completed",
          }),
        ).catch((error) => log.warn("durable judge verification failed", { runID: latest.id, error: String(error) }))
        return
      }
      if (configuredVerifier === "agent") {
        if (!delegatedExecutor) {
          await Effect.runPromise(
            this.store.transitionWithEvent(latest.id, "needs_review", {
              type: "verification_required",
              at: Date.now(),
              payload: { verifier: "agent", reason: "no executable verification Agent is installed" },
            }),
          ).catch((error) => log.warn("durable verification gate failed", { runID: latest.id, error: String(error) }))
          return
        }

        const agentVerifier: Verifier = {
          id: "builtin.agent",
          version: "1",
          verify: async (input) => {
            const reportInstruction: AgentInstruction = {
              type: "call_agent",
              runID: latest.id,
              taskID: task?.id ?? latest.graph.rootTaskID,
              agentID: "verification-agent",
              instruction: [
                "Verify one durable Goal acceptance criterion.",
                "Return JSON only: { outcome: pass|fail|unverified, evidenceIDs: string[], reason: string }.",
                "You may only cite the supplied Evidence IDs; never invent evidence.",
                `Criterion ${input.criterion.id}: ${input.criterion.text}`,
                `Evidence: ${JSON.stringify(input.evidence)}`,
              ].join("\n"),
              instructionID: `${latest.id}:agent-verification:${input.criterion.id}:${Date.now()}`,
              issuedAt: Date.now(),
              policyContextHash: "builtin.agent-verifier:v1",
              capability: "agent",
              idempotencyKey: `${latest.id}:agent-verification:${input.criterion.id}:${Date.now()}`,
            }
            try {
              const result = await delegatedExecutor(reportInstruction, latest)
              if (result.type !== "agent_completed")
                return { outcome: "unverified", evidenceIDs: [], reason: "verification Agent did not return a report" }
              const raw = result.output
              const report = typeof raw === "string" ? JSON.parse(raw) : raw
              if (!report || typeof report !== "object")
                return { outcome: "unverified", evidenceIDs: [], reason: "verification Agent returned an invalid report" }
              const value = report as { outcome?: unknown; evidenceIDs?: unknown; reason?: unknown }
              const evidenceIDs = Array.isArray(value.evidenceIDs)
                ? value.evidenceIDs.filter((item): item is string => typeof item === "string")
                : []
              const available = new Set(input.evidence.map((item) => item.id))
              if (evidenceIDs.some((evidenceID) => !available.has(evidenceID)))
                return { outcome: "unverified", evidenceIDs: [], reason: "verification Agent cited unknown Evidence" }
              const outcome = value.outcome
              if (outcome !== "pass" && outcome !== "fail" && outcome !== "unverified")
                return { outcome: "unverified", evidenceIDs: [], reason: "verification Agent returned an invalid outcome" }
              if (outcome === "pass" && evidenceIDs.length === 0)
                return { outcome: "unverified", evidenceIDs: [], reason: "verification Agent passed without Evidence" }
              return {
                outcome,
                evidenceIDs,
                reason: typeof value.reason === "string" ? value.reason : "verification Agent report",
              }
            } catch (error) {
              return { outcome: "unverified", evidenceIDs: [], reason: `verification Agent failed: ${String(error)}` }
            }
          },
        }
        const verifiers = new VerifierRegistry()
        verifiers.register(agentVerifier)
        await Effect.runPromise(
          new SuperAgentVerificationCoordinator(this.store, verifiers).verifyAndFinish({
            runID: latest.id,
            verifierID: agentVerifier.id,
            summary: repairSucceeded ? "durable Agent repair verified" : "durable Agent verification completed",
          }),
        ).catch((error) => log.warn("durable Agent verification failed", { runID: latest.id, error: String(error) }))
        return
      }
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
