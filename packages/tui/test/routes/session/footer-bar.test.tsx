/** @jsxImportSource @opentui/solid */
import { afterAll, beforeAll, expect, test } from "bun:test"
import { For } from "solid-js"
import { testRender } from "@opentui/solid"
import type { CapturedFrame, RGBA } from "@opentui/core"
import { SessionFooterBar } from "../../../src/routes/session/footer"
import { currentIconStyle, icon, setIconStyle } from "../../../src/util/panel-icons"
import { Locale } from "../../../src/util/locale"
import { resolveTheme, type ThemeJson } from "../../../src/theme"
import novaway from "../../../src/theme/assets/novaway.json" with { type: "json" }
import { ThemeReady, ThemeTestProviders } from "../../fixture/providers"

// panel-icons 的图标风格是**模块级全局状态**(一个 signal),而 test/util/panel-icons.test.ts
// 会把它留在 nerdfont / ascii 上。同一个 bun 进程跑全部测试文件,本文件必须自己钉死风格 ——
// 否则同一批断言会随执行顺序时对时错(实测:单独跑全过,跟着全量跑就红)。
const PREVIOUS_STYLE = currentIconStyle()
beforeAll(() => setIconStyle("emoji"))
afterAll(() => setIconStyle(PREVIOUS_STYLE))

// 底栏只有一行,而且它的价值全在「一列都不多占、一项都不折行」上,所以这些断言量的都是
// 真实渲染出来的字符帧:量宽度账(算得对不对)、量项的取舍(优先级顺序对不对)、量行数
// (会不会把下面的输入区顶高一格)。断言里出现的所有字形都取自生产用的 icon(...),写死字面量
// 的话,改 panel-icons 的映射不会有任何测试变红。

function frame(app: { captureCharFrame(): string }) {
  return app
    .captureCharFrame()
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
}

const DIR = "E:\\AImoney\\NovaWay-Matrix\\novaway-coder\\packages\\tui\\src\\routes\\session"
const LONG_DIR = DIR + "\\footer.tsx"
const SHORT_DIR = "~/novaway-coder"

// 底栏本体 + 一行哨兵。哨兵紧跟底栏的下一行 —— 差值恒为 1 就是「底栏恰好 1 行」。
function bar(props: Partial<Parameters<typeof SessionFooterBar>[0]>) {
  const width = props.width ?? 80
  return () => (
    <box width={width} flexDirection="column">
      <SessionFooterBar
        width={width}
        directory={props.directory ?? DIR}
        branch={props.branch ?? "main"}
        lsp={props.lsp ?? 3}
        mcp={props.mcp ?? 4}
        mcpError={props.mcpError ?? false}
        permissions={props.permissions ?? 2}
        connected={props.connected ?? true}
        encoding={props.encoding ?? "UTF-8"}
        brand={props.brand ?? "NovaWay"}
        version={props.version ?? "0.1.0"}
      />
      <text>PROBE</text>
    </box>
  )
}

