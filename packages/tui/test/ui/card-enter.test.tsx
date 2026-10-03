/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { createSignal, For, Show } from "solid-js"
import { testRender } from "@opentui/solid"
import { RGBA, type CapturedFrame } from "@opentui/core"
// 裸导入跑 extend({ neonbox }) 的副作用;类型单独用 import type 拿(见 card.test.tsx 的理由)。
import type { NeonBoxRenderable } from "../../src/ui/card"
import "../../src/ui/card"
import { perimeterCells, alphaOver, brighten, BORDER_ALPHA_DEFAULT, NEON_WHITE } from "../../src/ui/neon"
import { TOP_EDGE_GLOW } from "../../src/ui/card"
import { createEnterBaselineStore, ENTER_STAGGER_MAX_INDEX, ENTER_STAGGER_STEP } from "../../src/ui/enter"

// 入场淡入的集成层断言。纯函数层(fadeIn 的夹紧、enter-baseline 的判定)在
// neon.test.ts / enter.test.ts 里锁死,这里只做「卡片在延迟窗口里画什么色」这件事:
// 依赖「第一帧恰好落在第几毫秒」的断言在慢机器上会红,所以只取两个确定的时间点 ——
// 延迟还没到(一定 k = 0)与延迟 + 淡入时长已过(一定 k = 1)。

const WIDTH = 12
const HEIGHT = 4
const START = RGBA.fromHex("#ff0000")
const END = RGBA.fromHex("#0000ff")

const cardProps = {
  width: WIDTH,
  height: HEIGHT,
  gradientStops: [END],
  enterFrom: START,
}

function frame(app: { captureSpans(): CapturedFrame }) {
  const grid = new Map<string, { r: number; g: number; b: number }>()
  app.captureSpans().lines.forEach((line, row) => {
    let col = 0
    for (const span of line.spans) {
      for (const _ of span.text) {
        grid.set(`${row}:${col}`, { r: span.fg.r, g: span.fg.g, b: span.fg.b })
        col += 1
      }
    }
  })
  return grid
}

// 边框上一格的实际颜色。buffer 存 fg 走 8bit 量化,单格误差容 1/255。
function borderColor(app: { captureSpans(): CapturedFrame }, x: number, y: number) {
  const value = frame(app).get(`${y}:${x}`)
  if (!value) throw new Error(`边框格 (${x},${y}) 不在帧里`)
  return value
}

// 这几张卡没有自己的 backgroundColor,所以叠色底就是「透明黑」—— 见 ui/card 的
// borderBackdrop 注释:透明卡自己给不出背后是什么,这里恰好是同一条已知近似。
const BACKDROP = RGBA.fromValues(0, 0, 0, 0)

/**
 * 一格描边的终态色。测试不写死叠色算出来的数(那是把实现抄一遍),只把**契约**写出来:
 * 描边 = 起点/终色按 borderAlpha 叠在背后那层实色上,上边框那一行再叠一道顶部光晕。
 *
 * `lit = false` 用在淡入的第 0 帧上 —— 光晕在入场淡入**之前**入管线(见 ui/card 的
 * renderSelf),所以 k = 0 那一帧整圈都是起点色,顶边也不例外。这不是漏洞:入场未完成的
 * 描边本来就是「还没通电」的一圈灰,不该带环境光。
 */
function settledTone(color: RGBA, cell: { y: number }, lit = true) {
  const base = alphaOver(color, BACKDROP, BORDER_ALPHA_DEFAULT)
  return lit && cell.y === 0 ? brighten(base, TOP_EDGE_GLOW, NEON_WHITE) : base
}

function expectBorder(
  app: { captureSpans(): CapturedFrame },
  expected: RGBA,
  label: string,
  origin = { x: 0, y: 0 },
  lit = true,
) {
  for (const cell of perimeterCells(WIDTH, HEIGHT)) {
    const actual = borderColor(app, origin.x + cell.x, origin.y + cell.y)
    const tone = settledTone(expected, cell, lit)
    const diff = Math.max(Math.abs(actual.r - tone.r), Math.abs(actual.g - tone.g), Math.abs(actual.b - tone.b))
    expect(diff, `${label} @ (${origin.x + cell.x},${origin.y + cell.y})`).toBeLessThan(0.01)
  }
}

// 延迟给足 1 秒:第一条断言一定落在延迟窗口内,不受机器快慢影响。
const LONG_DELAY = 1000

