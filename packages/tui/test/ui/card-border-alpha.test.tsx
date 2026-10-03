/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA, type CapturedFrame } from "@opentui/core"
import {
  alphaOver,
  BORDER_ALPHA_DEFAULT,
  brighten,
  gradientAt,
  NEON_WHITE,
  perimeterCells,
  semanticStops,
  softenOver,
} from "../../src/ui/neon"
import { TOP_EDGE_GLOW, TOP_EDGE_INK, topEdgeTarget } from "../../src/ui/card"
import { NeonCard } from "../../src/component/neon-card"
import { TIP_CARD_ALPHA, TipCard } from "../../src/feature-plugins/home/tip-card"
import { FLOW_NODE_ALPHA, FlowCanvas } from "../../src/component/flow/canvas"
import { PANEL_CARD_ALPHA, SidebarCard } from "../../src/component/sidebar-card"
import { INPUT_CARD_ALPHA, PromptCard } from "../../src/component/prompt/card"
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"
import { FIXTURE_MESSAGES, FIXTURE_PARTS } from "../fixture/flow"
import { resolveTheme, type ThemeJson } from "../../src/theme"
import novaway from "../../src/theme/assets/novaway.json" with { type: "json" }
// 裸导入跑 extend({ neonbox }) 的副作用(见 test/ui/card.test.tsx 的理由)。
import "../../src/ui/card"

// 描边的「半透明柔边 + 顶部光晕」这一层的渲染级断言。
//
// 原型的描边一律是半透明渐变(`.bubble` 两端 rgba(...,.8)/rgba(...,.55) 那一族),
// 而终端没有 alpha —— 所以这一层做的事是**按叠色折算**:描边色 = 把渐变色按 alpha
// 盖在「这一格背后那个实色」上,得到的那个实色。这正是 alpha 在该背景上的定义式。
//
// 这里的断言分三类:
//   1. 数值:逐格落在「纯渐变色」与「卡底色」之间,且比纯渐变淡 —— 也就是「确实变薄了」。
//   2. 色相:色带沿周长的**相对顺序**没变(粉→紫→青还是粉→紫→青)。这条比数值更要紧:
//      叠色是逐通道的线性插值,理论上保序;一旦有人在叠色前后动了 stops 或换了插值
//      方式,色带就会在某一段折回去,而「比纯色淡」的断言一条都不会红。
//   3. 顶边:上边框那一行整体比下边框亮一档(光晕),且左右边框中段**不**跟着亮 ——
//      否则那就不是「被点亮的发丝边」而是「第二圈亮边」了。

const PANEL = RGBA.fromHex("#101010")
// 原型 `--gb-main` 的三端:粉 → 紫 → 青。
const GLASS_MAIN = [RGBA.fromHex("#ff5c9e"), RGBA.fromHex("#a78bfa"), RGBA.fromHex("#4fd1e0")]
// 侧栏分区卡与输入卡的三端霓虹。
const TOOL_STOPS = [RGBA.fromHex("#00e5ff"), RGBA.fromHex("#4d7cff"), RGBA.fromHex("#ff2d7b")]

const WIDTH = 12
const HEIGHT = 5

function grid(app: { captureSpans(): CapturedFrame }) {
  const map = new Map<string, { r: number; g: number; b: number }>()
  app.captureSpans().lines.forEach((line, row) => {
    let col = 0
    for (const span of line.spans) {
      for (const _ of span.text) {
        map.set(`${row}:${col}`, { r: span.fg.r, g: span.fg.g, b: span.fg.b })
        col += 1
      }
    }
  })
  return map
}

function at(map: Map<string, { r: number; g: number; b: number }>, x: number, y: number, label: string) {
  const value = map.get(`${y}:${x}`)
  if (!value) throw new Error(`${label} (${x},${y}) 不在帧里`)
  return value
}

function lum(cell: { r: number; g: number; b: number }) {
  return cell.r + cell.g + cell.b
}