async function renderBar(props: Partial<Parameters<typeof SessionFooterBar>[0]>, height = 6) {
  const width = props.width ?? 80
  const app = await testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        {bar(props)()}
      </ThemeTestProviders>
    ),
    { width, height },
  )
  try {
    let text = ""
    for (let attempt = 0; attempt < 200; attempt++) {
      await app.renderOnce()
      text = frame(app).join("\n")
      if (text.includes("READY") && text.includes("PROBE")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(text).toContain("READY")
    const rows = frame(app)
    const ready = rows.findIndex((line) => line.includes("READY"))
    const probe = rows.findIndex((line) => line.includes("PROBE"))
    expect(ready).toBeGreaterThanOrEqual(0)
    expect(probe).toBeGreaterThan(ready)
    return { app, row: rows[ready + 1]!, rowIndex: ready + 1, probe }
  } catch (error) {
    app.renderer.destroy()
    throw error
  }
}

function rowCells(value: CapturedFrame, row: number) {
  const line = value.lines[row]
  if (!line) return []
  return line.spans.flatMap((span) =>
    [...span.text].map((ch) => ({
      ch,
      cell: `${span.fg.r.toFixed(4)},${span.fg.g.toFixed(4)},${span.fg.b.toFixed(4)}`,
    })),
  )
}

// 某个字形所在那一格的取色 —— 语义色就是这条断言的靶子。
function colorOf(app: { captureSpans(): CapturedFrame }, row: number, glyph: string) {
  const cells = rowCells(app.captureSpans(), row)
  const index = cells.findIndex((item) => item.ch === glyph)
  expect(index).toBeGreaterThanOrEqual(0)
  return cells[index]!.cell
}

// 期望色从生产用的那套主题真值里取(与 AssistantCard 测试同一条路径),写死十六进制会在换主题
// 之后变成假通过。
const THEME = resolveTheme(novaway as ThemeJson, "dark")

function cell(rgba: RGBA) {
  return `${rgba.r.toFixed(4)},${rgba.g.toFixed(4)},${rgba.b.toFixed(4)}`
}

// truncateMiddleToWidth 是这一行宽度账的地基(路径与分支名都靠它截),所以它的「一定不超预算」
// 与「头尾都留」在这里单独钉住 —— 少一列就会让整行溢出,偏到一侧就会把项目名丢掉。
test("底栏地基:truncateMiddleToWidth 保证不超预算且头尾都留", () => {
  const value = "E:\\AImoney\\NovaWay-Matrix\\novaway-coder"
  for (let columns = 0; columns <= value.length + 4; columns++) {
    const out = Locale.truncateMiddleToWidth(value, columns)
    expect(Locale.displayWidth(out)).toBeLessThanOrEqual(columns)
  }
  // CJK 也按列算,不是按码元:14 个码元占 28 列,预算 15 必须截成 ≤ 15 列。
  const cjk = Locale.truncateMiddleToWidth("一".repeat(14), 15)
  expect(Locale.displayWidth(cjk)).toBeLessThanOrEqual(15)
  // 放得下就原样返回,不引入省略号
  expect(Locale.truncateMiddleToWidth("短", 10)).toBe("短")
  expect(Locale.truncateMiddleToWidth("abc", 0)).toBe("")
  expect(Locale.truncateMiddleToWidth("abc", 1)).toBe("…")
  // 头尾都在:盘符头 + 项目名尾
  expect(Locale.truncateMiddleToWidth(value, 20)).toBe("E:\\AImoney…way-coder")
})

// 逐项对齐原型 card-design-v7.html:1134-1144 的 `.footer`:左组路径 / ✓ LSP / ⚙ MCP / 🔑 权限,
// 右组 ⑂ 分支 / UTF-8 / ● 品牌 + 版本。目录用短的,好让「路径」这一项在 120 列下也不被截。
test("底栏:120 列下逐项对齐原型(左组路径与三项计数,右组分支/编码/品牌+版本)", async () => {
  const { app, row } = await renderBar({ width: 120, directory: SHORT_DIR })
  try {
    expect(row).toContain(SHORT_DIR)
    expect(row).toContain(`${icon("check")} 3 LSP`)
    expect(row).toContain(`${icon("gear")} 4 MCP`)
    expect(row).toContain(`${icon("key")} 2 权限`)
    expect(row).toContain(`${icon("branch")} main`)
    expect(row).toContain("UTF-8")
    expect(row).toContain(`${icon("led")} NovaWay 0.1.0`)
  } finally {
    app.renderer.destroy()
  }
})

// 单行是这个组件存在的第一约束:底栏一旦折行,下面整个输入区就被顶高一格。
// READY 哨兵独占第 0 行,底栏紧跟其后,PROBE 再紧跟底栏 —— 差值恒为 1 就是这条断言。
test("底栏:80 与 120 列下都只有一行(哨兵紧跟下一行)", async () => {
  for (const width of [80, 120]) {
    const { app, rowIndex, probe } = await renderBar({ width, directory: LONG_DIR })
    try {
      expect(probe - rowIndex).toBe(1)
    } finally {
      app.renderer.destroy()
    }
  }
})

// 整行宽度必须 ≤ 可用列数。这一条把宽度账本身钉住:漏算某个 gap、或按码元而不是按显示列算,
// 就会在这里炸开,右端被终端裁掉。宽到放不下时由 flexGrow 空隙吃掉余量,所以只有上界。
// 光有上界不够 —— 溢出时渲染器会把右端裁掉,量出来仍然是 width;所以下面两条用
// startsWith / endsWith 把行的两端钉死,任何多算或少算一列都会让位置错位。
test("底栏:宽度账正确 —— 整行不超过可用列数", async () => {
  for (const width of [30, 40, 55, 60, 66, 72, 75, 80, 100, 120]) {
    const { app, row } = await renderBar({ width, directory: LONG_DIR })
    try {
      expect(Locale.displayWidth(row)).toBeLessThanOrEqual(width)
    } finally {
      app.renderer.destroy()
    }
  }
})

// 端到端把整行的每一个空格都量一遍(手算的期望值,不是从实现里回读的):
//   左组 = 路径 17 + gap 2 + LSP 7 + gap 2 + MCP 7 + gap 2 + 权限 9 = 46
//   中间 = 弹性空隙 2 + 根盒两侧 gap 各 1 = 4
//   右组 = 分支 6 + gap 2 + 编码 5 + gap 2 + 品牌+版本 15 = 30
//   合计 46 + 4 + 30 = 80,正好填满 80 列(路径被截到 17 列是因为它吃剩下的)。
// 「路径 17 列」= truncateMiddleToWidth(81 列的 LONG_DIR, 17):头 8 列「E:\AImon」
// + 省略号 1 + 尾 8 列「oter.tsx」。
test("底栏:80 列下整行正好填满,左右两端位置一列不差", async () => {
  const { app, row } = await renderBar({ width: 80, directory: LONG_DIR })
  try {
    expect(
      row.startsWith(`E:\\AImon…oter.tsx  ${icon("check")} 3 LSP  ${icon("gear")} 4 MCP  ${icon("key")} 2 权限`),
    ).toBe(true)
    expect(row.endsWith(`${icon("branch")} main  UTF-8  ${icon("led")} NovaWay 0.1.0`)).toBe(true)
    expect(Locale.displayWidth(row)).toBe(80)
  } finally {
    app.renderer.destroy()
  }
})

// 超长目录把左组撑满,断言路径确实是**按列**从中间截出来的:头(盘符)与尾(项目名)都在。
// CJK 文案让「按码元算」和「按列算」差出一大截(「2 权限」6 个码元占 8 列),按码元算会溢出。
test("底栏:路径按显示列从中间截断,头尾都留", async () => {
  const { app, row } = await renderBar({ width: 80, directory: LONG_DIR })
  try {
    expect(row).toContain("…")
    expect(row).toContain("E:\\")
    // 80 列下路径只剩 17 列,尾段被切在「footer.tsx」中间 —— 尾段保住了,但只是它的后半截
    expect(row).toContain("oter.tsx")
    expect(row).not.toContain("NovaWay-Matrix")
  } finally {
    app.renderer.destroy()
  }
})

// 80 列下右组三项(分支 / 编码 / 品牌+版本)全部保留 —— 这是正常桌面宽度,不该开始降级。
test("底栏:80 列下右组三项(分支/编码/品牌+版本)全部保留", async () => {
  const { app, row } = await renderBar({ width: 80, directory: LONG_DIR })
  try {
    expect(row).toContain(`${icon("branch")} main`)
    expect(row).toContain("UTF-8")
    expect(row).toContain(`${icon("led")} NovaWay 0.1.0`)
  } finally {
    app.renderer.destroy()
  }
})

// 降级阶梯:固定项按「LSP → MCP → 权限 → 版本 → 编码」试放,**第一项放不下就停**。
// 编码排在最后(只占 5 列、谁也查不到),所以它一定比版本先掉;而更便宜的编码绝不能把更贵的
// LSP 挤出去 —— 这三档正好把这个顺序钉住。
test("底栏:窄到放不下时按「LSP → MCP → 权限 → 版本 → 编码」逐项让位", async () => {
  const at = async (width: number) => {
    const value = await renderBar({ width, directory: LONG_DIR })
    const row = value.row
    value.app.renderer.destroy()
    return row
  }
  // 72 列:三项计数 + 版本都在,只剩编码被让掉
  const wide = await at(72)
  expect(wide).toContain(`${icon("check")} 3 LSP`)
  expect(wide).toContain(`${icon("gear")} 4 MCP`)
  expect(wide).toContain(`${icon("key")} 2 权限`)
  expect(wide).toContain("0.1.0")
  expect(wide).not.toContain("UTF-8")
  // 66 列:版本也让掉,三项计数仍在
  const mid = await at(66)
  expect(mid).toContain(`${icon("key")} 2 权限`)
  expect(mid).not.toContain("0.1.0")
  expect(mid).not.toContain("UTF-8")
  // 55 列:权限先让掉,更贵的… 等等,权限在阶梯里排在 LSP/MCP 之后,所以先掉的是它
  const narrow = await at(55)
  expect(narrow).toContain(`${icon("check")} 3 LSP`)
  expect(narrow).toContain(`${icon("gear")} 4 MCP`)
  expect(narrow).not.toContain("权限")
  // 44 列:只剩 LSP(阶梯第一项),MCP 不会被更便宜的编码挤回来
  const tiny = await at(44)
  expect(tiny).toContain(`${icon("check")} 3 LSP`)
  expect(tiny).not.toContain("MCP")
  expect(tiny).not.toContain("UTF-8")
  expect(tiny).not.toContain("0.1.0")
})

// 阶梯是「第一项放不下就停」,不是「跳过它继续试」:50 列这一档里 MCP 放不下,而版本与编码
// 更便宜、放得下 —— 跳过继续试的话它们会挤进来,把弹性列吃光,路径反而整段消失。
test("底栏:第一项放不下就停,更便宜的项不许挤掉更贵的项", async () => {
  const { app, row } = await renderBar({ width: 50, directory: LONG_DIR })
  try {
    expect(row).toContain(`${icon("check")} 3 LSP`)
    expect(row).not.toContain("MCP")
    expect(row).not.toContain("UTF-8")
    expect(row).not.toContain("0.1.0")
    // 弹性项仍然是第一优先:路径按列截断保住,而不是被让位
    expect(row).toContain("…")
    expect(Locale.displayWidth(row)).toBeLessThanOrEqual(50)
  } finally {
    app.renderer.destroy()
  }
})

// 弹性项(路径 / 分支名)优先于计数:44 列那一档仍然保留被截短的路径与完整分支名。
test("底栏:极窄时计数让位,但路径与分支名按截断保留", async () => {
  const { app, row } = await renderBar({ width: 44, directory: LONG_DIR })
  try {
    expect(row).toContain(`${icon("branch")} main`)
    expect(row).toContain(`${icon("led")} NovaWay`)
    expect(row).toContain("…")
    expect(Locale.displayWidth(row)).toBeLessThanOrEqual(44)
  } finally {
    app.renderer.destroy()
  }
})

// 分支名特别长时也一样:它先按列截断,而不是把左组的计数挤掉。
test("底栏:超长分支名按显示列截断,不挤掉左组", async () => {
  const { app, row } = await renderBar({ width: 80, branch: "feature/plan-1b-status-bar" })
  try {
    expect(row).toContain("…")
    expect(row).toContain(`${icon("check")} 3 LSP`)
    expect(Locale.displayWidth(row)).toBeLessThanOrEqual(80)
  } finally {
    app.renderer.destroy()
  }
})

// 0 项规则:LSP 的 0 是有效信息(没有语言服务器),MCP / 权限的 0 是噪声,整项不渲染。
test("底栏:计数为 0 时只保留 LSP,MCP 与权限整项不显示", async () => {
  const { app, row } = await renderBar({ width: 80, lsp: 0, mcp: 0, mcpError: false, permissions: 0 })
  try {
    expect(row).toContain(`${icon("check")} 0 LSP`)
    expect(row).not.toContain("MCP")
    expect(row).not.toContain("权限")
  } finally {
    app.renderer.destroy()
  }
})

// 有 MCP server 但全部 failed 时,0 个 connected 仍然要报出来 —— 那是故障,不是静默成功。
test("底栏:MCP 失败时即使 0 个连上也要显示", async () => {
  const { app, row } = await renderBar({ width: 80, mcp: 0, mcpError: true })
  try {
    expect(row).toContain(`${icon("gear")} 0 MCP`)
  } finally {
    app.renderer.destroy()
  }
})

// 还没连上任何提供商时不显示三项计数,改成一条 /connect 提示(旧版底栏的行为)。
test("底栏:未连接提供商时状态项换成 /connect 提示", async () => {
  const { app, row } = await renderBar({ width: 80, connected: false })
  try {
    expect(row).toContain("开始使用")
    expect(row).toContain("/connect")
    expect(row).not.toContain("LSP")
  } finally {
    app.renderer.destroy()
  }
})

// 语义色:状态项各有各的色,这是原型「低调的一行小字,但状态各有语义色」的那一半。
test("底栏:状态项按语义上色(LSP/MCP 绿,权限黄,品牌点绿)", async () => {
  const { app, rowIndex } = await renderBar({ width: 100 })
  try {
    expect(colorOf(app, rowIndex, icon("check"))).toBe(cell(THEME.success))
    expect(colorOf(app, rowIndex, icon("gear"))).toBe(cell(THEME.success))
    expect(colorOf(app, rowIndex, icon("key"))).toBe(cell(THEME.warning))
    expect(colorOf(app, rowIndex, icon("led"))).toBe(cell(THEME.success))
  } finally {
    app.renderer.destroy()
  }
})

// MCP failed 时圆点转 error 色 —— 「静默成功」和「连不上」在状态栏上是两件事。
test("底栏:MCP 失败时圆点用 error 色", async () => {
  const { app, rowIndex } = await renderBar({ width: 100, mcp: 0, mcpError: true })
  try {
    expect(colorOf(app, rowIndex, icon("gear"))).toBe(cell(THEME.error))
  } finally {
    app.renderer.destroy()
  }
})

// LSP 为 0 时圆点弱化成 textMuted:「没有语言服务器」是有效信息,但不该和 3 个一样响。
test("底栏:LSP 为 0 时圆点弱化,计数仍显示", async () => {
  const { app, rowIndex, row } = await renderBar({ width: 100, lsp: 0, mcp: 0, mcpError: false, permissions: 0 })
  try {
    expect(row).toContain(`${icon("check")} 0 LSP`)
    expect(colorOf(app, rowIndex, icon("check"))).toBe(cell(THEME.textMuted))
  } finally {
    app.renderer.destroy()
  }
})

// 挂载位置的几何:会话页主区是 [flexGrow 的消息区 | flexShrink=0 的底部盒],底部盒里依次是
// 权限/提问/队列/输入卡,状态栏插在输入卡**上方**。所以要量的不是「行高」,而是:
//   1) 状态栏只占 1 行(折行会整体顶高一格);
//   2) 底部盒不溢出 —— 输入区那一行仍然是画面的最后一行;
//   3) 消息区仍有内容 —— flexGrow 的兄弟被挤掉 1 行之后不能变空。
// 这里用真实的 SessionFooterBar + 一个 scrollbox + 一个定高输入区替身,照生产的三段结构量。
// 这里只量几何(不量颜色),所以不挂 ThemeReady 哨兵 —— 它自己占 1 行,会把 24 行的
// 画面预算挤掉一行,量出来的行号就不是生产的行号了。
async function renderShell(width: number, height = 24) {
  const app = await testRender(
    () => (
      <ThemeTestProviders>
        <box width={width} height={height} flexDirection="column">
          <scrollbox flexGrow={1} flexShrink={1} minHeight={0} verticalScrollbarOptions={{ visible: false }}>
            <For each={[1, 2, 3, 4]}>
              {(index) => (
                <box height={1} flexShrink={0}>
                  <text>MSG-{index}</text>
                </box>
              )}
            </For>
          </scrollbox>
          <box flexShrink={0} flexDirection="column">
            <SessionFooterBar
              width={width}
              directory={LONG_DIR}
              branch="main"
              lsp={3}
              mcp={4}
              mcpError={false}
              permissions={2}
              connected={true}
              encoding="UTF-8"
              brand="NovaWay"
              version="0.1.0"
            />
            <box height={2} flexShrink={0}>
              <text>PROMPT-ROW</text>
            </box>
          </box>
        </box>
      </ThemeTestProviders>
    ),
    { width, height },
  )
  try {
    let text = ""
    for (let attempt = 0; attempt < 200; attempt++) {
      await app.renderOnce()
      text = frame(app).join("\n")
      if (text.includes("PROMPT-ROW")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(text).toContain("PROMPT-ROW")
    return { app, rows: frame(app) }
  } catch (error) {
    app.renderer.destroy()
    throw error
  }
}

test("底栏挂进主区:80 与 120 列下只占 1 行、不顶掉输入区、消息区仍有内容", async () => {
  for (const width of [80, 120]) {
    const { app, rows } = await renderShell(width)
    try {
      const last = rows.map((line) => line.trimEnd()).findLastIndex((line) => line.length > 0)
      const footer = rows.findIndex((line) => line.includes("LSP"))
      const prompt = rows.findIndex((line) => line.includes("PROMPT-ROW"))
      // 状态栏一行,且紧挨在输入区上方
      expect(footer).toBeGreaterThanOrEqual(0)
      expect(prompt).toBeGreaterThan(0)
      expect(rows[prompt - 1]).toContain("LSP")
      // 输入区那一行仍是画面的最后一行 —— 底部盒没有溢出
      expect(prompt).toBe(last)
      // 消息区没被挤空:24 行里至少还能看到前两条消息
      expect(rows.findIndex((line) => line.includes("MSG-1"))).toBeGreaterThanOrEqual(0)
      expect(rows.findIndex((line) => line.includes("MSG-2"))).toBeGreaterThanOrEqual(0)
    } finally {
      app.renderer.destroy()
    }
  }
})

// 原型那 5 个符号在 emoji 风格下原样保留;✓ ⚙ ⑂ ● 是 East-Asian Ambiguous、CJK 终端会渲成
// 2 列,nerdfont / ascii 两套因此降级成纯 ASCII —— 宽度可预测,恒 1~3 列。
test("底栏:emoji 风格用原型符号,nerdfont / ascii 降级成 ASCII", () => {
  const original: Record<string, string> = { check: "✓", gear: "⚙", key: "🔑", branch: "⑂", led: "●" }
  try {
    for (const style of ["emoji", "nerdfont", "ascii"] as const) {
      setIconStyle(style)
      for (const [key, glyph] of Object.entries(original)) {
        const value = icon(key as Parameters<typeof icon>[0])
        if (style === "emoji") expect(value).toBe(glyph)
        else expect(value).toMatch(/^[\x20-\x7e]+$/)
      }
    }
  } finally {
    setIconStyle("emoji")
  }
})
