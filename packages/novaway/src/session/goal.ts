import { Context, Effect, Layer } from "effect"
import { eq, and } from "drizzle-orm"
import { Database } from "@/storage/db"
import { GoalTable, type GoalProgress } from "./goal.sql"
import { TodoTable } from "./session.sql"

export interface Goal {
  readonly id: string
  readonly sessionId: string
  readonly parentId: string | null
  readonly title: string
  readonly description: string | null
  readonly status: "pending" | "in_progress" | "completed" | "cancelled"
  readonly priority: "high" | "medium" | "low"
  readonly successCriteria: string[] | null
  readonly deadline: Date | null
  readonly progress: number
  readonly tags: string[]
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface Interface {
  readonly create: (input: {
    sessionId: string
    parentId?: string
    title: string
    description?: string
    priority?: Goal["priority"]
    successCriteria?: string[]
    deadline?: Date
    tags?: string[]
  }) => Effect.Effect<Goal>

  readonly list: (sessionId: string) => Effect.Effect<readonly Goal[]>

  readonly get: (goalId: string) => Effect.Effect<Goal | null>

  readonly update: (input: {
    goalId: string
    title?: string
    description?: string
    status?: Goal["status"]
    priority?: Goal["priority"]
    successCriteria?: string[]
    deadline?: Date
    tags?: string[]
  }) => Effect.Effect<Goal>

  readonly delete: (goalId: string) => Effect.Effect<void>

  readonly getProgress: (goalId: string) => Effect.Effect<GoalProgress>

  readonly updateProgress: (goalId: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/GoalService") {}
export { Service as GoalService }

const generateId = () => `goal_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const toGoal = (row: any): Goal => ({
      id: row.id,
      sessionId: row.session_id,
      parentId: row.parent_id,
      title: row.title,
      description: row.description,
      status: row.status as Goal["status"],
      priority: row.priority as Goal["priority"],
      successCriteria: row.success_criteria ? JSON.parse(row.success_criteria) : null,
      deadline: row.deadline ? new Date(row.deadline) : null,
      progress: row.progress,
      tags: (row.tags as string[]) ?? [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    })

    const create = Effect.fn("GoalService.create")(function* (input: {
      sessionId: string
      parentId?: string
      title: string
      description?: string
      priority?: Goal["priority"]
      successCriteria?: string[]
      deadline?: Date
      tags?: string[]
    }) {
      const now = new Date()
      const goal: Goal = {
        id: generateId(),
        sessionId: input.sessionId,
        parentId: input.parentId ?? null,
        title: input.title,
        description: input.description ?? null,
        status: "pending",
        priority: input.priority ?? "medium",
        successCriteria: input.successCriteria ?? null,
        deadline: input.deadline ?? null,
        progress: 0,
        tags: input.tags ?? [],
        createdAt: now,
        updatedAt: now,
      }

      yield* Effect.sync(() =>
        Database.use((db) =>
          db.insert(GoalTable).values({
            id: goal.id,
            session_id: goal.sessionId,
            parent_id: goal.parentId,
            title: goal.title,
            description: goal.description,
            status: goal.status,
            priority: goal.priority,
            success_criteria: goal.successCriteria ? JSON.stringify(goal.successCriteria) : null,
            deadline: goal.deadline?.getTime() ?? null,
            progress: goal.progress,
            tags: goal.tags,
            created_at: goal.createdAt.getTime(),
            updated_at: goal.updatedAt.getTime(),
          })
          .run(),
        ),
      )

      return goal
    })

    const list = Effect.fn("GoalService.list")(function* (sessionId: string) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(GoalTable).where(eq(GoalTable.session_id, sessionId)).orderBy(GoalTable.created_at).all(),
        ),
      )
      return rows.map(toGoal)
    })

    const get = Effect.fn("GoalService.get")(function* (goalId: string) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(GoalTable).where(eq(GoalTable.id, goalId)).limit(1).all()),
      )
      if (rows.length === 0) return null
      return toGoal(rows[0])
    })

    const update = Effect.fn("GoalService.update")(function* (input: {
      goalId: string
      title?: string
      description?: string
      status?: Goal["status"]
      priority?: Goal["priority"]
      successCriteria?: string[]
      deadline?: Date
      tags?: string[]
    }) {
      const now = new Date()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(GoalTable)
            .set({
              ...(input.title && { title: input.title }),
              ...(input.description !== undefined && { description: input.description }),
              ...(input.status && { status: input.status }),
              ...(input.priority && { priority: input.priority }),
              ...(input.successCriteria !== undefined && {
                success_criteria: input.successCriteria ? JSON.stringify(input.successCriteria) : null,
              }),
              ...(input.deadline !== undefined && {
                deadline: input.deadline?.getTime() ?? null,
              }),
              ...(input.tags !== undefined && { tags: input.tags }),
              updated_at: now.getTime(),
            })
            .where(eq(GoalTable.id, input.goalId))
            .run(),
        ),
      )

      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(GoalTable).where(eq(GoalTable.id, input.goalId)).limit(1).all()),
      )

      return toGoal(rows[0])
    })

    const deleteGoal = Effect.fn("GoalService.delete")(function* (goalId: string) {
      yield* Effect.sync(() => Database.use((db) => db.delete(GoalTable).where(eq(GoalTable.id, goalId)).run()))
    })

    const getProgress = Effect.fn("GoalService.getProgress")(function* (goalId: string) {
      const todos = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(TodoTable).where(eq(TodoTable.goal_id, goalId)).all()),
      )

      const total = todos.length
      const completed = todos.filter((t) => t.status === "completed").length
      const percentage = total > 0 ? (completed / total) * 100 : 0

      return { total, completed, percentage }
    })

    const updateProgress = Effect.fn("GoalService.updateProgress")(function* (goalId: string) {
      const progress = yield* getProgress(goalId)
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(GoalTable)
            .set({ progress: progress.percentage, updated_at: Date.now() })
            .where(eq(GoalTable.id, goalId))
            .run(),
        ),
      )
    })

    return Service.of({ create, list, get, update, delete: deleteGoal, getProgress, updateProgress })
  }),
)

export const defaultLayer = layer

export * as Goal from "./goal"
