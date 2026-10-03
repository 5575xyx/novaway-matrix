/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { testRender } from "@opentui/solid"
import { RGBA, type CapturedFrame } from "@opentui/core"
import { alphaOver, BORDER_ALPHA_DEFAULT, HOVER_BOOST, perimeterCells } from "../../src/ui/neon"
import { phaseStep, TOP_EDGE_GLOW } from "../../src/ui/card"
import { SidebarCard } from "../../src/component/sidebar-card"
import { TabBar } from "../../src/component/tab-bar"
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"
import type { NeonBoxRenderable } from "../../src/ui/card"
// 裸导入跑 extend({ neonbox }) 的副作用(见 test/ui/card.test.tsx 的理由)。
import "../../src/ui/card"

// 「动效看得见」这一层的断言。
//
// 用户反馈是「动画似乎没出现」。查下来不是没实现,而是三件事叠在一起:
//   1. 导轨那一档的相位从来没接上 —— 原型那边永不间歇的是两条 1px 导轨:标题栏
//      `railFlow 7s linear infinite`(:89)与侧栏右缘 `railV 9s linear infinite`(:113)。
//      终端里前者就是标签栏那条 NeonRail,后者是侧栏根卡的描边。这一层加 `flow`:常驻流动,
//      不带扫光,侧栏根卡开着它。
//   2. 悬停时相位不加速 —— 一圈 8 秒对「刚被点了一下」的反馈来说太慢。
//      原型悬停是 `.card:hover { transition: all .3s }` + `gbFlow 2.6s`,
//      所以悬停那一档每拍走两格(整圈 4 秒)。
//   3. 标签栏那条霓虹导轨根本没接 `animated` —— 组件有那个 prop,TabBar 没传,
//      于是它永远是一条静止的渐变(见最后一条用例)。这是「实现了却不可能触发」的 bug。
//
// **面板卡/分区卡不在常驻那一档**:原型 `.card` 底态既没有 `animation` 也没有
// `background-size: 200% 200%`,`gbFlow 2.6s` 挂在 `:hover` 上(:159-163)。所以
// component/sidebar-card 那个 `flow=` 已经摘掉,那一族底态冻结、悬停才流 ——
// 下面「侧栏分区卡:悬停才流」那两条钉的就是这个契约。

const PANEL = RGBA.fromHex("#101010")
const STOPS = [RGBA.fromHex("#00e5ff"), RGBA.fromHex("#4d7cff")]
const WIDTH = 12
const HEIGHT = 4
// 相位每 80ms 走一格;200ms 至少跨两格,足够分辨「动了没有」。
const PHASE_WAIT = 200

type Cell = { r: number; g: number; b: number }

// testRender 的返回类型从测试渲染器的返回值推(TestRendererSetup 只在 @opentui/core/testing 里导出)。
type Harness = Awaited<ReturnType<typeof testRender>>

