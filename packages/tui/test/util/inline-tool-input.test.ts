import { describe, expect, test } from "bun:test"
import { input } from "../../src/routes/session"

describe("工具行的参数摘要", () => {
  test("短参数原样显示", () => {
    expect(input({ offset: 1, limit: 130 })).toBe("[offset=1, limit=130]")
  })

  test("omit 里的键不进摘要", () => {
    expect(input({ filePath: "a.ts", limit: 5 }, ["filePath"])).toBe("[limit=5]")
  })

  test("没有可显示的参数时返回空串", () => {
    expect(input({ nested: { a: 1 }, list: [1, 2] })).toBe("")
  })

  test("换行被压成空格:多行参数不能把一行工具行撑成多行", () => {
    const summary = input({ thought: "第一行\n第二行\r\n第三行" })
    expect(summary).not.toContain("\n")
    expect(summary).not.toContain("\r")
  })

  test("超长参数被截断,整行也有上限", () => {
    // sequential-thinking 的 thought 就是这种几百字的整段文本
    const summary = input({ nextThoughtNeeded: true, thought: "思".repeat(2000), thoughtNumber: 1 })
    expect(summary.length).toBeLessThanOrEqual(242)
    expect(summary).toContain("…")
    expect(summary.startsWith("[")).toBe(true)
    expect(summary.endsWith("]")).toBe(true)
  })

  test("多个长参数都被各自截断,不会只截最后一个", () => {
    const summary = input({ a: "甲".repeat(500), b: "乙".repeat(500) })
    expect(summary).toContain("a=")
    expect(summary.length).toBeLessThanOrEqual(242)
  })
})