// HSL 色相(0..360°)。要证明「色带顺序没变」只能看色相:叠色让每一格都变暗了,
// 亮度变化证明不了「它还是那个色相」。
function hue(cell: { r: number; g: number; b: number }) {
  const max = Math.max(cell.r, cell.g, cell.b)
  const min = Math.min(cell.r, cell.g, cell.b)
  if (max === min) return 0
  const delta = max - min
  if (max === cell.r) return 60 * (((cell.g - cell.b) / delta + 6) % 6)
  if (max === cell.g) return 60 * ((cell.b - cell.r) / delta + 2)
  return 60 * ((cell.r - cell.g) / delta + 4)
}

async function shot(props: Record<string, unknown>) {
  const app = await testRender(
    () => (
      <neonbox {...(props as object)}>
        <text>hi</text>
      </neonbox>
    ),
    { width: 20, height: 8 },
  )
  try {
    await app.renderOnce()
    return grid(app)
  } finally {
    app.renderer.destroy()
  }
}

describe("NeonBox 描边按 alpha 折算(柔边)", () => {
  test("逐格描边落在纯渐变色与卡底色之间,且比纯渐变淡", async () => {
    const stops = [RGBA.fromHex("#00e5ff"), RGBA.fromHex("#4d7cff")]
    const frame = await shot({ width: WIDTH, height: HEIGHT, backgroundColor: PANEL, gradientStops: stops })
    let lighter = 0
    let dimmer = 0
    for (const cell of perimeterCells(WIDTH, HEIGHT)) {
      const actual = at(frame, cell.x, cell.y, "边框格")
      const pure = gradientAt(stops, cell.t)
      if (lum(actual) >= lum(pure) - 1e-9) dimmer++
      if (lum(actual) > lum(PANEL) + 1e-9) lighter++
    }
    // 每格都比纯渐变淡(顶边光晕那 6% 抬不回叠色掉的那 38%)
    expect(dimmer).toBe(0)
    // 也每格都比卡底色亮 —— 不然就是「描边消失了」,不是「变薄了」
    expect(lighter).toBe(perimeterCells(WIDTH, HEIGHT).length)
  })

  test("逐通道夹在两端之间,方向与 alpha 一致", async () => {
    const stops = [RGBA.fromHex("#00e5ff"), RGBA.fromHex("#4d7cff")]
    const frame = await shot({ width: WIDTH, height: HEIGHT, backgroundColor: PANEL, gradientStops: stops })
    for (const cell of perimeterCells(WIDTH, HEIGHT)) {
      // 顶边那一行额外叠了光晕,能不能亮过纯渐变由「顶部光晕」那节单独钉。
      if (cell.y === 0) continue
      const actual = at(frame, cell.x, cell.y, "边框格")
      const pure = gradientAt(stops, cell.t)
      const pairs = [
        [actual.r, pure.r, PANEL.r],
        [actual.g, pure.g, PANEL.g],
        [actual.b, pure.b, PANEL.b],
      ] as const
      for (const [value, from, to] of pairs) {
        expect(value, `(${cell.x},${cell.y})`).toBeGreaterThanOrEqual(Math.min(from, to) - 0.01)
        expect(value, `(${cell.x},${cell.y})`).toBeLessThanOrEqual(Math.max(from, to) + 0.01)
      }
    }
  })

  // 对照组:alpha = 1 时描边就是纯渐变 —— 证明「变淡」来自 alpha,不是来自别的什么。
  test("borderAlpha = 1 时描边回到纯渐变(对照组)", async () => {
    const stops = [RGBA.fromHex("#00e5ff"), RGBA.fromHex("#4d7cff")]
    const frame = await shot({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: PANEL,
      gradientStops: stops,
      borderAlpha: 1,
    })
    for (const cell of perimeterCells(WIDTH, HEIGHT)) {
      // 顶边那一行额外叠了光晕,跳过它(光晕本身由下一节钉)。
      if (cell.y === 0) continue
      const actual = at(frame, cell.x, cell.y, "边框格")
      const pure = gradientAt(stops, cell.t)
      expect(Math.abs(actual.r - pure.r), `r @ (${cell.x},${cell.y})`).toBeLessThan(0.01)
      expect(Math.abs(actual.g - pure.g), `g @ (${cell.x},${cell.y})`).toBeLessThan(0.01)
      expect(Math.abs(actual.b - pure.b), `b @ (${cell.x},${cell.y})`).toBeLessThan(0.01)
    }
  })

  // borderBackdrop:透明卡自己给不出「背后是什么」,必须由调用点声明 ——
  // 否则叠色会朝默认黑收敛,浅色主题下整圈描边会沉下去。
  test("borderBackdrop 决定叠色背景:同一条渐变,给不同背景得到不同描边", async () => {
    const stops = [RGBA.fromHex("#00e5ff"), RGBA.fromHex("#4d7cff")]
    const onDark = await shot({ width: WIDTH, height: HEIGHT, gradientStops: stops, borderBackdrop: PANEL })
    const onLight = await shot({
      width: WIDTH,
      height: HEIGHT,
      gradientStops: stops,
      borderBackdrop: RGBA.fromHex("#f5f7fa"),
    })
    expect(lum(at(onDark, 0, 1, "深色底上的左边框"))).toBeLessThan(lum(at(onLight, 0, 1, "浅色底上的左边框")))
    // 且深色那一档真的等于「按 PANEL 叠出来的那一档」
    const pure = gradientAt(stops, perimeterCells(WIDTH, HEIGHT).find((cell) => cell.x === 0 && cell.y === 1)!.t)
    const expected = alphaOver(pure, PANEL, BORDER_ALPHA_DEFAULT)
    const actual = at(onDark, 0, 1, "深色底上的左边框")
    expect(Math.abs(actual.r - expected.r)).toBeLessThan(0.01)
    expect(Math.abs(actual.g - expected.g)).toBeLessThan(0.01)
    expect(Math.abs(actual.b - expected.b)).toBeLessThan(0.01)
  })

  // 全透明的叠色底 = 「背后没有实色」,不是「背后是黑」。主题自己声明
  // "transparent" 时(assets/lucent-orng.json:68-78)每个 borderBackdrop 都是这一档,
  // 折算式里那 38% 的底色就落到了纯黑上 —— 浅色终端上整圈描边因此比原型重。
  // 这一条钉的是渲染结果:全透明叠色底画出来的描边与 borderAlpha = 1 逐格相同,
  // 也就是原型给的那圈渐变本身(纯函数那一层在 neon.test.ts 的 softenOver 里)。
  test("叠色底全透明时不折算:逐格等于纯渐变(与 borderAlpha = 1 同档)", async () => {
    const stops = [RGBA.fromHex("#00e5ff"), RGBA.fromHex("#4d7cff")]
    const nothing = RGBA.fromValues(0, 0, 0, 0)
    const unknown = await shot({ width: WIDTH, height: HEIGHT, gradientStops: stops, borderBackdrop: nothing })
    const flat = await shot({
      width: WIDTH,
      height: HEIGHT,
      gradientStops: stops,
      borderBackdrop: nothing,
      borderAlpha: 1,
    })
    for (const cell of perimeterCells(WIDTH, HEIGHT)) {
      // 顶边那一行还叠了光晕,两帧同样叠,所以逐格比仍然成立。
      const a = at(unknown, cell.x, cell.y, "未知底上的边框")
      const b = at(flat, cell.x, cell.y, "borderAlpha=1 的边框")
      expect(Math.abs(a.r - b.r), `r @ (${cell.x},${cell.y})`).toBeLessThan(0.01)
      expect(Math.abs(a.g - b.g), `g @ (${cell.x},${cell.y})`).toBeLessThan(0.01)
      expect(Math.abs(a.b - b.b), `b @ (${cell.x},${cell.y})`).toBeLessThan(0.01)
    }
    // 对照:同一个「未知底」若按纯黑折算,左边框中段会明显暗于纯渐变 —— 光晕抬不回来这个差。
    const cell = perimeterCells(WIDTH, HEIGHT).find((item) => item.x === 0 && item.y === 1)!
    const folded = alphaOver(gradientAt(stops, cell.t), RGBA.fromValues(0, 0, 0, 0), BORDER_ALPHA_DEFAULT)
    expect(lum(at(unknown, 0, 1, "未知底上的左边框"))).toBeGreaterThan(lum(folded))
  })
})

