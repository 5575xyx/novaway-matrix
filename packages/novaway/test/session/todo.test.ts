import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Todo } from "../../src/session/todo"
import { SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { testEffect } from "../lib/effect"

// 会话表带外键约束,先落一条 project + session 再写 todo。
function seedSession(id: string) {
  const sessionID = SessionID.make(id)
  Database.use((db) => {
    db.insert(ProjectTable).values({ id: ProjectID.global, worktree: "", sandboxes: [] }).onConflictDoNothing().run()
    db.insert(SessionTable)
      .values({ id: sessionID, project_id: ProjectID.global, slug: id, directory: "", title: id, version: "test" })
      .onConflictDoNothing()
      .run()
  })
  return sessionID
}

const freshSession = () => seedSession(`ses_todo_${Date.now()}_${Math.random().toString(36).slice(2)}`)

// getByGoal 是跨会话查询(goal.ts 的进度统计依赖这个语义),测试间用唯一 goalId 隔离。
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`

const it = testEffect(Todo.defaultLayer)

const seed = (
  sessionID: SessionID,
  items: Array<{ content: string; status?: string; priority?: string; goalId?: string }>,
) =>
  Todo.Service.use((svc) =>
    svc.update({
      sessionID,
      todos: items.map((item) => ({
        content: item.content,
        status: item.status ?? "pending",
        priority: item.priority ?? "medium",
        ...(item.goalId ? { goalId: item.goalId } : {}),
      })),
    }),
  )

const list = (sessionID: SessionID) => Todo.Service.use((svc) => svc.get(sessionID))

describe("Todo service", () => {
  it.instance("update persists goalId onto the row", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      const goal = `goal_${uid()}`
      yield* seed(sessionID, [
        { content: "one", goalId: goal },
        { content: "two", priority: "low" },
      ])

      expect(yield* list(sessionID)).toEqual([
        { content: "one", status: "pending", priority: "medium", goalId: goal },
        { content: "two", status: "pending", priority: "low" },
      ])
    }),
  )

  it.instance("updateSingle only changes the targeted row", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "a" }, { content: "b" }, { content: "c" }])

      const svc = yield* Todo.Service
      yield* svc.updateSingle({ sessionID, position: 1, status: "completed" })

      const rows = yield* list(sessionID)
      expect(rows.map((row) => row.status)).toEqual(["pending", "completed", "pending"])
      expect(rows.map((row) => row.content)).toEqual(["a", "b", "c"])
    }),
  )

  it.instance("updateSingle replaces content on a single row", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "old", priority: "high" }, { content: "keep" }])

      const svc = yield* Todo.Service
      yield* svc.updateSingle({ sessionID, position: 0, content: "new" })

      expect(yield* list(sessionID)).toEqual([
        { content: "new", status: "pending", priority: "high" },
        { content: "keep", status: "pending", priority: "medium" },
      ])
    }),
  )

  it.instance("updateSingle fails for a missing position", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "only" }])

      const svc = yield* Todo.Service
      const exit = yield* svc.updateSingle({ sessionID, position: 9, status: "completed" }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.instance("remove deletes only the targeted row and reindexes the rest", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "a" }, { content: "b" }, { content: "c" }, { content: "d" }])

      const svc = yield* Todo.Service
      yield* svc.remove({ sessionID, position: 1 })

      expect((yield* list(sessionID)).map((row) => row.content)).toEqual(["a", "c", "d"])
    }),
  )

  it.instance("remove from the front reindexes from zero", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "a" }, { content: "b" }, { content: "c" }])

      const svc = yield* Todo.Service
      yield* svc.remove({ sessionID, position: 0 })

      expect((yield* list(sessionID)).map((row) => row.content)).toEqual(["b", "c"])
    }),
  )

  it.instance("remove keeps sibling sessions untouched", () =>
    Effect.gen(function* () {
      const first = freshSession()
      const second = freshSession()
      yield* seed(first, [{ content: "f1" }, { content: "f2" }])
      yield* seed(second, [{ content: "s1" }, { content: "s2" }, { content: "s3" }])

      const svc = yield* Todo.Service
      yield* svc.remove({ sessionID: first, position: 0 })

      const [firstRows, secondRows] = yield* Effect.zip(list(first), list(second))
      expect(firstRows.map((row) => row.content)).toEqual(["f2"])
      expect(secondRows.map((row) => row.content)).toEqual(["s1", "s2", "s3"])
    }),
  )

  it.instance("add appends after the current max position", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "a" }, { content: "b" }])

      const svc = yield* Todo.Service
      yield* svc.add({ sessionID, content: "c", priority: "high", goalId: "goal_9" })

      const rows = yield* list(sessionID)
      expect(rows.map((row) => row.content)).toEqual(["a", "b", "c"])
      expect(rows.at(-1)).toEqual({ content: "c", status: "pending", priority: "high", goalId: "goal_9" })
    }),
  )

  it.instance("getByGoal returns only todos bound to that goal", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      const goal = `goal_${uid()}`
      const other = `goal_${uid()}`
      yield* seed(sessionID, [
        { content: "g1-a", goalId: goal },
        { content: "g2-a", goalId: other },
        { content: "loose" },
        { content: "g1-b", goalId: goal },
      ])

      const rows = yield* Todo.Service.use((svc) => svc.getByGoal(goal))
      expect(rows.map((row) => row.content)).toEqual(["g1-a", "g1-b"])
      expect(rows.every((row) => row.goalId === goal)).toBe(true)
    }),
  )

  it.instance("update with an empty list clears the session", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "a" }, { content: "b" }])

      const svc = yield* Todo.Service
      yield* svc.update({ sessionID, todos: [] })

      expect(yield* list(sessionID)).toEqual([])
    }),
  )
})
