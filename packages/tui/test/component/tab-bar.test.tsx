/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { ArgsProvider } from "../../src/context/args"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { TabBar } from "../../src/component/tab-bar"
import { NeonRail } from "../../src/component/neon-rail"

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