describe("NeonBox 顶部光晕", () => {
  // 色板两端同色:于是同一条边上除了光晕之外没有任何别的差异,
  // 「顶边比底边亮」才测得到光晕本身,而不是色带走到哪儿了。
  const flat = [RGBA.fromHex("#3aa0ff"), RGBA.fromHex("#3aa0ff")]

  test("上边框比下边框亮一档", async () => {
    const frame = await shot({ width: WIDTH, height: HEIGHT, backgroundColor: PANEL, gradientStops: flat })
    const top = lum(at(frame, 6, 0, "上边框中点"))
    const bottom = lum(at(frame, 6, HEIGHT - 1, "下边框中点"))
    expect(top).toBeGreaterThan(bottom)
    // 光晕只有 6%(向白插),亮度的增量必须小到读不出「第二圈边」:净亮 0.05~0.2。
    expect(top - bottom).toBeGreaterThan(0.04)
    expect(top - bottom).toBeLessThan(0.2)
  })

  test("左右边框中段不跟着亮(不是第二圈亮边)", async () => {
    const frame = await shot({ width: WIDTH, height: HEIGHT, backgroundColor: PANEL, gradientStops: flat })
    // HEIGHT = 5:左边框的非角格子是 y=1..3,那一段一律不带光晕。
    const middle = [1, 2, 3].map((y) => lum(at(frame, 0, y, "左边框")))
    for (const value of middle) expect(value).toBeCloseTo(middle[0]!, 2)
    expect(middle[0]!).toBeLessThan(lum(at(frame, 6, 0, "上边框")))
  })

  // 光晕的量本身钉在 6% 向白:多一分就成第二圈边,少一分在叠色之后看不出来。
  test("光晕量就是 brighten(叠色后的边, TOP_EDGE_GLOW, 白)", async () => {
    const stops = [RGBA.fromHex("#00e5ff"), RGBA.fromHex("#4d7cff")]
    const frame = await shot({ width: WIDTH, height: HEIGHT, backgroundColor: PANEL, gradientStops: stops })
    const cell = perimeterCells(WIDTH, HEIGHT).find((item) => item.x === 6 && item.y === 0)!
    const base = alphaOver(gradientAt(stops, cell.t), PANEL, BORDER_ALPHA_DEFAULT)
    const k = TOP_EDGE_GLOW
    const expected = brighten(base, k, NEON_WHITE)
    const actual = at(frame, cell.x, cell.y, "上边框")
    expect(Math.abs(actual.r - expected.r)).toBeLessThan(0.01)
    expect(Math.abs(actual.g - expected.g)).toBeLessThan(0.01)
    expect(Math.abs(actual.b - expected.b)).toBeLessThan(0.01)
  })

  test("四角跟着所在的那条边走:两个上角亮、两个下角不亮", async () => {
    const frame = await shot({ width: WIDTH, height: HEIGHT, backgroundColor: PANEL, gradientStops: flat })
    const topLeft = lum(at(frame, 0, 0, "╭"))
    const bottomLeft = lum(at(frame, 0, HEIGHT - 1, "╰"))
    expect(topLeft).toBeGreaterThan(bottomLeft)
    // 角格与同一条边的直段同档 —— 角不会因为「拐了个弯」就变成更重的一档
    expect(topLeft).toBeCloseTo(lum(at(frame, 6, 0, "上边框")), 2)
  })

  // 光晕的方向跟着叠色底的明暗极性走(见 ui/card 的 topEdgeTarget)。浅底上那一档是
  // **朝黑推**:描边本来就比近白的底色暗,朝白推等于把它往底色上靠,顶边的对比度反而
  // 降一档(实测 #87b6e5 → #8ebae6)。所以浅底上顶边要比同一条边的中段**更暗**。
  test("浅色叠色底:光晕朝黑推,顶边比边中段更暗而不是更亮", async () => {
    const LIGHT = RGBA.fromHex("#f5f7fa")
    // 色板两端同色,于是同一条边上除了光晕之外没有别的差异(同上面那两条的理由)。
    //
    // **不写 backgroundColor**:这一条要试的是「透明卡坐在浅色底上」,而边框格背后那一层
    // 实色按「自己的底色 → borderBackdrop → 祖先底色」解析(见 ui/card 的 borderCellBackdrop)。
    // 给了自己的底色又给一个不同的 borderBackdrop 是自相矛盾的声明 —— 解析会取自己的底色,
    // 于是这一条就变成在深色底上测光晕,测不到它想测的那件事。
    const frame = await shot({
      width: WIDTH,
      height: HEIGHT,
      borderBackdrop: LIGHT,
      gradientStops: flat,
    })
    const top = lum(at(frame, 6, 0, "浅底上的上边框"))
    const side = lum(at(frame, 0, 1, "浅底上的左边框中段"))
    expect(top).toBeLessThan(side)
    // 幅度仍在同一档:6% 朝黑 ≈ 0.06 × 通道值,净差不超过 0.2(与深底那条同量级)。
    expect(side - top).toBeGreaterThan(0.04)
    expect(side - top).toBeLessThan(0.2)
  })

  // 判据本身:同一个叠色底,方向由它决定 —— 深底朝白、浅底朝黑、全透明维持朝白。
  test("光晕目标色:深底朝白、浅底朝黑、底未知时维持朝白", () => {
    expect(topEdgeTarget(PANEL)).toBe(NEON_WHITE)
    expect(topEdgeTarget(RGBA.fromHex("#f5f7fa"))).toBe(TOP_EDGE_INK)
    expect(topEdgeTarget(RGBA.fromValues(0, 0, 0, 0))).toBe(NEON_WHITE)
  })
})

