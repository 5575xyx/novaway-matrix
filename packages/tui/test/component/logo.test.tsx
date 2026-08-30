/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import { Logo } from "../../src/component/logo"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"

describe("Logo 大字 wordmark", () => {
  test("NOVA+WAY 像素画,除首行留白外恰好三行实心像素", async () => {
    const frame = await renderFrame(() => <Logo />)
    const lines = frame.split("\n").filter((line) => line.trim())
    expect(lines).toHaveLength(3)
    // 末行是像素画的底部描边,只有 ▀ 没有 █,所以对整幅画面断言
    expect(lines.join("\n")).toContain("█")
  })
})

async function renderFrame(component: () => JSX.Element) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">{component()}</ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 6 },
  )
  try {
    await app.renderOnce()
    let frame = app.captureCharFrame()
    for (let attempt = 0; attempt < 5; attempt++) {
      // wordmark 是逐字渲染的像素画,首帧可能是空的;等到实心像素出现再断言
      if (frame.includes("█")) return frame
      await new Promise((resolve) => setTimeout(resolve, 25))
      await app.renderOnce()
      frame = app.captureCharFrame()
    }
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}
