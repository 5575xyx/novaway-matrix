/** @jsxImportSource @opentui/solid */
import { afterAll, beforeAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { CapturedFrame, RGBA } from "@opentui/core"
import { Pill, PillRow, pillColumns, type PillSpec } from "../../src/component/pill"
import { icon, currentIconStyle, setIconStyle } from "../../src/util/panel-icons"
import { Locale } from "../../src/util/locale"
import { resolveTheme, type ThemeJson } from "../../src/theme"
import novaway from "../../src/theme/assets/novaway.json" with { type: "json" }
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"

// 面板图标是**模块级全局状态**,而 test/util/panel-icons.test.ts 会把它留在 nerdfont / ascii 上。
// 同一个 bun 进程跑全部测试文件,这里必须自己钉死风格,否则断言随执行顺序时对时错。
const PREVIOUS_STYLE = currentIconStyle()
beforeAll(() => setIconStyle("emoji"))
afterAll(() => setIconStyle(PREVIOUS_STYLE))

const THEME = resolveTheme(novaway as ThemeJson, "dark")

function cell(rgba: RGBA) {
  return `${rgba.r.toFixed(4)},${rgba.g.toFixed(4)},${rgba.b.toFixed(4)}`
}

// captureSpans 给的是「一段同底色字符」;胶囊的底色正好一整块,所以按字形找它所在的那一段就够。
function styleOfGlyph(app: { captureSpans(): CapturedFrame }, row: number, glyph: string) {
  const span = app.captureSpans().lines[row]?.spans.find((item) => item.text.includes(glyph))
  if (!span) throw new Error(`帧里找不到 ${glyph}`)
  return { fg: `${span.fg.r.toFixed(4)},${span.fg.g.toFixed(4)},${span.fg.b.toFixed(4)}`, bg: cell(span.bg) }
}

function frame(app: { captureCharFrame(): string }) {
  return app
    .captureCharFrame()
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
}

type Harness = Awaited<ReturnType<typeof testRender>>

async function render(node: () => any, width = 60, height = 8): Promise<Harness> {
  const app = await testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        {node()}
      </ThemeTestProviders>
    ),
    { width, height },
  )
  let text = ""
  for (let attempt = 0; attempt < 200; attempt++) {
    await app.renderOnce()
    text = app.captureCharFrame()
    if (text.includes("READY")) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  expect(text).toContain("READY")
  return app
}

// READY 哨兵占第 0 行,被测内容从第 1 行开始。
const ROW = 1

// ── 宽度账:胶囊的每一列都要按显示列算 ──────────────────────────────────────────
// `◱`(U+25F1)与 `·`(U+00B7)都是 East-Asian Ambiguous:按 Unicode 标准记 1 列,
// Bun.stringWidth 也这么记,但开了 ambiguous-wide 的 CJK 终端会把它们渲成 2 列。
// 所以这里的期望值是「标准口径下的列数」,CJK 终端上真实占位会多出来 —— 这正是
// 降级阶梯必须留有余量的原因(见 PillRow 那组测试)。
test("胶囊地基:pillColumns 按显示列算,CJK 一个字两列", () => {
  // 无图标:左右内边距 2 列 + 文案 4 列
  expect(pillColumns({ label: "命令" })).toBe(6)
  // 有图标:图标 1 + 图标后的空格 1
  expect(pillColumns({ label: "视图·气泡", icon: "◱" })).toBe(2 + 1 + 1 + 9)
  // 只剩图标(降级档):图标后那个空格也一起不渲染,否则会留一个悬空的空格
  expect(pillColumns({ label: "", icon: "◱" })).toBe(2 + 1)
  // 按码元算会低估:CJK 文案 6 个码元占 11 列
  expect(Locale.displayWidth("视图·流程图")).toBe(11)
  expect("视图·流程图".length).toBe(6)
})

