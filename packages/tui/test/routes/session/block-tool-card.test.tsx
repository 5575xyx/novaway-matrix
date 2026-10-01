/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { BlockTool } from "../../../src/routes/session"

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
