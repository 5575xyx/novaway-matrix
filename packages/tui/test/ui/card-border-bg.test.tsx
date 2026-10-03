/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA, type CapturedFrame } from "@opentui/core"
import type { JSX } from "solid-js"
import { brighten, gradientAt, perimeterCells, softenOver } from "../../src/ui/neon"
import { TOP_EDGE_GLOW, topEdgeTarget } from "../../src/ui/card"
// 裸导入跑 extend({ neonbox }) 的副作用(见 test/ui/card.test.tsx 的理由)。
import "../../src/ui/card"

// 边框格**写进格子里的那个底色**(bg 通道)—— 与 test/ui/card-border-alpha 测的 fg 那一层
// 是同一枚硬币的两面,那一节只管「描边该是什么颜色」,这一节管「描边所在那一格底下是什么颜色」。
//
// 为什么这一层需要单独一节:原生 `OptimizedBuffer.setCell(x, y, char, fg, bg)` 把 bg 直接
// 写进格子,**不做 alpha 合成、也没有「沿用原有底色」这种语义**(见 node_modules/@opentui/core
// 的 chunk 里 setCell → bufferSetCell)。于是一张 backgroundColor 全透明的卡把
// RGBA(0,0,0,0) 递进去,终端读到的是 RGB(0,0,0) —— 深色主题下页面近黑,那圈黑读起来「就是边框」;
// 浅色主题下它是每张透明卡外面一圈实实在在的黑框(用户报的就是这个)。
//
// 这一节的判据因此是 bg 通道本身,而不是「描边好不好看」。

const WIDTH = 12
const HEIGHT = 5
const LIGHT = RGBA.fromHex("#f5f7fa")
const PANEL = RGBA.fromHex("#101010")
const STOPS = [RGBA.fromHex("#00e5ff"), RGBA.fromHex("#4d7cff")]

type Cell = { fg: RGBA; bg: RGBA }

// captureSpans 是一段段同色字符,边框又逐格渐变,所以先按字符摊平成 "行:列" → 那一格。
function cells(app: { captureSpans(): CapturedFrame }) {
  const map = new Map<string, Cell>()
  app.captureSpans().lines.forEach((line, row) => {
    let col = 0
    for (const span of line.spans) {
      for (const _ of span.text) {
        map.set(`${row}:${col}`, { fg: span.fg, bg: span.bg })
        col += 1
      }
    }
  })
  return map
}

function at(map: Map<string, Cell>, x: number, y: number, label: string) {
  const value = map.get(`${y}:${x}`)
  if (!value) throw new Error(`${label} (${x},${y}) 不在帧里`)
  return value
}

// buffer 走 8bit 量化,单通道容 1/255 略宽一点。
function sameColor(actual: RGBA, expected: RGBA) {
  return (
    Math.abs(actual.r - expected.r) <= 0.005 &&
    Math.abs(actual.g - expected.g) <= 0.005 &&
    Math.abs(actual.b - expected.b) <= 0.005
  )
}

async function shot(node: () => JSX.Element) {
  const app = await testRender(node, { width: 20, height: 8 })
  try {
    await app.renderOnce()
    return cells(app)
  } finally {
    app.renderer.destroy()
  }
}

const BORDER = perimeterCells(WIDTH, HEIGHT)

