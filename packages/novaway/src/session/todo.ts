import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import { Effect, Layer, Context, Schema } from "effect"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { asc } from "drizzle-orm"
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
    todoId: string
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

    const add = Effect.fn("Todo.add")(function* (input: {
      sessionID: SessionID
      content: string
      priority?: Info["priority"]
      goalId?: string
    }) {
      const result = yield* Effect.sync(() =>
        Database.transaction((db) => {
          const maxPosition = db
            .select({ max: TodoTable.position })
            .from(TodoTable)
            .where(eq(TodoTable.session_id, input.sessionID))
            .all()
          const position = maxPosition.length > 0 ? (maxPosition[0].max ?? -1) + 1 : 0

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
      return result
    })

    const updateSingle = Effect.fn("Todo.updateSingle")(function* (input: {
      todoId: string
      sessionID: SessionID
      status?: Info["status"]
      content?: string
    }) {
      const result = yield* Effect.sync(() =>
        Database.transaction((db) => {
          const todo = db
            .select()
            .from(TodoTable)
            .where(eq(TodoTable.session_id, input.sessionID))
            .all()
            .find((t) => t.content === input.todoId || `${t.session_id}_${t.position}` === input.todoId)

          if (!todo) throw new Error("Todo not found")

          db.update(TodoTable)
            .set({
              ...(input.status && { status: input.status }),
              ...(input.content && { content: input.content }),
            })
            .where(eq(TodoTable.session_id, input.sessionID))
            .run()

          return {
            content: input.content ?? todo.content,
            status: input.status ?? todo.status,
            priority: todo.priority,
            goalId: todo.goal_id ?? undefined,
          }
        }),
      )
      return result
    })

    const remove = Effect.fn("Todo.remove")(function* (input: { sessionID: SessionID; position: number }) {
      yield* Effect.sync(() =>
        Database.transaction((db) => {
          db.delete(TodoTable)
            .where(eq(TodoTable.session_id, input.sessionID))
            .run()

          const remaining = db
            .select()
            .from(TodoTable)
            .where(eq(TodoTable.session_id, input.sessionID))
            .orderBy(asc(TodoTable.position))
            .all()

          remaining.forEach((todo, index) => {
            db.update(TodoTable).set({ position: index }).where(eq(TodoTable.session_id, input.sessionID)).run()
          })
        }),
      )
    })

    const getByGoal = Effect.fn("Todo.getByGoal")(function* (goalId: string) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(TodoTable).where(eq(TodoTable.goal_id, goalId))),
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
