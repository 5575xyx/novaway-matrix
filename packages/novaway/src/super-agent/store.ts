import { Context, Effect, Layer } from "effect"
import { asc, desc, eq, max, and, lt, lte, gt, inArray, isNull, or } from "drizzle-orm"
import { Database, type TxOrDb } from "@/storage/db"
import {
  SuperAgentApprovalTable,
  SuperAgentBudgetReservationTable,
  SuperAgentCheckpointTable,
  SuperAgentInputTable,
  SuperAgentEventTable,
  SuperAgentEventOutboxTable,
  SuperAgentTaskMutationTable,
  SuperAgentEvidenceTable,
  SuperAgentOperationTable,
  SuperAgentRunTable,
  SuperAgentVerificationTable,
} from "./super-agent.sql"
import { GoalTable } from "@/session/goal.sql"
import { transitionRun, canCompleteRun } from "./state"
import { nextTaskGraph, replayTaskMutations, validateTaskGraph } from "./graph"
import { addBudget, assertWithinBudget } from "./budget"
import { verificationOutcomeAt } from "./validity"
import { SuperAgentRuntime } from "./runtime"
import { projectTaskGraph } from "./task-projection"
import {
  SUPER_AGENT_EVENT_VERSION,
  type ApprovalRequest,
  type Budget,
  type BudgetReservation,
  type Goal,
  type InputRequest,
  type Evidence,
  type SuperAgentCheckpoint,
  type SuperAgentEvent,
  type SuperAgentEventInput,
  type SuperAgentOperation,
  type SuperAgentRun,
  type Verification,
} from "./types"

export type StoredSuperAgentRun = SuperAgentRun & { directory: string }

export type SuperAgentOutboxRecord = {
  eventID: string
  runID: string
  sequence: number
  type: string
  payload: Record<string, unknown>
  status: "pending" | "acked"
  attempts: number
  nextAttemptAt: number
  lastError?: string
  createdAt: number
  updatedAt: number
}

export type SuperAgentTaskMutation = {
  id: number
  runID: string
  graphVersion: number
  taskID: string
  fromStatus?: string
  toStatus: string
  before?: unknown
  after: unknown
  createdAt: number
}
export interface Interface {
  readonly create: (input: {
    id: string
    directory: string
    goal: Goal
    budget?: Budget
  }) => Effect.Effect<StoredSuperAgentRun>
  /**
   * Create a durable run and bind it to a Goal in one SQLite transaction.
   * Returning the already linked run makes retries safe across UI refreshes,
   * duplicate HTTP requests, and process races.
   */
  readonly createLinked: (input: {
    id: string
    directory: string
    goal: Goal
    budget?: Budget
    goalId: string
    sessionId: string
    executionConfig: Record<string, unknown>
  }) => Effect.Effect<StoredSuperAgentRun | undefined>
  /** Create the Goal row, Durable Run, and binding in one transaction. */
  readonly createGoalLinked: (input: {
    id: string
    directory: string
    goal: Goal
    budget?: Budget
    goalId: string
    sessionId: string
    title: string
    description?: string
    priority?: "high" | "medium" | "low"
    successCriteria?: string[]
    deadline?: Date
    tags?: string[]
    executionConfig: Record<string, unknown>
  }) => Effect.Effect<StoredSuperAgentRun | undefined>
  readonly get: (id: string) => Effect.Effect<StoredSuperAgentRun | undefined>
  /** Atomically claims the durable worker lease, allowing takeover only after expiry. */
  readonly claimRunLease: (input: {
    runID: string
    owner: string
    leaseMs: number
    now?: number
  }) => Effect.Effect<boolean>
  readonly renewRunLease: (input: {
    runID: string
    owner: string
    leaseMs: number
    now?: number
  }) => Effect.Effect<boolean>
  readonly releaseRunLease: (input: { runID: string; owner: string }) => Effect.Effect<boolean>
  readonly list: (directory: string) => Effect.Effect<StoredSuperAgentRun[]>
  readonly listAll: (limit?: number) => Effect.Effect<StoredSuperAgentRun[]>
  readonly appendEvent: (event: SuperAgentEventInput) => Effect.Effect<SuperAgentEvent>
  readonly events: (id: string, after?: number, limit?: number) => Effect.Effect<SuperAgentEvent[]>
  readonly outbox: (id: string, limit?: number, at?: number) => Effect.Effect<SuperAgentOutboxRecord[]>
  readonly ackOutbox: (eventID: string) => Effect.Effect<SuperAgentOutboxRecord | undefined>
  readonly failOutbox: (
    eventID: string,
    error: string,
    retryAt: number,
  ) => Effect.Effect<SuperAgentOutboxRecord | undefined>
  readonly checkpoint: (runID: string, reason: string) => Effect.Effect<SuperAgentCheckpoint | undefined>
  readonly getCheckpoint: (id: string) => Effect.Effect<SuperAgentCheckpoint | undefined>
  readonly beginOperation: (input: {
    id: string
    runID: string
    instructionID: string
    idempotencyKey: string
    leaseMs: number
  }) => Effect.Effect<SuperAgentOperation & { acquired: boolean }>
  readonly resolveOperation: (
    id: string,
    status: SuperAgentOperation["status"],
    result?: unknown,
    reason?: string,
  ) => Effect.Effect<SuperAgentOperation | undefined>
  readonly heartbeatOperation: (id: string, leaseMs: number) => Effect.Effect<SuperAgentOperation | undefined>
  readonly operations: (runID: string) => Effect.Effect<SuperAgentOperation[]>
  readonly requeueOperation: (id: string, reason?: string) => Effect.Effect<SuperAgentOperation | undefined>
  readonly recoverExpiredOperations: (runID?: string, at?: number) => Effect.Effect<SuperAgentOperation[]>
  readonly reserveBudget: (runID: string, id: string, requested: Budget) => Effect.Effect<BudgetReservation>
  readonly settleBudget: (id: string, settled: Budget) => Effect.Effect<BudgetReservation | undefined>
  readonly releaseBudget: (id: string) => Effect.Effect<BudgetReservation | undefined>
  readonly reservations: (runID: string) => Effect.Effect<BudgetReservation[]>
  readonly createApproval: (input: Omit<ApprovalRequest, "createdAt" | "updatedAt">) => Effect.Effect<ApprovalRequest>
  readonly decideApproval: (
    id: string,
    status: "approved" | "rejected",
    decidedBy: string,
    reason?: string,
  ) => Effect.Effect<ApprovalRequest | undefined>
  readonly approvals: (runID: string) => Effect.Effect<ApprovalRequest[]>
  readonly createInput: (input: Omit<InputRequest, "createdAt" | "updatedAt">) => Effect.Effect<InputRequest>
  readonly answerInput: (id: string, answer: string) => Effect.Effect<InputRequest | undefined>
  readonly inputs: (runID: string) => Effect.Effect<InputRequest[]>
  readonly evidence: (evidence: Evidence) => Effect.Effect<Evidence>
  readonly evidences: (runID: string) => Effect.Effect<Evidence[]>
  readonly verification: (verification: Verification) => Effect.Effect<Verification>
  readonly verifications: (runID: string) => Effect.Effect<Verification[]>
  readonly transition: (id: string, status: SuperAgentRun["status"]) => Effect.Effect<StoredSuperAgentRun | undefined>
  readonly transitionWithEvent: (
    id: string,
    status: SuperAgentRun["status"],
    event: Omit<SuperAgentEventInput, "runID">,
  ) => Effect.Effect<{ run: StoredSuperAgentRun; event: SuperAgentEvent } | undefined>
  readonly updateGraph: (
    id: string,
    graph: SuperAgentRun["graph"],
    expectedVersion: number,
  ) => Effect.Effect<StoredSuperAgentRun | undefined>
  /** Rebuild the task-board projection from the durable graph. */
  readonly rebuildTaskProjection: (runID: string) => Effect.Effect<boolean>
  readonly rebuildTaskProjections: (directory?: string) => Effect.Effect<number>
  readonly taskMutations: (runID: string, taskID?: string, limit?: number) => Effect.Effect<SuperAgentTaskMutation[]>
}