describe("NeonBox 边框格写入的底色", () => {
  // 这一条是本节的落点,也是用户报的那个 bug:透明卡在浅色主题下每张外面套一圈黑框。
  // 修之前 bg 写的是卡片自己的 backgroundColor,透明卡那一档就是 RGBA(0,0,0,0),
  // setCell 原样写进格子 → 终端读到 rgb(0,0,0)。
  test("透明卡:边框格的 bg 是声明的 borderBackdrop,不是 rgb(0,0,0)", async () => {
    const frame = await shot(() => (
      <neonbox width={WIDTH} height={HEIGHT} gradientStops={STOPS} borderBackdrop={LIGHT}>
        <text>hi</text>
      </neonbox>
    ))
    for (const cell of BORDER) {
      const actual = at(frame, cell.x, cell.y, "边框格").bg
      expect(sameColor(actual, LIGHT), `(${cell.x},${cell.y}) 实得 ${actual.r},${actual.g},${actual.b}`).toBe(true)
    }
    // 单独把「不是黑」也钉一句:这一档要是哪天退回写背景色,上面那条会先红,
    // 而「浅色底上仍然是黑」才是用户真正看见的那个症状。
    expect(at(frame, 0, 1, "左边框中段").bg.r).toBeGreaterThan(0.9)
  })

  // 改的只是 bg 通道,fg 那一层(叠色 + 顶边光晕)必须一字不变 ——
  // 它叠的是同一个 backdrop,两层指的是同一个色,所以描边不会带着一圈对不上的暗边。
  test("fg 那一层不变:逐格仍是叠过同一个 backdrop 的渐变色加顶边光晕", async () => {
    const frame = await shot(() => (
      <neonbox width={WIDTH} height={HEIGHT} gradientStops={STOPS} borderBackdrop={LIGHT}>
        <text>hi</text>
      </neonbox>
    ))
    for (const cell of BORDER) {
      const expected = brighten(
        softenOver(gradientAt(STOPS, cell.t), LIGHT, 0.62),
        cell.y === 0 ? TOP_EDGE_GLOW : 0,
        topEdgeTarget(LIGHT),
      )
      const actual = at(frame, cell.x, cell.y, "边框格").fg
      expect(sameColor(actual, expected), `(${cell.x},${cell.y}) 实得 ${actual.r},${actual.g},${actual.b}`).toBe(true)
    }
  })

  // 有底色的卡(用户气泡 / 工具卡 / 思考卡 / 错误卡 / 侧栏根卡)今天就是对的:边框格背后
  // 露出来的确实是自己的底色,叠色参考与写入的 bg 是同一个色,这一档不许被改。
  test("有底色的卡:bg 与叠色参考都仍是它自己的 backgroundColor", async () => {
    const frame = await shot(() => (
      <neonbox width={WIDTH} height={HEIGHT} backgroundColor={PANEL} gradientStops={STOPS}>
        <text>hi</text>
      </neonbox>
    ))
    for (const cell of BORDER) {
      expect(sameColor(at(frame, cell.x, cell.y, "边框格").bg, PANEL), `(${cell.x},${cell.y})`).toBe(true)
    }
  })

  // 最后一档兜底:调用点忘了声明 borderBackdrop 时,往上找最近的不透明祖先。
  // 侧栏分区卡就坐在有底色的侧栏根卡里(见 routes/session/sidebar.tsx),这一档找得到的就是它。
  test("忘了声明 borderBackdrop 时向上找最近的不透明祖先底色", async () => {
    const frame = await shot(() => (
      <box width={20} height={8} backgroundColor={LIGHT}>
        <neonbox width={WIDTH} height={HEIGHT} gradientStops={STOPS}>
          <text>hi</text>
        </neonbox>
      </box>
    ))
    for (const cell of BORDER) {
      expect(sameColor(at(frame, cell.x, cell.y, "边框格").bg, LIGHT), `(${cell.x},${cell.y})`).toBe(true)
    }
  })

  // 一路都没有不透明底色时退回旧行为:仍然写透明,终端里读作黑。与 softenOver 的
  // 「背后不知道就不猜」同一条纪律 —— app 根盒子自己不带底色(整屏是渲染器填的),
  // 所以这一档确实会发生,把它钉住免得以后有人以为它是 bug。
  test("一路都没有不透明底色时退回旧行为(写透明,不凭空造一层实色)", async () => {
    const frame = await shot(() => (
      <neonbox width={WIDTH} height={HEIGHT} gradientStops={STOPS}>
        <text>hi</text>
      </neonbox>
    ))
    for (const cell of BORDER) {
      const actual = at(frame, cell.x, cell.y, "边框格").bg
      expect(actual.r, `(${cell.x},${cell.y})`).toBe(0)
      expect(actual.g, `(${cell.x},${cell.y})`).toBe(0)
      expect(actual.b, `(${cell.x},${cell.y})`).toBe(0)
    }
  })
})