function grid(app: { captureSpans(): CapturedFrame }) {
  const map = new Map<string, Cell>()
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

function lum(cell: Cell) {
  return cell.r + cell.g + cell.b
}

/**
 * 整圈描边的逐格最大通道偏差。
 *
 * 不用亮度:叠色之后色带在亮度上的坡很平(三段霓虹近青的一端 r 升 g 降,200ms 内两者
 * 几乎抵消),而扫光只改亮度 —— 用亮度就分不出「只是扫光过去了」和「色带真的挪了」。
 */
function maxDeviation(a: ReturnType<typeof grid>, b: ReturnType<typeof grid>) {
  const keys = perimeterCells(WIDTH, HEIGHT).map((cell) => `${cell.y}:${cell.x}`)
  return Math.max(
    ...keys.flatMap((key) => {
      const left = a.get(key)
      const right = b.get(key)
      if (!left || !right) return [0]
      return [Math.abs(left.r - right.r), Math.abs(left.g - right.g), Math.abs(left.b - right.b)]
    }),
  )
}

/**
 * 两帧之间、同一排采样格上的**逐格逐通道最大偏差**(`shift`)与**最大下降量**(`drop`)。
 *
 * 两个量判的不是同一件事,缺一不可:
 *   · shift —— 「颜色变了没有」。底态冻结那条要求它**恰好为 0**:那一圈格子上没有任何一项
 *     随时间变化的东西(没有相位、没有抬对比、没有扫光、没有入场淡入),每帧算出来的值必须
 *     逐通道相同 —— 所以那里不能用「小于某门槛」,门槛会把 bug 放过去。
 *   · drop —— 「有没有哪一格变暗了」。悬停时同一格里叠着三层只会把颜色往亮处推的东西
 *     (顶部光晕、悬停抬对比、扫光),色带平移是唯一会让某格变暗的那一层。所以单看 shift
 *     的话,扫光自己就足以让它过关 —— 判「色带真的在走」必须看 drop。
 *     同一段推理见 test/component/card-hover.test.tsx 的 maxDrop。
 */
function shift(a: Cell[], b: Cell[]) {
  return Math.max(
    ...a.flatMap((left, index) => {
      const right = b[index]
      return [Math.abs(left.r - right.r), Math.abs(left.g - right.g), Math.abs(left.b - right.b)]
    }),
  )
}

function drop(a: Cell[], b: Cell[]) {
  return Math.max(
    ...a.flatMap((left, index) => {
      const right = b[index]
      return [left.r - right.r, left.g - right.g, left.b - right.b]
    }),
  )
}

async function frames(props: Record<string, unknown>, samples: number) {
  const app = await testRender(
    () => (
      <neonbox {...(props as object)}>
        <text>hi</text>
      </neonbox>
    ),
    { width: 20, height: 8 },
  )
  try {
    const shots: ReturnType<typeof grid>[] = []
    for (let index = 0; index < samples; index++) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
      await app.renderOnce()
      shots.push(grid(app))
    }
    return shots
  } finally {
    app.renderer.destroy()
  }
}

describe("NeonBox 常驻流动(flow)", () => {
  test("flow 让描边在没有 hover、没有焦点时也逐帧移动", async () => {
    const [first, second] = await frames(
      { width: WIDTH, height: HEIGHT, backgroundColor: PANEL, gradientStops: STOPS, flow: true },
      2,
    )
    expect(maxDeviation(first, second)).toBeGreaterThan(0.004)
  })

  // flow 只搬色带,不画扫光。判据:常驻态的亮度必须始终落在「叠色后色板自身的亮度区间」里 ——
  // 扫光是向白插值,会把某一格顶出这个区间(见后面 animated 那条对照)。
  //
  // 上限要把顶边那一行的光晕算进去(见 TOP_EDGE_GLOW):它是「最亮的那一端再向白插 6%」,
  // 所以 ceiling = 色板上沿 + 6% × (3 − 上沿)。下限不用加 —— 光晕只提亮。
  test("flow 不带扫光:亮度始终落在叠色后色板自身的区间里", async () => {
    const ramp = STOPS.map((stop) => lum(alphaOver(stop, PANEL, BORDER_ALPHA_DEFAULT)))
    const plain = Math.max(...ramp)
    const ceiling = plain + TOP_EDGE_GLOW * (3 - plain) + 0.02
    const floor = Math.min(...ramp) - 0.02
    for (const frame of await frames(
      { width: WIDTH, height: HEIGHT, backgroundColor: PANEL, gradientStops: STOPS, flow: true },
      8,
    )) {
      for (const cell of perimeterCells(WIDTH, HEIGHT)) {
        const value = frame.get(`${cell.y}:${cell.x}`)
        if (!value) continue
        expect(lum(value), `(${cell.x},${cell.y})`).toBeLessThanOrEqual(ceiling)
        expect(lum(value), `(${cell.x},${cell.y})`).toBeGreaterThanOrEqual(floor)
      }
    }
  })

  test("不传 flow 时描边静止(对照组:动的确实是 flow 带来的)", async () => {
    const [first, second] = await frames(
      { width: WIDTH, height: HEIGHT, backgroundColor: PANEL, gradientStops: STOPS },
      2,
    )
    expect(maxDeviation(first, second)).toBe(0)
  })

  test("flow + animated:色带在走,扫光也在(亮度会顶出色板上沿)", async () => {
    const ramp = STOPS.map((stop) => lum(alphaOver(stop, PANEL, BORDER_ALPHA_DEFAULT)))
    const ceiling = Math.max(...ramp)
    let peak = 0
    for (const frame of await frames(
      { width: WIDTH, height: HEIGHT, backgroundColor: PANEL, gradientStops: STOPS, flow: true, animated: true },
      8,
    )) {
      for (const cell of perimeterCells(WIDTH, HEIGHT)) {
        const value = frame.get(`${cell.y}:${cell.x}`)
        if (value) peak = Math.max(peak, lum(value))
      }
    }
    // 柔边之后扫光峰值仍然明显高出叠色后的色板上沿(实测 +0.9 量级),门槛 0.2 足够稳。
    expect(peak).toBeGreaterThan(ceiling + 0.2)
  })
})

