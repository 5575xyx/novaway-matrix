import { Context, Effect, Layer } from "effect"
import { and, eq, inArray, lte, or } from "drizzle-orm"
import type { SessionID } from "@/session/schema"
import { Database } from "@/storage/db"
import { TeamAssignmentTable, TeamRunEventTable } from "./run.sql"

/** 一次员工派工尝试的 Durable 状态。`reported` 不是成功，必须经过独立验证。 */
export type AssignmentStatus =
  | "created"
  | "delivered"
  | "accepted"
  | "running"
  | "waiting"
  | "blocked"
  | "reported"
  | "verifying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired"
  | "needs_review"

export type AssignmentReport = {
  assignmentID: string
  dispatchID: string
  attempt: number
  sessionID: SessionID
  status: "succeeded" | "failed" | "blocked" | "needs_review"
  summary?: string
  claims?: unknown[]
  evidence?: unknown[]
  artifacts?: unknown[]
  blockers?: unknown[]
}

export type Assignment = {
  id: string
  runID: string
  taskID: string
  employeeID?: string
  sessionID?: SessionID
  parentAssignmentID?: string
  dispatchID: string
  attempt: number
  status: AssignmentStatus
  objective: string
  scope?: Record<string, unknown>
  acceptanceIDs: string[]
  worktree?: string
  promptHash?: string
  skillManifestHash?: string
  permissionHash?: string
  idempotencyKey: string
  leaseUntil?: number
  lastHeartbeatAt?: number
  heartbeatMisses: number
  report?: Record<string, unknown>
  verification?: Record<string, unknown>
  error?: string
  deliveredAt?: number
  acceptedAt?: number
  startedAt?: number
  reportedAt?: number
  verifiedAt?: number
  cancelledAt?: number
  expiredAt?: number
  createdAt: number
  updatedAt: number
}

export type ReportResult = Assignment | "not-found" | "stale" | "duplicate"
export type Identity = {
  assignmentID: string
  dispatchID: string
  attempt: number
  sessionID: SessionID
}

export class InvalidAssignmentTransition extends Error {
  constructor(
    readonly from: AssignmentStatus,
    readonly to: AssignmentStatus,
  ) {
    super(`invalid assignment transition: ${from} -> ${to}`)
  }
}

const ACTIVE: readonly AssignmentStatus[] = ["created", "delivered", "accepted", "running", "waiting", "blocked"]
const TRANSITIONS: Record<AssignmentStatus, readonly AssignmentStatus[]> = {
  created: ["delivered", "cancelled", "expired", "needs_review"],
  delivered: ["accepted", "running", "cancelled", "expired", "needs_review"],
  accepted: ["running", "cancelled", "expired", "needs_review"],
  running: ["waiting", "blocked", "reported", "cancelled", "expired", "needs_review"],
  waiting: ["running", "blocked", "reported", "cancelled", "expired", "needs_review"],
  blocked: ["running", "cancelled", "expired", "needs_review"],
  reported: ["verifying", "cancelled", "needs_review"],
  verifying: ["succeeded", "failed", "needs_review"],
  succeeded: [],
  failed: [],
  cancelled: [],
  expired: [],
  needs_review: [],
}

export function canTransition(from: AssignmentStatus, to: AssignmentStatus) {
  return TRANSITIONS[from].includes(to)
}

const id = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const lease = (leaseMs: number | undefined, now: number) => now + Math.max(1, leaseMs ?? 120_000)

const toAssignment = (row: typeof TeamAssignmentTable.$inferSelect): Assignment => ({
  id: row.id,
  runID: row.run_id,
  taskID: row.task_id,
  employeeID: row.employee_id ?? undefined,
  sessionID: row.session_id ?? undefined,
  parentAssignmentID: row.parent_assignment_id ?? undefined,
  dispatchID: row.dispatch_id,
  attempt: row.attempt,
  status: row.status as AssignmentStatus,
  objective: row.objective,
  scope: row.scope ?? undefined,
  acceptanceIDs: row.acceptance_ids ?? [],
  worktree: row.worktree ?? undefined,
  promptHash: row.prompt_hash ?? undefined,
  skillManifestHash: row.skill_manifest_hash ?? undefined,
  permissionHash: row.permission_hash ?? undefined,
  idempotencyKey: row.idempotency_key,
  leaseUntil: row.lease_until ?? undefined,
  lastHeartbeatAt: row.last_heartbeat_at ?? undefined,
  heartbeatMisses: row.heartbeat_misses,
  report: row.report ?? undefined,
  verification: row.verification ?? undefined,
  error: row.error ?? undefined,
  deliveredAt: row.delivered_at ?? undefined,
  acceptedAt: row.accepted_at ?? undefined,
  startedAt: row.started_at ?? undefined,
  reportedAt: row.reported_at ?? undefined,
  verifiedAt: row.verified_at ?? undefined,
  cancelledAt: row.cancelled_at ?? undefined,
  expiredAt: row.expired_at ?? undefined,
  createdAt: row.time_created,
  updatedAt: row.time_updated,
})

