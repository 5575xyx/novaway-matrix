import { createHash } from "node:crypto"
import { assertMutableRun, assertTaskExists, canCompleteRun, transitionRun } from "./state"
import { TaskScheduler, transitionTask } from "./scheduler"
import { validateTaskGraph } from "./graph"
import {
  SUPER_AGENT_EVENT_VERSION,
  type AgentInstruction,
  type ExecutorResult,
  type Goal,
  type SuperAgentEvent,
  type SuperAgentRun,
  type Verification,
} from "./types"

export interface SuperAgentJournal {
  readonly append: (event: SuperAgentEvent) => void
  readonly events: () => readonly SuperAgentEvent[]
}

export class MemorySuperAgentJournal implements SuperAgentJournal {
  private readonly log: SuperAgentEvent[] = []
  append(event: SuperAgentEvent) {
    this.log.push(event)
  }
  events() {
    return this.log.slice()
  }
}

export type SuperAgentExecutor = (instruction: AgentInstruction, run: SuperAgentRun) => Promise<ExecutorResult>

export type SuperAgentInstructionPolicy = {
  allowedCapabilities: readonly string[]
  maxSteps?: number
}

export const defaultSuperAgentInstructionPolicy: SuperAgentInstructionPolicy = {
  allowedCapabilities: [
    "checkpoint",
    "agent",
    "task",
    "delegate",
    "tool",
    "approval",
    "input",
    "verify",
    "repair",
    "finish",
  ],
  maxSteps: 200,
}

export class SuperAgentRuntime {
  private sequence = 0
  private readonly instructionResults = new Map<string, ExecutorResult>()

  constructor(
    private run: SuperAgentRun,
    private readonly journal: SuperAgentJournal,
    private readonly executor?: SuperAgentExecutor,
    private readonly policy: SuperAgentInstructionPolicy = defaultSuperAgentInstructionPolicy,
  ) {}

  snapshot() {
    return structuredClone(this.run)
  }

  /** Reconciles the in-memory kernel with a durable graph after a checkpoint/restart write. */
  restore(run: SuperAgentRun) {
    if (run.id !== this.run.id) throw new Error(`cannot restore another Super-Agent run: ${run.id}`)
    this.run = structuredClone(run)
    return this.snapshot()
  }

  private emit(
    type: string,
    payload: Record<string, unknown> = {},
    idempotencyKey = `${this.run.id}:event:${this.sequence + 1}`,
  ) {
    const event: SuperAgentEvent = {
      eventID: `${this.run.id}:event:${this.sequence + 1}`,
      protocolVersion: SUPER_AGENT_EVENT_VERSION,
      idempotencyKey,
      runID: this.run.id,
      sequence: ++this.sequence,
      type,
      at: Date.now(),
      payload,
    }
    this.journal.append(event)
    return event
  }

  transition(status: SuperAgentRun["status"]) {
    this.run = transitionRun(this.run, status)
    this.emit("run_status_changed", { status })
    return this.snapshot()
  }

  async dispatch(instruction: AgentInstruction) {
    assertMutableRun(this.run)
    this.validateInstruction(instruction)
    if (this.policy.maxSteps !== undefined && this.run.usage.steps >= this.policy.maxSteps)
      throw new Error("Super-Agent step budget exceeded")
    const previous = this.instructionResults.get(instruction.idempotencyKey)
    if (previous) return { result: previous, run: this.snapshot(), duplicate: true as const }
    this.run = {
      ...this.run,
      usage: { ...this.run.usage, steps: this.run.usage.steps + 1 },
      updatedAt: Date.now(),
    }
    this.emit("instruction_issued", { instruction }, instruction.idempotencyKey)
    if (!this.executor) throw new Error("Super-Agent executor is not configured")
    if (instruction.type === "run_tool" || instruction.type === "call_agent" || instruction.type === "parallel_call_agents")
      this.startTask(instruction.taskID)
    const result = await this.executor(instruction, this.snapshot())
    this.instructionResults.set(instruction.idempotencyKey, result)
    this.applyResult(result, instruction)
    return { result, run: this.snapshot(), duplicate: false as const }
  }