describe("NeonBox 悬停时相位加速", () => {
  test("每拍步长:常驻 1 格、悬停 2 格", () => {
    expect(phaseStep(false)).toBe(1)
    expect(phaseStep(true)).toBe(2)
  })

  // 100 格 × 80ms:常驻一圈 8 秒(与原型 railV 9s 同一量级),悬停一圈 4 秒
  // (原型 .bubble:hover 的 gbFlow 2.6s ~ .tab.active 的 3s 那一档)。
  test("一圈时长落在 8 秒 / 4 秒这两档", () => {
    const interval = 80
    const steps = 100
    expect((steps / phaseStep(false)) * interval).toBe(8000)
    expect((steps / phaseStep(true)) * interval).toBe(4000)
  })

  // 真正的接线:animated 卡片的色带在同一段墙钟时间里挪得比 flow 卡片更远。
  // 用「左边框中段那一格在红蓝两色板上落在哪一档」量相位 —— b 通道就是 t 本身,
  // 与扫光无关(扫光只把三通道一起往白抬,而那一格在采样窗内不会被扫到:
  // 窗口占一圈 12%,我们只盯起始相位附近的一格,并对两帧取 b 的差)。
  test("animated 的相位推进是 flow 的两倍(接线到 phaseStep)", async () => {
    const drift = async (extra: Record<string, unknown>) => {
      const [first, second] = await frames(
        { width: WIDTH, height: HEIGHT, backgroundColor: PANEL, gradientStops: STOPS, ...extra },
        2,
      )
      // 左边框中段(0,1):不在顶边,也不在扫光窗口的必经之路上,色相最稳
      const a = first.get("1:0")!
      const b = second.get("1:0")!
      return Math.abs(b.b - a.b)
    }
    const slow = await drift({ flow: true })
    const fast = await drift({ flow: true, animated: true })
    expect(fast).toBeGreaterThan(slow * 1.5)
  })
})

