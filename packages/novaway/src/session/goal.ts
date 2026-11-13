import { Context, Effect, Layer } from "effect"
import { and, eq, sql } from "drizzle-orm"
import { Database } from "@/storage/db"
import { GoalBudgetTable, GoalTable, type GoalProgress } from "./goal.sql"
import { TodoTable as GoalTodoTable } from "./session.sql"
import { NotFoundError } from "@/storage/storage"
import { SessionID } from "./schema"
import type { Budget } from "./goal-budget"

export interface Goal {
  readonly id: string
  readonly sessionId: string
  readonly parentId: string | null
  readonly title: string
  readonly description: string | null
  readonly status: "pending" | "in_progress" | "paused" | "completed" | "cancelled"
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
    sessionId: SessionID
    parentId?: string
    title: string
    description?: string
    status?: "pending" | "in_progress"
    priority?: Goal["priority"]
    successCriteria?: string[]
    deadline?: Date
    tags?: string[]
  }) => Effect.Effect<Goal, NotFoundError>

  readonly list: (sessionId: SessionID) => Effect.Effect<readonly Goal[]>

  readonly get: (input: { goalId: string; sessionId: SessionID }) => Effect.Effect<Goal | null>

  readonly update: (input: {
    goalId: string
    sessionId: SessionID
    title?: string
    description?: string
    status?: Goal["status"]
    priority?: Goal["priority"]
    successCriteria?: string[]
    deadline?: Date
    tags?: string[]
  }) => Effect.Effect<Goal, NotFoundError>

  readonly delete: (input: { goalId: string; sessionId: SessionID }) => Effect.Effect<void, NotFoundError>

  readonly getProgress: (input: { goalId: string; sessionId: SessionID }) => Effect.Effect<GoalProgress, NotFoundError>

  readonly updateProgress: (input: { goalId: string; sessionId: SessionID }) => Effect.Effect<void, NotFoundError>

  /** 读取（或首次创建）目标的持久预算，startedAt 只在创建时写入。 */
  readonly budget: (input: { goalId: string; sessionId: SessionID; startedAt: number }) => Effect.Effect<Budget>

  /** 记一轮续跑，并把本轮消耗的 token 增量累加进预算。 */
  readonly chargeBudget: (input: { goalId: string; sessionId: SessionID; tokens: number }) => Effect.Effect<Budget>
}

