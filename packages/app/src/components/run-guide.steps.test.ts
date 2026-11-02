import { describe, expect, it } from "bun:test"
import { guideStates } from "./run-guide.steps"

const at = (steps: ReturnType<typeof guideStates>) => steps.map((step) => `${step.id}:${step.state}`)

describe("run guide steps", () => {
  it("walks a fresh run from goal to merge in order", () => {
    expect(at(guideStates({ state: "awaiting_approval", accepted: true, hasWorktrees: true }))).toEqual([
      "goal:done",
      "approve:current",
      "execute:todo",
      "verdict:todo",
      "merge:todo",
    ])
    expect(at(guideStates({ state: "running", accepted: true, hasWorktrees: true }))).toEqual([
      "goal:done",
      "approve:done",
      "execute:current",
      "verdict:todo",
      "merge:todo",
    ])
    expect(at(guideStates({ state: "done", mergeState: "unmerged", accepted: true, hasWorktrees: true }))).toEqual([
      "goal:done",
      "approve:done",
      "execute:done",
      "verdict:done",
      "merge:current",
    ])
    expect(at(guideStates({ state: "done", mergeState: "merged", accepted: true, hasWorktrees: true }))).toEqual([
      "goal:done",
      "approve:done",
      "execute:done",
      "verdict:done",
      "merge:done",
    ])
  })

  it("keeps the goal step current while the plan is still being built", () => {
    expect(at(guideStates({ state: "planning", accepted: false, hasWorktrees: false }))).toEqual([
      "goal:current",
      "approve:todo",
      "execute:todo",
      "verdict:todo",
    ])
    // 目标与验收已经写好、只等计划生成时：没有「当前步」，界面说「等待计划生成」。
    expect(guideStates({ state: "planning", accepted: true, hasWorktrees: false })).toEqual([
      { id: "goal", state: "done" },
      { id: "approve", state: "todo" },
      { id: "execute", state: "todo" },
      { id: "verdict", state: "todo" },
    ])
  })

  it("does not offer a merge step when the run left no branch", () => {
    expect(at(guideStates({ state: "done", accepted: true, hasWorktrees: false }))).toEqual([
      "goal:done",
      "approve:done",
      "execute:done",
      "verdict:done",
    ])
  })

  it("marks failed and cancelled runs as needing attention, not as done", () => {
    for (const state of ["failed", "cancelled", "exceeded"]) {
      const steps = guideStates({ state, accepted: true, hasWorktrees: true })
      expect(steps.find((step) => step.id === "verdict")?.state).toBe("attention")
      // 失败的结果不是可交付物：合并留在「还没轮到」，不引导用户去合。
      expect(steps.find((step) => step.id === "merge")?.state).toBe("todo")
    }
  })

  it("treats a paused or blocked run as still executing", () => {
    for (const state of ["paused", "blocked", "needs_review"]) {
      const steps = guideStates({ state, accepted: true, hasWorktrees: true })
      expect(steps.find((step) => step.id === "execute")?.state).toBe("current")
      expect(steps.find((step) => step.id === "verdict")?.state).toBe("todo")
    }
  })

  it("keeps a partial delivery mergeable", () => {
    const steps = guideStates({ state: "partial", mergeState: "unmerged", accepted: true, hasWorktrees: true })
    expect(steps.find((step) => step.id === "verdict")?.state).toBe("done")
    expect(steps.find((step) => step.id === "merge")?.state).toBe("current")
  })
})
