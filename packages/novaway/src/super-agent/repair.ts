import { Effect } from "effect"
import type { Interface as SuperAgentStoreInterface } from "./store"
import type { TaskNode, Verification, AgentInstruction, ExecutorResult, SuperAgentRun } from "./types"
import { DeterministicSupervisor } from "./supervisor"
import { MemorySuperAgentJournal, SuperAgentRuntime, type SuperAgentExecutor } from "./runtime"
import { TaskScheduler } from "./scheduler"
import { SuperAgentVerificationCoordinator } from "./verification-coordinator"
import type { VerifierRegistry } from "./verification"

export type SuperAgentEffectExecutor = (
  instruction: AgentInstruction,
  run: SuperAgentRun,
) => Effect.Effect<ExecutorResult>

export type RepairInput = { runID: string; failed: readonly Verification[]; sourceTask: TaskNode; input?: unknown }
export type RepairStrategy = { id: string; version: string; create(input: RepairInput): TaskNode }

export class RepairStrategyRegistry {
  private readonly entries = new Map<string, RepairStrategy>()
  register(strategy: RepairStrategy) {
    if (this.entries.has(strategy.id)) throw new Error(`repair strategy already registered: ${strategy.id}`)
    this.entries.set(strategy.id, strategy)
    return { dispose: () => this.entries.delete(strategy.id) }
  }
  resolve(id: string) {
    return this.entries.get(id)
  }
  list() {
    return [...this.entries.values()]
  }
  create(id: string, input: RepairInput) {
    const strategy = this.resolve(id)
    if (!strategy) throw new Error(`repair strategy not found: ${id}`)
    return strategy.create(input)
  }
}

export const builtinRepairStrategy: RepairStrategy = {
  id: "builtin.repair",
  version: "1",
  create(input) {
    const now = Date.now()
    const failureIDs = input.failed.map((failure) => failure.id)
    const sourceInput =
      input.sourceTask.input && typeof input.sourceTask.input === "object"
        ? (input.sourceTask.input as Record<string, unknown>)
        : {}
    return {
      ...input.sourceTask,
      id: `${input.sourceTask.id}:repair:${now}`,
      kind: "repair",
      title: `Repair: ${input.sourceTask.title}`,
      objective: `Repair failed acceptance criteria: ${failureIDs.join(", ")}`,
      status: "pending",
      dependencies: input.sourceTask.dependencies.slice(),
      input: input.input ?? {
        ...sourceInput,
        failedVerificationIDs: failureIDs,
        sourceTaskID: input.sourceTask.id,
        repairOf: input.sourceTask.id,
      },
      attempts: 0,
      evidenceIDs: [],
      verificationIDs: [],
      createdAt: now,
      updatedAt: now,
    }
  },
}

export class SuperAgentRepairCoordinator {
  constructor(
    private readonly store: SuperAgentStoreInterface,
    private readonly strategies: RepairStrategyRegistry,
  ) {}

  create(input: {
    runID: string
    sourceTaskID?: string
    failedVerificationIDs: readonly string[]
    strategyID: string
    input?: unknown
  }) {
    const store = this.store
    const strategies = this.strategies
    return Effect.gen(function* () {
      let run = yield* store.get(input.runID)
      if (!run) return yield* Effect.fail(new Error(`run not found: ${input.runID}`))
      if (run.status === "failed") {
        const recovered = yield* store.transitionWithEvent(run.id, "needs_review", {
          type: "run_status_changed",
          at: Date.now(),
          payload: { from: "failed", to: "needs_review", source: "repair-request" },
        })
        if (!recovered) return yield* Effect.fail(new Error(`run not found: ${input.runID}`))
        run = recovered.run
      }
      const failed = (yield* store.verifications(run.id)).filter((item) =>
        input.failedVerificationIDs.includes(item.id),
      )
      if (failed.length === 0) return yield* Effect.fail(new Error("no failed verification found"))
      const source =
        run.graph.nodes.find((item) => item.id === input.sourceTaskID) ??
        run.graph.nodes.find((item) => item.id === failed[0]?.taskID) ??
        run.graph.nodes.find((item) => item.id === run.graph.rootTaskID)
      if (!source) return yield* Effect.fail(new Error("repair source task not found"))
      const task = strategies.create(input.strategyID, { runID: run.id, failed, sourceTask: source, ...(input.input !== undefined ? { input: input.input } : {}) })
      const graph = {
        ...run.graph,
        version: run.graph.version + 1,
        nodes: [...run.graph.nodes, task],
        edges: [...run.graph.edges, { from: task.id, to: source.id, kind: "repairs" as const }],
      }
      const updated = yield* store.updateGraph(run.id, graph, run.graph.version)
      if (!updated) return yield* Effect.fail(new Error(`graph update conflict: ${run.id}`))
      yield* store.appendEvent({
        runID: run.id,
        type: "repair_task_created",
        at: Date.now(),
        payload: { taskID: task.id, sourceTaskID: source.id, verificationIDs: input.failedVerificationIDs },
      })
      // Creating a repair task is an explicit recovery action. Move only this
      // newly repaired run back to running; review-gated runs without an
      // explicit repair remain stopped and cannot be resumed by a worker scan.
      const resumed = updated.status === "needs_review"
        ? yield* store.transitionWithEvent(updated.id, "running", {
            type: "run_status_changed",
            at: Date.now(),
            payload: { from: "needs_review", to: "running", source: "repair-request" },
          })
        : undefined
      return { run: resumed?.run ?? updated, task }
    })
  }

