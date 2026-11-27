import { describe, expect, it } from "bun:test"
import { acceptanceForGoal, linesOf } from "./run-task"

describe("task input", () => {
  it("accepts a goal without requiring user-written acceptance", () => {
    expect(acceptanceForGoal("  分析竞品  ", "", "系统检查：")).toEqual(["系统检查：分析竞品"])
  })

  it("preserves explicit acceptance lines", () => {
    expect(acceptanceForGoal("目标", " 一\n\n二 ", "系统检查：")).toEqual(["一", "二"])
  })

  it("rejects an empty goal", () => {
    expect(acceptanceForGoal("  ", "", "系统检查：")).toEqual([])
  })

  it("normalizes material and constraint lines", () => {
    expect(linesOf(" docs/ \n\n src/team ")).toEqual(["docs/", "src/team"])
  })
})
