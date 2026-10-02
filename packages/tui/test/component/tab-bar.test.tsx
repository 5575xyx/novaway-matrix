/** @jsxImportSource @opentui/solid */
import { afterAll, beforeAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { ArgsProvider } from "../../src/context/args"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { TabBar, tabColumns, type TabItem } from "../../src/component/tab-bar"
import { NeonRail } from "../../src/component/neon-rail"
import { PillRow, pillColumns, type PillSpec } from "../../src/component/pill"
import { currentIconStyle, icon, setIconStyle } from "../../src/util/panel-icons"
import { Locale } from "../../src/util/locale"

// panel-icons 的风格是模块级全局状态,别的测试文件会把它留在 nerdfont / ascii 上。
const PREVIOUS_STYLE = currentIconStyle()
beforeAll(() => setIconStyle("emoji"))
afterAll(() => setIconStyle(PREVIOUS_STYLE))

test("TabBar 底边是霓虹导轨(全宽 ━ 行)", async () => {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <ArgsProvider>
            <KVProvider>
              <ThemeProvider mode="dark">
                <TabBar
                  tabs={[{ id: "chat", title: "会话", type: "chat", closable: false }]}
                  activeTabId="chat"
                  onTabClick={() => {}}
                  onTabClose={() => {}}
                  width={40}
                />
              </ThemeProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 40, height: 4 },
  )
  try {
    let lines: string[] = []
    for (let attempt = 0; attempt < 10; attempt++) {
      await app.renderOnce()
      lines = app.captureCharFrame().split("\n")
      if (lines[0]?.includes("会话")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(lines[0]).toContain("会话")
    expect(lines[1]).toContain("━")
  } finally {
    app.renderer.destroy()
  }
})

// 导轨宽度必须按自身盒子(窄容器)取样,否则按终端全宽取色会被 overflow 裁掉渐变尾部,
// 末列永远到不了终点色。
test("导轨在窄容器里按自身宽度铺满渐变,末列取到终点色", async () => {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <ArgsProvider>
            <KVProvider>
              <ThemeProvider mode="dark">
                <box width={10} flexDirection="column">
                  <NeonRail stops={[RGBA.fromHex("#ff0000"), RGBA.fromHex("#0000ff")]} />
                </box>
              </ThemeProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 40, height: 4 },
  )
  try {
    let lastFg: RGBA | undefined
    let railLine = ""
    for (let attempt = 0; attempt < 10; attempt++) {
      await app.renderOnce()
      const captured = app.captureSpans()
      const rail = captured.lines.find((row) => row.spans.some((span) => span.text.includes("━")))
      lastFg = rail?.spans.filter((span) => span.text.includes("━")).at(-1)?.fg
      railLine =
        app
          .captureCharFrame()
          .split("\n")
          .find((row) => row.includes("━")) ?? ""
      if (lastFg && lastFg.b > 0.9) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    // 末列是渐变终点(蓝),不是被终端宽度采样裁在前段的红
    expect(lastFg?.b).toBeGreaterThan(0.9)
    expect(lastFg?.r).toBeLessThan(0.1)
    // 导轨只铺容器宽度 10 列,第 11 列起留白
    expect(railLine.slice(0, 10)).toBe("━━━━━━━━━━")
    expect(railLine[10]).toBe(" ")
  } finally {
    app.renderer.destroy()
  }
})

// 标签栏右端的胶囊(会话页组装,首页不传)。这一组量的都是几何:胶囊贴在标签行最右、
// 与标签之间至少留 1 列、整行只有 1 行(折行会把会话区顶高一格)。
// 宽度预算是 TabBar 算出来(标签栏宽度 − padding − 所有标签的列数)再交给 PillRow 的,
// 降级阶梯见 test/component/pill.test.tsx;这里只验证这条链路接对了、且整行不溢出。
const STATUS_PILLS: PillSpec[] = [
  { label: "视图·气泡", icon: icon("view"), tone: "accent", priority: 3, iconOnly: true },
  { label: "/ 命令 ctrl+p", priority: 2 },
  { label: "session #a1b2c3", priority: 1 },
  { label: "8.2K ctx", priority: 0 },
]
const CHAT_TAB: TabItem = { id: "chat", title: "聊天", type: "chat", closable: false }