export class Service extends Context.Service<Service, Interface>()("@novaway/GoalService") {}
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
      sessionId: SessionID
      parentId?: string
      title: string
      description?: string
      status?: "pending" | "in_progress"
      priority?: Goal["priority"]
      successCriteria?: string[]
      deadline?: Date
      tags?: string[]
    }) {
      if (input.parentId) {
        const parent = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select({ id: GoalTable.id })
              .from(GoalTable)
              .where(and(eq(GoalTable.id, input.parentId!), eq(GoalTable.session_id, input.sessionId)))
              .limit(1)
              .all(),
          ),
        )
        if (parent.length === 0)
          return yield* new NotFoundError({ message: `Parent goal not found: ${input.parentId}` })
      }

      const now = new Date()
      const goal: Goal = {
        id: generateId(),
        sessionId: input.sessionId,
        parentId: input.parentId ?? null,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "pending",
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
          db
            .insert(GoalTable)
            .values({
              id: goal.id,
              session_id: goal.sessionId,
              parent_id: goal.parentId,
              title: goal.title,
              description: goal.description,
              status: goal.status,
              priority: goal.priority,
              success_criteria: goal.successCriteria ? JSON.stringify(goal.successCriteria) : null,
              deadline: goal.deadline ?? null,
              progress: goal.progress,
              tags: goal.tags,
              created_at: goal.createdAt,
              updated_at: goal.updatedAt,
            })
            .run(),
        ),
      )

      return goal
    })

    const list = Effect.fn("GoalService.list")(function* (sessionId: SessionID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select({
              id: GoalTable.id,
              session_id: GoalTable.session_id,
              parent_id: GoalTable.parent_id,
              title: GoalTable.title,
              description: GoalTable.description,
              status: GoalTable.status,
              priority: GoalTable.priority,
              success_criteria: GoalTable.success_criteria,
              deadline: GoalTable.deadline,
              progress: GoalTable.progress,
              tags: GoalTable.tags,
              created_at: GoalTable.created_at,
              updated_at: GoalTable.updated_at,
              todo_total: sql<number>`count(${GoalTodoTable.session_id})`,
              todo_completed: sql<number>`sum(case when ${GoalTodoTable.status} = 'completed' then 1 else 0 end)`,
            })
            .from(GoalTable)
            .leftJoin(
              GoalTodoTable,
              and(eq(GoalTodoTable.goal_id, GoalTable.id), eq(GoalTodoTable.session_id, sessionId)),
            )
            .where(eq(GoalTable.session_id, sessionId))
            .groupBy(GoalTable.id)
            .orderBy(GoalTable.created_at)
            .all(),
        ),
      )
      return rows.map((row) =>
        toGoal({ ...row, progress: row.todo_total > 0 ? (row.todo_completed / row.todo_total) * 100 : 0 }),
      )
    })

    const get = Effect.fn("GoalService.get")(function* (input: { goalId: string; sessionId: SessionID }) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(GoalTable)
            .where(and(eq(GoalTable.id, input.goalId), eq(GoalTable.session_id, input.sessionId)))
            .limit(1)
            .all(),
        ),
      )
      return rows.length === 0 ? null : toGoal(rows[0])
    })

    const update = Effect.fn("GoalService.update")(function* (input: {
      goalId: string
      sessionId: SessionID
      title?: string
      description?: string
      status?: Goal["status"]
      priority?: Goal["priority"]
      successCriteria?: string[]
      deadline?: Date
      tags?: string[]
    }) {
      const now = new Date()
      const rowsUpdated = yield* Effect.sync(() =>
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
                deadline: input.deadline ?? null,
              }),
              ...(input.tags !== undefined && { tags: input.tags }),
              updated_at: now,
            })
            .where(
              and(
                eq(GoalTable.id, input.goalId),
                eq(GoalTable.session_id, input.sessionId),
                ...(input.status === "completed" || input.status === "cancelled"
                  ? [
                      input.status === "completed"
                        ? eq(GoalTable.status, "in_progress")
                        : sql`${GoalTable.status} in ('in_progress', 'paused')`,
                    ]
                  : []),
              ),
            )
            .returning({ id: GoalTable.id })
            .all(),
        ),
      )

      if (rowsUpdated.length === 0) {
        const current = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(GoalTable)
              .where(and(eq(GoalTable.id, input.goalId), eq(GoalTable.session_id, input.sessionId)))
              .limit(1)
              .all(),
          ),
        )
        if (current.length === 0) return yield* new NotFoundError({ message: `Goal not found: ${input.goalId}` })
        return toGoal(current[0])
      }

      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(GoalTable)
            .where(and(eq(GoalTable.id, input.goalId), eq(GoalTable.session_id, input.sessionId)))
            .limit(1)
            .all(),
        ),
      )
      if (rows.length === 0) return yield* new NotFoundError({ message: `Goal not found: ${input.goalId}` })
      return toGoal(rows[0])
    })

    const deleteGoal = Effect.fn("GoalService.delete")(function* (input: { goalId: string; sessionId: SessionID }) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .delete(GoalTable)
            .where(and(eq(GoalTable.id, input.goalId), eq(GoalTable.session_id, input.sessionId)))
            .returning({ id: GoalTable.id })
            .all(),
        ),
      )
      if (rows.length === 0) return yield* new NotFoundError({ message: `Goal not found: ${input.goalId}` })
    })

    const getProgress = Effect.fn("GoalService.getProgress")(function* (input: {
      goalId: string
      sessionId: SessionID
    }) {
      if (!(yield* get(input))) return yield* new NotFoundError({ message: `Goal not found: ${input.goalId}` })
      const todos = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(GoalTodoTable)
            .where(and(eq(GoalTodoTable.goal_id, input.goalId), eq(GoalTodoTable.session_id, input.sessionId)))
            .all(),
        ),
      )

      const total = todos.length
      const completed = todos.filter((t) => t.status === "completed").length
      const percentage = total > 0 ? (completed / total) * 100 : 0

      return { total, completed, percentage }
    })

    const updateProgress = Effect.fn("GoalService.updateProgress")(function* (input: {
      goalId: string
      sessionId: SessionID
    }) {
      const progress = yield* getProgress(input)
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(GoalTable)
            .set({ progress: progress.percentage, updated_at: new Date() })
            .where(and(eq(GoalTable.id, input.goalId), eq(GoalTable.session_id, input.sessionId)))
            .run(),
        ),
      )
    })

    const readBudget = (goalId: string) =>
      Effect.sync(() =>
        Database.use((db) =>
          db.select().from(GoalBudgetTable).where(eq(GoalBudgetTable.goal_id, goalId)).limit(1).get(),
        ),
      ).pipe(
        Effect.map((row): Budget | undefined =>
          row ? { turns: row.turns, tokens: row.tokens, startedAt: Number(row.started_at) } : undefined,
        ),
      )

    const budget = Effect.fn("GoalService.budget")(function* (input: {
      goalId: string
      sessionId: SessionID
      startedAt: number
    }) {
      const existing = yield* readBudget(input.goalId)
      if (existing) return existing
      const now = new Date()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(GoalBudgetTable)
            .values({
              goal_id: input.goalId,
              session_id: input.sessionId,
              turns: 0,
              tokens: 0,
              started_at: new Date(input.startedAt),
              updated_at: now,
            })
            .onConflictDoNothing()
            .run(),
        ),
      )
      return (yield* readBudget(input.goalId)) ?? { turns: 0, tokens: 0, startedAt: input.startedAt }
    })

    const chargeBudget = Effect.fn("GoalService.chargeBudget")(function* (input: {
      goalId: string
      sessionId: SessionID
      tokens: number
    }) {
      const delta = Math.max(0, Math.floor(input.tokens))
      const now = new Date()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(GoalBudgetTable)
            .set({
              turns: sql`${GoalBudgetTable.turns} + 1`,
              tokens: sql`${GoalBudgetTable.tokens} + ${delta}`,
              updated_at: now,
            })
            .where(eq(GoalBudgetTable.goal_id, input.goalId))
            .run(),
        ),
      )
      return (yield* readBudget(input.goalId)) ?? { turns: 0, tokens: delta, startedAt: 0 }
    })

    return Service.of({
      create,
      list,
      get,
      update,
      delete: deleteGoal,
      getProgress,
      updateProgress,
      budget,
      chargeBudget,
    })
  }),
)

export const defaultLayer = layer

export * as Goal from "./goal"