/** 事件和状态写入必须在同一个 immediate transaction 中完成。 */
const appendEventTx = (
  tx: Database.TxOrDb,
  input: { runID: string; kind: string; payload?: Record<string, unknown> },
) => {
  const previous = tx
    .select()
    .from(TeamRunEventTable)
    .where(eq(TeamRunEventTable.run_id, input.runID))
    .orderBy(TeamRunEventTable.seq)
    .all()
    .at(-1)
  const event = {
    id: id("evt"),
    run_id: input.runID,
    seq: (previous?.seq ?? 0) + 1,
    at: Date.now(),
    kind: input.kind,
    payload: input.payload ?? null,
    lease_epoch: null,
  }
  tx.insert(TeamRunEventTable).values(event).run()
  return event
}

function transitionFields(to: AssignmentStatus, now: number) {
  return {
    status: to,
    time_updated: now,
    ...(to === "delivered" ? { delivered_at: now } : {}),
    ...(to === "accepted" ? { accepted_at: now } : {}),
    ...(to === "running" ? { started_at: now } : {}),
    ...(to === "reported" ? { reported_at: now } : {}),
    ...(to === "succeeded" || to === "failed" ? { verified_at: now } : {}),
    ...(to === "cancelled" ? { cancelled_at: now } : {}),
    ...(to === "expired" || to === "needs_review" ? { expired_at: now } : {}),
  }
}

function eventPayload(assignment: Assignment, extra: Record<string, unknown> = {}) {
  return {
    assignmentID: assignment.id,
    dispatchID: assignment.dispatchID,
    taskID: assignment.taskID,
    attempt: assignment.attempt,
    ...(assignment.employeeID ? { employeeID: assignment.employeeID } : {}),
    ...extra,
  }
}

function identityMatches(row: typeof TeamAssignmentTable.$inferSelect, identity: Identity) {
  return (
    row.id === identity.assignmentID &&
    row.dispatch_id === identity.dispatchID &&
    row.attempt === identity.attempt &&
    (!row.session_id || row.session_id === identity.sessionID)
  )
}

export interface Interface {
  readonly create: (input: {
    id: string
    runID: string
    taskID: string
    employeeID?: string
    sessionID?: SessionID
    parentAssignmentID?: string
    dispatchID: string
    attempt: number
    objective: string
    scope?: Record<string, unknown>
    acceptanceIDs?: string[]
    worktree?: string
    promptHash?: string
    skillManifestHash?: string
    permissionHash?: string
    idempotencyKey: string
    leaseMs?: number
  }) => Effect.Effect<Assignment>
  readonly get: (assignmentID: string) => Effect.Effect<Assignment | undefined>
  readonly list: (input: { runID: string; taskID?: string }) => Effect.Effect<Assignment[]>
  readonly deliver: (assignmentID: string) => Effect.Effect<Assignment | undefined>
  readonly accept: (assignmentID: string) => Effect.Effect<Assignment | undefined>
  readonly start: (assignmentID: string) => Effect.Effect<Assignment | undefined>
  readonly heartbeat: (input: Identity & { leaseMs?: number }) => Effect.Effect<Assignment | "stale" | undefined>
  readonly renewLease: (input: Identity & { leaseMs?: number }) => Effect.Effect<Assignment | "stale" | undefined>
  readonly report: (input: AssignmentReport) => Effect.Effect<ReportResult>
  readonly verify: (input: {
    assignmentID: string
    outcome: "succeeded" | "failed" | "needs_review"
    verification: Record<string, unknown>
    error?: string
  }) => Effect.Effect<Assignment | undefined>
  readonly cancel: (input: { assignmentID: string; reason?: string }) => Effect.Effect<Assignment | undefined>
  readonly expire: (input: {
    assignmentID: string
    status?: "expired" | "needs_review"
    reason?: string
  }) => Effect.Effect<Assignment | undefined>
  readonly expireDue: (input?: {
    runID?: string
    now?: number
    status?: "expired" | "needs_review"
  }) => Effect.Effect<Assignment[]>
}