describe("柔边不改变色带顺序", () => {
  test("沿上边框读出来仍是 粉 → 紫 → 青,且每一格的色相都对得上纯渐变", async () => {
    const frame = await shot({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: PANEL,
      gradientStops: GLASS_MAIN,
    })
    // 上边框的非角格子:x = 1..WIDTH-2
    const cells = perimeterCells(WIDTH, HEIGHT).filter((cell) => cell.y === 0 && cell.x > 0 && cell.x < WIDTH - 1)
    const rendered = cells.map((cell) => hue(at(frame, cell.x, cell.y, "上边框")))
    const pure = cells.map((cell) => hue(gradientAt(GLASS_MAIN, cell.t)))
    // 逐格保序:叠色不该挪动任何一格的色相(向底色混只降饱和度)。
    for (let i = 0; i < rendered.length; i++) {
      expect(Math.abs(rendered[i]! - pure[i]!), `第 ${i} 格`).toBeLessThan(6)
    }
    // 相对顺序:纯渐变里单调的一段,叠色后必须还是同一个方向的单调。
    const direction = Math.sign(pure[pure.length - 1]! - pure[0]!)
    expect(direction).not.toBe(0)
    for (let i = 1; i < rendered.length; i++) {
      expect(Math.sign(rendered[i]! - rendered[i - 1]!) === direction || rendered[i] === rendered[i - 1]).toBe(true)
    }
  })

  test("整圈的色相顺序也还是 粉 → 紫 → 青(起点粉、终点青)", async () => {
    const frame = await shot({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: PANEL,
      gradientStops: GLASS_MAIN,
    })
    const cells = perimeterCells(WIDTH, HEIGHT)
    const first = hue(at(frame, cells[0]!.x, cells[0]!.y, "首格"))
    const last = hue(at(frame, cells[cells.length - 1]!.x, cells[cells.length - 1]!.y, "末格"))
    // --gb-main 是 #ff5c9e(粉,≈330°)→ #a78bfa(紫,≈258°)→ #4fd1e0(青,≈186°):首尾必须分得开,
    // 且首格比末格更「粉」—— 即色相更接近 330 而不是 186。
    expect(Math.abs(first - hue(GLASS_MAIN[0]!))).toBeLessThan(6)
    expect(Math.abs(last - hue(GLASS_MAIN[2]!))).toBeLessThan(8)
    expect(first).toBeGreaterThan(last)
  })
})

