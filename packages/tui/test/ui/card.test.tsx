/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA, type CapturedFrame } from "@opentui/core"
import "../../src/ui/card"

describe("NeonBox 渐变卡片", () => {
  test("自绘圆角边框,内容画在边框内侧", async () => {
    const app = await testRender(
      () => (
        <neonbox
          width={12}
          height={4}
          backgroundColor={RGBA.fromHex("#101010")}
          gradientStops={[RGBA.fromHex("#ff0000"), RGBA.fromHex("#0000ff")]}
        >
          <text>hi</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      const lines = frame.split("\n")
      expect(lines[0]).toContain("╭──────────╮")
      expect(frame).toContain("│")
      expect(frame).toContain("╯")
      expect(frame).toContain("│hi")
    } finally {
      app.renderer.destroy()
    }
  })

  test("JSX 直写 paddingTop=0/paddingLeft=0 被 setter 夹到 1,内容不盖掉边框", async () => {
    const app = await testRender(
      () => (
        <neonbox
          width={10}
          height={3}
          backgroundColor={RGBA.fromHex("#101010")}
          gradientStops={[RGBA.fromHex("#ff0000"), RGBA.fromHex("#0000ff")]}
          paddingTop={0}
          paddingLeft={0}
        >
          <text>ab</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("╭────────╮")
      expect(frame).toContain("│ab")
    } finally {
      app.renderer.destroy()
    }
  })

  test("JSX 直写 padding=0/paddingX=0 简写也被 setter 夹到 1,内容不盖掉边框", async () => {
    const app = await testRender(
      () => (
        <neonbox
          width={10}
          height={3}
          backgroundColor={RGBA.fromHex("#101010")}
          gradientStops={[RGBA.fromHex("#ff0000"), RGBA.fromHex("#0000ff")]}
          padding={0}
          paddingX={0}
        >
          <text>ab</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      const lines = frame.split("\n")
      expect(frame).toContain("╭────────╮")
      expect(frame).toContain("│ab")
      expect(lines.some((line) => line.startsWith("ab"))).toBe(false)
    } finally {
      app.renderer.destroy()
    }
  })

  test("不给 gradientStops 时不画边框(退回普通 box 行为)", async () => {
    const app = await testRender(
      () => (
        <neonbox width={8} height={3} backgroundColor={RGBA.fromHex("#101010")}>
          <text>plain</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("plain")
      expect(frame).not.toContain("╭")
    } finally {
      app.renderer.destroy()
    }
  })
})

// captureSpans 给的是「一段同色字符」,而边框是逐格渐变的带子,所以先按字符摊平,
// 再用 ╭…╮ 切出上边框那一段 —— 不依赖 getSpanLines 会不会吐出行尾空白。
// 测试内容全是 1 列宽的 box-drawing 字符,列号按 1 递增就对得上。
function rowCells(frame: CapturedFrame, row: number) {
  const line = frame.lines[row]
  if (!line) return []
  return line.spans.flatMap((span) =>
    [...span.text].map((ch) => ({
      ch,
      cell: `${span.fg.r.toFixed(4)},${span.fg.g.toFixed(4)},${span.fg.b.toFixed(4)}`,
    })),
  )
}

function topBorder(frame: CapturedFrame) {
  const cells = rowCells(frame, 0)
  const start = cells.findIndex((item) => item.ch === "╭")
  const end = cells.findIndex((item) => item.ch === "╮")
  if (start < 0 || end < start) return []
  return cells.slice(start, end + 1)
}

// 相位每 80ms 走一格(整圈 100 格),200ms 足够跨过两格以上;这里只等定时器,
// 不依赖渲染循环 —— renderer 本身不转。
const PHASE_WAIT = 200

const cardProps = {
  width: 12,
  height: 4,
  backgroundColor: RGBA.fromHex("#101010"),
  gradientStops: [RGBA.fromHex("#ff0000"), RGBA.fromHex("#0000ff")],
}

function animatedCard(animationsEnabled?: () => boolean) {
  return () => (
    <neonbox {...cardProps} animated animationsEnabled={animationsEnabled}>
      <text>hi</text>
    </neonbox>
  )
}

describe("NeonBox 流动描边", () => {
  test("不传 animated 时描边色静止:两次渲染逐格同色", async () => {
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
      const before = topBorder(app.captureSpans())
      await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
      await app.renderOnce()
      const after = topBorder(app.captureSpans())
      expect(before.map((item) => item.ch).join("")).toBe("╭──────────╮")
      expect(after).toEqual(before)
    } finally {
      app.renderer.destroy()
    }
  })

  test("animated 时相位推进:两次渲染之间上边框颜色发生变化", async () => {
    const app = await testRender(animatedCard(), { width: 20, height: 6 })
    try {
      await app.renderOnce()
      const before = topBorder(app.captureSpans())
      await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
      await app.renderOnce()
      const after = topBorder(app.captureSpans())
      // 变化的必须是颜色本身,不能是「整行没了」这种假阳性
      expect(after.map((item) => item.ch)).toEqual(before.map((item) => item.ch))
      expect(after.map((item) => item.cell)).not.toEqual(before.map((item) => item.cell))
    } finally {
      app.renderer.destroy()
    }
  })

  test("animationsEnabled 门控(对应 KV 的 animations_enabled)关掉时相位停表", async () => {
    const app = await testRender(
      animatedCard(() => false),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      const before = topBorder(app.captureSpans())
      await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
      await app.renderOnce()
      expect(topBorder(app.captureSpans())).toEqual(before)
    } finally {
      app.renderer.destroy()
    }
  })

  test("扫光提亮盖在相位头部:上边框头格被拉向白色", async () => {
    const app = await testRender(animatedCard(), { width: 20, height: 6 })
    try {
      await app.renderOnce()
      // 相位从 0 起步,上边框头格(cell.t=0)的环形距离恰好 0 = 提亮量最大(55%)。
      const head = topBorder(app.captureSpans())[0]!
      // stops 是纯红→纯蓝:纯渐变下头格是纯红(g=0),扫光把它往白拉,g 必须抬起来。
      expect(Number(head.cell.split(",")[1])).toBeGreaterThan(0.3)
    } finally {
      app.renderer.destroy()
    }
  })

  test("扫光只落在相位头部后的窗口内,窗口外的格子保持纯渐变", async () => {
    const app = await testRender(animatedCard(), { width: 20, height: 6 })
    try {
      await app.renderOnce()
      const border = topBorder(app.captureSpans())
      // 12×4 的周长 = 2×(12−1) + 2×(4−2) = 24 格,窗口 0.12 圈 ≈ 2.9 格;
      // 上边框末格(cell.t=11/24≈0.46)离头部 0.46 圈,在窗口外。
      expect(Number(border.at(-1)!.cell.split(",")[1])).toBe(0)
    } finally {
      app.renderer.destroy()
    }
  })
})