describe("flow 的定时器生命周期", () => {
  function harness() {
    let setFlow: ((value: boolean) => void) | undefined
    let card: NeonBoxRenderable | undefined
    let ticks = 0
    function Body() {
      const [on, setOn] = createSignal(false)
      setFlow = setOn
      return (
        <neonbox
          width={WIDTH}
          height={HEIGHT}
          backgroundColor={PANEL}
          gradientStops={STOPS}
          flow={on()}
          ref={(value: NeonBoxRenderable) => {
            card = value
          }}
        >
          <text>hi</text>
        </neonbox>
      )
    }
    return {
      Body,
      toggle(value: boolean) {
        if (!setFlow) throw new Error("Harness 还没渲染")
        setFlow(value)
      },
      attachCounter() {
        if (!card) throw new Error("卡片还没建出来")
        const node = card
        const original = node.requestRender.bind(node)
        node.requestRender = () => {
          ticks++
          original()
        }
      },
      ticks: () => ticks,
    }
  }

  test("flow 来回切换不漏表,停掉之后真的不再走", async () => {
    const h = harness()
    const app = await testRender(h.Body, { width: 20, height: 8 })
    try {
      await app.renderOnce()
      h.attachCounter()
      for (const value of [true, false, true, false, true]) {
        h.toggle(value)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
      const running = h.ticks()
      expect(running).toBeGreaterThan(0)
      // flow = false:相位表停,之后只剩无关抖动
      h.toggle(false)
      await app.renderOnce()
      const stopped = h.ticks()
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(h.ticks()).toBe(stopped)
    } finally {
      app.renderer.destroy()
    }
  })

  test("destroy 之后 flow 的定时器不再走(销毁泄漏会把测试进程吊住)", async () => {
    const h = harness()
    const app = await testRender(h.Body, { width: 20, height: 8 })
    try {
      await app.renderOnce()
      h.attachCounter()
      h.toggle(true)
      await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
      expect(h.ticks()).toBeGreaterThan(0)
      app.renderer.destroy()
      const after = h.ticks()
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(h.ticks()).toBe(after)
    } finally {
      app.renderer.destroy()
    }
  })
})

// 「实现了却不可能触发」的那一条:NeonRail 有 animated 这个 prop,TabBar 没传。
// 于是标签栏底下那条彩虹导轨一直是一条**静止**的渐变 —— 用户看到的就是「动画没出现」。
// 原型那里是 `.titlebar::after { animation: railFlow 7s linear infinite }`,一直流着。
describe("标签栏霓虹导轨", () => {
  test("TabBar 的导轨常驻流动(不用 hover、不用焦点)", async () => {
    const app = await testRender(
      () => (
        <ThemeTestProviders>
          <ThemeReady />
          <TabBar
            tabs={[{ id: "chat", title: "会话", type: "chat", closable: false }]}
            activeTabId="chat"
            onTabClick={() => {}}
            onTabClose={() => {}}
            width={40}
          />
        </ThemeTestProviders>
      ),
      { width: 44, height: 6 },
    )
    try {
      let frame = ""
      for (let attempt = 0; attempt < 60; attempt++) {
        await app.renderOnce()
        frame = app.captureCharFrame()
        if (frame.includes("━")) break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      expect(frame).toContain("━")
      const row = frame.split("\n").findIndex((line) => line.includes("━"))
      const rail = () => grid(app).get(`${row}:3`)!
      const before = rail()
      await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
      await app.renderOnce()
      const after = rail()
      const moved = Math.abs(after.r - before.r) + Math.abs(after.g - before.g) + Math.abs(after.b - before.b)
      expect(moved, "导轨应当自己在流").toBeGreaterThan(0.02)
    } finally {
      app.renderer.destroy()
    }
  })
})

// 侧栏分区卡:底态冻结、悬停才流。原型 `.card` 的 `gbFlow 2.6s` 挂在 `:hover` 上
// (card-design-v7.html:159-163),底态既没有 `animation` 也没有 `background-size: 200% 200%`
// —— 所以 component/sidebar-card 上那个 `flow=` 被摘掉了。这一族是屏幕上最多的一批卡
// (侧栏同屏七八张),「谁在什么时候动」在这里必须钉死,否则有人会顺手把它接回去。
describe("侧栏分区卡:悬停才流", () => {
  // 上边框上一排采样点,避开两个圆角。逐格逐通道比而不用亮度:叠色把亮度坡压平了
  // (见文件头 maxDeviation 的注释),r 升 g 降正好抵消。
  const COLUMNS = [2, 6, 10, 14, 18]

  async function mountCard() {
    const app = await testRender(
      () => (
        <ThemeTestProviders>
          <ThemeReady />
          <SidebarCard title="资源管理器" badge="novaway-coder">
            <text>BODYMARK</text>
          </SidebarCard>
        </ThemeTestProviders>
      ),
      { width: 44, height: 8 },
    )
    for (let attempt = 0; attempt < 60; attempt++) {
      await app.renderOnce()
      if (app.captureCharFrame().includes("BODYMARK")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    // 边框行号不能写死:ThemeReady 哨兵排在卡片**前面**,卡片从它下一行开始。
    const top = app
      .captureCharFrame()
      .split("\n")
      .findIndex((line) => line.includes("╭"))
    if (top < 0) throw new Error("帧里找不到分区卡的边框")
    return { app, top }
  }

  async function sample(app: Harness, top: number, count: number) {
    const shots: Cell[][] = []
    for (let index = 0; index < count; index++) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
      await app.renderOnce()
      const cells = grid(app)
      shots.push(COLUMNS.map((column) => cells.get(`${top}:${column}`)!))
    }
    return shots
  }

  test("底态:描边逐格冻结(不传 flow 就没有相位表)", async () => {
    const { app, top } = await mountCard()
    try {
      // 先把指针挪到卡片外面:测试渲染器的初始指针位置不是「没有悬停」,
      // 停在卡上时下面那条断言量的就是悬停档而不是底态。
      await app.mockMouse.moveTo(43, 7)
      await app.renderOnce()
      const [first, ...rest] = await sample(app, top, 4)
      // 恰好 0,不是「小于某门槛」:这一圈格子没有任何一项随时间变化的东西 ——
      // 没有相位、没有抬对比、没有扫光、没有入场淡入 —— 于是每帧算出来的值逐通道相同。
      for (const shot of rest) expect(shift(first, shot), "底态描边应逐格冻结").toBe(0)
    } finally {
      app.renderer.destroy()
    }
  })

  test("鼠标移上去:描边逐帧流动,且色带真的在平移(有格子变暗)", async () => {
    const { app, top } = await mountCard()
    try {
      await app.mockMouse.moveTo(6, top + 1)
      await app.renderOnce()
      const [first, ...rest] = await sample(app, top, 4)
      expect(Math.max(...rest.map((shot) => shift(first, shot))), "悬停期间描边应逐帧变化").toBeGreaterThan(0.004)
      // 单看 shift 不够:扫光自己就足以满足它(见 shift/drop 的注释)。
      expect(
        Math.max(...rest.map((shot) => drop(first, shot))),
        "悬停期间应有格子变暗(色带真的平移了,不只是扫光爬过)",
      ).toBeGreaterThan(0.004)
    } finally {
      app.renderer.destroy()
    }
  })
})

// 悬停抬亮那一档的量级自检:钉的是「确实抬了 HOVER_BOOST 那一档的亮度」。
describe("悬停抬对比度的量", () => {
  test("柔边之后 HOVER_BOOST 落在 16%~26% 这一档", () => {
    // 12% 是对着**满饱和**描边调的;描边按 0.62 的 alpha 折算之后,同样的百分比在更暗的
    // 底上视觉增益只剩六成,所以必须按 1/0.62 ≈ 1.6 倍上调,否则悬停几乎看不出来。
    expect(HOVER_BOOST).toBeGreaterThan(0.16)
    expect(HOVER_BOOST).toBeLessThan(0.26)
  })

  test("抬完之后的亮度差肉眼可见,但没把渐变本身洗掉", () => {
    const base = alphaOver(RGBA.fromHex("#00e5ff"), RGBA.fromHex("#0a0e14"), 0.62)
    const towards = RGBA.fromHex("#e0e6ed")
    const lit = {
      r: base.r + (towards.r - base.r) * HOVER_BOOST,
      g: base.g + (towards.g - base.g) * HOVER_BOOST,
      b: base.b + (towards.b - base.b) * HOVER_BOOST,
    }
    // 可见:三通道加起来至少抬 0.2(柔边后基准亮度约 1.24,即 +16% 以上)
    expect(lum(lit) - lum(base)).toBeGreaterThan(0.2)
    // 不抢戏:抬完不到原来的 1.6 倍,而且仍然是青(蓝通道最亮)
    expect(lum(lit)).toBeLessThan(lum(base) * 1.6)
    expect(lit.b).toBeGreaterThan(lit.r)
    expect(lit.g).toBeGreaterThan(lit.r)
  })
})
