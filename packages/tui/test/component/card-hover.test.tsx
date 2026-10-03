/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA, type CapturedFrame } from "@opentui/core"
import { SidebarCard } from "../../src/component/sidebar-card"
import { NeonCard, BlockTool } from "../../src/routes/session"
import { alphaOver, BORDER_ALPHA_DEFAULT, brighten, HOVER_BOOST, semanticStops } from "../../src/ui/neon"
import { resolveTheme, type ThemeJson } from "../../src/theme"
import novaway from "../../src/theme/assets/novaway.json" with { type: "json" }
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"
import "../../src/ui/card"

// C1:悬停时渐变流动 + 描边提亮。
// 提亮的**量**(20%)由下面最后一条用两张只差一个 boost 的同色卡逐格钉死;这里测的是接线:
// 真的把鼠标挪上去,描边真的开始流动、真的整体变亮,挪走后真的停。
//
// 相位是这里最麻烦的干扰项:animated 一开,相位每 80ms 走两格,一格的位移就足以让
// 「同一格的颜色」和「同一格的提亮量」混在一起分不开。所以两条断言各挑一个干净的量:
//   流动 —— 盯**单格随时间**变化(相位一动就变,提亮是常量,不影响「变了没有」这个判断),
//     并且要求其中至少有一格是**变暗**的:扫光/光晕/悬停抬对比这三层都是朝亮处推,
//     任何一格都只升不降,所以「有一格变暗」只能是色带真的走了(判据见 maxDrop);
//   提亮 —— 盯「同一相位下 hover 前后的色距」。这一族不带 `flow`,鼠标一移开相位就
//     冻结(见 ui/card 的 flow 与 component/sidebar-card),而重新悬停后相位从冻结的那一格
//     接着走 —— 两次采样之间隔多久,这个差值里就混进多少相位。所以这一次必须紧贴住:
//     鼠标没碰过 → 立刻采 plain → 立刻采 hovered,两次 renderOnce 之间只有几毫秒,
//     相位最多差半格(周长的 1/200),而提亮是 20%,量级差 40 倍。

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

/**
 * 整条上边框的前景色。
 *
 * **为什么量「逐格最大偏差/下降量」而不是亮度**:描边按 alpha 折算之后(见 ui/neon 的
 * BORDER_ALPHA_DEFAULT),色带在亮度上的坡被压扁了 —— 三段霓虹色板近青的一端 r 升 g 降,
 * 200ms 内两者此消彼长、r + g + b 几乎抵消。工具卡那一格上,叠色前 200ms 的亮度差是
 * −0.016,叠色后只剩 −0.003:还在,却掉进了 8bit 量化与 `toBeCloseTo(_, 3)` 的噪声里,
 * 于是「有没有在动」这条判据失效了(改之前它测的是真东西,现在它测的是量化误差)。
 * 逐格逐通道比就不受抵消影响:任一通道走过一档(1/255)就说明那一格的颜色真的变了。
 * 注意「变了」不等于「色带走了」—— 扫光也改通道,那一条由 maxDrop 分流。
 */
function borderRow(app: { captureSpans(): CapturedFrame; captureCharFrame(): string }) {
  const { top } = cardRows(app)
  const grid = cellGrid(app)
  return [...Array.from({ length: 40 }, (_, index) => index)]
    .map((x) => grid.get(`${top}:${x}`))
    .filter((value): value is { r: number; g: number; b: number } => Boolean(value))
}

function maxDeviation(a: { r: number; g: number; b: number }[], b: { r: number; g: number; b: number }[]) {
  if (a.length !== b.length || a.length === 0) throw new Error("两次采样的格子数对不上")
  return Math.max(
    ...a.flatMap((left, index) => {
      const right = b[index]!
      return [Math.abs(left.r - right.r), Math.abs(left.g - right.g), Math.abs(left.b - right.b)]
    }),
  )
}

