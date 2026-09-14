import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import { Effect, Layer, Context, Schema } from "effect"
import { Database } from "@/storage/db"
import { asc, and, eq, sql } from "drizzle-orm"
import { TodoTable } from "./session.sql"

export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({ description: "Priority level of the task: high, medium, low" }),
  goalId: Schema.optional(Schema.String.annotate({ description: "ID of the goal this todo is associated with" })),
}).annotate({ identifier: "Todo" })
export type Info = Schema.Schema.Type<typeof Info>

export const Event = {
  Updated: BusEvent.define(
    "todo.updated",
    Schema.Struct({
      sessionID: SessionID,
      todos: Schema.Array(Info),
    }),
  ),
}

export interface Interface {
  readonly update: (input: { sessionID: SessionID; todos: Info[] }) => Effect.Effect<void>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info[]>
  readonly add: (input: {
    sessionID: SessionID
    content: string
    priority?: Info["priority"]
    goalId?: string
  }) => Effect.Effect<Info>
  readonly updateSingle: (input: {
    position: number
    sessionID: SessionID
    status?: Info["status"]
    content?: string
  }) => Effect.Effect<Info>
  readonly remove: (input: { sessionID: SessionID; position: number }) => Effect.Effect<void>
  readonly getByGoal: (goalId: string) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/SessionTodo") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const update = Effect.fn("Todo.update")(function* (input: { sessionID: SessionID; todos: Info[] }) {
      yield* Effect.sync(() =>
        Database.transaction((db) => {
          db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
          if (input.todos.length === 0) return
          db.insert(TodoTable)
            .values(
              input.todos.map((todo, position) => ({
                session_id: input.sessionID,
                content: todo.content,
                status: todo.status,
                priority: todo.priority,
                goal_id: todo.goalId ?? null,
                position,
              })),
            )
            .run()
        }),
      )
      yield* bus.publish(Event.Updated, input)
    })

    const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).orderBy(asc(TodoTable.position)).all(),
        ),
      )
      return rows.map((row) => ({
        content: row.content,
        status: row.status,
        priority: row.priority,
        goalId: row.goal_id ?? undefined,
      }))
    })

    // 单条写入的方法也必须发同一条 Updated 事件,否则侧栏和插件槽收不到变更。
    const publishUpdated = (sessionID: SessionID) =>
      Effect.gen(function* () {
        yield* bus.publish(Event.Updated, { sessionID, todos: yield* get(sessionID) })
      })

    const add = Effect.fn("Todo.add")(function* (input: {
      sessionID: SessionID
      content: string
      priority?: Info["priority"]
      goalId?: string
    }) {
      const result = yield* Effect.sync(() =>
        Database.transaction((db) => {
          const maxPosition = db
            .select({ value: sql<number>`max(${TodoTable.position})` })
            .from(TodoTable)
            .where(eq(TodoTable.session_id, input.sessionID))
            .get()
          const position = (maxPosition?.value ?? -1) + 1

          db.insert(TodoTable)
            .values({
              session_id: input.sessionID,
              content: input.content,
              status: "pending",
              priority: input.priority ?? "medium",
              goal_id: input.goalId ?? null,
              position,
            })
            .run()

          return { content: input.content, status: "pending", priority: input.priority ?? "medium", goalId: input.goalId }
        }),
      )
      yield* publishUpdated(input.sessionID)
      return result
    })

    const updateSingle = Effect.fn("Todo.updateSingle")(function* (input: {
      position: number
      sessionID: SessionID
      status?: Info["status"]
      content?: string
    }) {
      const result = yield* Effect.sync(() =>
        Database.transaction((db) => {
          const todo = db
            .select()
            .from(TodoTable)
            .where(and(eq(TodoTable.session_id, input.sessionID), eq(TodoTable.position, input.position)))
            .get()

          if (!todo) throw new Error(`Todo not found at position ${input.position}`)

          db.update(TodoTable)
            .set({
              ...(input.status && { status: input.status }),
              ...(input.content && { content: input.content }),
            })
            .where(and(eq(TodoTable.session_id, input.sessionID), eq(TodoTable.position, input.position)))
            .run()

          return {
            content: input.content ?? todo.content,
            status: input.status ?? todo.status,
            priority: todo.priority,
            goalId: todo.goal_id ?? undefined,
          }
        }),
      )
      yield* publishUpdated(input.sessionID)
      return result
    })

    const remove = Effect.fn("Todo.remove")(function* (input: { sessionID: SessionID; position: number }) {
      yield* Effect.sync(() =>
        Database.transaction((db) => {
          db.delete(TodoTable)
            .where(and(eq(TodoTable.session_id, input.sessionID), eq(TodoTable.position, input.position)))
            .run()

          const remaining = db
            .select()
            .from(TodoTable)
            .where(eq(TodoTable.session_id, input.sessionID))
            .orderBy(asc(TodoTable.position))
            .all()

          remaining.forEach((todo, index) => {
            if (todo.position === index) return
            db.update(TodoTable)
              .set({ position: index })
              .where(and(eq(TodoTable.session_id, input.sessionID), eq(TodoTable.position, todo.position)))
              .run()
          })
        }),
      )
      yield* publishUpdated(input.sessionID)
    })

    const getByGoal = Effect.fn("Todo.getByGoal")(function* (goalId: string) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(TodoTable).where(eq(TodoTable.goal_id, goalId)).all()),
      )
      return rows.map((row) => ({
        content: row.content,
        status: row.status,
        priority: row.priority,
        goalId: row.goal_id ?? undefined,
      }))
    })

    return Service.of({ update, get, add, updateSingle, remove, getByGoal })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as Todo from "./todo"
