/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA, type CapturedFrame } from "@opentui/core"
// 裸导入跑 extend({ neonbox }) 的副作用;类型单独用 import type 拿(见 card.test.tsx 的理由)。
import type { NeonBoxRenderable } from "../../src/ui/card"
import "../../src/ui/card"
import { perimeterCells } from "../../src/ui/neon"

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

function expectBorder(app: { captureSpans(): CapturedFrame }, expected: RGBA, label: string) {
  for (const cell of perimeterCells(WIDTH, HEIGHT)) {
    const actual = borderColor(app, cell.x, cell.y)
    const diff = Math.max(
      Math.abs(actual.r - expected.r),
      Math.abs(actual.g - expected.g),
      Math.abs(actual.b - expected.b),
    )
    expect(diff, `${label} @ (${cell.x},${cell.y})`).toBeLessThan(0.01)
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
      expectBorder(app, START, "延迟窗口内")
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
      const cell = perimeterCells(WIDTH, HEIGHT)[5]!
      const reds: number[] = []
      for (let frame = 0; frame < 8; frame++) {
        await new Promise((resolve) => setTimeout(resolve, 40))
        await app.renderOnce()
        reds.push(borderColor(app, cell.x, cell.y).r)
      }
      // 起点是纯红、终点是纯蓝:红通道必须一路降到底,不能中途回弹。
      // 首帧不做「必须还是纯红」的断言 —— testRender + renderOnce 的耗时不可控,
      // 第一帧可能已经走到 k ≈ 0.3。「k = 0 时是纯红」由上面那条延迟 1 秒的用例钉死。
      for (let i = 1; i < reds.length; i++) expect(reds[i]!).toBeLessThanOrEqual(reds[i - 1]! + 1e-6)
      expect(reds[0]!).toBeGreaterThan(0.3)
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
