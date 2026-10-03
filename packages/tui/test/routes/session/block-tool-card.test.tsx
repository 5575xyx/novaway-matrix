/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { testRender } from "@opentui/solid"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { BlockTool } from "../../../src/routes/session"
import type { ToolStatusSummary } from "../../../src/util/tool-display"

// 真实 BlockTool 的卡片化回归:neonbox 渐变边框(╭…╯)必须和文本内容同帧出现,
// 防止边框盖掉子内容(或反之)。手写 fixture 快照测不到真实组件,这里补上。
test("BlockTool 渲染霓虹卡片边框且不盖住内容", async () => {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <ArgsProvider>
            <KVProvider>
              <ThemeProvider mode="dark">
                <BlockTool title="# 测试标题">
                  <text>卡片内容占位</text>
                </BlockTool>
              </ThemeProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 40, height: 6 },
  )
  try {
    let frame = ""
    for (let attempt = 0; attempt < 10; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes("卡片内容占位") && frame.includes("╭")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(frame).toContain("╭")
    expect(frame).toContain("╯")
    expect(frame).toContain("测试标题")
    expect(frame).toContain("卡片内容占位")
  } finally {
    app.renderer.destroy()
  }
})

// ── 工具卡 head 行的状态摘要(任务 C3)──────────────────────────────────────

const SUMMARY: ToolStatusSummary = { passed: 12, failed: 0 }

function mountTool(props: { title?: string; status?: ToolStatusSummary; headWidth?: number; body?: string }) {
  return (
    <TestTuiContexts>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <ArgsProvider>
          <KVProvider>
            <ThemeProvider mode="dark">
              <BlockTool title={props.title} status={props.status} headWidth={props.headWidth} onClick={undefined}>
                <text>{props.body ?? "输出正文占位"}</text>
              </BlockTool>
            </ThemeProvider>
          </KVProvider>
        </ArgsProvider>
      </TuiConfigProvider>
    </TestTuiContexts>
  )
}

async function renderTool(node: () => JSX.Element, width: number, height = 8) {
  const app = await testRender(() => node(), { width, height })
  try {
    let frame = ""
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes("╭") && frame.includes("输出正文占位")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return frame
  } finally {
    app.renderer.destroy()
  }
}

const rows = (frame: string) =>
  frame
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim().length > 0)

test("状态摘要与标题并排在 head 那一行,且不受输出折叠与否影响", async () => {
  const frame = await renderTool(() => mountTool({ title: "# Running in app", status: SUMMARY }), 60)
  const head = rows(frame).find((row) => row.includes("passed"))
  expect(head, `帧里没有摘要行:\n${frame}`).toBeDefined()
  expect(head).toContain("Running in app")
  expect(head).toContain("✓ 12 passed")
  // 失败段在 head 右侧
  const failed = await renderTool(() => mountTool({ title: "# t", status: { passed: 1, failed: 3 } }), 60)
  const failedRow = rows(failed).find((row) => row.includes("failed"))
  expect(failedRow).toContain("✓ 1 passed")
  expect(failedRow).toContain("· 3 failed")
})

test("没有状态摘要时 head 上不出现任何通过/失败字样(不写假信息)", async () => {
  const frame = await renderTool(() => mountTool({ title: "# Running in app" }), 60)
  expect(frame).toContain("Running in app")
  expect(frame).not.toContain("passed")
  expect(frame).not.toContain("failed")
})

test("既没有标题也没有摘要时 head 仍然画(caret + 图标),正文紧跟在分隔线下面", async () => {
  const frame = await renderTool(() => mountTool({}), 60)
  const rows_ = rows(frame)
  // 卡内第一行是上边框,第二行是 head —— head 永远在,工具不会因为没有标题/摘要就整张卡都不画。
  // (改造前这里是「head 整行不画」:那正是「工具输出读起来是一片没有层次的纯文本」的成因之一。)
  expect(rows_[1]).toMatch(/▸/)
  expect(rows_[1]).toContain("⚙")
  // 第三行是 body 与 head 之间那条分隔线,第四行才是正文
  expect(rows_[2]!.replace(/[│\s]/g, "")).toMatch(/^[─━╍]+$/)
  const content = rows_.find((row) => row.includes("输出正文占位"))
  expect(content).toBeDefined()
  expect(rows_.indexOf(content!)).toBe(3)
})

test("窄终端下摘要整段留着,标题按显示列截断并留省略号", async () => {
  const frame = await renderTool(
    () => mountTool({ title: "# Running in /home/user/novaway/packages/novaway", status: SUMMARY, headWidth: 20 }),
    60,
  )
  const head = rows(frame).find((row) => row.includes("passed"))!
  expect(head).toContain("✓ 12 passed")
  expect(head).toContain("…")
  expect(head).not.toContain("packages/novaway")
})
