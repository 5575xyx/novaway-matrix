/** @jsxImportSource @opentui/solid */
// 工具子卡的「有边框的卡 + head/body」结构(原型的 `.tool`,card-design-v7.html:427-458)。
//
// 这里测的是**生产件本体**(BlockTool / InlineToolRow),不是手抄的壳 —— 手抄的话把 head
// 去掉、把 body 的行数上限改成 20,都不会有任何一条断言变红。
import { expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { testRender } from "@opentui/solid"
import { ScrollBoxRenderable, type Renderable } from "@opentui/core"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { BlockTool, InlineToolRow, ToolLabel, TOOL_BODY_MAX_ROWS } from "../../../src/routes/session"
import { Locale } from "../../../src/util/locale"
import novaway from "../../../src/theme/assets/novaway.json" with { type: "json" }
import { resolveTheme, type ThemeJson } from "../../../src/theme"

const theme = resolveTheme(novaway as ThemeJson, "dark")

const WIDTH = 46

type Mount = {
  title?: string
  status?: { passed: number; failed: number }
  body?: string
  bodyRows?: number
  head?: boolean
  /** 紧凑形态的 head 压成一行(生产 InlineTool 在有摘要时这么传) */
  oneLine?: boolean
  onClick?: () => void
}

// 紧凑形态 = 卡 + InlineToolRow 当 head(生产 InlineTool 就是这个组合);
// 展开形态 = 卡自己按 title 画 head(Shell / GenericTool 那一路)。
function card(props: Mount) {
  return (
    <TestTuiContexts>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <ArgsProvider>
          <KVProvider>
            <ThemeProvider mode="dark">
              <BlockTool
                title={props.head ? undefined : props.title}
                status={props.status}
                onClick={props.onClick}
                collapsible={Boolean(props.body)}
                bodyRows={props.bodyRows}
                head={
                  props.head ? (
                    <InlineToolRow complete={true} pending="" oneLine={props.oneLine}>
                      {props.title ?? "读取 src/index.ts"}
                    </InlineToolRow>
                  ) : undefined
                }
              >
                {props.body ? <text fg={theme.text}>{props.body}</text> : undefined}
              </BlockTool>
            </ThemeProvider>
          </KVProvider>
        </ArgsProvider>
      </TuiConfigProvider>
    </TestTuiContexts>
  )
}

// 深度优先找出 body 那个 scrollbox:量它的几何靠真件,而不是往生产组件上加一个只为测试存在的 prop。
function findScroll(node: Renderable): ScrollBoxRenderable | undefined {
  if (node instanceof ScrollBoxRenderable) return node
  for (const child of node.getChildren()) {
    const found = findScroll(child)
    if (found) return found
  }
  return undefined
}

async function renderLabel(max: number) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <ArgsProvider>
            <KVProvider>
              <ThemeProvider mode="dark">
                <box width={40}>
                  <text>
                    <ToolLabel name="读取" params="src/routes/session/index.tsx (offset=1, limit=130)" max={max} />
                  </text>
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
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      if (app.captureCharFrame().includes("读取")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return {
      lines: () =>
        app
          .captureCharFrame()
          .split("\n")
          .map((line) => line.replace(/\s+$/, "")),
      destroy: () => app.renderer.destroy(),
    }
  } catch (error) {
    app.renderer.destroy()
    throw error
  }
}

async function renderCard(props: Mount, width = WIDTH, height = 20) {
  const app = await testRender(() => card(props), { width, height })
  const settle = async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      if (app.captureCharFrame().includes("╭")) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  await settle()
  return {
    app,
    frame: () => app.captureCharFrame(),
    lines: () =>
      app
        .captureCharFrame()
        .split("\n")
        .map((line) => line.replace(/\s+$/, "")),
    click: async (row: number, column: number) => {
      await app.mockMouse.click(column, row)
      await settle()
    },
    destroy: () => app.renderer.destroy(),
  }
}

const SUMMARY = { passed: 12, failed: 0 }

test("紧凑工具卡:边框 + head 一行,状态摘要与命令并排(不展开也能看到结论)", async () => {
  const view = await renderCard({ head: true, title: "bun test --timeout 30000", status: SUMMARY })
  try {
    const frame = view.frame()
    expect(frame).toContain("╭")
    expect(frame).toContain("╯")
    const head = view.lines().find((line) => line.includes("passed"))!
    expect(head).toContain("bun test --timeout 30000")
    expect(head).toContain("✓ 12 passed")
    // head 里有 caret 与状态图标列(原型的 `.caret` + `.tw`)
    expect(head).toContain("▸")
    expect(head).toContain("✓")
  } finally {
    view.destroy()
  }
})

test("命令首词单独染色,余下参数不是那个颜色(原型的 `.tool-head .cmd b`)", async () => {
  const view = await renderCard({ title: "bun test --timeout 30000" })
  try {
    const spans = view.app.captureSpans().lines
    const row = spans.findIndex((line) => line.spans.some((span) => span.text.includes("bun")))
    expect(row, "帧里没有 head 那一行").toBeGreaterThanOrEqual(0)
    const flat = spans[row]!.spans.map((span) => ({ text: span.text, fg: span.fg.toInts() }))
    const head = flat.find((span) => span.text === "bun")
    expect(head, `没有单独的 bun 段:${JSON.stringify(flat)}`).toBeDefined()
    expect(head!.fg).toEqual(theme.info.toInts())
    const rest = flat.find((span) => span.text.includes("test"))
    expect(rest, `没有余下参数段:${JSON.stringify(flat)}`).toBeDefined()
    expect(rest!.fg).toEqual(theme.textMuted.toInts())
    // 首词用命令色,余下参数是 muted —— 两者必须不同,否则染色没生效
    expect(head!.fg).not.toEqual(rest!.fg)
  } finally {
    view.destroy()
  }
})

