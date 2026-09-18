import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Todo } from "../../src/session/todo"
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { Tool } from "../../src/tool/tool"
import { TodoEditTool } from "../../src/tool/todo"
import { Truncate } from "../../src/tool/truncate"
import { testEffect } from "../lib/effect"

// 工具包装层会截断输出并查一次 agent,所以除了 Todo 还要提供 Truncate 和 Agent。
const it = testEffect(Layer.mergeAll(Todo.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer))

function seedSession(id: string): SessionID {
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

const freshSession = () => seedSession(`ses_todoedit_${Date.now()}_${Math.random().toString(36).slice(2)}`)

const ctx = (sessionID: SessionID): Tool.Context => ({
  sessionID,
  messageID: MessageID.ascending(),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

type ToolResult = { title: string; output: string; metadata: { todos: Todo.Info[]; truncated: boolean } }

const call = (args: unknown, sessionID: SessionID) =>
  Effect.gen(function* () {
    const def = yield* Tool.init(yield* TodoEditTool)
    const execute = def.execute as unknown as (args: unknown, context: Tool.Context) => Effect.Effect<ToolResult>
    return yield* execute(args, ctx(sessionID))
  })

const seed = (sessionID: SessionID, items: Array<{ content: string; status?: string; priority?: string }>) =>
  Todo.Service.use((svc) =>
    svc.update({
      sessionID,
      todos: items.map((item) => ({
        content: item.content,
        status: item.status ?? "pending",
        priority: item.priority ?? "medium",
      })),
    }),
  )

const rows = (sessionID: SessionID) => Todo.Service.use((svc) => svc.get(sessionID))

describe("todoedit", () => {
  it.instance("add appends an item with priority and goal", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "a" }])

      const result = yield* call({ action: "add", content: "  c  ", priority: "high", goalId: "goal_1" }, sessionID)

      expect((yield* rows(sessionID)).map((row) => row.content)).toEqual(["a", "c"])
      expect(result.metadata.todos.at(-1)).toEqual({
        content: "c",
        status: "pending",
        priority: "high",
        goalId: "goal_1",
      })
      expect(result.output).toContain("1. [ ] c")
      expect(result.output).toContain("0/2 completed")
    }),
  )

  it.instance("edit replaces content without touching status or priority", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "old", status: "in_progress", priority: "high" }, { content: "keep" }])

      yield* call({ action: "edit", position: 0, content: "new" }, sessionID)

      expect(yield* rows(sessionID)).toEqual([
        { content: "new", status: "in_progress", priority: "high" },
        { content: "keep", status: "pending", priority: "medium" },
      ])
    }),
  )

  it.instance("complete progress reopen and cancel set the requested status", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "a" }, { content: "b" }, { content: "c" }, { content: "d" }])

      yield* call({ action: "progress", position: 0 }, sessionID)
      yield* call({ action: "complete", position: 1 }, sessionID)
      yield* call({ action: "cancel", position: 2 }, sessionID)
      yield* call({ action: "reopen", position: 3 }, sessionID)

      expect((yield* rows(sessionID)).map((row) => row.status)).toEqual([
        "in_progress",
        "completed",
        "cancelled",
        "pending",
      ])
    }),
  )

  it.instance("remove deletes the item and reindexes the rest", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "a" }, { content: "b" }, { content: "c" }])

      const result = yield* call({ action: "remove", position: 0 }, sessionID)

      expect((yield* rows(sessionID)).map((row) => row.content)).toEqual(["b", "c"])
      expect(result.output).toContain("0. [ ] b")
      expect(result.output).toContain("1. [ ] c")
    }),
  )

  it.instance("rejects an out of range position without changing the list", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "only" }])

      const result = yield* call({ action: "complete", position: 5 }, sessionID)

      expect(result.output).toContain("position 5 is out of range")
      expect((yield* rows(sessionID)).map((row) => row.status)).toEqual(["pending"])
    }),
  )

  it.instance("rejects a negative position", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "only" }])

      const result = yield* call({ action: "complete", position: -1 }, sessionID)

      expect(result.output).toContain("position -1 is out of range")
      expect((yield* rows(sessionID)).map((row) => row.status)).toEqual(["pending"])
    }),
  )

  it.instance("rejects a non-integer position", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "only" }])

      const result = yield* call({ action: "complete", position: 0.5 }, sessionID)

      expect(result.output).toContain("position 0.5 is out of range")
      expect((yield* rows(sessionID)).map((row) => row.status)).toEqual(["pending"])
    }),
  )

  it.instance("rejects a status change without a position", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "only" }])

      const result = yield* call({ action: "complete" }, sessionID)

      expect(result.output).toContain('action "complete" needs a 0-based position')
      expect((yield* rows(sessionID)).map((row) => row.status)).toEqual(["pending"])
    }),
  )

  it.instance("rejects empty content for add and edit", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [{ content: "keep" }])

      const added = yield* call({ action: "add", content: "   " }, sessionID)
      const edited = yield* call({ action: "edit", position: 0, content: "" }, sessionID)

      expect(added.output).toContain('action "add" needs non-empty content.')
      expect(edited.output).toContain('action "edit" needs non-empty content.')
      expect((yield* rows(sessionID)).map((row) => row.content)).toEqual(["keep"])
    }),
  )

  it.instance("rejects a position on an empty list", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()

      const result = yield* call({ action: "remove", position: 0 }, sessionID)

      expect(result.output).toContain(
        "the current list has 0 item(s), valid range is no valid position (the list is empty)",
      )
    }),
  )

  it.instance("reports progress in the output line", () =>
    Effect.gen(function* () {
      const sessionID = freshSession()
      yield* seed(sessionID, [
        { content: "a", status: "completed" },
        { content: "b" },
        { content: "c", status: "cancelled" },
      ])

      const result = yield* call({ action: "complete", position: 1 }, sessionID)

      expect(result.title).toBe("todoedit: complete")
      expect(result.output).toContain("2/3 completed")
      expect(result.output).toContain("0. [x] a")
      expect(result.output).toContain("1. [x] b")
      expect(result.output).toContain("2. [-] c")
    }),
  )
})
