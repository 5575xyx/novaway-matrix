import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { brighten, fadeIn, gradientAt, HOVER_BOOST, neonStops, perimeterCells, semanticStops } from "../../src/ui/neon"
import { resolveTheme, type ThemeJson } from "../../src/theme"
import novaway from "../../src/theme/assets/novaway.json" with { type: "json" }

describe("fadeIn", () => {
  const red = RGBA.fromHex("#ff0000")
  const blue = RGBA.fromHex("#0000ff")

  test("k = 0 取起点、k = 1 取终点", () => {
    expect(fadeIn(red, blue, 0)).toEqual(red)
    expect(fadeIn(red, blue, 1)).toEqual(blue)
  })

  test("k 越界夹紧到 [0,1]", () => {
    expect(fadeIn(red, blue, -3)).toEqual(red)
    expect(fadeIn(red, blue, 7)).toEqual(blue)
  })

  test("k = 0.5 是两端中点", () => {
    const mid = fadeIn(red, blue, 0.5)
    expect(mid.r).toBeCloseTo(0.5, 2)
    expect(mid.b).toBeCloseTo(0.5, 2)
    expect(mid.g).toBeCloseTo(0, 2)
  })

  test("单调递增:每一步都不比上一步更靠近终点", () => {
    let previous = -1
    for (let k = 0; k <= 1; k += 0.05) {
      const b = fadeIn(red, blue, k).b
      expect(b).toBeGreaterThanOrEqual(previous - 1e-12)
      previous = b
    }
    // 循环最后一次 k = 0.95,离终色还差 5%;RGBA 走 8bit 量化(见 card-sweep 的说明),
    // 这里只断言「已经走到接近终点」,精确的 k = 1 由上一条钉死。
    expect(previous).toBeGreaterThan(0.9)
    expect(previous).toBeLessThanOrEqual(1)
  })
})

describe("brighten", () => {
  const dim = RGBA.fromValues(0.2, 0.4, 0.6, 1)
  const white = RGBA.fromValues(1, 1, 1, 1)

  test("amount = 0 原样返回", () => {
    expect(brighten(dim, 0, white)).toEqual(dim)
  })

  test("按 amount 朝 towards 线性插值", () => {
    // RGBA 走 8bit 量化:0.7 落盘是 179/255 = 0.70196,精度取 1 位(±0.05)足够。
    expect(brighten(dim, 0.5, white).r).toBeCloseTo(0.6, 1)
    expect(brighten(dim, 0.5, white).g).toBeCloseTo(0.7, 1)
    expect(brighten(dim, 0.5, white).b).toBeCloseTo(0.8, 1)
  })

  test("amount 越界夹紧到 [0,1]", () => {
    expect(brighten(dim, -1, white)).toEqual(dim)
    expect(brighten(dim, 2, white)).toEqual(white)
  })

  test("alpha 原样保留:提亮改的是「亮不亮」,不是「透不透明」", () => {
    const translucent = RGBA.fromValues(0.2, 0.4, 0.6, 0.5)
    expect(brighten(translucent, HOVER_BOOST, white).a).toBeCloseTo(0.5, 1)
  })

  test("HOVER_BOOST 是可感又不抢戏的一档(8%~15%)", () => {
    expect(HOVER_BOOST).toBeGreaterThan(0.08)
    expect(HOVER_BOOST).toBeLessThan(0.15)
  })
})

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

  test("3×3 按 上(左→右)→右(上→下)→下(右→左)→左(下→上) 遍历", () => {
    expect(perimeterCells(3, 3).map((cell) => [cell.x, cell.y])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [2, 2],
      [1, 2],
      [0, 2],
      [0, 1],
    ])
  })
})

describe("semanticStops", () => {
  const theme = resolveTheme(novaway as ThemeJson, "dark")

  test("助手=青蓝双段", () => {
    expect(semanticStops(theme, "assistant")).toEqual([theme.info, theme.primary])
  })

  test("用户=粉紫双段", () => {
    expect(semanticStops(theme, "user")).toEqual([theme.accent, theme.neonMid])
  })

  test("思考=紫青双段", () => {
    expect(semanticStops(theme, "thinking")).toEqual([theme.neonMid, theme.neonEnd])
  })

  test("错误/提示是单段语义色", () => {
    expect(semanticStops(theme, "error")).toEqual([theme.error])
    expect(semanticStops(theme, "tip")).toEqual([theme.warning])
  })

  test("工具/输入走全段霓虹", () => {
    expect(semanticStops(theme, "tool")).toEqual(neonStops(theme))
    expect(semanticStops(theme, "input")).toEqual(neonStops(theme))
  })

  test("每个 role 都返回 2 或 3 段的非空色板", () => {
    const roles = ["user", "assistant", "thinking", "tool", "input"] as const
    for (const role of roles) {
      const stops = semanticStops(theme, role)
      expect(stops.length).toBeGreaterThanOrEqual(2)
      expect(stops.length).toBeLessThanOrEqual(3)
    }
  })
})
