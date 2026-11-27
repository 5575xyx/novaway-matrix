import { describe, expect, test } from "bun:test"
import type { RunView } from "@novaway/sdk/v2"
import { taskPhase, taskState, toExpertCenterTaskView } from "./expert-center.logic"

const run = (state: string, phase?: string) => ({
  id: "run-1",
  goal: "整理项目",
  mode: "auto" as const,
  state,
  phase,
  updatedAt: 123,
}) as unknown as RunView

describe("expert center task projection", () => {
  test("maps internal states into user language states", () => {
    expect(taskState(run("planning"))).toBe("planning")
    expect(taskState(run("awaiting_approval"))).toBe("needs-you")
    expect(taskState(run("running"))).toBe("working")
    expect(taskState(run("paused"))).toBe("paused")
    expect(taskState(run("done"))).toBe("completed")
    expect(taskState(run("partial"))).toBe("partial")
    expect(taskState(run("failed"))).toBe("failed")
  })

  test("maps execution phases without exposing internal phase names", () => {
    expect(taskPhase(run("planning"))).toBe("planning")
    expect(taskPhase(run("running", "execution"))).toBe("working")
    expect(taskPhase(run("needs_review"))).toBe("reviewing")
    expect(taskPhase(run("done"))).toBe("delivering")
  })

  test("projects an auto run with stable summary fields", () => {
    expect(toExpertCenterTaskView(run("done"))).toMatchObject({
      id: "run-1",
      goal: "整理项目",
      state: "completed",
      phase: "delivering",
      executor: { mode: "auto" },
      artifacts: [],
      updatedAt: 123,
    })
  })
})
