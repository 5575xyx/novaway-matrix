import { describe, expect, it } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { decideTodoSweep, TODO_SWEEP_MARKER, todoSweepReminder } from "../../src/session/prompt"
import type { Todo } from "../../src/session/todo"

// decideTodoSweep 只看清单状态和消息顺序,不碰 Effect,所以直接断言纯函数。
const text = (value: string): MessageV2.Part => ({ type: "text", text: value } as unknown as MessageV2.Part)
const toolCall = (tool: string): MessageV2.Part =>
  ({ type: "tool", callID: "call_1", tool, state: { status: "completed" } } as unknown as MessageV2.Part)
const message = (parts: MessageV2.Part[] = []): MessageV2.WithParts =>
  ({ info: { id: "msg", role: "assistant" }, parts } as unknown as MessageV2.WithParts)

const todo = (content: string, status = "pending"): Todo.Info => ({ content, status, priority: "medium" })

describe("decideTodoSweep", () => {
  it("returns clean when every todo is completed or cancelled", () => {
    const result = decideTodoSweep({
      todos: [todo("a", "completed"), todo("b", "cancelled")],
      messages: [message([toolCall("todowrite")])],
    })
    expect(result).toBe("clean")
  })

  it("returns clean for an empty todo list", () => {
    const result = decideTodoSweep({
      todos: [],
      messages: [message([toolCall("todowrite")])],
    })
    expect(result).toBe("clean")
  })

  it("returns no_todo_call when the model never touched the list", () => {
    const result = decideTodoSweep({
      todos: [todo("a")],
      messages: [message([text("just chatting")])],
    })
    expect(result).toBe("no_todo_call")
  })

  it("returns sweep when unfinished todos follow a todowrite call", () => {
    const result = decideTodoSweep({
      todos: [todo("a", "in_progress"), todo("b")],
      messages: [message([toolCall("todowrite")]), message([text("finished the first part")])],
    })
    expect(result).toBe("sweep")
  })

  it("counts a todoedit call as todo activity", () => {
    const result = decideTodoSweep({
      todos: [todo("a", "in_progress")],
      messages: [message([toolCall("todoedit")])],
    })
    expect(result).toBe("sweep")
  })

  it("returns recently_swept when the reminder lands after the last todo call", () => {
    const result = decideTodoSweep({
      todos: [todo("a", "in_progress")],
      messages: [message([toolCall("todoedit")]), message([text(`${TODO_SWEEP_MARKER}\nbody`)])],
    })
    expect(result).toBe("recently_swept")
  })

  it("sweeps again once new todo activity follows the reminder", () => {
    const result = decideTodoSweep({
      todos: [todo("a", "in_progress")],
      messages: [message([text(`${TODO_SWEEP_MARKER}\nbody`)]), message([toolCall("todoedit")])],
    })
    expect(result).toBe("sweep")
  })

  it("stops at the per-session reminder limit", () => {
    const result = decideTodoSweep({
      todos: [todo("a", "in_progress")],
      messages: [
        message([text(`${TODO_SWEEP_MARKER}\n1`)]),
        message([text(`${TODO_SWEEP_MARKER}\n2`)]),
        message([toolCall("todowrite")]),
      ],
    })
    expect(result).toBe("limit")
  })

  it("prefers recently_swept over the limit once the reminder is the latest activity", () => {
    const result = decideTodoSweep({
      todos: [todo("a", "in_progress")],
      messages: [
        message([text(`${TODO_SWEEP_MARKER}\n1`)]),
        message([toolCall("todoedit")]),
        message([text(`${TODO_SWEEP_MARKER}\n2`)]),
        message([text(`${TODO_SWEEP_MARKER}\n3`)]),
      ],
    })
    expect(result).toBe("recently_swept")
  })
})

describe("todoSweepReminder", () => {
  it("lists only unfinished items with their 0-based positions", () => {
    const body = todoSweepReminder([todo("a", "completed"), todo("b", "in_progress"), todo("c", "cancelled"), todo("d")])

    expect(body.startsWith(TODO_SWEEP_MARKER)).toBe(true)
    expect(body).toContain("共 4 条,其中 2 条未完成")
    expect(body).toContain("1. b [in_progress]")
    expect(body).toContain("3. d [pending]")
    expect(body).not.toContain("a [")
    expect(body).not.toContain("c [")
    expect(body).toContain("todoedit")
  })
})
