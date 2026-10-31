import { describe, expect, it } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import {
  decideStaleTodoReminder,
  decideTodoReminder,
  resetStaleTodoReminders,
  staleTodoReminder,
  TODO_REMINDER_MARKER,
  todoReminder,
} from "../../src/session/prompt"
import type { Todo } from "../../src/session/todo"

// 提醒相关的判定都是纯函数,不碰 Effect,所以直接断言。
const text = (value: string): MessageV2.Part => ({ type: "text", text: value }) as unknown as MessageV2.Part
const toolCall = (tool: string): MessageV2.Part =>
  ({ type: "tool", callID: "call_1", tool, state: { status: "completed" } }) as unknown as MessageV2.Part
const message = (parts: MessageV2.Part[] = [], role: "assistant" | "user" = "assistant"): MessageV2.WithParts =>
  ({ info: { id: "msg", role }, parts }) as unknown as MessageV2.WithParts

const todo = (content: string, status = "pending"): Todo.Info => ({ content, status, priority: "medium" })

describe("decideTodoReminder", () => {
  const turns = (count: number, parts: MessageV2.Part[] = [text("working")]) =>
    Array.from({ length: count }, () => message(parts))

  it("stays quiet during a short turn", () => {
    expect(decideTodoReminder({ messages: turns(5), enabled: true })).toBe(false)
  })

  it("nudges after ten assistant turns without todo activity", () => {
    expect(decideTodoReminder({ messages: turns(10), enabled: true })).toBe(true)
  })

  it("does not nudge when the todo tool is disabled", () => {
    expect(decideTodoReminder({ messages: turns(10), enabled: false })).toBe(false)
  })

  it("resets the counter on todo activity", () => {
    const messages = [...turns(9), message([toolCall("todoedit")]), ...turns(3)]
    expect(decideTodoReminder({ messages, enabled: true })).toBe(false)
  })

  it("waits between two reminders", () => {
    const reminded = message(
      [
        text(`${TODO_REMINDER_MARKER}
body`),
      ],
      "user",
    )
    expect(decideTodoReminder({ messages: [reminded, ...turns(4)], enabled: true })).toBe(false)
    expect(decideTodoReminder({ messages: [reminded, ...turns(10)], enabled: true })).toBe(true)
  })
})

describe("todoReminder", () => {
  it("describes the current list without asking for a rewrite", () => {
    const body = todoReminder([todo("a", "completed"), todo("b", "in_progress")])
    expect(body.startsWith(TODO_REMINDER_MARKER)).toBe(true)
    expect(body).toContain("1. [completed] a")
    expect(body).toContain("2. [in_progress] b")
    expect(body).toContain("不要向用户提起这条提醒")
  })

  it("notes when no list exists yet", () => {
    expect(todoReminder([])).toContain("当前还没有待办清单")
  })
})

describe("decideStaleTodoReminder", () => {
  const tools = (count: number): MessageV2.WithParts => message(Array.from({ length: count }, () => toolCall("bash")))

  const list = [todo("检查项目结构", "in_progress"), todo("实现接口", "pending"), todo("补测试", "pending")]

  it("stays quiet while the current item is still producing work", () => {
    resetStaleTodoReminders()
    const messages = [message([toolCall("todowrite")]), tools(4)]
    expect(decideStaleTodoReminder({ sessionID: "ses_a", messages, todos: list })).toBe(false)
  })

  it("nudges when one open item absorbed many tool calls while later items wait", () => {
    resetStaleTodoReminders()
    const messages = [message([toolCall("todowrite")]), tools(14)]
    expect(decideStaleTodoReminder({ sessionID: "ses_b", messages, todos: list })).toBe(true)
  })

  it("does not nudge when every item is already done or there is no pending work", () => {
    resetStaleTodoReminders()
    const messages = [message([toolCall("todowrite")]), tools(14)]
    expect(
      decideStaleTodoReminder({
        sessionID: "ses_c",
        messages,
        todos: [todo("检查项目结构", "in_progress"), todo("实现接口", "completed")],
      }),
    ).toBe(false)
  })

  it("throttles repeated nudges for the same snapshot", () => {
    resetStaleTodoReminders()
    const messages = [message([toolCall("todowrite")]), tools(14)]
    expect(decideStaleTodoReminder({ sessionID: "ses_d", messages, todos: list })).toBe(true)
    expect(decideStaleTodoReminder({ sessionID: "ses_d", messages, todos: list })).toBe(false)
  })
})

describe("staleTodoReminder", () => {
  it("names the open item and the items still waiting", () => {
    const body = staleTodoReminder([todo("检查项目结构", "in_progress"), todo("实现接口", "pending")])
    expect(body.startsWith(TODO_REMINDER_MARKER)).toBe(true)
    expect(body).toContain("检查项目结构")
    expect(body).toContain("实现接口")
    expect(body).toContain("不要向用户提起这条提醒")
  })
})
