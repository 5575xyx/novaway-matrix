/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { testRender } from "@opentui/solid"
import { RGBA, type CapturedFrame } from "@opentui/core"
import { alphaOver, brighten, gradientAt, NEON_WHITE, perimeterCells, semanticStops } from "../../src/ui/neon"
import { TOP_EDGE_GLOW } from "../../src/ui/card"
import { resolveTheme, type ThemeJson } from "../../src/theme"
import novaway from "../../src/theme/assets/novaway.json" with { type: "json" }
// 裸导入跑 extend({ neonbox }) 的副作用;类型单独用 import type 拿 ——
// 只写一条 `import { NeonBoxRenderable }` 时,转译器会把它当纯类型用途整条抹掉,
// 副作用跟着没跑,渲染时报 Unknown component type: neonbox。
import type { NeonBoxRenderable } from "../../src/ui/card"
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

// 整帧摊平成 "行:列" → 前景色。卡片摆在 (0,0),所以屏幕坐标就是 (cell.x, cell.y)。
function cellGrid(frame: CapturedFrame) {
  const grid = new Map<string, { r: number; g: number; b: number }>()
  frame.lines.forEach((line, row) => {
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

function rgb(value: { r: number; g: number; b: number } | undefined) {
  if (!value) return "none"
  return `${value.r.toFixed(4)},${value.g.toFixed(4)},${value.b.toFixed(4)}`
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

function animatedCard() {
  return () => (
    <neonbox {...cardProps} animated>
      <text>hi</text>
    </neonbox>
  )
}

describe("NeonBox 流动描边", () => {
  // 全 App 视觉回归守卫:静止卡的描边逐格色必须严格等于「叠色后的 gradientAt(stops, t)」。
  // 之前的实现写成 gradientAt(stops, (cell.t + phase) % 1),静止时 phase = 0,
  // `(1 + 0) % 1` 把周长末格(t = 1)送回 t = 0 —— 那一格渲染成起点色而不是终点色,
  // 所有不动的卡(助手气泡卡 / 侧栏卡 / 输入卡的失焦态)都跟着偏了一格。
  test("静止态逐格等于叠色后的 gradientAt(stops, t),周长末格取终点色而不是绕回起点色", async () => {
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
      const grid = cellGrid(app.captureSpans())
      const mismatches: string[] = []
      for (const cell of perimeterCells(cardProps.width, cardProps.height)) {
        const expected = alphaOver(gradientAt(cardProps.gradientStops, cell.t), cardProps.backgroundColor, 0.62)
        const lit = cell.y === 0 ? brighten(expected, TOP_EDGE_GLOW, NEON_WHITE) : expected
        const actual = grid.get(`${cell.y}:${cell.x}`)
        // buffer 存 fg 走 8bit 量化,单格误差容 1/255。
        if (
          !actual ||
          Math.abs(actual.r - lit.r) > 0.004 ||
          Math.abs(actual.g - lit.g) > 0.004 ||
          Math.abs(actual.b - lit.b) > 0.004
        ) {
          mismatches.push(`(${cell.x},${cell.y}) t=${cell.t} 期望 ${rgb(lit)} 实得 ${rgb(actual)}`)
        }
      }
      expect(mismatches).toEqual([])
      // 再把「末格」单拎出来:12×4 的周长 28 格,末格 t = 27/27 = 1,是左边框第 1 行。
      // 红→蓝两色 stops 下它必须是终点蓝(叠过 0.62 之后是 #0624a4 那一档);
      // 绕回起点色会叠成 #062400 —— 蓝通道差着 0.62。
      const last = grid.get("1:0")
      expect(last).toBeDefined()
      expect(last!.b).toBeGreaterThan(0.6)
      expect(last!.r).toBeLessThan(0.06)
    } finally {
      app.renderer.destroy()
    }
  })

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

  // 扫光本身的所有数学性质在 test/ui/card-sweep.test.ts 里纯函数单测(窗口边界、相位回绕、
  // 接缝连续性);集成层只做与相位绝对值无关的差分断言 —— 下面这条比较「亮度」:
  // 红→蓝两色 stops 上纯相位平移不改变 r+g+b(两个端点都是 255),扫光则是向白插值、
  // 严格抬高亮度。所以只要动画态出现亮度高于静态基线的格子,就说明扫光真的在画。
  test("animated 时存在比静态渐变更亮的格子(扫光,与相位取值无关)", async () => {
    const keys = perimeterCells(cardProps.width, cardProps.height).map((cell) => `${cell.y}:${cell.x}`)
    const brightness = (grid: Map<string, { r: number; g: number; b: number }>) =>
      keys.map((key) => {
        const value = grid.get(key)
        return value ? value.r + value.g + value.b : -1
      })

    const staticApp = await testRender(
      () => (
        <neonbox {...cardProps}>
          <text>hi</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    let baseline: number[]
    try {
      await staticApp.renderOnce()
      baseline = brightness(cellGrid(staticApp.captureSpans()))
    } finally {
      staticApp.renderer.destroy()
    }

    const app = await testRender(animatedCard(), { width: 20, height: 6 })
    try {
      await app.renderOnce()
      let peak = 0
      // 采样若干帧:扫光带只有一圈的 12%,某一帧没扫到不代表没在扫。
      for (let frame = 0; frame < 6; frame++) {
        await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
        await app.renderOnce()
        const current = brightness(cellGrid(app.captureSpans()))
        peak = Math.max(peak, ...current.map((value, index) => value - baseline[index]!))
      }
      // 8bit 量化下 55% 提亮在纯蓝端是 +0.55 量级,给 0.1 的门槛足够稳。
      expect(peak).toBeGreaterThan(0.1)
    } finally {
      app.renderer.destroy()
    }
  })

  // 定时器生命周期:animated 来回切换不漏表、destroy 之后表真的不再走。
  // 「表走了几拍」用 requestRender 的调用次数计数 —— 定时器每拍恰好调一次 requestRender。
  // 变异验证:同时删掉 destroySelf 覆写和 isDestroyed 自停(两者互为兜底)会红。
  const PHASE_INTERVAL_MS = 80

  function toggleHarness() {
    let setAnimated: ((value: boolean) => void) | undefined
    let card: NeonBoxRenderable | undefined
    let ticks = 0
    function Harness() {
      const [on, setOn] = createSignal(false)
      setAnimated = setOn
      return (
        <neonbox
          {...cardProps}
          ref={(value: NeonBoxRenderable) => {
            card = value
          }}
          animated={on()}
        >
          <text>hi</text>
        </neonbox>
      )
    }
    return {
      Harness,
      toggle(value: boolean) {
        if (!setAnimated) throw new Error("Harness 还没渲染")
        setAnimated(value)
      },
      // 首帧渲染完再挂钩,避开 Solid 在挂载期写属性带来的噪声。
      attachCounter() {
        if (!card) throw new Error("卡片还没建出来")
        const node = card
        const original = node.requestRender.bind(node)
        node.requestRender = () => {
          ticks++
          original()
        }
      },
      ticks() {
        return ticks
      },
    }
  }

  test("destroy 之后定时器不再走(销毁泄漏会把测试进程吊住)", async () => {
    const harness = toggleHarness()
    const app = await testRender(harness.Harness, { width: 20, height: 6 })
    // 整段包 try/finally:下面任何一条断言抛了,renderer 都不会被 destroy,
    // 而这正是本条要守的那个 12.5Hz 定时器 —— 测试自己漏表就会把进程吊住。
    try {
      await app.renderOnce()
      harness.attachCounter()
      // 来回切若干次:每次 true 都重新起表,每次 false 都停表。
      for (const value of [true, false, true, false, true]) {
        harness.toggle(value)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
      const beforeDestroy = harness.ticks()
      expect(beforeDestroy).toBeGreaterThan(0)
      app.renderer.destroy()
      const afterDestroy = harness.ticks()
      await new Promise((resolve) => setTimeout(resolve, PHASE_INTERVAL_MS * 5))
      expect(harness.ticks()).toBe(afterDestroy)
    } finally {
      app.renderer.destroy()
    }
  })

  test("重复把 animated 置真不会叠出多个表", async () => {
    const harness = toggleHarness()
    const app = await testRender(harness.Harness, { width: 20, height: 6 })
    try {
      await app.renderOnce()
      harness.attachCounter()
      const startedAt = Date.now()
      // 「不会叠表」这条不变量由 startPhaseTimer 开头的 stopPhaseTimer 保证(每次起表前
      // 先清掉旧的);setter 里的相等守卫只是省掉一次无谓的起停 + 一次 requestRender。
      // 变异验证:把相等守卫删掉这条仍然绿 —— 它守的是不变量,不是某个具体机制。
      harness.toggle(true)
      harness.toggle(true)
      harness.toggle(true)
      const budget = PHASE_INTERVAL_MS * 5
      await new Promise((resolve) => setTimeout(resolve, budget))
      // 用实际经过的时间自标定:单表约 elapsed/80 拍;叠 3 个表就是 3 倍。
      const elapsed = Date.now() - startedAt
      expect(harness.ticks()).toBeGreaterThan(0)
      expect(harness.ticks()).toBeLessThanOrEqual(Math.ceil(elapsed / PHASE_INTERVAL_MS) + 2)
    } finally {
      app.renderer.destroy()
    }
  })
})

// HSL 色相(0..360°)。要证明「色带在走」而不是「有东西在变亮」,只能看色相:
// 亮度的变化既能来自相位平移、也能来自扫光,色相的变化只可能来自换了颜色。
function hue(cell: { r: number; g: number; b: number }) {
  const max = Math.max(cell.r, cell.g, cell.b)
  const min = Math.min(cell.r, cell.g, cell.b)
  if (max === min) return 0
  const delta = max - min
  if (max === cell.r) return 60 * (((cell.g - cell.b) / delta + 6) % 6)
  if (max === cell.g) return 60 * ((cell.b - cell.r) / delta + 2)
  return 60 * ((cell.r - cell.g) / delta + 4)
}

function brightness(cell: { r: number; g: number; b: number }) {
  return cell.r + cell.g + cell.b
}

// 助手气泡卡的青蓝渐变描边。
//
// 上面的「相位推进」那条只证明「颜色变了」,而颜色变完全可以由扫光解释 —— 助手卡的色板
// 曾经真的退化成平色(novaway 深色主题里 info 与 primary 同为 #00e5ff),那时它一样绿。
// 所以这里把扫光摘出去再看一遍:同一格在两个相位上的**色相**必须是不同的。
//
// 「摘掉扫光」怎么摘:色板自身的亮度跨度只有 [#4d7cff 的 1.788, #00e5ff 的 1.898],
// 相位平移永远走不出这个区间;扫光是把颜色往白里插,亮度只往上顶(峰值 +0.6)。
// 于是「亮过色板上沿 0.2」的格子必定是扫过的,整批排除。剩下的格子里即便还残留扫光尾巴,
// 那点尾巴也最多把色相挪不到 1°(往白混几乎不改色相),不碍事。
// 色板若是平的,这些格子在每一帧里都等于色板色 → 与基线的色相差恒为 0 —— 这正是修好之前的状态。
describe("助手气泡卡的青蓝渐变描边", () => {
  const theme = resolveTheme(novaway as ThemeJson, "dark")
  // 卡开宽一点:周长越长,一轮里能取到的「没被扫到」的格子越多。
  const assistant = {
    width: 40,
    height: 10,
    backgroundColor: RGBA.fromHex("#101010"),
    gradientStops: [...semanticStops(theme, "assistant")],
  }
  const keys = perimeterCells(assistant.width, assistant.height).map((cell) => `${cell.y}:${cell.x}`)
  const rampCeiling = Math.max(...assistant.gradientStops.map(brightness))

  const mount = (animated: boolean) =>
    testRender(
      () => (
        <neonbox {...assistant} animated={animated}>
          <text>hi</text>
        </neonbox>
      ),
      { width: 46, height: 14 },
    )

  test("animated 时同一格的色相在两个相位上不同(排除扫光格子之后)", async () => {
    const base = await mount(false)
    let staticGrid: Map<string, { r: number; g: number; b: number }>
    try {
      await base.renderOnce()
      staticGrid = cellGrid(base.captureSpans())
    } finally {
      base.renderer.destroy()
    }

    const app = await mount(true)
    try {
      const frames: Array<Map<string, { r: number; g: number; b: number }>> = []
      for (let frame = 0; frame < 8; frame++) {
        await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
        await app.renderOnce()
        frames.push(cellGrid(app.captureSpans()))
      }
      const swept = new Set(
        frames.flatMap((grid) =>
          keys.filter((key) => {
            const value = grid.get(key)
            const base = staticGrid.get(key)
            return value && base ? brightness(value) > brightness(base) + 0.2 : false
          }),
        ),
      )
      expect(swept.size).toBeLessThan(keys.length)
      const delta = frames.flatMap((grid) =>
        keys
          .filter((key) => !swept.has(key))
          .map((key) => {
            const value = grid.get(key)!
            const base = staticGrid.get(key)!
            return hue(value) - hue(base)
          }),
      )
      // 色板是平的时,每帧每格都等于色板色,色相差恒为 0 → max 是 0,这条会红。
      // 修好之后 1.6s 走 20 格(周长的 20%),青→蓝的色相跨度约 38°;绕回接缝的格子一次
      // 能看到近乎整段(实测 33°),门槛取 3° —— 8bit 量化在最暗的一端(青的 r≈0)
      // 带来的色相噪声不到 0.5°。
      expect(Math.max(...delta.map(Math.abs))).toBeGreaterThan(3)
    } finally {
      app.renderer.destroy()
    }
  })

  test("扫光仍然会把格子顶出色板上沿(与相位取值无关)", async () => {
    const app = await mount(true)
    try {
      let peak = -1
      for (let frame = 0; frame < 6; frame++) {
        await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
        await app.renderOnce()
        const grid = cellGrid(app.captureSpans())
        for (const key of keys) {
          const value = grid.get(key)
          if (value) peak = Math.max(peak, brightness(value))
        }
      }
      // 扫光峰值向白插 55%,而色板上沿只有 1.898 —— 顶出去 0.2 是稳的。
      expect(peak).toBeGreaterThan(rampCeiling + 0.2)
    } finally {
      app.renderer.destroy()
    }
  })
})
