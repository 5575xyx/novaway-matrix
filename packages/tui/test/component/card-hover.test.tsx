/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA, type CapturedFrame } from "@opentui/core"
import { SidebarCard } from "../../src/component/sidebar-card"
import { NeonCard, BlockTool } from "../../src/routes/session"
import { brighten, HOVER_BOOST, semanticStops } from "../../src/ui/neon"
import { resolveTheme, type ThemeJson } from "../../src/theme"
import novaway from "../../src/theme/assets/novaway.json" with { type: "json" }
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"
import "../../src/ui/card"

// C1:悬停时渐变流动 + 描边提亮。
// 提亮的**量**(12%)由下面最后一条用两张只差一个 boost 的同色卡逐格钉死;这里测的是接线:
// 真的把鼠标挪上去,描边真的开始流动、真的整体变亮,挪走后真的停。
//
// 相位是这里最麻烦的干扰项:animated 一开,相位每 80ms 走一格,一格的位移就足以让
// 「同一格的颜色」和「同一格的提亮量」混在一起分不开。所以两条断言各挑一个干净的量:
//   流动 —— 盯**单格随时间**变化(相位一动就变,提亮是常量,不影响「变了没有」这个判断);
//   提亮 —— 盯「同一相位下 hover 前后的色距」。移开鼠标相位会**冻结**(见 ui/card.ts:
//          phase 只增不减),所以「移开 → 采样 → 再移上去 → 采样」两次采样之间的相位差
//          最多一格(周长的 1/100),而提亮是 12%,量级差 10 倍,压得住。