// 面板卡 / 输入卡 / 节点卡在原型里各有自己的 alpha(见 neon.ts 的 BORDER_ALPHA_DEFAULT 注释表)。
// 这一节钉的是「三个壳确实按各自的档位透传」—— 手一抖写回默认值,只有这里会红。
const theme = resolveTheme(novaway as ThemeJson, "dark")

type Harness = Awaited<ReturnType<typeof testRender>>

async function shellGrid(node: () => unknown) {
  const app = await testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        {node() as never}
      </ThemeTestProviders>
    ),
    { width: 44, height: 10 },
  )
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      if (app.captureCharFrame().includes("BODYMARK")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return { grid: grid(app), frame: app.captureCharFrame() }
  } finally {
    app.renderer.destroy()
  }
}

function firstBorderX(frame: string) {
  const row = frame.split("\n").find((line) => line.includes("╭"))
  if (!row) throw new Error("帧里找不到霓虹卡边框")
  return row.indexOf("╭")
}

function corner(frame: string) {
  const top = frame.split("\n").findIndex((line) => line.includes("╭"))
  return { y: top, x: firstBorderX(frame) }
}

/**
 * 一张壳的左上角(╭)的期望描边色。
 *
 * 取**角格**而不是边中段是有意的:perimeterCells 给角格的 t = 0,于是渐变取到 stops[0]
 * 本身 —— 期望值与这张卡实际渲染多宽、多高完全无关,不用在测试里去复算周长与列号
 * (复算过一次,数错一格就变成「测渲染布局」而不是「测叠色档」了)。
 * 光晕的目标色同样从叠色底取(见 ui/card 的 topEdgeTarget)—— 这一节用的全是深色底,
 * 所以那个目标就是纯白,但写成从叠色底推出来的,换主题时这条不会骗人。
 */