/**
 * 逐格逐通道的**最大下降量** —— 「有没有哪一格变暗了」。
 *
 * 为什么单靠 maxDeviation 不够:悬停时同一格里叠着四层东西,其中三层只会把颜色往亮处推:
 *   · 顶部光晕(TOP_EDGE_GLOW 朝白,见 ui/card 的 topEdgeTarget)
 *   · 悬停抬对比(HOVER_BOOST 朝 theme.text,深色主题下是近白)
 *   · 扫光(SWEEP_STRENGTH 朝白)
 * 三层都是「朝一个更亮的终点插值」,所以对任何一格都只可能让通道**上升**。
 * 色带流动是唯一会让某格变暗的那一层(渐变上一格的色相比这一格暗,色带走过来它就变暗)。
 * 于是「至少有一格变暗」这条判据把「色带真的走了」与「只有扫光爬过去了」分开了 ——
 * 单看 maxDeviation 的话,扫光自己就足以满足它:扫光窗口占一圈 12%,而上面那 6 帧
 * (PHASE_WAIT 200ms × 5 ≈ 1 秒)里悬停档每拍走两格,相位已经推进约四分之一圈,
 * 那一道上白亮扫过的几十格足够把整条上边框逐格都比出偏差来。
 *
 * 下降量取最大而不是「有没有下降」:8bit 量化下 1/255 就是 0.004,门槛与上面那条
 * maxDeviation 用同一个数。
 */
function maxDrop(a: { r: number; g: number; b: number }[], b: { r: number; g: number; b: number }[]) {
  if (a.length !== b.length || a.length === 0) throw new Error("两次采样的格子数对不上")
  return Math.max(
    ...a.flatMap((left, index) => {
      const right = b[index]!
      return [left.r - right.r, left.g - right.g, left.b - right.b]
    }),
  )
}

function brightness(cell: { r: number; g: number; b: number }) {
  return cell.r + cell.g + cell.b
}

// ThemeTestProviders 固定 mode="dark" 且默认主题就是 novaway,所以助手卡的色板可以直接
// 解析出来取它的**柔边之后**的亮度上沿(见下面助手卡那条测试的用法)。
//
// 为什么是柔边之后的值而不是纯色板:上沿原来取的是纯色板(#00e5ff 三通道和 1.898),
// 扫光要越过它得插 55% —— 那正是「探照灯」那一档。扫光收到 30% 之后峰值落在 1.79,
// 已经**不再越过纯色板**,于是「越过色板上沿」这个判据失效了。改用柔边之后的上沿:
//   · 相位平移只能在这一族色板折算出来的亮度区间里取值(+ 顶边光晕 6%),越不过它;
//   · 扫光向白插 30% 一定越得过它。
// 两件事仍然互不冒名,而门槛从「纯色板上沿 + 0.2」换成「柔边上沿 + 0.3」后余量更稳。
const ASSISTANT_THEME = resolveTheme(novaway as ThemeJson, "dark")
const RAMP_CEILING = Math.max(
  ...semanticStops(ASSISTANT_THEME, "assistant").map((stop) =>
    brightness(alphaOver(stop, ASSISTANT_THEME.background, BORDER_ALPHA_DEFAULT)),
  ),
)

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

/**
 * 「悬停时在动、移开后那层只属于悬停的东西没了」这一对断言。
 *
 * **移开之后钉的是「整圈逐格冻结」**:这一族都不带 `flow`(原型 `.card` 底态不流,
 * `gbFlow` 挂在 `:hover` 上,见 ui/card 的 flow 与 component/sidebar-card),
 * 所以移开鼠标就等于相位停表、扫光消失、抬对比撤掉 —— 描边逐格冻结。判据分两个量:
 *   · 「色带真的在流」用**逐格逐通道最大下降量**判(理由见 maxDrop):扫光/光晕/抬对比
 *     三层只会让颜色变亮,能测出「变暗」的那一层只可能是色带平移。
 *   · 「扫光在不在」用**亮度**判,并拿悬停**之前**的那一帧当基线(那时既没有扫光也没有
 *     抬对比,亮度就是这张卡色带自身的区间上沿)。这个基线不依赖任何主题 token,
 *     所以换主题也不会让门槛失准。
 */
