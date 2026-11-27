import { describe, expect, it } from "bun:test"
import { executorTheme } from "./executor-theme"

describe("executorTheme", () => {
  it("keeps one executor's visual accent stable", () => {
    expect(executorTheme("安全审查")).toEqual(executorTheme("安全审查"))
  })

  it("provides distinct accents for a varied directory", () => {
    const accents = new Set(["审查队长", "安全审查", "正确性审查", "测试审查"].map((name) => executorTheme(name).accent))
    expect(accents.size).toBeGreaterThan(1)
  })
})