// captureSpans 给的是「一段同色字符」,边框是逐格渐变的带子 —— 先按字符摊平,再按格取值。
function cellGrid(app: { captureSpans(): CapturedFrame }) {
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

// 边框行号不能写死:ThemeReady 哨兵排在卡片**前面**,卡片从它下一行开始。
function cardRows(app: { captureCharFrame(): string }) {
  const lines = app.captureCharFrame().split("\n")
  const top = lines.findIndex((line) => line.includes("╭"))
  const bottom = lines.findIndex((line) => line.includes("╯"))
  if (top < 0 || bottom < top) throw new Error("帧里找不到霓虹卡边框")
  return { top, bottom }
}

// 上边框第 5 格,避开两个圆角。主题三端色端点接近,单格亮度足够分辨变化。
function borderCell(app: { captureSpans(): CapturedFrame; captureCharFrame(): string }) {
  const value = cellGrid(app).get(`${cardRows(app).top}:5`)
  if (!value) throw new Error("上边框不在帧里")
  return value
}

function brightness(cell: { r: number; g: number; b: number }) {
  return cell.r + cell.g + cell.b
}

// ThemeTestProviders 固定 mode="dark" 且默认主题就是 novaway,所以助手卡的色板可以直接
// 解析出来取它的亮度上沿(见下面助手卡那条测试的用法)。
const RAMP_CEILING = Math.max(...semanticStops(resolveTheme(novaway as ThemeJson, "dark"), "assistant").map(brightness))

// TestRendererSetup 只在 @opentui/core/testing 里导出,这里从 testRender 的返回值推。
type Harness = Awaited<ReturnType<typeof testRender>>

async function settle(app: Harness, ready: (text: string) => boolean) {
  let text = ""
  for (let attempt = 0; attempt < 200; attempt++) {
    await app.renderOnce()
    text = app.captureCharFrame()
    if (ready(text)) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  expect(text).toContain("READY")
  return app
}

// 相位每 80ms 走一格,200ms 足够跨两格以上;这里只等定时器,不依赖渲染循环。
const PHASE_WAIT = 200

function overCard(app: Harness) {
  return app.mockMouse.moveTo(6, cardRows(app).top + 1)
}

function offCard(app: Harness) {
  return app.mockMouse.moveTo(6, cardRows(app).bottom + 1)
}

async function sidebarCard(title: string, badge: string, body: string) {
  return settle(
    await testRender(
      () => (
        <ThemeTestProviders>
          <ThemeReady />
          <SidebarCard title={title} badge={badge}>
            <text>{body}</text>
          </SidebarCard>
        </ThemeTestProviders>
      ),
      { width: 44, height: 8 },
    ),
    (text) => text.includes(body),
  )
}

// 「悬停期间在动,移开后不动」这一对断言。工具卡与分区卡走的是三段霓虹色板,相位一动
// 色就动,所以两次 200ms 之间的采样足够分辨。
async function flowPair(name: string, mount: () => Promise<Harness>, ready: (text: string) => boolean) {
  const app = await settle(await mount(), ready)
  try {
    await app.renderOnce()
    await overCard(app)
    await app.renderOnce()
    const first = brightness(borderCell(app))
    await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
    await app.renderOnce()
    expect(brightness(borderCell(app)), `${name}:悬停期间描边应流动`).not.toBeCloseTo(first, 3)

    await offCard(app)
    await app.renderOnce()
    const stopped = brightness(borderCell(app))
    await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
    await app.renderOnce()
    expect(brightness(borderCell(app)), `${name}:移开后描边应静止`).toBeCloseTo(stopped, 3)
  } finally {
    app.renderer.destroy()
  }
}

// 悬停流动:分区卡的悬停是这次新加的 —— 它原先只有 header 上的 onMouseDown,整卡没有 hover 状态。
test("分区卡:悬停期间描边逐帧流动,移开后静止", async () => {
  await flowPair(
    "SidebarCard",
    () =>
      testRender(
        () => (
          <ThemeTestProviders>
            <ThemeReady />
            <SidebarCard title="资源管理器" badge="novaway-coder">
              <text>文件树正文</text>
            </SidebarCard>
          </ThemeTestProviders>
        ),
        { width: 44, height: 8 },
      ),
    (text) => text.includes("文件树正文"),
  )
})

// 工具卡:hover() 是它原本就有的状态,C1 只是把它接到 animated/boost 上。
// 它带 onClick 才响应悬停(见 routes/session 的 BlockTool),这里传一个可点的。
test("工具卡:悬停期间描边逐帧流动,移开后静止", async () => {
  await flowPair(
    "BlockTool",
    () =>
      testRender(
        () => (
          <ThemeTestProviders>
            <ThemeReady />
            <BlockTool title="读文件" onClick={() => {}}>
              <text>TOOLMARK</text>
            </BlockTool>
          </ThemeTestProviders>
        ),
        { width: 48, height: 8 },
      ),
    (text) => text.includes("TOOLMARK"),
  )
})

// 助手气泡卡:色板是真有坡的(novaway 深色 #00e5ff → #4d7cff,见 src/ui/neon 的
// semanticStops),所以这一格在相位推进时本来就会换色相 —— 亮度也跟着动,
// 于是「变亮」这个量本身分不清是色带平移还是扫光。
// 这里换一个与相位无关的判据:亮过**色板自身的亮度上沿**。
// 色板两端是 #00e5ff(1.898)与 #4d7cff(1.788),相位平移取到的亮度必然落在 [1.788, 1.898]
// 之间;只有扫光(向白插 55%)才顶得出这个区间。这样「有扫光」与「色带在流动」
// 就成了两件互不冒名的事。
// 顺带钉住「移开后扫光真的停了」——移开后亮度必须回到色板区间内。
test("助手气泡卡:悬停期间有扫光扫过这一格,移开后不再有", async () => {
  const app = await settle(
    await testRender(
      () => (
        <ThemeTestProviders>
          <ThemeReady />
          <NeonCard>
            <text>BODYMARK</text>
          </NeonCard>
        </ThemeTestProviders>
      ),
      { width: 48, height: 8 },
    ),
    (text) => text.includes("BODYMARK"),
  )
  try {
    await app.renderOnce()
    await overCard(app)
    await app.renderOnce()
    const samples: number[] = []
    for (let step = 0; step < 12; step++) {
      await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
      await app.renderOnce()
      samples.push(brightness(borderCell(app)))
    }
    // 扫光峰值提亮 55%,8bit 量化下这一格至少 +0.3 亮度 —— 用 0.2 的门槛足够稳。
    expect(Math.max(...samples)).toBeGreaterThan(RAMP_CEILING + 0.2)

    await offCard(app)
    await app.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
    await app.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
    await app.renderOnce()
    // 移开后没有扫光,这一格落在色板自身的亮度区间里(相位冻结在哪一格就取哪一格的值)。
    expect(brightness(borderCell(app))).toBeLessThan(RAMP_CEILING + 0.05)
  } finally {
    app.renderer.destroy()
  }
})

// 悬停提亮:「移开(相位冻结)→ 采样 → 再移上去 → 采样」。两次采样之间相位最多差一格
// (周长的 1/100),提亮是 12%,量级差 10 倍,压得住。
// 门槛取 7%:8bit 量化会把 0.106 记成 0.102,再叠上一格的相位噪声。
test("分区卡:悬停时描边整体朝 theme.text 提亮", async () => {
  const app = await sidebarCard("分支", "main", "分支正文")
  try {
    await overCard(app)
    await app.renderOnce()
    await offCard(app)
    await app.renderOnce()
    const plain = borderCell(app)
    await overCard(app)
    await app.renderOnce()
    const hovered = borderCell(app)
    // theme.text 是主题里最亮的前景色,朝它混必然抬亮度(前提即此)。
    expect(brightness(hovered) - brightness(plain)).toBeGreaterThan(HOVER_BOOST * 0.7)
  } finally {
    app.renderer.destroy()
  }
})

// 提亮量本身:同一张卡、同一条边框格,传 boost 与不传 boost 的两帧之差,
// 必须恰好等于 brighten(base, HOVER_BOOST, towards)。这条把「12%」钉在集成层,
// 免得只靠 neon.test.ts 的纯函数单测 —— 那边改错了接线也一样绿。
test("提亮量就是 brighten(base, HOVER_BOOST, towards):同色两卡只差一个 boost", async () => {
  // 三段相近的霓虹端色:两端亮度接近,「提亮」不会被「换色段」这种差异冒充。
  const stops = [RGBA.fromHex("#5a3a8a"), RGBA.fromHex("#7a4fa0"), RGBA.fromHex("#9a60b0")]
  const towards = RGBA.fromHex("#ffffff")
  const card = { width: 12, height: 4, gradientStops: stops }

  const shoot = async (boost?: RGBA) => {
    const app = await testRender(
      () => (
        <neonbox {...card} boost={boost}>
          <text>hi</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      return cellGrid(app)
    } finally {
      app.renderer.destroy()
    }
  }

  const plain = await shoot()
  const boosted = await shoot(towards)
  const sample = [
    { x: 2, y: 0 },
    { x: 6, y: 0 },
    { x: 10, y: 0 },
    { x: 11, y: 2 },
  ]
  for (const cell of sample) {
    const key = `${cell.y}:${cell.x}`
    const base = plain.get(key)
    const actual = boosted.get(key)
    if (!base || !actual) throw new Error(`边框格 ${key} 不在帧里`)
    const expected = brighten(RGBA.fromValues(base.r, base.g, base.b, 1), HOVER_BOOST, towards)
    // buffer 存 fg 走 8bit 量化,单格误差容 1/255。
    expect(Math.abs(actual.r - expected.r), `r @ ${key}`).toBeLessThan(0.01)
    expect(Math.abs(actual.g - expected.g), `g @ ${key}`).toBeLessThan(0.01)
    expect(Math.abs(actual.b - expected.b), `b @ ${key}`).toBeLessThan(0.01)
  }
})