  checkpoint(reason: string) {
    assertMutableRun(this.run)
    const id = `${this.run.id}:checkpoint:${this.sequence + 1}`
    this.run = { ...this.run, checkpointID: id, updatedAt: Date.now() }
    this.emit("checkpoint_created", { checkpointID: id, reason })
    return { id, run: this.snapshot() }
  }

  recordVerification(verification: Verification) {
    assertMutableRun(this.run)
    const task = verification.taskID ? assertTaskExists(this.run, verification.taskID) : undefined
    if (task && !task.verificationIDs.includes(verification.id)) task.verificationIDs.push(verification.id)
    this.emit("verification_recorded", { verificationID: verification.id, outcome: verification.outcome })
    return this.snapshot()
  }

  complete(verifications: readonly Verification[], summary: string) {
    this.run = transitionRun(this.run, "verifying")
    const result = canCompleteRun(this.run, verifications)
    if (!result.ok) {
      this.run = transitionRun(this.run, "needs_review")
      this.emit("completion_rejected", { reason: result.reason })
      return { completed: false as const, reason: result.reason, run: this.snapshot() }
    }
    this.run.completion = { summary, verificationIDs: verifications.map((item) => item.id) }
    this.run = transitionRun(this.run, "completed")
    this.emit("run_completed", { summary })
    return { completed: true as const, run: this.snapshot() }
  }

  private validateInstruction(instruction: AgentInstruction) {
    if (instruction.runID !== this.run.id) throw new Error("instruction has wrong runID")
    if (
      !instruction.instructionID ||
      !instruction.idempotencyKey ||
      !instruction.policyContextHash ||
      !instruction.capability
    )
      throw new Error("instruction metadata is incomplete")
    if (!this.policy.allowedCapabilities.includes(instruction.capability))
      throw new Error(`instruction capability denied: ${instruction.capability}`)
    if (!Number.isFinite(instruction.issuedAt)) throw new Error("instruction issuedAt is invalid")
    if ("taskID" in instruction && instruction.taskID) assertTaskExists(this.run, instruction.taskID)
    if (instruction.type === "spawn_task") assertTaskExists(this.run, instruction.parentTaskID)
    if (instruction.type === "checkpoint" && instruction.runID !== this.run.id)
      throw new Error("checkpoint has wrong runID")
  }

  private applyResult(result: ExecutorResult, instruction: AgentInstruction) {
    const taskID = "taskID" in instruction ? instruction.taskID : undefined
    if (result.type === "tool_completed") {
      this.run = {
        ...this.run,
        usage: { ...this.run.usage, toolCalls: this.run.usage.toolCalls + 1 },
        updatedAt: Date.now(),
      }
      if (taskID) this.settleTask(taskID, "succeeded", result.output, result.evidenceIDs)
      this.emit("tool_completed", {
        taskID,
        tool: result.tool,
        evidenceIDs: result.evidenceIDs ?? [],
      })
      return
    }
    if (result.type === "agent_completed") {
      if (taskID) this.settleTask(taskID, "succeeded", result.output, result.evidenceIDs)
      this.emit("agent_completed", { taskID, agentID: result.agentID, evidenceIDs: result.evidenceIDs ?? [] })
      return
    }
    if (result.type === "unknown") {
      if (taskID) this.settleTask(taskID, "needs_review")
      this.run = transitionRun(this.run, "needs_review")
      this.emit("operation_unknown", { operationID: result.operationID, reason: result.reason })
      return
    }
    if (result.type === "approval_required") {
      if (taskID) this.settleTask(taskID, "waiting")
      this.run = transitionRun(this.run, "waiting_approval")
      this.emit("approval_requested", { requestID: result.requestID })
      return
    }
    if (result.type === "input_required") {
      if (taskID) this.settleTask(taskID, "waiting")
      this.run = transitionRun(this.run, "waiting_input")
      this.emit("input_requested", { requestID: result.requestID })
      return
    }
    if (result.type === "agent_failed") {
      if (taskID) this.settleTask(taskID, "failed")
      const failedTask = taskID ? this.run.graph.nodes.find((task) => task.id === taskID) : undefined
      if (
        taskID &&
        failedTask &&
        failedTask.retryPolicy.retryable &&
        failedTask.attempts < failedTask.retryPolicy.maxAttempts
      ) {
        const scheduler = new TaskScheduler(this.run)
        const retry = scheduler.retry(taskID)
        this.run = scheduler.snapshot()
        this.emit("task_retry_scheduled", {
          taskID,
          attempt: retry.attempts,
          retryAt: retry.retryAt,
          reason: result.message,
        })
        return
      }
      const hasOtherWork = taskID
        ? this.run.graph.nodes.some(
            (task) =>
              task.id !== taskID && ["pending", "ready", "running", "waiting", "retrying"].includes(task.status),
          )
        : false
      this.run = transitionRun(this.run, hasOtherWork ? "needs_review" : "failed")
      this.run.failure = { code: result.code, message: result.message }
      this.emit("run_failed", { code: result.code, message: result.message, deferred: hasOtherWork })
      return
    }
    this.emit("executor_completed", { type: result.type })
  }

