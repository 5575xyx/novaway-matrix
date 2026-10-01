import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { gradientAt, perimeterCells } from "../../src/ui/neon"

describe("gradientAt", () => {
  const red = RGBA.fromHex("#ff0000")
  const blue = RGBA.fromHex("#0000ff")

  test("单色直接返回原对象", () => {
    expect(gradientAt([red], 0.5)).toBe(red)
  })

  test("端点返回对应端色", () => {
    expect(gradientAt([red, blue], 0)).toEqual(red)
    expect(gradientAt([red, blue], 1)).toEqual(blue)
  })

  test("中点为两色均值", () => {
    const mid = gradientAt([red, blue], 0.5)
    expect(mid.r).toBeCloseTo(0.5, 2)
    expect(mid.b).toBeCloseTo(0.5, 2)
    expect(mid.g).toBeCloseTo(0, 2)
  })

  test("t 越界被夹紧到端点", () => {
    expect(gradientAt([red, blue], -1)).toEqual(red)
    expect(gradientAt([red, blue], 2)).toEqual(blue)
  })

  test("三段渐变中点落在中间色", () => {
    const green = RGBA.fromHex("#00ff00")
    const mid = gradientAt([red, green, blue], 0.5)
    expect(mid.g).toBeCloseTo(1, 2)
    expect(mid.r).toBeCloseTo(0, 2)
    expect(mid.b).toBeCloseTo(0, 2)
  })
})

describe("perimeterCells", () => {
  test("边长 < 2 返回空", () => {
    expect(perimeterCells(1, 5)).toEqual([])
    expect(perimeterCells(5, 1)).toEqual([])
  })

  test("周长格数 = 2w+2h-4,四角字符正确", () => {
    const cells = perimeterCells(12, 4)
    expect(cells).toHaveLength(2 * 12 + 2 * 4 - 4)
    expect(cells[0]).toMatchObject({ x: 0, y: 0, ch: "╭" })
    expect(cells[11]).toMatchObject({ x: 11, y: 0, ch: "╮" })
    expect(cells.find((cell) => cell.x === 11 && cell.y === 3)?.ch).toBe("╯")
    expect(cells.find((cell) => cell.x === 0 && cell.y === 3)?.ch).toBe("╰")
  })

  test("格子互不重复且全部落在边缘", () => {
    const cells = perimeterCells(8, 5)
    const keys = new Set(cells.map((cell) => `${cell.x},${cell.y}`))
    expect(keys.size).toBe(cells.length)
    for (const cell of cells) {
      expect(cell.x === 0 || cell.x === 7 || cell.y === 0 || cell.y === 4).toBe(true)
    }
  })

  test("t 从 0 单调升到 1", () => {
    const cells = perimeterCells(8, 5)
    expect(cells[0]!.t).toBe(0)
    expect(cells[cells.length - 1]!.t).toBe(1)
    expect(cells.every((cell, index) => index === 0 || cell.t >= cells[index - 1]!.t)).toBe(true)
  })
})