export class Service extends Context.Service<Service, Interface>()("@novaway/TeamAssignment") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const get: Interface["get"] = Effect.fn("TeamAssignment.get")(function* (assignmentID) {
      const row = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(TeamAssignmentTable).where(eq(TeamAssignmentTable.id, assignmentID)).get(),
        ),
      )
      return row ? toAssignment(row) : undefined
    })

    const list: Interface["list"] = Effect.fn("TeamAssignment.list")(function* (input) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(TeamAssignmentTable)
            .where(
              input.taskID
                ? and(eq(TeamAssignmentTable.run_id, input.runID), eq(TeamAssignmentTable.task_id, input.taskID))
                : eq(TeamAssignmentTable.run_id, input.runID),
            )
            .all(),
        ),
      )
      return rows.map(toAssignment).sort((a, b) => a.createdAt - b.createdAt)
    })

    const create: Interface["create"] = Effect.fn("TeamAssignment.create")(function* (input) {
      const now = Date.now()
      const result = yield* Effect.sync(() =>
        Database.transaction(
          (tx) => {
            const existing = tx
              .select()
              .from(TeamAssignmentTable)
              .where(
                or(
                  eq(TeamAssignmentTable.id, input.id),
                  eq(TeamAssignmentTable.idempotency_key, input.idempotencyKey),
                  eq(TeamAssignmentTable.dispatch_id, input.dispatchID),
                ),
              )
              .all()[0]
            if (existing) return toAssignment(existing)
            tx.insert(TeamAssignmentTable)
              .values({
                id: input.id,
                run_id: input.runID,
                task_id: input.taskID,
                employee_id: input.employeeID ?? null,
                session_id: input.sessionID ?? null,
                parent_assignment_id: input.parentAssignmentID ?? null,
                dispatch_id: input.dispatchID,
                attempt: input.attempt,
                status: "created",
                objective: input.objective,
                scope: input.scope ?? null,
                acceptance_ids: input.acceptanceIDs ?? [],
                worktree: input.worktree ?? null,
                prompt_hash: input.promptHash ?? null,
                skill_manifest_hash: input.skillManifestHash ?? null,
                permission_hash: input.permissionHash ?? null,
                idempotency_key: input.idempotencyKey,
                lease_until: lease(input.leaseMs, now),
                last_heartbeat_at: null,
                heartbeat_misses: 0,
                report: null,
                verification: null,
                error: null,
                time_created: now,
                time_updated: now,
              })
              .run()
            const row = tx.select().from(TeamAssignmentTable).where(eq(TeamAssignmentTable.id, input.id)).get()!
            appendEventTx(tx, {
              runID: input.runID,
              kind: "employee.assignment.created",
              payload: eventPayload(toAssignment(row)),
            })
            return toAssignment(row)
          },
          { behavior: "immediate" },
        ),
      )
      return result
    })

    const move = (assignmentID: string, to: AssignmentStatus, kind: string, extra?: Record<string, unknown>) =>
      Effect.sync(() =>
        Database.transaction(
          (tx) => {
            const row = tx.select().from(TeamAssignmentTable).where(eq(TeamAssignmentTable.id, assignmentID)).get()
            if (!row) return undefined
            const from = row.status as AssignmentStatus
            if (!canTransition(from, to)) throw new InvalidAssignmentTransition(from, to)
            const now = Date.now()
            tx.update(TeamAssignmentTable)
              .set(transitionFields(to, now))
              .where(eq(TeamAssignmentTable.id, assignmentID))
              .run()
            const updated = tx.select().from(TeamAssignmentTable).where(eq(TeamAssignmentTable.id, assignmentID)).get()!
            const assignment = toAssignment(updated)
            appendEventTx(tx, {
              runID: assignment.runID,
              kind,
              payload: eventPayload(assignment, { from, to, ...extra }),
            })
            return assignment
          },
          { behavior: "immediate" },
        ),
      )

    const deliver: Interface["deliver"] = Effect.fn("TeamAssignment.deliver")((assignmentID) =>
      move(assignmentID, "delivered", "employee.assignment.delivered"),
    )
    const accept: Interface["accept"] = Effect.fn("TeamAssignment.accept")((assignmentID) =>
      move(assignmentID, "accepted", "employee.assignment.accepted"),
    )
    const start: Interface["start"] = Effect.fn("TeamAssignment.start")((assignmentID) =>
      move(assignmentID, "running", "employee.assignment.started"),
    )

    const heartbeat: Interface["heartbeat"] = Effect.fn("TeamAssignment.heartbeat")(function* (input) {
      const result = yield* Effect.sync(() =>
        Database.transaction(
          (tx) => {
            const row = tx
              .select()
              .from(TeamAssignmentTable)
              .where(eq(TeamAssignmentTable.id, input.assignmentID))
              .get()
            if (!row) return undefined
            if (!identityMatches(row, input)) return "stale" as const
            if (!ACTIVE.includes(row.status as AssignmentStatus)) return "stale" as const
            const now = Date.now()
            tx.update(TeamAssignmentTable)
              .set({
                lease_until: lease(input.leaseMs, now),
                last_heartbeat_at: now,
                heartbeat_misses: 0,
                time_updated: now,
              })
              .where(and(eq(TeamAssignmentTable.id, input.assignmentID), inArray(TeamAssignmentTable.status, ACTIVE)))
              .run()
            return toAssignment(
              tx.select().from(TeamAssignmentTable).where(eq(TeamAssignmentTable.id, input.assignmentID)).get()!,
            )
          },
          { behavior: "immediate" },
        ),
      )
      return result
    })
    const renewLease = heartbeat

    const report: Interface["report"] = Effect.fn("TeamAssignment.report")(function* (input) {
      return yield* Effect.sync(() =>
        Database.transaction(
          (tx) => {
            const row = tx
              .select()
              .from(TeamAssignmentTable)
              .where(eq(TeamAssignmentTable.id, input.assignmentID))
              .get()
            if (!row) return "not-found" as const
            if (!identityMatches(row, input)) {
              appendEventTx(tx, {
                runID: row.run_id,
                kind: "employee.assignment.stale_report",
                payload: {
                  assignmentID: input.assignmentID,
                  dispatchID: input.dispatchID,
                  attempt: input.attempt,
                  sessionID: input.sessionID,
                  currentAttempt: row.attempt,
                  currentDispatchID: row.dispatch_id,
                  reason: "identity-mismatch",
                },
              })
              return "stale" as const
            }
            const current = row.status as AssignmentStatus
            if (current === "cancelled" || current === "expired" || current === "needs_review") {
              appendEventTx(tx, {
                runID: row.run_id,
                kind: "employee.assignment.stale_report",
                payload: {
                  assignmentID: input.assignmentID,
                  dispatchID: input.dispatchID,
                  attempt: input.attempt,
                  sessionID: input.sessionID,
                  currentStatus: current,
                  reason: "assignment-not-reportable",
                },
              })
              return "stale" as const
            }
            if (current === "reported" || current === "verifying" || current === "succeeded" || current === "failed")
              return "duplicate" as const
            if (!ACTIVE.includes(current) || !canTransition(current, "reported")) return "stale" as const
            const now = Date.now()
            const reportValue: Record<string, unknown> = {
              assignmentID: input.assignmentID,
              dispatchID: input.dispatchID,
              attempt: input.attempt,
              status: input.status,
              ...(input.summary ? { summary: input.summary } : {}),
              ...(input.claims ? { claims: input.claims } : {}),
              ...(input.evidence ? { evidence: input.evidence } : {}),
              ...(input.artifacts ? { artifacts: input.artifacts } : {}),
              ...(input.blockers ? { blockers: input.blockers } : {}),
            }
            tx.update(TeamAssignmentTable)
              .set({
                report: reportValue,
                session_id: row.session_id ?? input.sessionID,
                reported_at: now,
                status: "reported",
                time_updated: now,
              })
              .where(and(eq(TeamAssignmentTable.id, input.assignmentID), eq(TeamAssignmentTable.status, current)))
              .run()
            const updated = tx
              .select()
              .from(TeamAssignmentTable)
              .where(eq(TeamAssignmentTable.id, input.assignmentID))
              .get()!
            const assignment = toAssignment(updated)
            appendEventTx(tx, {
              runID: assignment.runID,
              kind: "employee.assignment.reported",
              payload: eventPayload(assignment, { reportStatus: input.status }),
            })
            return assignment
          },
          { behavior: "immediate" },
        ),
      )
    })

    const verify: Interface["verify"] = Effect.fn("TeamAssignment.verify")(function* (input) {
      return yield* Effect.sync(() =>
        Database.transaction(
          (tx) => {
            const row = tx
              .select()
              .from(TeamAssignmentTable)
              .where(eq(TeamAssignmentTable.id, input.assignmentID))
              .get()
            if (!row || row.status !== "reported") return undefined
            const now = Date.now()
            tx.update(TeamAssignmentTable)
              .set({ status: "verifying", time_updated: now })
              .where(and(eq(TeamAssignmentTable.id, input.assignmentID), eq(TeamAssignmentTable.status, "reported")))
              .run()
            const checking = tx
              .select()
              .from(TeamAssignmentTable)
              .where(eq(TeamAssignmentTable.id, input.assignmentID))
              .get()!
            appendEventTx(tx, {
              runID: row.run_id,
              kind: "employee.assignment.verifying",
              payload: eventPayload(toAssignment(checking)),
            })
            const finalStatus: AssignmentStatus = input.outcome
            const verifiedAt = Date.now()
            tx.update(TeamAssignmentTable)
              .set({
                ...transitionFields(finalStatus, verifiedAt),
                verification: input.verification,
                error: input.error ?? null,
              })
              .where(and(eq(TeamAssignmentTable.id, input.assignmentID), eq(TeamAssignmentTable.status, "verifying")))
              .run()
            const final = toAssignment(
              tx.select().from(TeamAssignmentTable).where(eq(TeamAssignmentTable.id, input.assignmentID)).get()!,
            )
            appendEventTx(tx, {
              runID: final.runID,
              kind: "employee.assignment.verified",
              payload: eventPayload(final, { outcome: input.outcome, ...(input.error ? { error: input.error } : {}) }),
            })
            return final
          },
          { behavior: "immediate" },
        ),
      )
    })

    const cancel: Interface["cancel"] = Effect.fn("TeamAssignment.cancel")(function* (input) {
      return yield* move(input.assignmentID, "cancelled", "employee.assignment.cancelled", {
        ...(input.reason ? { reason: input.reason } : {}),
      })
    })

    const expire: Interface["expire"] = Effect.fn("TeamAssignment.expire")(function* (input) {
      return yield* Effect.sync(() =>
        Database.transaction(
          (tx) => {
            const row = tx
              .select()
              .from(TeamAssignmentTable)
              .where(eq(TeamAssignmentTable.id, input.assignmentID))
              .get()
            if (!row) return undefined
            const from = row.status as AssignmentStatus
            const to = input.status ?? "expired"
            if (!canTransition(from, to)) return undefined
            const now = Date.now()
            tx.update(TeamAssignmentTable)
              .set({
                ...transitionFields(to, now),
                error: input.reason ?? null,
                heartbeat_misses: row.heartbeat_misses + 1,
              })
              .where(and(eq(TeamAssignmentTable.id, input.assignmentID), inArray(TeamAssignmentTable.status, ACTIVE)))
              .run()
            const updated = toAssignment(
              tx.select().from(TeamAssignmentTable).where(eq(TeamAssignmentTable.id, input.assignmentID)).get()!,
            )
            appendEventTx(tx, {
              runID: updated.runID,
              kind: "employee.assignment.expired",
              payload: eventPayload(updated, { from, to, ...(input.reason ? { reason: input.reason } : {}) }),
            })
            return updated
          },
          { behavior: "immediate" },
        ),
      )
    })

    const expireDue: Interface["expireDue"] = Effect.fn("TeamAssignment.expireDue")(function* (input) {
      const now = input?.now ?? Date.now()
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(TeamAssignmentTable)
            .where(
              and(
                inArray(TeamAssignmentTable.status, ACTIVE),
                lte(TeamAssignmentTable.lease_until, now),
                input?.runID ? eq(TeamAssignmentTable.run_id, input.runID) : undefined,
              ),
            )
            .all(),
        ),
      )
      const expired: Assignment[] = []
      for (const row of rows) {
        const result = yield* expire({
          assignmentID: row.id,
          status: input?.status,
          reason: "lease-expired",
        })
        if (result && (result.status === "expired" || result.status === "needs_review")) expired.push(result)
      }
      return expired
    })

    return Service.of({
      create,
      get,
      list,
      deliver,
      accept,
      start,
      heartbeat,
      renewLease,
      report,
      verify,
      cancel,
      expire,
      expireDue,
    })
  }),
)

export const defaultLayer = layer