describe("NeonBox 入场淡入", () => {
  test("延迟未到时描边整圈都是起点色(enterFrom)", async () => {
    const app = await testRender(
      () => (
        <neonbox {...cardProps} enterDelay={LONG_DELAY}>
          <text>hi</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      expectBorder(app, START, "延迟窗口内", { x: 0, y: 0 }, false)
    } finally {
      app.renderer.destroy()
    }
  })

  test("延迟 + 淡入时长已过后描边整圈都是渐变终色", async () => {
    const app = await testRender(
      () => (
        <neonbox {...cardProps} enterDelay={LONG_DELAY}>
          <text>hi</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      // 淡入时长 150ms(见 src/ui/card.ts 的 ENTER_FADE_MS),留足余量等它走完。
      await new Promise((resolve) => setTimeout(resolve, LONG_DELAY + 400))
      await app.renderOnce()
      expectBorder(app, END, "淡入完成后")
    } finally {
      app.renderer.destroy()
    }
  })

  test("不传 enterDelay 就是终态(animations_enabled 关闭时调用方走的就是这条路)", async () => {
    // 起始色刻意与终色差得最远:只要有一格不是纯终色,说明没传 enterDelay 也淡入了。
    const app = await testRender(
      () => (
        <neonbox {...cardProps}>
          <text>hi</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      expectBorder(app, END, "无 enterDelay 的首帧")
    } finally {
      app.renderer.destroy()
    }
  })

  test("enterDelay = 0 时描边逐帧向终色推进,不会跳色", async () => {
    const app = await testRender(
      () => (
        <neonbox {...cardProps} enterDelay={0}>
          <text>hi</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      // 盯右边框中段那一格:它既不在顶边(没有光晕)也不在角上,红通道的起落就是淡入本身。
      // 起点纯红按 0.62 叠在透明黑上是 r = 0.62,终点纯蓝叠出来 r = 0 —— 红通道必须一路降到底。
      const cell = perimeterCells(WIDTH, HEIGHT).find((item) => item.y === 2 && item.x === WIDTH - 1)!
      const reds: number[] = []
      for (let frame = 0; frame < 8; frame++) {
        await new Promise((resolve) => setTimeout(resolve, 40))
        await app.renderOnce()
        reds.push(borderColor(app, cell.x, cell.y).r)
      }
      // 起点是纯红、终点是纯蓝:红通道必须一路降到底,不能中途回弹。
      // 首帧不做「必须还是纯红」的断言 —— testRender + renderOnce 的耗时不可控,
      // 第一帧可能已经走到 k ≈ 0.3。「k = 0 时是起点色」由上面那条延迟 1 秒的用例钉死。
      for (let i = 1; i < reds.length; i++) expect(reds[i]!).toBeLessThanOrEqual(reds[i - 1]! + 1e-6)
      // 起点的叠色值是 0.62 —— 门槛取 0.3 是为了容忍第一帧已经淡了一半。
      expect(reds[0]!).toBeGreaterThan(0.3)
      expect(reds[0]!).toBeLessThanOrEqual(0.63)
      expect(reds[reds.length - 1]!).toBeLessThan(0.01)
    } finally {
      app.renderer.destroy()
    }
  })

  // 淡入不能变成常驻 12.5Hz 定时器:消息列表窗口化会把卡片反复建/销,
  // 每张卡留一张永不停的表,长会话滚动时定时器会越攒越多。
  test("淡入走完后定时器自停(不会变成常驻 requestRender)", async () => {
    let card: NeonBoxRenderable | undefined
    const app = await testRender(
      () => (
        <neonbox
          {...cardProps}
          enterDelay={0}
          ref={(value: NeonBoxRenderable) => {
            card = value
          }}
        >
          <text>hi</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      if (!card) throw new Error("卡片还没建出来")
      const node = card
      const original = node.requestRender.bind(node)
      let ticks = 0
      node.requestRender = () => {
        ticks++
        original()
      }
      // 延迟 0 + 淡入 150ms,300ms 足够走完;再等 300ms 只应剩相位/无关抖动。
      await new Promise((resolve) => setTimeout(resolve, 300))
      const afterFade = ticks
      expect(afterFade).toBeGreaterThan(0)
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(ticks).toBe(afterFade)
    } finally {
      app.renderer.destroy()
    }
  })

  test("destroy 之后入场定时器不再走(销毁泄漏会把测试进程吊住)", async () => {
    let card: NeonBoxRenderable | undefined
    const app = await testRender(
      () => (
        <neonbox
          {...cardProps}
          enterDelay={LONG_DELAY}
          ref={(value: NeonBoxRenderable) => {
            card = value
          }}
        >
          <text>hi</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      if (!card) throw new Error("卡片还没建出来")
      const node = card
      const original = node.requestRender.bind(node)
      let ticks = 0
      node.requestRender = () => {
        ticks++
        original()
      }
      await new Promise((resolve) => setTimeout(resolve, 120))
      app.renderer.destroy()
      const afterDestroy = ticks
      expect(afterDestroy).toBeGreaterThan(0)
      await new Promise((resolve) => setTimeout(resolve, 160))
      expect(ticks).toBe(afterDestroy)
    } finally {
      app.renderer.destroy()
    }
  })

  // 入场只播一次。enterDelay 是 JSX 属性,solid 每次重渲染都会重写它 —— 会话打开之后
  // 用户才把 animations_enabled 打开时,那个响应式表达式会从 undefined 变成一个数字,
  // 于是**每一张历史卡**都会被补播一次淡入。没有这道守卫,「打开动画」这个动作
  // 会变成「整屏闪一次」。
  test("已经画过第一帧之后再补 enterDelay 不重播入场", async () => {
    let card: NeonBoxRenderable | undefined
    const app = await testRender(
      () => (
        <neonbox
          {...cardProps}
          ref={(value: NeonBoxRenderable) => {
            card = value
          }}
        >
          <text>hi</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      if (!card) throw new Error("卡片还没建出来")
      const node = card
      expectBorder(app, END, "首帧")
      // 模拟「用户这时才打开动画」:属性被重写成有延迟。
      node.enterDelay = 0
      await app.renderOnce()
      expectBorder(app, END, "补写 enterDelay 之后")
    } finally {
      app.renderer.destroy()
    }
  })
})

// 上面那条守的是「**同一个实例**被补写属性」。视图切换走的是另一条路:两个 <Show> 当场
// 销毁旧视图建出新视图,每张卡拿到的是一个 painted === false 的**全新实例** —— 上面那道
// 守卫(painted)对它无效,于是 id 基线必须在**重挂之前**就把「这些卡早就亮过了」说出来。
// 见 ui/enter 的 createEnterBaselineStore。
//
// 这里按 routes/session 的真实结构搭:createEnterBaselineStore 的两个入参与那两个 Show
// 都与生产一致,只有「消息数组」换成了固定 id 列表。目标那条排到封顶档(320ms),延迟窗口
// 足够长,首帧一定落在窗口内 —— 断言不依赖机器快慢。
const STAGGER_FILLER = 8

type Placed = { enterDelay?: number; screenX: number; screenY: number }

async function mountViews() {
  const ids = [...Array.from({ length: STAGGER_FILLER }, (_, i) => `warm-${i}`), "target"]
  const [view, setView] = createSignal<"bubble" | "flow">("bubble")
  // known 随「消息到达」增长:与生产里 known = messages().map(m => m.id) 同一形状。
  const known: string[] = []
  const baseline = createEnterBaselineStore({ known: () => known, resetOn: view })
  const cards = new Map<string, Placed>()
  const Body = () => (
    <>
      <Show when={view() === "flow"}>
        <text>flow</text>
      </Show>
      <Show when={view() !== "flow"}>
        <box flexDirection="column">
          <For each={ids}>
            {(id) => (
              <neonbox
                {...cardProps}
                enterDelay={baseline().delayFor(id)}
                ref={(value: NeonBoxRenderable) => cards.set(id, value)}
              >
                <text>hi</text>
              </neonbox>
            )}
          </For>
        </box>
      </Show>
    </>
  )
  // 9 张 4 行高的卡要全部在屏内:目标那张在最后,borderColor 按它的 screenY 取格。
  const app = await testRender(Body, { width: 20, height: STAGGER_FILLER * HEIGHT + HEIGHT + 2 })
  // 首屏那一刻会话里已有这些消息(基线建在它们到达之前,于是它们逐条领延迟),
  // 之后切视图重建基线时它们就全成了「早就亮过了」。
  known.push(...ids)
  return { app, setView, cards }
}

describe("视图切换后的消息卡不重播入场", () => {
  test("切走再切回:卡片是全新实例,但拿到 undefined 而不是又一段延迟", async () => {
    const mounted = await mountViews()
    try {
      await mounted.app.renderOnce()
      const first = mounted.cards.get("target")
      if (!first) throw new Error("卡片还没建出来")
      expect(first.enterDelay).toBe(ENTER_STAGGER_MAX_INDEX * ENTER_STAGGER_STEP)
      // 首挂载落在延迟窗口内(k = 0):整圈都是起点色,顶边也不带光晕(见 settledTone)。
      expectBorder(mounted.app, START, "首挂载的延迟窗口内", { x: first.screenX, y: first.screenY }, false)

      mounted.setView("flow")
      for (let index = 0; index < 10; index++) {
        await mounted.app.renderOnce()
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      mounted.setView("bubble")
      await mounted.app.renderOnce()

      const again = mounted.cards.get("target")!
      // 确实是新实例 —— 上面那条 painted 守卫对它无效,这就是它要单独守的原因。
      expect(again).not.toBe(first)
      expect(again.enterDelay).toBeUndefined()
      // 关键断言:一帧都不淡入,直接是终态描边。
      expectBorder(mounted.app, END, "重挂之后的首帧", { x: again.screenX, y: again.screenY })
    } finally {
      mounted.app.renderer.destroy()
    }
  })
})
