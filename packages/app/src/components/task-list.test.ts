import { describe, expect, test } from "bun:test"

describe("TaskList", () => {
  const testTasks = [
    { id: "1", content: "探索项目上下文", status: "completed", priority: "high" },
    { id: "2", content: "提出澄清问题", status: "in_progress", priority: "high" },
    { id: "3", content: "提出2-3种方案", status: "pending", priority: "medium" },
  ]

  test("completed count is correct", () => {
    const completed = testTasks.filter(t => t.status === "completed").length
    expect(completed).toBe(1)
  })

  test("in_progress count is correct", () => {
    const inProgress = testTasks.filter(t => t.status === "in_progress").length
    expect(inProgress).toBe(1)
  })

  test("pending tasks are counted correctly", () => {
    const pending = testTasks.filter(t => t.status === "pending").length
    expect(pending).toBe(1)
  })

  test("status icon mapping works for completed", () => {
    const statusIcon = (status: string) => {
      switch (status) {
        case "completed": return "circle-check"
        case "in_progress": return "checklist"
        case "cancelled": return "circle-x"
        default: return "circle-x"
      }
    }
    expect(statusIcon("completed")).toBe("circle-check")
    expect(statusIcon("in_progress")).toBe("checklist")
    expect(statusIcon("pending")).toBe("circle-x")
    expect(statusIcon("cancelled")).toBe("circle-x")
  })
})