test("head 上带摘要时压成一行:文案不许折行,摘要仍在同一行右端", async () => {
  const view = await renderCard({
    head: true,
    title: "读取 src/routes/session/index.tsx (offset=1, limit=130)",
    status: SUMMARY,
    oneLine: true,
  })
  try {
    const lines = view.lines()
    const top = lines.findIndex((line) => line.includes("╭"))
    const bottom = lines.findIndex((line) => line.includes("╯"))
    // 卡只有三行:上边框 / head / 下边框 —— 一条 40 多列的文案没有折行
    expect(bottom - top).toBe(2)
    const head = lines[top + 1]!
    expect(head).toContain("✓ 12 passed")
    expect(head).toContain("读取")
    // 摘要贴在卡内右缘(工具卡自己的 paddingRight 1 列 + 它右边的边框)
    expect(head.lastIndexOf("passed") + "passed".length).toBeGreaterThan(head.lastIndexOf("│") - 3)
  } finally {
    view.destroy()
  }
})

// 截断本身是 ToolLabel 做的(名字先占,剩下的给参数),所以单测它:
// 名字被截意味着连工具身份都认不出来,那比参数被截更糟。
test("ToolLabel 按 max 截断:名字优先,参数拿剩下的列,末尾留省略号", async () => {
  const view = await renderLabel(20)
  try {
    const line = view.lines().find((row) => row.includes("读取"))!
    expect(line).toContain("…")
    expect([...line].filter((char) => char === "…").length).toBe(1)
    // 20 列预算:整行(去掉首尾空白)不超过 20 列
    expect(Locale.displayWidth(line.trim())).toBeLessThanOrEqual(20)
  } finally {
    view.destroy()
  }
})

test("body 与 head 之间有一条横线规则,并被行数上限截住(原型的 max-height: 160px)", async () => {
  const many = Array.from({ length: 40 }, (_, index) => `line-${index}`).join("\n")
  const view = await renderCard({ title: "bun test", body: many, bodyRows: 40 }, WIDTH, 24)
  try {
    const lines = view.lines()
    const headRow = lines.findIndex((line) => line.includes("bun test"))
    expect(headRow).toBeGreaterThanOrEqual(0)
    // head 的下一行是那条规则(去掉卡自己的边框列之后整行都是横线)
    expect(lines[headRow + 1]!.replace(/[│\s]/g, "")).toMatch(/^[─━╍]+$/)
    // body 视口正好是上限那么多行,而不是 40 行
    const body = findScroll(view.app.renderer.root)
    expect(body?.viewport.height).toBe(TOOL_BODY_MAX_ROWS)
    // 剩下的行没丢:内容高度大于视口,所以还能滚到
    expect(body!.scrollHeight).toBeGreaterThan(body!.viewport.height)
    // 卡底边框紧跟在 body 之后
    expect(lines.findIndex((line) => line.includes("╯"))).toBe(headRow + 2 + TOOL_BODY_MAX_ROWS)
  } finally {
    view.destroy()
  }
})

test("点 head 收起 body,再点展开(点击不吃掉文本选区)", async () => {
  const view = await renderCard({ title: "bun test", body: "BODYMARK", onClick: () => {} })
  try {
    const headRow = view.lines().findIndex((line) => line.includes("bun test"))
    expect(view.frame()).toContain("BODYMARK")
    await view.click(headRow, 6)
    expect(view.frame()).not.toContain("BODYMARK")
    // 收起后 head 还在 —— 卡不会因为没有 body 就消失
    expect(view.frame()).toContain("bun test")
    await view.click(
      view.lines().findIndex((line) => line.includes("bun test")),
      6,
    )
    expect(view.frame()).toContain("BODYMARK")
  } finally {
    view.destroy()
  }
})

test("没有输出的工具仍然画出 head,caret 是禁用色且点了不动", async () => {
  const view = await renderCard({ title: "bun test", onClick: () => {} })
  try {
    const lines = view.lines()
    const headRow = lines.findIndex((line) => line.includes("bun test"))
    expect(headRow).toBeGreaterThanOrEqual(0)
    expect(lines[headRow]).toContain("▸")
    // 没有 body 就没有可展开的东西:点下去画面必须一模一样
    const before = view.frame()
    await view.click(headRow, 6)
    expect(view.frame()).toBe(before)
    // 禁用的凭据是 caret 那个颜色:不可点的 caret 用边框色,可点的用 muted
    const spans = view.app.captureSpans().lines[headRow]!.spans.map((span) => ({
      text: span.text,
      fg: span.fg.toInts(),
    }))
    expect(spans.find((span) => span.text.includes("▸"))!.fg).toEqual(theme.border.toInts())
  } finally {
    view.destroy()
  }
})