test("胶囊:label 与 icon 都渲染出来", async () => {
  const app = await render(() => <Pill label="视图·气泡" icon="◱" />)
  try {
    const row = frame(app)[ROW]!
    expect(row).toContain("◱")
    expect(row).toContain("视图·气泡")
    // 图标与文案之间恰好一个空格,前面还有 1 列内边距(右内边距是底色,字符帧里是空格、被
    // frame() 的去尾空白吃掉了,所以只钉左端)
    expect(row.startsWith(" ◱ 视图·气泡")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

// 状态胶囊(session #、ctx)是**只读**的,悬停变色会让人以为它能点,所以不挂鼠标事件。
// 这一条钉住「不可点的胶囊不响应点击」。
test("胶囊:没有 onClick 时点它什么也不发生", async () => {
  let clicks = 0
  const app = await render(() => (
    <box flexDirection="row">
      <Pill label="8.2K ctx" />
    </box>
  ))
  try {
    await app.mockMouse.click(3, ROW)
    await app.renderOnce()
    expect(clicks).toBe(0)
  } finally {
    app.renderer.destroy()
  }
  // 有 onClick 时同一位置会命中 —— 单独跑一遍,确保上面的「没反应」不是因为坐标点空了。
  const clickable = await render(() => (
    <box flexDirection="row">
      <Pill label="视图·气泡" icon="◱" onClick={() => clicks++} />
    </box>
  ))
  try {
    await clickable.mockMouse.click(3, ROW)
    await clickable.renderOnce()
    expect(clicks).toBe(1)
  } finally {
    clickable.renderer.destroy()
  }
})

// 悬停反馈:底色从 backgroundPanel 抬到 backgroundElement,文字从 textMuted 抬到 primary。
// accent 档(当前视图那种)静止态就用 primary 文字,底色与普通档一致 —— 于是
// 「悬停一定换底色」这条规律对两档都成立。
test("胶囊:可点的胶囊悬停时底色抬到 backgroundElement、文字抬到 primary", async () => {
  const app = await render(() => (
    <box flexDirection="row">
      <Pill label="视图·气泡" icon="◱" onClick={() => {}} />
    </box>
  ))
  try {
    await app.renderOnce()
    const rest = styleOfGlyph(app, ROW, "视")
    expect(rest.bg).toBe(cell(THEME.backgroundPanel))
    expect(rest.fg).toBe(cell(THEME.textMuted))

    await app.mockMouse.moveTo(3, ROW)
    await app.renderOnce()
    const hover = styleOfGlyph(app, ROW, "视")
    expect(hover.bg).toBe(cell(THEME.backgroundElement))
    expect(hover.bg).not.toBe(rest.bg)
    expect(hover.fg).toBe(cell(THEME.primary))

    await app.mockMouse.moveTo(40, ROW + 2)
    await app.renderOnce()
    const left = styleOfGlyph(app, ROW, "视")
    expect(left.bg).toBe(rest.bg)
    expect(left.fg).toBe(rest.fg)
  } finally {
    app.renderer.destroy()
  }
})

test("胶囊:tone=accent 静止态就是 primary 文字,底色不变", async () => {
  const app = await render(() => (
    <box flexDirection="row">
      <Pill label="视图·流程图" icon="◱" tone="accent" onClick={() => {}} />
    </box>
  ))
  try {
    await app.renderOnce()
    const rest = styleOfGlyph(app, ROW, "视")
    expect(rest.bg).toBe(cell(THEME.backgroundPanel))
    expect(rest.fg).toBe(cell(THEME.primary))
    await app.mockMouse.moveTo(3, ROW)
    await app.renderOnce()
    expect(styleOfGlyph(app, ROW, "视").bg).toBe(cell(THEME.backgroundElement))
  } finally {
    app.renderer.destroy()
  }
})

// ── 降级阶梯 ────────────────────────────────────────────────────────────────
// 四颗胶囊按优先级 视图(3) > / 命令(2) > session #(1) > ctx(0) 依次试放,放不下的整颗丢掉;
// 视图胶囊允许退化成「只剩图标」,其余三颗不退化(退化的信息量还不如没有)。
const PILLS: PillSpec[] = [
  { label: "视图·气泡", icon: "◱", tone: "accent", priority: 3, iconOnly: true },
  { label: "/ 命令 ctrl+p", priority: 2 },
  { label: "session #a1b2c3", priority: 1 },
  { label: "8.2K ctx", priority: 0 },
]

function viewColumns(label: string, icon?: string) {
  return pillColumns({ label, icon })
}

test("PillRow:宽度够时四颗全在,顺序仍是传入顺序", async () => {
  const width =
    viewColumns("视图·气泡", "◱") +
    1 +
    viewColumns("/ 命令 ctrl+p") +
    1 +
    viewColumns("session #a1b2c3") +
    1 +
    viewColumns("8.2K ctx") +
    1
  const app = await render(() => <PillRow width={width} pills={PILLS} />, width + 2)
  try {
    const row = frame(app)[ROW]!
    expect(row).toContain("视图·气泡")
    expect(row).toContain("/ 命令 ctrl+p")
    expect(row).toContain("session #a1b2c3")
    expect(row).toContain("8.2K ctx")
    expect(Locale.displayWidth(row)).toBeLessThanOrEqual(width)
    // 顺序不能被优先级打乱:视图在最左,ctx 在最右
    expect(row.indexOf("视图·气泡")).toBeLessThan(row.indexOf("/ 命令 ctrl+p"))
    expect(row.indexOf("session #a1b2c3")).toBeLessThan(row.indexOf("8.2K ctx"))
  } finally {
    app.renderer.destroy()
  }
})

// 一档一档收窄,每一档丢掉的都是优先级最低的那颗:先 ctx,再 session #,再 / 命令。
test("PillRow:收窄时按「ctx → session # → / 命令」依次让位", async () => {
  const view = viewColumns("视图·气泡", "◱")
  const command = viewColumns("/ 命令 ctrl+p")
  const session = viewColumns("session #a1b2c3")
  const ctx = viewColumns("8.2K ctx")
  // 每档都留足「视图 + 空隙 + 前三颗」,只把最后一颗挤掉
  for (const [width, dropped] of [
    [1 + view + 1 + command + 1 + session + 1 + ctx, []],
    [1 + view + 1 + command + 1 + session, ["ctx"]],
    [1 + view + 1 + command, ["session #a1b2c3"]],
    [1 + view, ["/ 命令 ctrl+p"]],
  ] as const) {
    const app = await render(() => <PillRow width={width} pills={PILLS} />, width + 2)
    try {
      const row = frame(app)[ROW]!
      expect(row, `宽度 ${width}`).toContain("视图·气泡")
      for (const gone of dropped) expect(row, `宽度 ${width} 不该还有 ${gone}`).not.toContain(gone)
      expect(Locale.displayWidth(row), `宽度 ${width}`).toBeLessThanOrEqual(width - 1)
    } finally {
      app.renderer.destroy()
    }
  }
})

// 最后一档:视图胶囊退化成只剩图标 —— iconOnly 的那一颗先试纯图标,放得下就只画图标。
test("PillRow:极窄时视图胶囊退化成只剩图标,再窄就整颗丢掉", async () => {
  const iconOnly = viewColumns("", "◱")
  const slim = await render(() => <PillRow width={1 + iconOnly} pills={PILLS} />, iconOnly + 4)
  try {
    const row = frame(slim)[ROW]!
    expect(row).toContain("◱")
    expect(row).not.toContain("视图")
    expect(Locale.displayWidth(row)).toBeLessThanOrEqual(iconOnly)
  } finally {
    slim.renderer.destroy()
  }
  const gone = await render(() => <PillRow width={iconOnly - 1} pills={PILLS} />, iconOnly + 4)
  try {
    expect(frame(gone)[ROW]).not.toContain("◱")
  } finally {
    gone.renderer.destroy()
  }
})

// 图标风格:原型的 ◱ 是 East-Asian Ambiguous,nerdfont / ascii 两套必须降级成宽度可预测的字形,
// 否则 CJK 终端上一行凭空多出好几列,右端最先被顶出去(见 util/panel-icons 的文件头)。
test("胶囊图标:emoji 风格用 ◱,nerdfont / ascii 降级成宽度可预测的字形", () => {
  try {
    setIconStyle("emoji")
    expect(icon("view")).toBe("◱")
    expect(pillColumns({ label: "", icon: icon("view") })).toBe(3)
    for (const style of ["nerdfont", "ascii"] as const) {
      setIconStyle(style)
      const glyph = icon("view")
      expect(glyph.length, style).toBe(1)
      expect(pillColumns({ label: "", icon: glyph }), style).toBe(3)
    }
  } finally {
    setIconStyle("emoji")
  }
})
