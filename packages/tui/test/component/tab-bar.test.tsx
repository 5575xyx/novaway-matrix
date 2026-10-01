/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { ArgsProvider } from "../../src/context/args"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { TabBar } from "../../src/component/tab-bar"

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
