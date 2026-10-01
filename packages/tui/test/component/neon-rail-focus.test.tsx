/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import type { TextareaRenderable } from "@opentui/core"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider, useTheme } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { ArgsProvider } from "../../src/context/args"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { NeonRail } from "../../src/component/neon-rail"
import { neonStops } from "../../src/ui/neon"

// 契约守卫:on:focused/on:blurred 的事件名不进类型校验(on:${string} 接受任意字符串),
// opentui 若重命名事件,输入框聚焦导轨会静默失效且 typecheck 无感。此测试用与
// prompt/index.tsx 相同的接线做最小合成渲染,锁住该事件契约。
let captured: TextareaRenderable | undefined

function FocusHarness() {
  const { theme } = useTheme()
  const [focused, setFocused] = createSignal(false)
  return (
    <box width="100%" flexDirection="column">
      <Show when={focused()}>
        <NeonRail stops={neonStops(theme)} animated />
      </Show>
      <textarea
        width="100%"
        minHeight={1}
        placeholder="focus-guard"
        placeholderColor={theme.textMuted}
        ref={(r: TextareaRenderable) => {
          captured = r
        }}
        on:focused={() => setFocused(true)}
        on:blurred={() => setFocused(false)}
      />
    </box>
  )
}

test("输入框聚焦事件挂载霓虹导轨,失焦移除", async () => {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <ArgsProvider>
            <KVProvider>
              <ThemeProvider mode="dark">
                <FocusHarness />
              </ThemeProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 40, height: 4 },
  )
  try {
    // 文本域确实渲染了(占位符可见),测试非空转。
    let frame = ""
    for (let attempt = 0; attempt < 60; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (captured && frame.includes("focus-guard")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(captured).toBeDefined()
    expect(frame).toContain("focus-guard")
    expect(frame).not.toContain("━")

    // 聚焦 → 导轨随 on:focused 挂载。
    captured!.focus()
    for (let attempt = 0; attempt < 60 && !frame.includes("━"); attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(frame).toContain("━")

    // 失焦 → 导轨随 on:blurred 移除。
    captured!.blur()
    for (let attempt = 0; attempt < 60 && frame.includes("━"); attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(frame).not.toContain("━")
  } finally {
    app.renderer.destroy()
  }
})
