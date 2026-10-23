import { Context, Effect, Layer } from "effect"
import { and, eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import type { SessionID } from "@/session/schema"
import { AgentTaskTable } from "./team.sql"

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled"

export type Task = {
  id: string
  teamID: string
  subject: string
  description: string
  activeForm?: string
  status: TaskStatus
  ownerSessionID?: SessionID
  blocks: string[]
  blockedBy: string[]
  metadata: Record<string, unknown>
  createdBy?: SessionID
  createdAt: number
  updatedAt: number
}

export interface Interface {
  readonly create: (input: {
    teamID: string
    subject: string
    description: string
    activeForm?: string
    metadata?: Record<string, unknown>
    createdBy?: SessionID
    blockedBy?: string[]
  }) => Effect.Effect<Task>
  readonly get: (taskID: string) => Effect.Effect<Task | undefined>
  readonly list: (teamID: string) => Effect.Effect<Task[]>
  readonly update: (input: {
    taskID: string
    subject?: string
    description?: string
    status?: TaskStatus
    ownerSessionID?: SessionID | null
    addBlocks?: string[]
    addBlockedBy?: string[]
    metadata?: Record<string, unknown>
  }) => Effect.Effect<Task | undefined>
  /** Atomically claim an unowned, unblocked, pending task. */
  readonly claim: (input: { taskID: string; sessionID: SessionID }) => Effect.Effect<Task | undefined>
  readonly ready: (teamID: string) => Effect.Effect<Task[]>
  readonly remove: (taskID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/AgentTaskList") {}

const id = () => `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`

function toTask(row: typeof AgentTaskTable.$inferSelect): Task {
  return {
    id: row.id,
    teamID: row.team_id,
    subject: row.subject,
    description: row.description,
    activeForm: row.active_form ?? undefined,
    status: row.status as TaskStatus,
    ownerSessionID: (row.owner_session_id ?? undefined) as SessionID | undefined,
    blocks: row.blocks ?? [],
    blockedBy: row.blocked_by ?? [],
    metadata: row.metadata ?? {},
    createdBy: (row.created_by ?? undefined) as SessionID | undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const create: Interface["create"] = Effect.fn("AgentTaskList.create")(function* (input) {
      const now = Date.now()
      const task: Task = {
        id: id(),
        teamID: input.teamID,
        subject: input.subject,
        description: input.description,
        activeForm: input.activeForm,
        status: "pending",
        blocks: [],
        blockedBy: input.blockedBy ?? [],
        metadata: input.metadata ?? {},
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      }
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(AgentTaskTable)
            .values({
              id: task.id,
              team_id: task.teamID,
              subject: task.subject,
              description: task.description,
              active_form: task.activeForm ?? null,
              status: task.status,
              owner_session_id: null,
              blocks: [],
              blocked_by: task.blockedBy,
              metadata: task.metadata,
              created_by: task.createdBy ?? null,
              created_at: now,
              updated_at: now,
            })
            .run(),
        ),
      )
      return task
    })

    const get: Interface["get"] = Effect.fn("AgentTaskList.get")(function* (taskID) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(AgentTaskTable).where(eq(AgentTaskTable.id, taskID)).get()),
      )
      return row ? toTask(row) : undefined
    })

    const list: Interface["list"] = Effect.fn("AgentTaskList.list")(function* (teamID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(AgentTaskTable).where(eq(AgentTaskTable.team_id, teamID)).all()),
      )
      return rows.map(toTask).sort((a, b) => a.createdAt - b.createdAt)
    })

    const update: Interface["update"] = Effect.fn("AgentTaskList.update")(function* (input) {
      const current = yield* get(input.taskID)
      if (!current) return undefined
      const next: Task = {
        ...current,
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.ownerSessionID !== undefined ? { ownerSessionID: input.ownerSessionID ?? undefined } : {}),
        blocks: [...new Set([...current.blocks, ...(input.addBlocks ?? [])])],
        blockedBy: [...new Set([...current.blockedBy, ...(input.addBlockedBy ?? [])])],
        metadata: { ...current.metadata, ...(input.metadata ?? {}) },
        updatedAt: Date.now(),
      }
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(AgentTaskTable)
            .set({
              subject: next.subject,
              description: next.description,
              status: next.status,
              owner_session_id: next.ownerSessionID ?? null,
              blocks: next.blocks,
              blocked_by: next.blockedBy,
              metadata: next.metadata,
              updated_at: next.updatedAt,
            })
            .where(eq(AgentTaskTable.id, next.id))
            .run(),
        ),
      )
      return next
    })

    const claim: Interface["claim"] = Effect.fn("AgentTaskList.claim")(function* (input) {
      const current = yield* get(input.taskID)
      if (!current) return undefined
      if (current.status !== "pending" || current.ownerSessionID) return undefined
      if (current.blockedBy.length > 0) return undefined

      const now = Date.now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(AgentTaskTable)
            .set({ owner_session_id: input.sessionID, status: "in_progress", updated_at: now })
            .where(and(eq(AgentTaskTable.id, input.taskID), eq(AgentTaskTable.status, "pending")))
            .run(),
        ),
      )

      const next = yield* get(input.taskID)
      if (!next || next.ownerSessionID !== input.sessionID) return undefined
      return next
    })

    const ready: Interface["ready"] = Effect.fn("AgentTaskList.ready")(function* (teamID) {
      const tasks = yield* list(teamID)
      const completed = new Set(tasks.filter((task) => task.status === "completed").map((task) => task.id))
      return tasks.filter(
        (task) =>
          task.status === "pending" &&
          !task.ownerSessionID &&
          task.blockedBy.every((dependency) => completed.has(dependency)),
      )
    })

    const remove: Interface["remove"] = Effect.fn("AgentTaskList.remove")(function* (taskID) {
      yield* Effect.sync(() =>
        Database.use((db) => db.delete(AgentTaskTable).where(eq(AgentTaskTable.id, taskID)).run()),
      )
    })

    return Service.of({ create, get, list, update, claim, ready, remove })
  }),
)

export const defaultLayer = layer

export * as AgentTaskList from "./task-list"