const SWEEP_MARGIN = 0.3

function peakBrightness(row: { r: number; g: number; b: number }[]) {
  return Math.max(...row.map(brightness))
}

async function sample(app: Harness, count: number) {
  const shots: { r: number; g: number; b: number }[][] = []
  for (let index = 0; index < count; index++) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
    await app.renderOnce()
    shots.push(borderRow(app))
  }
  return shots
}

async function flowPair(name: string, mount: () => Promise<Harness>, ready: (text: string) => boolean) {
  const app = await settle(await mount(), ready)
  try {
    const idle = await sample(app, 4)
    const baseline = Math.max(...idle.map(peakBrightness))

    await overCard(app)
    const hovered = await sample(app, 6)
    // 判据是「有格子变暗」而不是「颜色变了」:扫光自己就足以让 maxDeviation 过关,
    // 变暗只可能来自色带平移(理由见 maxDrop)。
    expect(
      maxDrop(hovered[hovered.length - 1]!, hovered[0]!),
      `${name}:悬停期间应有格子变暗(色带走过了)`,
    ).toBeGreaterThan(0.004)
    expect(Math.max(...hovered.map(peakBrightness)), `${name}:悬停期间应有扫光扫过`).toBeGreaterThan(
      baseline + SWEEP_MARGIN,
    )

    await offCard(app)
    const left = await sample(app, 6)
    expect(Math.max(...left.map(peakBrightness)), `${name}:移开后扫光应停止`).toBeLessThanOrEqual(
      baseline + SWEEP_MARGIN,
    )
    // 底态不动了 —— 逐格逐通道完全相同,不是「小于某门槛」。
    for (const shot of left) expect(maxDeviation(shot, left[0]), `${name}:移开后描边应逐格冻结`).toBe(0)
  } finally {
    app.renderer.destroy()
  }
}

// 悬停流动:分区卡的悬停是那次新加的 —— 它原先只有 header 上的 onMouseDown,整卡没有 hover 状态。
test("分区卡:悬停期间描边逐帧流动 + 有扫光,移开后两者都停(底态本就不流)", async () => {
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
test("工具卡:悬停期间描边逐帧流动 + 有扫光,移开后两者都停", async () => {
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
    // 扫光向白插 30%(见 ui/card 的 SWEEP_STRENGTH):峰值越不过**纯**色板的上沿,但一定越过
    // 柔边之后那一档 —— 相位平移永远走不出后者的区间。余量 0.3,实测高 0.5 上下。
    expect(Math.max(...samples)).toBeGreaterThan(RAMP_CEILING + 0.3)

    await offCard(app)
    await app.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
    await app.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
    await app.renderOnce()
    // 移开后没有扫光,这一格落回色板折算后的亮度区间里(相位冻结在哪一格就取哪一格的值)。
    // 门槛比原来还紧一档:原来是「纯色板上沿 + 0.05」,现在是「柔边上沿 + 0.2」——
    // 后者才是真的「扫光不在了」。
    expect(brightness(borderCell(app))).toBeLessThan(RAMP_CEILING + 0.2)
  } finally {
    app.renderer.destroy()
  }
})

// 悬停提亮:「移开 → 立刻采样 → 再移上去 → 立刻采样」。两次采样紧挨着,
// 相位最多差半格(周长的 1/200),提亮是 20%,量级差 40 倍,压得住。
// 之所以还能这么采样,是因为这一族底态不流(见文件头):鼠标一移开相位就冻结。
// 门槛取 7%:8bit 量化会把 0.106 记成 0.102,再叠上半格的相位噪声。
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
// 必须恰好等于 brighten(base, HOVER_BOOST, towards)。这条把「20%」钉在集成层,
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