  execute(input: { runID: string; taskID?: string; executor: SuperAgentExecutor }) {
    const store = this.store
    return Effect.gen(function* () {
      const run = yield* store.get(input.runID)
      if (!run) return yield* Effect.fail(new Error(`run not found: ${input.runID}`))
      const decision = new DeterministicSupervisor().decide(run)
      const instruction = decision.instructions.find(
        (candidate) => "taskID" in candidate && candidate.taskID === input.taskID,
      )
      if (!instruction || instruction.type === "checkpoint" || !("taskID" in instruction))
        return yield* Effect.fail(new Error(`repair task is not ready: ${input.taskID ?? "any"}`))
      const runtime = new SuperAgentRuntime(run, new MemorySuperAgentJournal(), input.executor)
      const dispatched = yield* Effect.tryPromise({
        try: () => runtime.dispatch(instruction),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
      const updated = yield* store.updateGraph(run.id, dispatched.run.graph, run.graph.version)
      if (!updated) return yield* Effect.fail(new Error(`graph update conflict: ${run.id}`))
      yield* store.appendEvent({
        runID: run.id,
        type: "repair_task_executed",
        at: Date.now(),
        payload: { taskID: instruction.taskID, resultType: dispatched.result.type },
      })
      return { run: updated, result: dispatched.result, taskID: instruction.taskID }
    })
  }

  executeEffect(input: { runID: string; taskID?: string; executor: SuperAgentEffectExecutor }) {
    const store = this.store
    return Effect.gen(function* () {
      const run = yield* store.get(input.runID)
      if (!run) return yield* Effect.fail(new Error(`run not found: ${input.runID}`))
      const instruction = new DeterministicSupervisor().decide(run).instructions.find(
        (candidate) => "taskID" in candidate && candidate.taskID === input.taskID,
      )
      if (!instruction || instruction.type === "checkpoint" || !("taskID" in instruction))
        return yield* Effect.fail(new Error(`repair task is not ready: ${input.taskID ?? "any"}`))
      const scheduler = new TaskScheduler(run)
      scheduler.start(instruction.taskID)
      const result = yield* input.executor(instruction, scheduler.snapshot())
      const status =
        result.type === "tool_completed" || result.type === "agent_completed"
          ? "succeeded"
          : result.type === "approval_required" || result.type === "input_required"
            ? "waiting"
            : result.type === "unknown"
              ? "needs_review"
              : "failed"
      scheduler.settle(instruction.taskID, status, "output" in result ? result.output : undefined)
      const graph = scheduler.snapshot().graph
      const task = graph.nodes.find((item) => item.id === instruction.taskID)
      if (task && (result.type === "tool_completed" || result.type === "agent_completed"))
        task.evidenceIDs = result.evidenceIDs ?? []
      const updated = yield* store.updateGraph(run.id, graph, run.graph.version)
      if (!updated) return yield* Effect.fail(new Error(`graph update conflict: ${run.id}`))
      yield* store.appendEvent({
        runID: run.id,
        type: "repair_task_executed",
        at: Date.now(),
        payload: { taskID: instruction.taskID, resultType: result.type },
      })
      return { run: updated, result, taskID: instruction.taskID }
    })
  }

  executeAndVerify(input: {
    runID: string
    taskID?: string
    executor: SuperAgentEffectExecutor
    verifiers: VerifierRegistry
    verifierID: string
    summary: string
  }) {
    const coordinator = this
    const store = this.store
    return Effect.gen(function* () {
      const execution = yield* coordinator.executeEffect({
        runID: input.runID,
        taskID: input.taskID,
        executor: input.executor,
      })
      const verification = yield* new SuperAgentVerificationCoordinator(store, input.verifiers).verifyAndFinish({
        runID: input.runID,
        verifierID: input.verifierID,
        summary: input.summary,
      })
      return { execution, verification }
    })
  }
}