const cornerTone = (stops: readonly RGBA[], backdrop: RGBA, alpha: number) =>
  brighten(softenOver(stops[0]!, backdrop, alpha), TOP_EDGE_GLOW, topEdgeTarget(backdrop))

function expectCorner(actual: { r: number; g: number; b: number }, expected: RGBA, label: string) {
  expect(Math.abs(actual.r - expected.r), `${label} r`).toBeLessThan(0.012)
  expect(Math.abs(actual.g - expected.g), `${label} g`).toBeLessThan(0.012)
  expect(Math.abs(actual.b - expected.b), `${label} b`).toBeLessThan(0.012)
}

describe("各壳的 borderAlpha 透传", () => {
  test("侧栏分区卡:面板卡那一档(0.70),叠在 backgroundPanel 上", async () => {
    expect(PANEL_CARD_ALPHA).toBe(0.7)
    const { grid: frame, frame: chars } = await shellGrid(() => (
      <SidebarCard title="资源管理器" badge="x">
        <text>BODYMARK</text>
      </SidebarCard>
    ))
    const at0 = corner(chars)
    expectCorner(
      at(frame, at0.x, at0.y, "侧栏卡左上角"),
      cornerTone(TOOL_STOPS, theme.backgroundPanel, PANEL_CARD_ALPHA),
      "侧栏卡",
    )
  })

  test("输入卡:原型 .prompt 的那一档(0.45),叠在 background 上", async () => {
    expect(INPUT_CARD_ALPHA).toBe(0.45)
    const { grid: frame, frame: chars } = await shellGrid(() => (
      <PromptCard focused={false}>
        <text>BODYMARK</text>
      </PromptCard>
    ))
    const at0 = corner(chars)
    expectCorner(
      at(frame, at0.x, at0.y, "输入卡左上角"),
      cornerTone(TOOL_STOPS, theme.background, INPUT_CARD_ALPHA),
      "输入卡",
    )
  })

  test("NeonCard:默认那一档(0.62),并把 borderAlpha 透给节点卡自己选", async () => {
    const plain = await shellGrid(() => (
      <NeonCard>
        <text>BODYMARK</text>
      </NeonCard>
    ))
    const node = await shellGrid(() => (
      <NeonCard borderAlpha={0.72}>
        <text>BODYMARK</text>
      </NeonCard>
    ))
    const base = corner(plain.frame)
    const shifted = corner(node.frame)
    expectCorner(
      at(plain.grid, base.x, base.y, "默认档"),
      cornerTone(semanticStops(theme, "assistant"), theme.background, 0.62),
      "默认档",
    )
    expectCorner(
      at(node.grid, shifted.x, shifted.y, "节点档"),
      cornerTone(semanticStops(theme, "assistant"), theme.background, 0.72),
      "节点档",
    )
  })

  // 提示卡不吃气泡卡那 0.62:原型 `.tip` 自己给的是 .85 → .65(均值 0.75),
  // 而这张卡又是带常驻 flow 的那一族里唯一的小卡 —— 折算档写错的话,那一圈琥珀边
  // 会一边走一边偏重。导出 TIP_CARD_ALPHA 就是免得测试里再抄一个数。
  test("提示卡:原型 .tip 那一档(0.75),叠在 background 上", async () => {
    expect(TIP_CARD_ALPHA).toBe(0.75)
    const { grid: frame, frame: chars } = await shellGrid(() => (
      <TipCard parts={[{ text: "BODYMARK", highlight: false }]} width={40} />
    ))
    const at0 = corner(chars)
    expectCorner(
      at(frame, at0.x, at0.y, "提示卡左上角"),
      cornerTone(semanticStops(theme, "tip"), theme.background, TIP_CARD_ALPHA),
      "提示卡",
    )
  })
})