export class Service extends Context.Service<Service, Interface>()("@novaway/SuperAgentStore") {}

const now = () => Date.now()
const id = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

function fromRow(row: typeof SuperAgentRunTable.$inferSelect): StoredSuperAgentRun {
  return {
    id: row.id,
    directory: row.directory,
    goal: row.goal_json as Goal,
    status: row.status as SuperAgentRun["status"],
    graph: row.graph_json as SuperAgentRun["graph"],
    budget: row.budget_json as Budget,
    usage: row.usage_json as SuperAgentRun["usage"],
    ...(row.checkpoint_id ? { checkpointID: row.checkpoint_id } : {}),
    ...(row.failure_json ? { failure: row.failure_json as SuperAgentRun["failure"] } : {}),
    ...(row.completion_json ? { completion: row.completion_json as SuperAgentRun["completion"] } : {}),
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

function fromEventRow(row: typeof SuperAgentEventTable.$inferSelect): SuperAgentEvent {
  return {
    eventID: row.event_id,
    protocolVersion: row.protocol_version as typeof SUPER_AGENT_EVENT_VERSION,
    idempotencyKey: row.idempotency_key ?? row.event_id,
    runID: row.run_id,
    sequence: row.sequence,
    type: row.type,
    at: row.time_created,
    payload: row.payload_json as Record<string, unknown>,
  }
}

function fromOutboxRow(row: typeof SuperAgentEventOutboxTable.$inferSelect): SuperAgentOutboxRecord {
  return {
    eventID: row.event_id,
    runID: row.run_id,
    sequence: row.sequence,
    type: row.type,
    payload: row.payload_json as Record<string, unknown>,
    status: row.status as "pending" | "acked",
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

function fromCheckpointRow(row: typeof SuperAgentCheckpointTable.$inferSelect): SuperAgentCheckpoint {
  return {
    id: row.id,
    runID: row.run_id,
    reason: row.reason,
    eventSequence: row.event_sequence,
    stateVersion: row.state_version,
    run: row.snapshot_json as SuperAgentRun,
    createdAt: row.time_created,
  }
}

function fromOperationRow(row: typeof SuperAgentOperationTable.$inferSelect): SuperAgentOperation {
  return {
    id: row.id,
    runID: row.run_id,
    instructionID: row.instruction_id,
    idempotencyKey: row.idempotency_key,
    status: row.status as SuperAgentOperation["status"],
    leaseUntil: row.lease_until,
    startedAt: row.time_started,
    updatedAt: row.time_updated,
    ...(row.result_json ? { result: row.result_json as SuperAgentOperation["result"] } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
  }
}

function fromApprovalRow(row: typeof SuperAgentApprovalTable.$inferSelect): ApprovalRequest {
  return {
    id: row.id,
    runID: row.run_id,
    taskID: row.task_id,
    reason: row.reason,
    scope: row.scope,
    status: row.status as ApprovalRequest["status"],
    ...(row.decided_by ? { decidedBy: row.decided_by } : {}),
    ...(row.decision_reason ? { decisionReason: row.decision_reason } : {}),
    ...(row.time_expires ? { expiresAt: row.time_expires } : {}),
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

function fromInputRow(row: typeof SuperAgentInputTable.$inferSelect): InputRequest {
  return {
    id: row.id,
    runID: row.run_id,
    taskID: row.task_id,
    prompt: row.prompt,
    status: row.status as InputRequest["status"],
    ...(row.answer ? { answer: row.answer } : {}),
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

function fromReservationRow(row: typeof SuperAgentBudgetReservationTable.$inferSelect): BudgetReservation {
  return {
    id: row.id,
    runID: row.run_id,
    requested: row.requested_json as Budget,
    ...(row.settled_json ? { settled: row.settled_json as Budget } : {}),
    status: row.status as BudgetReservation["status"],
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

/**
 * Keep a durable Goal and its Super-Agent run in the same transaction. Cron still
 * reconciles old rows, but terminal state must not depend on a scheduler being
 * alive: HTTP handlers, workers, and recovery all enter this store transition.
 *
 * The explicit goalId is preferred. The execution_config lookup is retained as a
 * compatibility path for runs created by older clients that linked the run after
 * creation (and for persisted rows from before Goal metadata was added).
 */
function synchronizeLinkedGoal(db: TxOrDb, run: StoredSuperAgentRun, at: number) {
  const nextStatus =
    run.status === "completed"
      ? "completed"
      : run.status === "cancelled"
        ? "cancelled"
        : run.status === "failed" ||
            run.status === "paused" ||
            run.status === "waiting_approval" ||
            run.status === "waiting_input" ||
            run.status === "waiting_external" ||
            run.status === "needs_review"
          ? "paused"
          : run.status === "planning" ||
              run.status === "ready" ||
              run.status === "running" ||
              run.status === "verifying"
            ? "in_progress"
            : undefined
  if (!nextStatus) return

  const rows = run.goal.goalId
    ? db
        .select({ id: GoalTable.id, status: GoalTable.status, executionConfig: GoalTable.execution_config })
        .from(GoalTable)
        .where(
          run.goal.sessionId
            ? and(eq(GoalTable.id, run.goal.goalId), eq(GoalTable.session_id, run.goal.sessionId))
            : eq(GoalTable.id, run.goal.goalId),
        )
        .all()
    : db
        .select({ id: GoalTable.id, status: GoalTable.status, executionConfig: GoalTable.execution_config })
        .from(GoalTable)
        .all()

  for (const row of rows) {
    let linked = row.id === run.goal.goalId
    if (!linked && typeof row.executionConfig === "string") {
      try {
        linked = (JSON.parse(row.executionConfig) as { superAgentRunId?: unknown }).superAgentRunId === run.id
      } catch {
        // Ignore malformed unrelated Goal rows; GoalService handles them safely.
      }
    }
    if (!linked) continue

    const totalTasks = run.graph.nodes.length
    const progress =
      nextStatus === "completed"
        ? 100
        : totalTasks === 0
          ? 0
          : Math.round(
              (run.graph.nodes.reduce((sum, task) => {
                if (["completed", "succeeded"].includes(task.status)) return sum + 1
                if (task.status === "verifying") return sum + 0.9
                if (task.status === "running" || task.status === "waiting") return sum + 0.35
                if (task.status === "ready" || task.status === "retrying") return sum + 0.1
                return sum
              }, 0) /
                totalTasks) *
                100,
            )

    const allowedStatuses =
      nextStatus === "completed"
        ? ["in_progress"]
        : nextStatus === "cancelled"
          ? ["in_progress", "paused"]
          : nextStatus === "paused"
            ? ["in_progress"]
            : ["in_progress", "paused"]
    db.update(GoalTable)
      .set({ status: nextStatus, progress, updated_at: new Date(at) })
      .where(and(eq(GoalTable.id, row.id), inArray(GoalTable.status, allowedStatuses)))
      .run();
  }
}

export const defaultLayer = Layer.effect(
  Service,
  Effect.sync(() => {
    const get: Interface["get"] = Effect.fn("SuperAgentStore.get")(function* (runID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(SuperAgentRunTable).where(eq(SuperAgentRunTable.id, runID)).limit(1).all(),
        ),
      )
      const row = rows[0]
      if (!row) return undefined
      const run = fromRow(row)
      const mutationRows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select({
              taskID: SuperAgentTaskMutationTable.task_id,
              graphVersion: SuperAgentTaskMutationTable.graph_version,
              after: SuperAgentTaskMutationTable.after_json,
            })
            .from(SuperAgentTaskMutationTable)
            .where(eq(SuperAgentTaskMutationTable.run_id, runID))
            .orderBy(asc(SuperAgentTaskMutationTable.id))
            .all(),
        ),
      )
      if (mutationRows.length === 0) return run
      const graph = replayTaskMutations(
        run.graph,
        mutationRows.map((mutation) => ({
          taskID: mutation.taskID,
          graphVersion: mutation.graphVersion,
          after: mutation.after,
        })),
      )
      return { ...run, graph }
    })

    const persist = (run: StoredSuperAgentRun) =>
      Effect.sync(() =>
        Database.transaction((db) => {
          db.update(SuperAgentRunTable)
            .set({
              status: run.status,
              graph_json: run.graph,
              graph_version: run.graph.version,
              usage_json: run.usage,
              checkpoint_id: run.checkpointID,
              ...(run.failure ? { failure_json: run.failure } : { failure_json: null }),
              ...(run.completion ? { completion_json: run.completion } : { completion_json: null }),
              time_updated: run.updatedAt,
            })
            .where(eq(SuperAgentRunTable.id, run.id))
            .run();
          synchronizeLinkedGoal(db, run, run.updatedAt)
        }),
      )

    const completionVerifications = (runID: string) =>
      Effect.gen(function* () {
        const verifications = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select({
                id: SuperAgentVerificationTable.id,
                acceptanceID: SuperAgentVerificationTable.acceptance_id,
                outcome: SuperAgentVerificationTable.outcome,
                evidenceIDs: SuperAgentVerificationTable.evidence_json,
                createdAt: SuperAgentVerificationTable.time_created,
              })
              .from(SuperAgentVerificationTable)
              .where(eq(SuperAgentVerificationTable.run_id, runID))
              .all(),
          ),
        )
        const evidence = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentEvidenceTable)
              .where(eq(SuperAgentEvidenceTable.run_id, runID))
              .all()
              .map((row) => ({
                id: row.id,
                runID: row.run_id,
                taskID: row.task_id,
                kind: row.kind as Evidence["kind"],
                source: row.source,
                ...(Array.isArray(row.acceptance_ids_json) && row.acceptance_ids_json.length > 0
                  ? { acceptanceIDs: row.acceptance_ids_json as string[] }
                  : {}),
                ...(row.content_hash ? { contentHash: row.content_hash } : {}),
                ...(row.measured ? { measured: row.measured } : {}),
                ...(row.time_expires ? { expiresAt: row.time_expires } : {}),
                capturedAt: row.time_captured,
              })),
          ),
        )
        return verifications.map((verification) => {
          const evidenceIDs = verification.evidenceIDs as string[]
          const validity = verificationOutcomeAt(
            {
              id: verification.id,
              runID,
              acceptanceID: verification.acceptanceID,
              verifierID: "persisted",
              verifierVersion: "1",
              outcome: verification.outcome as Verification["outcome"],
              evidenceIDs,
              reason: "persisted verification",
              createdAt: verification.createdAt,
            },
            evidence,
          )
          return { acceptanceID: verification.acceptanceID, outcome: validity.outcome, evidenceIDs }
        })
      })

    const transition: Interface["transition"] = Effect.fn("SuperAgentStore.transition")(function* (runID, status) {
      const current = yield* get(runID)
      if (!current) return undefined
      const transitioned = transitionRun(current, status, now())
      if (status === "completed") {
        const verifications = yield* completionVerifications(runID)
        const guard = canCompleteRun({ ...transitioned, status: "verifying" }, verifications)
        if (!guard.ok) throw new Error(`cannot complete Super-Agent run: ${guard.reason}`)
      }
      const next = { ...transitioned, directory: current.directory }
      yield* persist(next)
      return next
    })

    return {
      create: Effect.fn("SuperAgentStore.create")(function* (input) {
        const created = SuperAgentRuntime.create({
          id: input.id,
          goal: input.goal,
          budget: input.budget,
        }).runtime.snapshot()
        const run: StoredSuperAgentRun = { ...created, directory: input.directory }
        yield* Effect.sync(() =>
          Database.transaction((db) => {
            db
              .insert(SuperAgentRunTable)
              .values({
                id: run.id,
                directory: run.directory,
                goal_json: run.goal,
                status: run.status,
                graph_json: run.graph,
                graph_version: run.graph.version,
                budget_json: run.budget,
                usage_json: run.usage,
                time_created: run.createdAt,
                time_updated: run.updatedAt,
              })
              .run()
            projectTaskGraph(db, run.id, run.graph, run.updatedAt)
          }),
        )
        return run
      }),
      createLinked: Effect.fn("SuperAgentStore.createLinked")(function* (input) {
        const created = SuperAgentRuntime.create({
          id: input.id,
          goal: {
            ...input.goal,
            executionConfig: input.executionConfig as Goal["executionConfig"],
            goalId: input.goalId,
            sessionId: input.sessionId,
          },
          budget: input.budget,
        }).runtime.snapshot()
        const candidate: StoredSuperAgentRun = { ...created, directory: input.directory }
        const linked = yield* Effect.sync(() =>
          Database.transaction(
            (db) => {
              const goalRow = db
                .select({ status: GoalTable.status, executionConfig: GoalTable.execution_config })
                .from(GoalTable)
                .where(and(eq(GoalTable.id, input.goalId), eq(GoalTable.session_id, input.sessionId)))
                .limit(1)
                .all()[0]
              if (!goalRow) return undefined

              let currentConfig: Record<string, unknown> = {}
              if (typeof goalRow.executionConfig === "string") {
                try {
                  const parsed = JSON.parse(goalRow.executionConfig)
                  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) currentConfig = parsed
                } catch {
                  // The Goal service will expose malformed configuration as null;
                  // launching repairs it with the validated request configuration.
                }
              }
              const existingRunID = currentConfig.superAgentRunId
              if (typeof existingRunID === "string" && existingRunID.length > 0) {
                const existing = db
                  .select()
                  .from(SuperAgentRunTable)
                  .where(eq(SuperAgentRunTable.id, existingRunID))
                  .limit(1)
                  .all()[0]
                if (existing) return fromRow(existing)
              }
              if (goalRow.status !== "pending" && goalRow.status !== "in_progress") return undefined

              const nextConfig = {
                ...currentConfig,
                ...input.executionConfig,
                mode: "durable",
                superAgentRunId: candidate.id,
              }
              db
                .insert(SuperAgentRunTable)
                .values({
                  id: candidate.id,
                  directory: candidate.directory,
                  goal_json: candidate.goal,
                  status: candidate.status,
                  graph_json: candidate.graph,
                  graph_version: candidate.graph.version,
                  budget_json: candidate.budget,
                  usage_json: candidate.usage,
                  time_created: candidate.createdAt,
                  time_updated: candidate.updatedAt,
                })
                .run();
              projectTaskGraph(db, candidate.id, candidate.graph, candidate.updatedAt)
              db
                .update(GoalTable)
                .set({
                  status: "in_progress",
                  execution_config: JSON.stringify(nextConfig),
                  updated_at: new Date(),
                })
                .where(and(eq(GoalTable.id, input.goalId), eq(GoalTable.session_id, input.sessionId)))
                .run();
              return candidate
            },
            { behavior: "immediate" },
          ),
        )
        return linked
      }),
      createGoalLinked: Effect.fn("SuperAgentStore.createGoalLinked")(function* (input) {
        const created = SuperAgentRuntime.create({
          id: input.id,
          goal: {
            ...input.goal,
            executionConfig: input.executionConfig as Goal["executionConfig"],
            goalId: input.goalId,
            sessionId: input.sessionId,
          },
          budget: input.budget,
        }).runtime.snapshot()
        const candidate: StoredSuperAgentRun = { ...created, directory: input.directory }
        const linked = yield* Effect.sync(() =>
          Database.transaction(
            (db) => {
              const existingGoal = db
                .select({ executionConfig: GoalTable.execution_config })
                .from(GoalTable)
                .where(and(eq(GoalTable.id, input.goalId), eq(GoalTable.session_id, input.sessionId)))
                .limit(1)
                .all()[0]
              if (existingGoal) {
                let existingRunID: string | undefined
                if (typeof existingGoal.executionConfig === "string") {
                  try {
                    const parsed = JSON.parse(existingGoal.executionConfig)
                    if (parsed && typeof parsed.superAgentRunId === "string") existingRunID = parsed.superAgentRunId
                  } catch {
                    // A partially corrupted pre-existing row is not overwritten by
                    // an idempotent create request.
                  }
                }
                if (!existingRunID) return undefined
                const existing = db
                  .select()
                  .from(SuperAgentRunTable)
                  .where(eq(SuperAgentRunTable.id, existingRunID))
                  .limit(1)
                  .all()[0]
                return existing ? fromRow(existing) : undefined
              }

              const executionConfig = {
                ...input.executionConfig,
                mode: "durable",
                superAgentRunId: candidate.id,
              }
              db
                .insert(GoalTable)
                .values({
                  id: input.goalId,
                  session_id: input.sessionId,
                  title: input.title,
                  description: input.description ?? null,
                  status: "in_progress",
                  priority: input.priority ?? "medium",
                  success_criteria: input.successCriteria ? JSON.stringify(input.successCriteria) : null,
                  deadline: input.deadline ?? null,
                  progress: 0,
                  tags: input.tags ?? [],
                  execution_config: JSON.stringify(executionConfig),
                  created_at: new Date(candidate.createdAt),
                  updated_at: new Date(candidate.createdAt),
                })
                .run();
              db
                .insert(SuperAgentRunTable)
                .values({
                  id: candidate.id,
                  directory: candidate.directory,
                  goal_json: candidate.goal,
                  status: candidate.status,
                  graph_json: candidate.graph,
                  graph_version: candidate.graph.version,
                  budget_json: candidate.budget,
                  usage_json: candidate.usage,
                  time_created: candidate.createdAt,
                  time_updated: candidate.updatedAt,
                })
                .run();
              projectTaskGraph(db, candidate.id, candidate.graph, candidate.updatedAt)
              return candidate
            },
            { behavior: "immediate" },
          ),
        )
        return linked
      }),
      get,
      claimRunLease: Effect.fn("SuperAgentStore.claimRunLease")(function* (input) {
        const at = input.now ?? now()
        const leaseUntil = at + Math.max(1_000, input.leaseMs)
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(SuperAgentRunTable)
              .set({ run_owner: input.owner, run_lease_until: leaseUntil, time_updated: at })
              .where(
                and(
                  eq(SuperAgentRunTable.id, input.runID),
                  or(
                    isNull(SuperAgentRunTable.run_owner),
                    lt(SuperAgentRunTable.run_lease_until, at),
                    eq(SuperAgentRunTable.run_owner, input.owner),
                  ),
                ),
              )
              .returning({ id: SuperAgentRunTable.id })
              .all(),
          ),
        )
        return rows.length > 0
      }),
      renewRunLease: Effect.fn("SuperAgentStore.renewRunLease")(function* (input) {
        const at = input.now ?? now()
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(SuperAgentRunTable)
              .set({ run_lease_until: at + Math.max(1_000, input.leaseMs), time_updated: at })
              .where(and(eq(SuperAgentRunTable.id, input.runID), eq(SuperAgentRunTable.run_owner, input.owner)))
              .returning({ id: SuperAgentRunTable.id })
              .all(),
          ),
        )
        return rows.length > 0
      }),
      releaseRunLease: Effect.fn("SuperAgentStore.releaseRunLease")(function* (input) {
        const at = now()
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(SuperAgentRunTable)
              .set({ run_owner: null, run_lease_until: null, time_updated: at })
              .where(and(eq(SuperAgentRunTable.id, input.runID), eq(SuperAgentRunTable.run_owner, input.owner)))
              .returning({ id: SuperAgentRunTable.id })
              .all(),
          ),
        )
        return rows.length > 0
      }),
      list: Effect.fn("SuperAgentStore.list")(function* (directory) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentRunTable)
              .where(eq(SuperAgentRunTable.directory, directory))
              .orderBy(desc(SuperAgentRunTable.time_updated))
              .all(),
          ),
        )
        return yield* Effect.forEach(rows, (row) => get(row.id).pipe(Effect.map((run) => run ?? fromRow(row))))
      }),
      listAll: Effect.fn("SuperAgentStore.listAll")(function* (limit = 10_000) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentRunTable)
              .orderBy(desc(SuperAgentRunTable.time_updated))
              .limit(Math.max(1, Math.min(limit, 100_000)))
              .all(),
          ),
        )
        return yield* Effect.forEach(rows, (row) => get(row.id).pipe(Effect.map((run) => run ?? fromRow(row))))
      }),
      appendEvent: Effect.fn("SuperAgentStore.appendEvent")(function* (event) {
        const result = yield* Effect.sync(() =>
          Database.transaction((db) => {
            if (event.idempotencyKey) {
              const existing = db
                .select()
                .from(SuperAgentEventTable)
                .where(
                  and(
                    eq(SuperAgentEventTable.run_id, event.runID),
                    eq(SuperAgentEventTable.idempotency_key, event.idempotencyKey),
                  ),
                )
                .limit(1)
                .all()[0]
              if (existing) return fromEventRow(existing)
            }
            const row = db
              .select({ value: max(SuperAgentEventTable.sequence) })
              .from(SuperAgentEventTable)
              .where(eq(SuperAgentEventTable.run_id, event.runID))
              .all()[0]
            const sequence = (row?.value ?? 0) + 1
            const eventID = event.eventID ?? `${event.runID}:event:${sequence}`
            const idempotencyKey = event.idempotencyKey ?? eventID
            db.insert(SuperAgentEventTable)
              .values({
                event_id: eventID,
                run_id: event.runID,
                sequence,
                protocol_version: SUPER_AGENT_EVENT_VERSION,
                idempotency_key: idempotencyKey,
                type: event.type,
                payload_json: event.payload,
                time_created: event.at,
              })
              .run();
            db.insert(SuperAgentEventOutboxTable)
              .values({
                event_id: eventID,
                run_id: event.runID,
                sequence,
                type: event.type,
                payload_json: event.payload,
                status: "pending",
                attempts: 0,
                time_created: event.at,
                time_updated: event.at,
              })
              .run();
            return {
              ...event,
              eventID,
              protocolVersion: SUPER_AGENT_EVENT_VERSION,
              idempotencyKey,
              sequence,
            }
          }),
        )
        return result
      }),
      events: Effect.fn("SuperAgentStore.events")(function* (runID, after = 0, limit = 1000) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentEventTable)
              .where(and(eq(SuperAgentEventTable.run_id, runID), gt(SuperAgentEventTable.sequence, after)))
              .orderBy(asc(SuperAgentEventTable.sequence))
              .limit(Math.min(Math.max(limit, 1), 10_000))
              .all(),
          ),
        )
        return rows.filter((row) => row.sequence > after).map(fromEventRow)
      }),
      outbox: Effect.fn("SuperAgentStore.outbox")(function* (runID, limit = 100, at = now()) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentEventOutboxTable)
              .where(
                and(
                  eq(SuperAgentEventOutboxTable.run_id, runID),
                  eq(SuperAgentEventOutboxTable.status, "pending"),
                  lte(SuperAgentEventOutboxTable.next_attempt_at, at),
                ),
              )
              .orderBy(asc(SuperAgentEventOutboxTable.id))
              .limit(Math.max(1, Math.min(limit, 1000)))
              .all(),
          ),
        )
        return rows.map(fromOutboxRow)
      }),
      ackOutbox: Effect.fn("SuperAgentStore.ackOutbox")(function* (eventID) {
        const updatedAt = now()
        const current = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db
                .select()
                .from(SuperAgentEventOutboxTable)
                .where(eq(SuperAgentEventOutboxTable.event_id, eventID))
                .limit(1)
                .all()[0],
          ),
        )
        if (!current) return undefined
        if (current.status === "acked") return fromOutboxRow(current)
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(SuperAgentEventOutboxTable)
              .set({
                status: "acked",
                attempts: current.attempts + 1,
                next_attempt_at: updatedAt,
                last_error: null,
                time_updated: updatedAt,
              })
              .where(eq(SuperAgentEventOutboxTable.event_id, eventID))
              .run(),
          ),
        )
        const row = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db
                .select()
                .from(SuperAgentEventOutboxTable)
                .where(eq(SuperAgentEventOutboxTable.event_id, eventID))
                .limit(1)
                .all()[0],
          ),
        )
        return row ? fromOutboxRow(row) : undefined
      }),
      failOutbox: Effect.fn("SuperAgentStore.failOutbox")(function* (eventID, error, retryAt) {
        const updatedAt = now()
        const current = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db
                .select()
                .from(SuperAgentEventOutboxTable)
                .where(eq(SuperAgentEventOutboxTable.event_id, eventID))
                .limit(1)
                .all()[0],
          ),
        )
        if (!current) return undefined
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(SuperAgentEventOutboxTable)
              .set({
                status: "pending",
                attempts: current.attempts + 1,
                next_attempt_at: retryAt,
                last_error: error,
                time_updated: updatedAt,
              })
              .where(eq(SuperAgentEventOutboxTable.event_id, eventID))
              .run(),
          ),
        )
        const row = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db
                .select()
                .from(SuperAgentEventOutboxTable)
                .where(eq(SuperAgentEventOutboxTable.event_id, eventID))
                .limit(1)
                .all()[0],
          ),
        )
        return row ? fromOutboxRow(row) : undefined
      }),
      checkpoint: Effect.fn("SuperAgentStore.checkpoint")(function* (runID, reason) {
        const current = yield* get(runID)
        if (!current) return undefined
        const checkpoint: SuperAgentCheckpoint = {
          id: id("checkpoint"),
          runID,
          reason,
          eventSequence: yield* Effect.sync(() =>
            Database.use(
              (db) =>
                db
                  .select({ value: max(SuperAgentEventTable.sequence) })
                  .from(SuperAgentEventTable)
                  .where(eq(SuperAgentEventTable.run_id, runID))
                  .all()[0]?.value ?? 0,
            ),
          ),
          stateVersion: 1,
          run: { ...current, checkpointID: undefined },
          createdAt: now(),
        }
        yield* Effect.sync(() =>
          Database.transaction((db) => {
            db.insert(SuperAgentCheckpointTable)
              .values({
                id: checkpoint.id,
                run_id: checkpoint.runID,
                reason: checkpoint.reason,
                event_sequence: checkpoint.eventSequence,
                state_version: checkpoint.stateVersion,
                snapshot_json: checkpoint.run,
                time_created: checkpoint.createdAt,
              })
              .run();
            db.update(SuperAgentRunTable)
              .set({ checkpoint_id: checkpoint.id, time_updated: checkpoint.createdAt })
              .where(eq(SuperAgentRunTable.id, runID))
              .run();
          }),
        )
        return checkpoint
      }),
      getCheckpoint: Effect.fn("SuperAgentStore.getCheckpoint")(function* (checkpointID) {
        const row = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db
                .select()
                .from(SuperAgentCheckpointTable)
                .where(eq(SuperAgentCheckpointTable.id, checkpointID))
                .limit(1)
                .all()[0],
          ),
        )
        return row ? fromCheckpointRow(row) : undefined
      }),
      beginOperation: Effect.fn("SuperAgentStore.beginOperation")(function* (input) {
        const startedAt = now()
        return yield* Effect.sync(() =>
          Database.transaction((db) => {
            const existing = db
              .select()
              .from(SuperAgentOperationTable)
              .where(
                and(
                  eq(SuperAgentOperationTable.run_id, input.runID),
                  eq(SuperAgentOperationTable.idempotency_key, input.idempotencyKey),
                ),
              )
              .limit(1)
              .all()[0]
            if (existing) {
              if (existing.status === "waiting" && existing.lease_until < startedAt) {
                const leaseUntil = startedAt + Math.max(1, input.leaseMs)
                db.update(SuperAgentOperationTable)
                  .set({ status: "started", lease_until: leaseUntil, time_updated: startedAt, reason: null })
                  .where(
                    and(
                      eq(SuperAgentOperationTable.id, existing.id),
                      eq(SuperAgentOperationTable.status, "waiting"),
                      lt(SuperAgentOperationTable.lease_until, startedAt),
                    ),
                  )
                  .run();
                const reclaimed = db
                  .select()
                  .from(SuperAgentOperationTable)
                  .where(eq(SuperAgentOperationTable.id, existing.id))
                  .limit(1)
                  .all()[0]
                if (reclaimed?.status === "started") return { ...fromOperationRow(reclaimed), acquired: true }
              }
              return { ...fromOperationRow(existing), acquired: false }
            }
            const leaseUntil = startedAt + Math.max(1, input.leaseMs)
            db.insert(SuperAgentOperationTable)
              .values({
                id: input.id,
                run_id: input.runID,
                instruction_id: input.instructionID,
                idempotency_key: input.idempotencyKey,
                status: "started",
                lease_until: leaseUntil,
                time_started: startedAt,
                time_updated: startedAt,
              })
              .run();
            return {
              id: input.id,
              runID: input.runID,
              instructionID: input.instructionID,
              idempotencyKey: input.idempotencyKey,
              status: "started" as const,
              leaseUntil,
              startedAt,
              updatedAt: startedAt,
              acquired: true,
            }
          }),
        )
      }),
      resolveOperation: Effect.fn("SuperAgentStore.resolveOperation")(function* (operationID, status, result, reason) {
        const updatedAt = now()
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(SuperAgentOperationTable)
              .set({ status, result_json: result, reason, time_updated: updatedAt })
              .where(eq(SuperAgentOperationTable.id, operationID))
              .run(),
          ),
        )
        const row = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db
                .select()
                .from(SuperAgentOperationTable)
                .where(eq(SuperAgentOperationTable.id, operationID))
                .limit(1)
                .all()[0],
          ),
        )
        return row ? fromOperationRow(row) : undefined
      }),
      heartbeatOperation: Effect.fn("SuperAgentStore.heartbeatOperation")(function* (operationID, leaseMs) {
        const updatedAt = now()
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(SuperAgentOperationTable)
              .set({ lease_until: updatedAt + Math.max(1, leaseMs), time_updated: updatedAt })
              .where(and(eq(SuperAgentOperationTable.id, operationID), eq(SuperAgentOperationTable.status, "started")))
              .run(),
          ),
        )
        const row = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db
                .select()
                .from(SuperAgentOperationTable)
                .where(eq(SuperAgentOperationTable.id, operationID))
                .limit(1)
                .all()[0],
          ),
        )
        return row ? fromOperationRow(row) : undefined
      }),
      operations: Effect.fn("SuperAgentStore.operations")(function* (runID) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db.select().from(SuperAgentOperationTable).where(eq(SuperAgentOperationTable.run_id, runID)).all(),
          ),
        )
        return rows.map(fromOperationRow)
      }),
      requeueOperation: Effect.fn("SuperAgentStore.requeueOperation")(function* (
        operationID,
        reason = "recovered permission gate",
      ) {
        const updatedAt = now()
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(SuperAgentOperationTable)
              .set({ status: "waiting", lease_until: 0, reason, time_updated: updatedAt })
              .where(
                and(
                  eq(SuperAgentOperationTable.id, operationID),
                  inArray(SuperAgentOperationTable.status, ["started", "waiting"]),
                ),
              )
              .run(),
          ),
        )
        const row = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db
                .select()
                .from(SuperAgentOperationTable)
                .where(eq(SuperAgentOperationTable.id, operationID))
                .limit(1)
                .all()[0],
          ),
        )
        return row ? fromOperationRow(row) : undefined
      }),
      recoverExpiredOperations: Effect.fn("SuperAgentStore.recoverExpiredOperations")(function* (runID, at = now()) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentOperationTable)
              .where(
                runID
                  ? and(
                      eq(SuperAgentOperationTable.run_id, runID),
                      eq(SuperAgentOperationTable.status, "started"),
                      lt(SuperAgentOperationTable.lease_until, at),
                    )
                  : and(eq(SuperAgentOperationTable.status, "started"), lt(SuperAgentOperationTable.lease_until, at)),
              )
              .all(),
          ),
        )
        if (rows.length > 0)
          yield* Effect.sync(() =>
            Database.transaction((db) => {
              for (const row of rows)
                db.update(SuperAgentOperationTable)
                  .set({ status: "unknown", reason: "operation lease expired", time_updated: at })
                  .where(eq(SuperAgentOperationTable.id, row.id))
                  .run();
            }),
          )
        return rows.map((row) => ({
          ...fromOperationRow(row),
          status: "unknown" as const,
          reason: "operation lease expired",
          updatedAt: at,
        }))
      }),
      reserveBudget: Effect.fn("SuperAgentStore.reserveBudget")(function* (runID, reservationID, requested) {
        const run = yield* get(runID)
        if (!run) throw new Error(`run not found: ${runID}`)
        const existing = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db
                .select()
                .from(SuperAgentBudgetReservationTable)
                .where(eq(SuperAgentBudgetReservationTable.id, reservationID))
                .limit(1)
                .all()[0],
          ),
        )
        if (existing) return fromReservationRow(existing)
        const active = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentBudgetReservationTable)
              .where(
                and(
                  eq(SuperAgentBudgetReservationTable.run_id, runID),
                  eq(SuperAgentBudgetReservationTable.status, "reserved"),
                ),
              )
              .all()
              .reduce((sum, row) => addBudget(sum, row.requested_json as Budget), {} as Budget),
          ),
        )
        assertWithinBudget(run.budget, run.usage as Budget, addBudget(active, requested))
        const timestamp = now()
        const reservation: BudgetReservation = {
          id: reservationID,
          runID,
          requested,
          status: "reserved",
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .insert(SuperAgentBudgetReservationTable)
              .values({
                id: reservation.id,
                run_id: reservation.runID,
                requested_json: reservation.requested,
                status: reservation.status,
                time_created: timestamp,
                time_updated: timestamp,
              })
              .run(),
          ),
        )
        return reservation
      }),
      settleBudget: Effect.fn("SuperAgentStore.settleBudget")(function* (reservationID, settled) {
        const timestamp = now()
        const updated = yield* Effect.sync(() =>
          Database.transaction((db) => {
            const reservation = db
              .select()
              .from(SuperAgentBudgetReservationTable)
              .where(eq(SuperAgentBudgetReservationTable.id, reservationID))
              .limit(1)
              .all()[0]
            if (!reservation) return false
            if (reservation.status === "settled") return true
            const run = db
              .select()
              .from(SuperAgentRunTable)
              .where(eq(SuperAgentRunTable.id, reservation.run_id))
              .limit(1)
              .all()[0]
            if (!run) return false
            const previous = run.usage_json as SuperAgentRun["usage"]
            const usage = {
              ...previous,
              tokens: previous.tokens + (settled.tokens ?? 0),
              usd: previous.usd + (settled.usd ?? 0),
              wallTimeMs: previous.wallTimeMs + (settled.wallTimeMs ?? 0),
              steps: previous.steps + (settled.steps ?? 0),
              toolCalls: previous.toolCalls + (settled.toolCalls ?? 0),
              childAgents: previous.childAgents + (settled.childAgents ?? 0),
            }
            db.update(SuperAgentBudgetReservationTable)
              .set({ settled_json: settled, status: "settled", time_updated: timestamp })
              .where(eq(SuperAgentBudgetReservationTable.id, reservationID))
              .run();
            db.update(SuperAgentRunTable)
              .set({ usage_json: usage, time_updated: timestamp })
              .where(eq(SuperAgentRunTable.id, reservation.run_id))
              .run();
            return true
          }),
        )
        if (!updated) return undefined
        const row = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db
                .select()
                .from(SuperAgentBudgetReservationTable)
                .where(eq(SuperAgentBudgetReservationTable.id, reservationID))
                .limit(1)
                .all()[0],
          ),
        )
        return row ? fromReservationRow(row) : undefined
      }),
      releaseBudget: Effect.fn("SuperAgentStore.releaseBudget")(function* (reservationID) {
        const timestamp = now()
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(SuperAgentBudgetReservationTable)
              .set({ status: "released", time_updated: timestamp })
              .where(eq(SuperAgentBudgetReservationTable.id, reservationID))
              .run(),
          ),
        )
        const row = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db
                .select()
                .from(SuperAgentBudgetReservationTable)
                .where(eq(SuperAgentBudgetReservationTable.id, reservationID))
                .limit(1)
                .all()[0],
          ),
        )
        return row ? fromReservationRow(row) : undefined
      }),
      reservations: Effect.fn("SuperAgentStore.reservations")(function* (runID) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentBudgetReservationTable)
              .where(eq(SuperAgentBudgetReservationTable.run_id, runID))
              .orderBy(asc(SuperAgentBudgetReservationTable.time_created))
              .all(),
          ),
        )
        return rows.map(fromReservationRow)
      }),
      createApproval: Effect.fn("SuperAgentStore.createApproval")(function* (input) {
        const timestamp = now()
        const request: ApprovalRequest = { ...input, createdAt: timestamp, updatedAt: timestamp }
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .insert(SuperAgentApprovalTable)
              .values({
                id: request.id,
                run_id: request.runID,
                task_id: request.taskID,
                reason: request.reason,
                scope: request.scope,
                status: request.status,
                decided_by: request.decidedBy,
                decision_reason: request.decisionReason,
                time_expires: request.expiresAt,
                time_created: timestamp,
                time_updated: timestamp,
              })
              .run(),
          ),
        )
        return request
      }),
      decideApproval: Effect.fn("SuperAgentStore.decideApproval")(function* (requestID, status, decidedBy, reason) {
        const timestamp = now()
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(SuperAgentApprovalTable)
              .set({ status, decided_by: decidedBy, decision_reason: reason, time_updated: timestamp })
              .where(eq(SuperAgentApprovalTable.id, requestID))
              .run(),
          ),
        )
        const row = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db
                .select()
                .from(SuperAgentApprovalTable)
                .where(eq(SuperAgentApprovalTable.id, requestID))
                .limit(1)
                .all()[0],
          ),
        )
        return row ? fromApprovalRow(row) : undefined
      }),
      approvals: Effect.fn("SuperAgentStore.approvals")(function* (runID) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentApprovalTable)
              .where(eq(SuperAgentApprovalTable.run_id, runID))
              .orderBy(asc(SuperAgentApprovalTable.time_created))
              .all(),
          ),
        )
        return rows.map(fromApprovalRow)
      }),
      createInput: Effect.fn("SuperAgentStore.createInput")(function* (input) {
        const timestamp = now()
        const request: InputRequest = { ...input, createdAt: timestamp, updatedAt: timestamp }
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .insert(SuperAgentInputTable)
              .values({
                id: request.id,
                run_id: request.runID,
                task_id: request.taskID,
                prompt: request.prompt,
                status: request.status,
                answer: request.answer,
                time_created: timestamp,
                time_updated: timestamp,
              })
              .run(),
          ),
        )
        return request
      }),
      answerInput: Effect.fn("SuperAgentStore.answerInput")(function* (requestID, answer) {
        const timestamp = now()
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(SuperAgentInputTable)
              .set({ status: "answered", answer, time_updated: timestamp })
              .where(eq(SuperAgentInputTable.id, requestID))
              .run(),
          ),
        )
        const row = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db.select().from(SuperAgentInputTable).where(eq(SuperAgentInputTable.id, requestID)).limit(1).all()[0],
          ),
        )
        return row ? fromInputRow(row) : undefined
      }),
      inputs: Effect.fn("SuperAgentStore.inputs")(function* (runID) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentInputTable)
              .where(eq(SuperAgentInputTable.run_id, runID))
              .orderBy(asc(SuperAgentInputTable.time_created))
              .all(),
          ),
        )
        return rows.map(fromInputRow)
      }),
      evidence: Effect.fn("SuperAgentStore.evidence")(function* (evidence) {
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .insert(SuperAgentEvidenceTable)
              .values({
                id: evidence.id,
                run_id: evidence.runID,
                task_id: evidence.taskID,
                kind: evidence.kind,
                source: evidence.source,
                acceptance_ids_json: evidence.acceptanceIDs,
                content_hash: evidence.contentHash,
                measured: evidence.measured,
                time_expires: evidence.expiresAt,
                time_captured: evidence.capturedAt,
              })
              .run(),
          ),
        )
        return evidence
      }),
      evidences: Effect.fn("SuperAgentStore.evidences")(function* (runID) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentEvidenceTable)
              .where(eq(SuperAgentEvidenceTable.run_id, runID))
              .orderBy(asc(SuperAgentEvidenceTable.time_captured))
              .all(),
          ),
        )
        return rows.map((row) => ({
          id: row.id,
          runID: row.run_id,
          taskID: row.task_id,
          kind: row.kind as Evidence["kind"],
          source: row.source,
          ...(Array.isArray(row.acceptance_ids_json) && row.acceptance_ids_json.length > 0
            ? { acceptanceIDs: row.acceptance_ids_json as string[] }
            : {}),
          ...(row.content_hash ? { contentHash: row.content_hash } : {}),
          ...(row.measured ? { measured: row.measured } : {}),
          ...(row.time_expires ? { expiresAt: row.time_expires } : {}),
          capturedAt: row.time_captured,
        }))
      }),
      verification: Effect.fn("SuperAgentStore.verification")(function* (verification) {
        if (verification.outcome === "pass" && verification.evidenceIDs.length === 0)
          throw new Error(`verification ${verification.id} cannot pass without evidence`)
        if (verification.evidenceIDs.length > 0) {
          const evidenceCount = yield* Effect.sync(() =>
            Database.use(
              (db) =>
                db
                  .select({ id: SuperAgentEvidenceTable.id })
                  .from(SuperAgentEvidenceTable)
                  .where(
                    and(
                      eq(SuperAgentEvidenceTable.run_id, verification.runID),
                      inArray(SuperAgentEvidenceTable.id, [...verification.evidenceIDs]),
                    ),
                  )
                  .all().length,
            ),
          )
          if (evidenceCount !== verification.evidenceIDs.length)
            throw new Error(`verification ${verification.id} references missing evidence`)
        }
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .insert(SuperAgentVerificationTable)
              .values({
                id: verification.id,
                run_id: verification.runID,
                task_id: verification.taskID,
                acceptance_id: verification.acceptanceID,
                verifier_id: verification.verifierID,
                verifier_version: verification.verifierVersion,
                outcome: verification.outcome,
                measured: verification.measured,
                evidence_json: verification.evidenceIDs,
                reason: verification.reason,
                time_created: verification.createdAt,
              })
              .run(),
          ),
        )
        return verification
      }),
      verifications: Effect.fn("SuperAgentStore.verifications")(function* (runID) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentVerificationTable)
              .where(eq(SuperAgentVerificationTable.run_id, runID))
              .orderBy(asc(SuperAgentVerificationTable.time_created))
              .all(),
          ),
        )
        return rows.map((row) => ({
          id: row.id,
          runID: row.run_id,
          ...(row.task_id ? { taskID: row.task_id } : {}),
          acceptanceID: row.acceptance_id,
          verifierID: row.verifier_id,
          verifierVersion: row.verifier_version,
          outcome: row.outcome as Verification["outcome"],
          ...(row.measured ? { measured: row.measured } : {}),
          evidenceIDs: row.evidence_json as string[],
          reason: row.reason,
          createdAt: row.time_created,
        }))
      }),
      transition,
      transitionWithEvent: Effect.fn("SuperAgentStore.transitionWithEvent")(function* (runID, status, event) {
        const current = yield* get(runID)
        if (!current) return undefined
        const transitioned = transitionRun(current, status, now())
        if (status === "completed") {
          const verifications = yield* completionVerifications(runID)
          const guard = canCompleteRun({ ...transitioned, status: "verifying" }, verifications)
          if (!guard.ok) throw new Error(`cannot complete Super-Agent run: ${guard.reason}`)
        }
        const next = { ...transitioned, directory: current.directory }
        const persistedEvent = yield* Effect.sync(() =>
          Database.transaction((db) => {
            db.update(SuperAgentRunTable)
              .set({
                status: next.status,
                graph_json: next.graph,
                graph_version: next.graph.version,
                usage_json: next.usage,
                checkpoint_id: next.checkpointID,
                ...(next.failure ? { failure_json: next.failure } : { failure_json: null }),
                ...(next.completion ? { completion_json: next.completion } : { completion_json: null }),
                time_updated: next.updatedAt,
              })
              .where(eq(SuperAgentRunTable.id, runID))
              .run();
            synchronizeLinkedGoal(db, next, next.updatedAt)
            const sequence =
              (db
                .select({ value: max(SuperAgentEventTable.sequence) })
                .from(SuperAgentEventTable)
                .where(eq(SuperAgentEventTable.run_id, runID))
                .all()[0]?.value ?? 0) + 1
            const eventID = event.eventID ?? `${runID}:event:${sequence}`
            const idempotencyKey = event.idempotencyKey ?? eventID
            db.insert(SuperAgentEventTable)
              .values({
                event_id: eventID,
                run_id: runID,
                sequence,
                protocol_version: SUPER_AGENT_EVENT_VERSION,
                idempotency_key: idempotencyKey,
                type: event.type,
                payload_json: event.payload,
                time_created: event.at,
              })
              .run();
            db.insert(SuperAgentEventOutboxTable)
              .values({
                event_id: eventID,
                run_id: runID,
                sequence,
                type: event.type,
                payload_json: event.payload,
                status: "pending",
                attempts: 0,
                time_created: event.at,
                time_updated: event.at,
              })
              .run();
            return { ...event, runID, eventID, protocolVersion: SUPER_AGENT_EVENT_VERSION, idempotencyKey, sequence }
          }),
        )
        return { run: next, event: persistedEvent }
      }),
      updateGraph: Effect.fn("SuperAgentStore.updateGraph")(function* (runID, graph, expectedVersion) {
        const current = yield* get(runID)
        if (!current) return undefined
        const nextGraph = nextTaskGraph(current.graph, validateTaskGraph(graph), expectedVersion)
        const updatedAt = now()
        const mutations = nextGraph.nodes.flatMap((task) => {
          const before = current.graph.nodes.find((item) => item.id === task.id)
          return !before || JSON.stringify(before) !== JSON.stringify(task) ? [{ task, before }] : []
        })
        yield* Effect.sync(() =>
          Database.transaction((db) => {
            db
              .update(SuperAgentRunTable)
              .set({ graph_json: nextGraph, graph_version: nextGraph.version, time_updated: updatedAt })
              .where(and(eq(SuperAgentRunTable.id, runID), eq(SuperAgentRunTable.graph_version, expectedVersion)))
              .run()
            const persistedGraphVersion = db
              .select({ version: SuperAgentRunTable.graph_version })
              .from(SuperAgentRunTable)
              .where(eq(SuperAgentRunTable.id, runID))
              .limit(1)
              .all()[0]?.version
            if (persistedGraphVersion !== nextGraph.version) return false
            synchronizeLinkedGoal(
              db,
              { ...current, graph: nextGraph, updatedAt } as StoredSuperAgentRun,
              updatedAt,
            )
            for (const mutation of mutations) {
              db.insert(SuperAgentTaskMutationTable)
                .values({
                  run_id: runID,
                  graph_version: nextGraph.version,
                  task_id: mutation.task.id,
                  from_status: mutation.before?.status,
                  to_status: mutation.task.status,
                  before_json: mutation.before,
                  after_json: mutation.task,
                  time_created: updatedAt,
                })
                .run();
            }
            projectTaskGraph(db, runID, nextGraph, updatedAt)
            return true
          }),
        )
        const persistedVersion = yield* Effect.sync(() =>
          Database.use(
            (db) =>
              db
                .select({ version: SuperAgentRunTable.graph_version })
                .from(SuperAgentRunTable)
                .where(eq(SuperAgentRunTable.id, runID))
                .limit(1)
                .all()[0]?.version,
          ),
        )
        if (persistedVersion !== nextGraph.version) throw new Error(`task graph version conflict for run ${runID}`)
        return { ...current, graph: nextGraph, updatedAt }
      }),
      rebuildTaskProjection: Effect.fn("SuperAgentStore.rebuildTaskProjection")(function* (runID) {
        const current = yield* get(runID)
        if (!current) return false
        yield* Effect.sync(() =>
          Database.transaction((db) => {
            projectTaskGraph(db, runID, current.graph, current.updatedAt)
          }),
        )
        return true
      }),
      rebuildTaskProjections: Effect.fn("SuperAgentStore.rebuildTaskProjections")(function* (directory) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentRunTable)
              .where(directory ? eq(SuperAgentRunTable.directory, directory) : undefined)
              .all(),
          ),
        )
        yield* Effect.sync(() =>
          Database.transaction((db) => {
            for (const row of rows) projectTaskGraph(db, row.id, row.graph_json as SuperAgentRun["graph"], row.time_updated)
          }),
        )
        return rows.length
      }),
      taskMutations: Effect.fn("SuperAgentStore.taskMutations")(function* (runID, taskID, limit = 100) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(SuperAgentTaskMutationTable)
              .where(
                taskID
                  ? and(eq(SuperAgentTaskMutationTable.run_id, runID), eq(SuperAgentTaskMutationTable.task_id, taskID))
                  : eq(SuperAgentTaskMutationTable.run_id, runID),
              )
              .orderBy(asc(SuperAgentTaskMutationTable.id))
              .limit(Math.max(1, Math.min(limit, 1000)))
              .all(),
          ),
        )
        return rows.map((row) => ({
          id: row.id,
          runID: row.run_id,
          graphVersion: row.graph_version,
          taskID: row.task_id,
          ...(row.from_status ? { fromStatus: row.from_status } : {}),
          toStatus: row.to_status,
          ...(row.before_json === null ? {} : { before: row.before_json }),
          after: row.after_json,
          createdAt: row.time_created,
        }))
      }),
    }
  }),
)
