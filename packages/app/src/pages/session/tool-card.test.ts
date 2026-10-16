import { describe, expect, test } from "bun:test"
import { toolCardSlots, type ToolCardRow } from "./tool-card"

const tool = (messageID = "m1"): ToolCardRow => ({ tool: true, messageID })
const other = (): ToolCardRow => ({ tool: false })

describe("toolCardSlots", () => {
  test("single tool row is not wrapped in a card", () => {
    // 单行套外框只会变成多余的装饰。
    expect(toolCardSlots([tool()])).toEqual([{ start: false, end: false, between: false }])
  })

  test("two consecutive tool rows form a card", () => {
    expect(toolCardSlots([tool(), tool()])).toEqual([
      { start: true, end: false, between: false },
      { start: false, end: true, between: false },
    ])
  })

  test("marks middles of a longer run", () => {
    expect(toolCardSlots([tool(), tool(), tool()])).toEqual([
      { start: true, end: false, between: false },
      { start: false, end: false, between: true },
      { start: false, end: true, between: false },
    ])
  })

  test("a non-tool row breaks the card", () => {
    expect(toolCardSlots([tool(), other(), tool(), tool()])).toEqual([
      { start: false, end: false, between: false },
      { start: false, end: false, between: false },
      { start: true, end: false, between: false },
      { start: false, end: true, between: false },
    ])
  })

  test("different assistant messages break the card", () => {
    expect(toolCardSlots([tool("m1"), tool("m2")])).toEqual([
      { start: false, end: false, between: false },
      { start: false, end: false, between: false },
    ])
  })

  test("handles an empty list", () => {
    expect(toolCardSlots([])).toEqual([])
  })
})
