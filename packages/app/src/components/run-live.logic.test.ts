import { describe, expect, test } from "bun:test"
import { summarizeLive } from "./run-live.logic"

const task = (status: string, subject = status) => ({ id: status + subject, subject, status })

describe("summarizeLive", () => {
  test("counts each task state without folding failures into done", () => {
    const result = summarizeLive({
      tasks: [task("completed"), task("completed"), task("in_progress"), task("pending"), task("failed")],
      teams: [
        { id: "a", name: "A", phase: "delivered" },
        { id: "b", name: "B", phase: "running" },
      ],
    })
    expect(result.total).toBe(5)
    expect(result.done).toBe(2)
    expect(result.active).toBe(1)
    expect(result.pending).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.percent).toBe(40)
    expect(result.deliveredTeams).toBe(1)
    expect(result.totalTeams).toBe(2)
  })

  test("an empty task board is not rendered as a full progress bar", () => {
    const result = summarizeLive({ tasks: [], teams: [] })
    expect(result.percent).toBe(0)
    expect(result.total).toBe(0)
    expect(result.current).toEqual([])
  })

  test("shows at most three current tasks", () => {
    const result = summarizeLive({
      tasks: [
        task("in_progress", "一"),
        task("in_progress", "二"),
        task("in_progress", "三"),
        task("in_progress", "四"),
      ],
      teams: [],
    })
    expect(result.active).toBe(4)
    expect(result.current.map((item) => item.subject)).toEqual(["一", "二", "三"])
  })

  test("cancelled tasks count as failed, not as done", () => {
    const result = summarizeLive({ tasks: [task("cancelled")], teams: [] })
    expect(result.done).toBe(0)
    expect(result.failed).toBe(1)
  })
})
