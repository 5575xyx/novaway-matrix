import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  alphaOver,
  brighten,
  BORDER_ALPHA_DEFAULT,
  fadeIn,
  gradientAt,
  HOVER_BOOST,
  neonStops,
  perimeterCells,
  semanticStops,
} from "../../src/ui/neon"
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

  test("HOVER_BOOST 是可感又不抢戏的一档(16%~26%)", () => {
    // 12% 那档是对着满饱和描边调的;描边按 0.62 的 alpha 折算之后同样的百分比只剩六成
    // 视觉增益,所以上调到 20%。理由与算式见 neon.ts 的 HOVER_BOOST 注释。
    expect(HOVER_BOOST).toBeGreaterThan(0.16)
    expect(HOVER_BOOST).toBeLessThan(0.26)
  })
})

// 终端没有 alpha(见 fadeIn 的注释),原型的半透明描边只能靠「叠色」折算成实色:
// alpha = k 的描边盖在 back 上,眼睛看到的就是 color·k + back·(1−k)。
describe("alphaOver", () => {
  const panel = RGBA.fromValues(0.1, 0.15, 0.2, 1)
  const cyan = RGBA.fromValues(0, 0.9, 1, 1)

  test("k = 1 原色、k = 0 全是背景色", () => {
    expect(alphaOver(cyan, panel, 1)).toEqual(cyan)
    expect(alphaOver(cyan, panel, 0)).toEqual(panel)
  })

  test("k 越界夹紧到 [0,1]", () => {
    expect(alphaOver(cyan, panel, -2)).toEqual(panel)
    expect(alphaOver(cyan, panel, 5)).toEqual(cyan)
  })

  test("逐通道就是 color·k + back·(1−k)", () => {
    const mid = alphaOver(cyan, panel, 0.62)
    expect(mid.g).toBeCloseTo(0.9 * 0.62 + 0.15 * 0.38, 2)
    expect(mid.b).toBeCloseTo(1 * 0.62 + 0.2 * 0.38, 2)
    // r 通道:color.r = 0,只剩背景那一层
    expect(mid.r).toBeCloseTo(0.1 * 0.38, 2)
  })

  test("逐通道都落在 color 与 back 之间(不会跑出两端)", () => {
    for (let k = 0; k <= 1.0001; k += 0.1) {
      const value = alphaOver(cyan, panel, k)
      const pairs = [
        [value.r, cyan.r, panel.r],
        [value.g, cyan.g, panel.g],
        [value.b, cyan.b, panel.b],
      ] as const
      for (const [actual, from, to] of pairs) {
        expect(actual).toBeGreaterThanOrEqual(Math.min(from, to) - 1e-9)
        expect(actual).toBeLessThanOrEqual(Math.max(from, to) + 1e-9)
      }
    }
  })

  test("同一条纪律:alpha 原样保留(叠色改的是「亮不亮」,不是「透不透明」)", () => {
    const translucent = RGBA.fromValues(0.2, 0.4, 0.6, 0.5)
    expect(alphaOver(translucent, panel, 0.62).a).toBeCloseTo(0.5, 1)
  })

  // 默认档钉在原型 `.bubble` 的 alpha 区间(0.55~0.90,助手/思考两档的均值 0.675)之内,
  // 偏低端取 0.62 —— 见 neon.ts 里 BORDER_ALPHA_DEFAULT 的注释。
  test("默认档 0.62 落在原型 .bubble 的 alpha 区间里", () => {
    expect(BORDER_ALPHA_DEFAULT).toBe(0.62)
    expect(BORDER_ALPHA_DEFAULT).toBeGreaterThan(0.55)
    expect(BORDER_ALPHA_DEFAULT).toBeLessThan(0.9)
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

// HSL 色相(0..360°)。判断「渐变真的画得出来」要用色相而不是 RGB 距离:
// 两端只要色相分开,描边上就看得出来颜色在走;反过来,亮度差很大但色相相同
// (青 #00e5ff 与它自己提亮两成)在终端里只读得出「更亮」,读不出「换色了」。
function hue(color: RGBA) {
  const max = Math.max(color.r, color.g, color.b)
  const min = Math.min(color.r, color.g, color.b)
  if (max === min) return 0
  const delta = max - min
  if (max === color.r) return 60 * (((color.g - color.b) / delta + 6) % 6)
  if (max === color.g) return 60 * ((color.b - color.r) / delta + 2)
  return 60 * ((color.r - color.g) / delta + 4)
}

function hex(color: RGBA) {
  return (
    "#" +
    [color.r, color.g, color.b]
      .map((value) =>
        Math.round(value * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  )
}

describe("semanticStops", () => {
  const theme = resolveTheme(novaway as ThemeJson, "dark")

  // 回归守卫(1b):助手卡是整个 UI 里最显眼的一圈描边,渐变一旦退化成平色就整张卡哑掉。
  // 原来的映射是 [info, primary],而 novaway 的 defs.darkCyan 与 defs.darkStep9 都是 #00e5ff
  // —— 默认深色主题下两端解析成同一个颜色,原型那条青蓝坡一点都画不出来。
  // 浅色主题碰巧不撞(lightCyan #0077aa ≠ lightStep9 #0066cc),所以只有默认深色这条路会坏。
  test("助手=青蓝双段:primary(青 #00e5ff)→ secondary(蓝 #4d7cff)", () => {
    expect(semanticStops(theme, "assistant")).toEqual([theme.primary, theme.secondary])
  })

  test("助手两端是两个不同色相,且起点偏青、终点偏蓝", () => {
    const stops = semanticStops(theme, "assistant")
    expect(stops[0]).not.toEqual(stops[1])
    expect(hue(stops[0]!)).toBeGreaterThan(170)
    expect(hue(stops[0]!)).toBeLessThan(200)
    expect(hue(stops[1]!)).toBeGreaterThan(210)
    expect(hue(stops[1]!)).toBeLessThan(260)
  })

  // 浅色主题也钉一遍,免得换端色时只顾深色。
  test("浅色主题下助手两端同样不撞色(lightCyan 与 lightStep9 本来就不同)", () => {
    const light = resolveTheme(novaway as ThemeJson, "light")
    const stops = semanticStops(light, "assistant")
    expect(stops).toEqual([light.primary, light.secondary])
    expect(Math.abs(hue(stops[0]!) - hue(stops[1]!))).toBeGreaterThan(10)
  })

  test("用户=粉紫双段", () => {
    expect(semanticStops(theme, "user")).toEqual([theme.accent, theme.neonMid])
  })

  test("思考=紫青双段", () => {
    expect(semanticStops(theme, "thinking")).toEqual([theme.neonMid, theme.neonEnd])
  })

  // error / tip 故意单色:这两种语义靠「整圈都是那个红 / 那个琥珀」传达,
  // 加渐变反而会被读成装饰(而且报的错也可能只是一半红一半粉,读不出严重性)。
  // 原型也是纯红框 / 纯琥珀框,这里保持一致。
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

  // 兜底是给「某个主题把两端配成了同一个色」准备的,所以必须在 synthetic 主题上验。
  // 用真实主题改 token 的办法造退化场景:resolved Theme 上直接覆盖即可。
  test("两端解析成同一个色时,第二端换成 accent", () => {
    const flat = { ...theme, primary: theme.secondary, secondary: theme.secondary }
    expect(semanticStops(flat, "assistant")).toEqual([theme.secondary, theme.accent])
  })

  test("accent 也等于第一端时再退到 neonEnd", () => {
    // default 主题的 neonMid 就是 secondary,所以这里 user 的两端 = accent 与 neonMid 都撞成蓝色。
    const flat = { ...theme, accent: theme.secondary, secondary: theme.secondary }
    expect(semanticStops(flat, "user")).toEqual([theme.secondary, theme.neonEnd])
  })

  // 默认深色主题下每个多段 role 解析出的实际色板(报告口径):
  //   user      #ff2d7b → #4d7cff          粉 → 蓝
  //   assistant #00e5ff → #4d7cff          青 → 蓝
  //   thinking  #4d7cff → #ff2d7b          蓝 → 品红
  //   tool      #00e5ff → #4d7cff → #ff2d7b
  //   input     #00e5ff → #4d7cff → #ff2d7b
  // 一条都不能出现「解析出来一模一样」的两端 —— 那圈描边就没有坡了。
  test("多段 role 在默认深色主题下都不平(渐变真的画得出来)", () => {
    const roles = ["user", "assistant", "thinking", "tool", "input"] as const
    const flat = roles.filter((role) => {
      const stops = semanticStops(theme, role)
      return new Set(stops.map(hex)).size !== stops.length
    })
    expect(flat).toEqual([])
  })
})