async function renderBar(width: number, pills?: PillSpec[], tabs: TabItem[] = [CHAT_TAB]) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <ArgsProvider>
            <KVProvider>
              <ThemeProvider mode="dark">
                <TabBar
                  tabs={tabs}
                  activeTabId={tabs[0]!.id}
                  onTabClick={() => {}}
                  onTabClose={() => {}}
                  width={width}
                  pills={pills ? (available) => <PillRow width={available} pills={pills} /> : undefined}
                />
                <text>PROBE</text>
              </ThemeProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: Math.max(width, 20), height: 4 },
  )
  try {
    let lines: string[] = []
    for (let attempt = 0; attempt < 200; attempt++) {
      await app.renderOnce()
      lines = app.captureCharFrame().split("\n")
      if (lines.join("\n").includes("PROBE")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return lines.map((line) => line.replace(/\s+$/, ""))
  } finally {
    app.renderer.destroy()
  }
}

test("TabBar:传了 pills 时胶囊贴在标签行最右,且与标签之间至少留 1 列", async () => {
  // 60 列只放一颗最宽的胶囊,量位置就够。
  const view = STATUS_PILLS[0]!
  const width = 60
  const lines = await renderBar(width, [view])
  const row = lines[0]!
  expect(row).toContain("聊天")
  expect(row).toContain("视图·气泡")
  // 整行宽 = 标签栏内宽 = width − 2(标签栏自己的 paddingLeft/Right 各 1 列,那两列是尾随空白,
  // 去尾之后量到的就是内宽)。胶囊不溢出,超宽时最右那颗会被 overflow:hidden 裁掉。
  expect(Locale.displayWidth(row)).toBe(width - 2)
  // 胶囊被弹性空隙顶到最右,所以它的图标起始列可以精确算出来:
  //   1(标签栏 paddingLeft)+ tabColumns + 余下的空隙 + 1(胶囊 paddingLeft)
  // 其中「余下的空隙」= 标签栏内宽 − 标签列数 − 胶囊列数 —— 空隙吃掉全部余量才叫「贴到最右」。
  const inner = width - 2
  const tab = tabColumns(CHAT_TAB)
  const pill = pillColumns({ label: view.label, icon: view.icon })
  const expectedColumn = 1 + tab + (inner - tab - pill) + 1
  // indexOf 给的是 UTF-16 下标,前面有 CJK 文字,必须换算成显示列再比。
  const actualColumn = Locale.displayWidth(row.slice(0, row.indexOf(view.icon!)))
  expect(actualColumn).toBe(expectedColumn)
  // 整行仍然只有 1 行:PROBE 紧跟在标签栏的导轨行下面
  expect(lines[1]).toContain("━")
  expect(lines[2]).toContain("PROBE")
})

test("TabBar:不传 pills 时标签行右端留空(首页那一档)", async () => {
  const lines = await renderBar(40)
  expect(lines[0]).toContain("聊天")
  // 去尾之后量到的就是那一个标签:1 列标签栏 paddingLeft + tabColumns,末尾两个空白列被去掉了
  expect(Locale.displayWidth(lines[0]!)).toBe(tabColumns(CHAT_TAB))
  expect(lines[2]).toContain("PROBE")
})

// 标签栏宽度 − padding 2 − 聊天标签 9 = 胶囊预算。四颗胶囊的标准宽度合计 58 列(含间隙)。
// 所以 120 / 80 列放得下全部四颗(会话页不收侧栏时的常态),62 列开始进入降级。
test("TabBar:120 与 80 列下四颗胶囊全在", async () => {
  for (const width of [120, 80]) {
    const lines = await renderBar(width, STATUS_PILLS)
    const row = lines[0]!
    expect(row, `${width} 列`).toContain("视图·气泡")
    expect(row, `${width} 列`).toContain("/ 命令 ctrl+p")
    expect(row, `${width} 列`).toContain("session #a1b2c3")
    expect(row, `${width} 列`).toContain("8.2K ctx")
    expect(Locale.displayWidth(row), `${width} 列`).toBe(width - 2)
    expect(lines[2], `${width} 列`).toContain("PROBE")
  }
})

// 降级:预算 = 标签栏宽 − 2 − 聊天标签 9 = 终端宽 − 11。四颗合计 58 列,所以
//   62 列(预算 51)先丢 ctx → 47 列(36)再丢 session # → 34 列(23)再丢 / 命令 →
//   23 列(12)视图胶囊只剩图标 → 13 列(2)整排为空。
// 每一档都验证「整行仍然只有 1 行」—— 降级是为了不溢出,不是为了把标签栏撑成两行。
test("TabBar:收窄时按「ctx → session # → / 命令」让位,极窄时视图胶囊只剩图标", async () => {
  const cases: { width: number; present: string[]; absent: string[] }[] = [
    { width: 62, present: ["视图·气泡", "/ 命令", "session #a1b2c3"], absent: ["8.2K ctx"] },
    { width: 47, present: ["视图·气泡", "/ 命令"], absent: ["session #a1b2c3", "8.2K ctx"] },
    { width: 34, present: ["视图·气泡"], absent: ["/ 命令", "session #a1b2c3", "8.2K ctx"] },
    { width: 23, present: [icon("view")], absent: ["视图", "/ 命令", "session #a1b2c3", "8.2K ctx"] },
    { width: 13, present: [], absent: [icon("view"), "视图", "session #a1b2c3"] },
  ]
  for (const item of cases) {
    const lines = await renderBar(item.width, STATUS_PILLS)
    const row = lines[0]!
    for (const text of item.present) expect(row, `${item.width} 列该有 ${text}`).toContain(text)
    for (const text of item.absent) expect(row, `${item.width} 列不该有 ${text}`).not.toContain(text)
    expect(Locale.displayWidth(row), `${item.width} 列`).toBeLessThanOrEqual(item.width - 2)
    expect(lines[1], `${item.width} 列`).toContain("━")
    expect(lines[2], `${item.width} 列`).toContain("PROBE")
  }
})

// 多标签时预算必须把**所有**标签算进去,否则胶囊会按「只有一个标签」那条预算画出来并被裁掉。
// 这里开两个预览标签(📄 = 2 列 + 文件名 + ✕ 2 列),验证最右那颗胶囊仍然是完整的。
test("TabBar:多标签时胶囊预算把每个标签都算进去(右端不会被裁)", async () => {
  const tabs: TabItem[] = [
    CHAT_TAB,
    { id: "preview-a", title: "index.tsx", type: "preview", closable: true, filePath: "a.tsx" },
    { id: "preview-b", title: "session/index.tsx", type: "preview", closable: true, filePath: "b.tsx" },
  ]
  const width = 120
  const lines = await renderBar(width, STATUS_PILLS, tabs)
  const row = lines[0]!
  expect(row).toContain("index.tsx")
  expect(row).toContain("8.2K ctx")
  // 整行仍是标签栏内宽,没有溢出被裁
  expect(Locale.displayWidth(row)).toBe(width - 2)
  const used = tabs.reduce((sum, tab) => sum + tabColumns(tab), 0)
  expect(pillColumns({ label: STATUS_PILLS[3]!.label })).toBe(10)
  // 预算 = width − 2 − 所有标签列数;标签列数算错一颗就会在这条断言上体现出来
  expect(width - 2 - used).toBeGreaterThanOrEqual(58)
})
