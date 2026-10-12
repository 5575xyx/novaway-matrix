import { describe, expect, test } from "bun:test"
import type { Todo } from "@novaway/sdk/v2/client"
import { todoSectionModel } from "./todo-section-model"

const t2 = (...statuses: Todo["status"][]): Todo[] =>
  statuses.map((status, index) => ({
    content: `Task ${index + 1}`,
    status,
    priority: "medium",
    id: String(index + 1),
  }))

describe("todoSectionModel", () => {
  test("returns null on an empty todo list", () => {
    expect(todoSectionModel([])).toBeNull()
  })

  test("returns the whole list with zero counts when there are 6 or fewer todos", () => {
    const todos = t2("completed", "pending", "in_progress")
    const model = todoSectionModel(todos)
    if (!model) return
    expect(model.total).toBe(3)
    expect(model.done).toBe(1)
    expect(model.preceding).toBe(0)
    expect(model.following).toBe(0)
    expect(model.focus).toEqual(todos)
  })

  test("uses a 3-todo focus window with a stable invariant when there are more than 6 todos", () => {
    const todos = t2("completed", "completed", "pending", "pending", "pending", "pending", "pending", "pending", "pending", "pending")
    const model = todoSectionModel(todos)
    if (!model) return
    expect(model.focus.length).toBe(3)
    expect(model.preceding + model.focus.length + model.following).toBe(model.total)
    expect(model.total).toBe(10)
  })

  test("anchors the focus window on the in_progress todo", () => {
    const todos = t2("completed", "completed", "completed", "completed", "in_progress", "pending", "pending", "pending", "pending")
    const model = todoSectionModel(todos)
    if (!model) return
    expect(model.focus.length).toBe(3)
    expect(model.preceding).toBe(3)
    expect(model.following).toBe(3)
    expect(model.focus[1].status).toBe("in_progress")
  })
})
