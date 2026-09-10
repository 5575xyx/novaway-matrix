/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { SDKProvider } from "../../src/context/sdk"
import { PermissionProvider } from "../../src/context/permission"
import { ProjectProvider } from "../../src/context/project"
import { ExitProvider } from "../../src/context/exit"
import { SyncProvider } from "../../src/context/sync"
import { ArgsProvider } from "../../src/context/args"
import { PluginRuntimeProvider, createPluginRuntime } from "../../src/plugin/runtime"
import { Sidebar } from "../../src/routes/session/sidebar"
import { workbenchOptions } from "../../src/component/dialog-workbench"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createFetch, eventSource } from "../fixture/tui-sdk"

test("工具工作台按数据与智能中枢分组选项", async () => {
  let options: ReturnType<typeof workbenchOptions> = []
  const app = await testRender(
    () => {
      options = workbenchOptions()
      return <text>{options.map((option) => option.title).join(" ")}</text>
    },
    { width: 80, height: 5 },
  )

  try {
    await app.renderOnce()
    expect(options).toHaveLength(7)
    expect(options[0]).toMatchObject({ value: "data", category: "数据", title: "数据" })
    expect(options.slice(1).every((option) => option.category === "智能中枢")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

// 标签行照旧渲染,会话专属内容(标题、检查点/目标/工作流/编排)跳过,不崩。
test("侧栏在无会话时渲染标签行,跳过会话专属内容", async () => {
  const runtime = createPluginRuntime()

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <ArgsProvider>
            <KVProvider>
              <SDKProvider
                url="http://test"
                directory="/tmp/NovaWay/packages/tui"
                fetch={createFetch().fetch}
                events={eventSource()}
              >
                <PermissionProvider>
                  <ProjectProvider>
                    <ExitProvider exit={() => {}}>
                      <SyncProvider>
                        <ThemeProvider mode="dark">
                          <PluginRuntimeProvider value={runtime}>
                            <Sidebar />
                          </PluginRuntimeProvider>
                        </ThemeProvider>
                      </SyncProvider>
                    </ExitProvider>
                  </ProjectProvider>
                </PermissionProvider>
              </SDKProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 10 },
  )

  try {
    let frame = ""
    for (let attempt = 0; attempt < 10; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      // 等 sync 拉完、标签行画出来
      if (frame.includes("待办与统计") && frame.includes("Git")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(frame).toContain("待办与统计")
    expect(frame).toContain("文件")
    expect(frame).toContain("Git")
    expect(frame).not.toContain("智能中枢")
    expect(frame).not.toContain("数据")
  } finally {
    app.renderer.destroy()
  }
})