// 流程图节点卡走的是 NeonCard 这层壳,所以「canvas.tsx 到底传没传 FLOW_NODE_ALPHA」
// 只有挂真画布才测得到。喂的是 flow-canvas.test.tsx 同一份 fixture。
describe("流程图节点卡的叠色档", () => {
  test("节点卡的描边 = role 色板按 FLOW_NODE_ALPHA 叠在 background 上,再叠顶边光晕", async () => {
    expect(FLOW_NODE_ALPHA).toBe(0.72)
    const app = await testRender(
      () => (
        <ThemeTestProviders>
          <ThemeReady />
          <FlowCanvas messages={FIXTURE_MESSAGES} parts={FIXTURE_PARTS} reveal={false} />
        </ThemeTestProviders>
      ),
      { width: 96, height: 64 },
    )
    try {
      let frame = ""
      for (let attempt = 0; attempt < 200; attempt++) {
        await app.renderOnce()
        frame = app.captureCharFrame()
        if (frame.includes("用户输入") && frame.includes("第 2 轮")) break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      // fixture 的第一个节点是「用户输入」→ role `user` → 粉紫双段
      const expected = brighten(
        softenOver(semanticStops(theme, "user")[0]!, theme.background, FLOW_NODE_ALPHA),
        TOP_EDGE_GLOW,
        topEdgeTarget(theme.background),
      )
      const at0 = corner(frame)
      expectCorner(at(grid(app), at0.x, at0.y, "节点卡左上角"), expected, "节点卡")
    } finally {
      app.renderer.destroy()
    }
  })
})

// 叠色之后描边明显不该再被当成「一条实线」。这一条是整节的落点:
// 光晕量、alpha 档、NEON_WHITE 三者合成出来的净增量必须留在可读区间内。
describe("柔边与光晕的合成量", () => {
  test("默认档下描边的亮度落在「纯渐变」与「卡底色」之间,不到纯渐变的八成", async () => {
    const stops = [RGBA.fromHex("#00e5ff"), RGBA.fromHex("#4d7cff")]
    const frame = await shot({ width: WIDTH, height: HEIGHT, backgroundColor: PANEL, gradientStops: stops })
    const cell = perimeterCells(WIDTH, HEIGHT).find((item) => item.x === 6 && item.y === 0)!
    const pure = lum(gradientAt(stops, cell.t))
    const actual = lum(at(frame, cell.x, cell.y, "上边框"))
    expect(actual).toBeLessThan(pure * 0.8)
    expect(actual).toBeGreaterThan(lum(PANEL) + 0.2)
    // 光晕量本身仍在 5%~8% 之间(向白插值前的比例)
    expect(TOP_EDGE_GLOW).toBeGreaterThanOrEqual(0.05)
    expect(TOP_EDGE_GLOW).toBeLessThanOrEqual(0.08)
    // 目标色就是纯白 —— 提亮改的是「亮不亮」,alpha 原样不动
    expect(NEON_WHITE.a).toBe(1)
    expect(NEON_WHITE.r).toBe(1)
  })
})