  private startTask(taskID: string) {
    const task = assertTaskExists(this.run, taskID)
    let next = task
    if (next.status === "pending") next = transitionTask(next, "ready")
    if (next.status === "ready") next = transitionTask(next, "running")
    this.replaceTask(next)
  }

  private settleTask(
    taskID: string,
    status: "succeeded" | "failed" | "waiting" | "needs_review",
    output?: unknown,
    evidenceIDs?: readonly string[],
  ) {
    const task = assertTaskExists(this.run, taskID)
    const next = transitionTask(
      {
        ...task,
        ...(output === undefined ? {} : { output }),
        ...(evidenceIDs === undefined ? {} : { evidenceIDs }),
      },
      status,
    )
    this.replaceTask(next)
  }

  private replaceTask(task: SuperAgentRun["graph"]["nodes"][number]) {
    this.run = {
      ...this.run,
      graph: { ...this.run.graph, nodes: this.run.graph.nodes.map((item) => (item.id === task.id ? task : item)) },
      updatedAt: task.updatedAt,
    }
  }

  static create(
    input: {
      id: string
      goal: Goal
      budget?: SuperAgentRun["budget"]
      task?: { id: string; title: string; objective: string }
    },
    journal = new MemorySuperAgentJournal(),
  ) {
    const now = Date.now()
    const task = input.task ?? { id: `${input.id}:root`, title: "Root task", objective: input.goal.text }
    const graphID = `${input.id}:graph`
    const plan = input.goal.plan?.length ? input.goal.plan : undefined
    const nodes = plan
      ? plan.map((item) => ({
          id: item.id,
          graphID,
          kind: item.kind,
          title: item.title,
          objective: item.objective,
          status: "pending" as const,
          dependencies: [...(item.dependencies ?? [])],
          ...(item.input === undefined ? {} : { input: item.input }),
          acceptanceCriteria: [...(item.acceptanceCriteria ?? [])],
          retryPolicy: item.retryPolicy ?? { maxAttempts: 1, backoffMs: 0, retryable: false },
          attempts: 0,
          evidenceIDs: [],
          verificationIDs: [],
          createdAt: now,
          updatedAt: now,
        }))
      : [
          {
            id: task.id,
            graphID,
            kind: "root",
            title: task.title,
            objective: task.objective,
            status: "pending" as const,
            dependencies: [],
            acceptanceCriteria: input.goal.acceptanceCriteria,
            retryPolicy: { maxAttempts: 1, backoffMs: 0, retryable: false },
            attempts: 0,
            evidenceIDs: [],
            verificationIDs: [],
            createdAt: now,
            updatedAt: now,
          },
        ]
    const rootTaskID = nodes[0]!.id
    const graph = validateTaskGraph({
      id: graphID,
      version: 1,
      nodes,
      edges: nodes.flatMap((node) =>
        node.dependencies.map((dependency) => ({ from: node.id, to: dependency, kind: "depends_on" as const })),
      ),
      rootTaskID,
      planHash: plan ? createHash("sha256").update(JSON.stringify(plan)).digest("hex") : "initial",
    })
    const run: SuperAgentRun = {
      id: input.id,
      goal: input.goal,
      status: "draft",
      graph,
      budget: input.budget ?? {},
      usage: { tokens: 0, usd: 0, wallTimeMs: 0, steps: 0, toolCalls: 0, childAgents: 0 },
      createdAt: now,
      updatedAt: now,
    }
    return { runtime: new SuperAgentRuntime(run, journal), journal }
  }
}
