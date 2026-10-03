/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import type { JSX } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { TuiKeybind } from "../../../src/config/keybind"
import { ArgsProvider } from "../../../src/context/args"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TuiPathsProvider, TuiStartupProvider, TuiTerminalEnvironmentProvider } from "../../../src/context/runtime"
import { NovaWayKeymapProvider, registerNovaWayKeymap } from "../../../src/keymap"
import { QueueDock } from "../../../src/routes/session/queue-dock"
import type { QueueDraft } from "../../../src/prompt/queue"

const WIDTH = 72

function draft(id: string, inputText: string): QueueDraft {
  return {
    id,
    sessionID: "ses_test",
    agent: "build",
    model: { providerID: "novaway", modelID: "big-pickle" },
    inputText,
    nonTextParts: [],
  }
}

// 折叠键那条命令(session.queued_prompts)在会话页里注册,这里挂一层同名的,
// 让这一行的两端都有键名可显示 —— 断言的是左端那个「<键>追加」。
function KeymapLayer(props: { overrides: TuiKeybind.KeybindOverrides; children: JSX.Element }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const keybinds = TuiKeybind.parse(props.overrides)
  const config = {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
  const offKeymap = registerNovaWayKeymap(keymap, renderer, config)
  const offLayer = keymap.registerLayer({
    bindings: config.keybinds.gather("session", ["session.queued_prompts"]),
  })
  onCleanup(() => {
    offLayer()
    offKeymap()
  })
  return <NovaWayKeymapProvider keymap={keymap}>{props.children}</NovaWayKeymapProvider>
}

async function renderDock(overrides: TuiKeybind.KeybindOverrides, collapsed = true) {
  const Body = () => (
    <box width={WIDTH}>
      <QueueDock
        items={[draft("q1", "把侧栏改成卡片式布局"), draft("q2", "顺手把过渡动画也统一了")]}
        collapsed={collapsed}
        onToggle={() => {}}
        onSend={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onClearAll={() => {}}
      />
    </box>
  )
  const app = await testRender(
    () => (
      <TuiPathsProvider
        value={{
          cwd: "/tmp/NovaWay/packages/tui",
          home: "/tmp/NovaWay/home",
          state: "/tmp/NovaWay/state",
          worktree: "/tmp/NovaWay",
        }}
      >
        <TuiTerminalEnvironmentProvider value={{ platform: "linux" }}>
          <TuiStartupProvider value={{ skipInitialLoading: true }}>
            <TuiConfigProvider config={createTuiResolvedConfig({ keybinds: overrides })}>
              <ArgsProvider>
                <KVProvider>
                  <ThemeProvider mode="dark">
                    <KeymapLayer overrides={overrides}>
                      <Body />
                    </KeymapLayer>
                  </ThemeProvider>
                </KVProvider>
              </ArgsProvider>
            </TuiConfigProvider>
          </TuiStartupProvider>
        </TuiTerminalEnvironmentProvider>
      </TuiPathsProvider>
    ),
    { width: WIDTH, height: 10 },
  )
  try {
    let lines: string[] = []
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      lines = app.captureCharFrame().split("\n")
      if (lines.some((line) => line.includes("条排队消息"))) return lines
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error("渲染未在 40 轮内就绪,实际帧:" + JSON.stringify(lines.slice(0, 4)))
  } finally {
    app.renderer.destroy()
  }
}

const titleRow = (lines: string[]) => lines.find((line) => line.includes("条排队消息"))!

test("排队提示:折叠态那一行是「⇧ N 条排队消息 · <键>追加 · 预览」", async () => {
  const row = titleRow(await renderDock({}))
  expect(row).toContain("⇧")
  expect(row).toContain("2 条排队消息")
  // 键名来自 input.submit 的真实绑定(默认 return → formatKeySequence 给 "enter")
  expect(row).toContain("· enter 追加")
  expect(row).toContain("把侧栏改成卡片式布局")
})

test("排队提示:追加提示里的键跟着绑定走,不是写死的 enter", async () => {
  const row = titleRow(await renderDock({ input_submit: "ctrl+s" }))
  expect(row).toContain("· ctrl+s 追加")
  expect(row).not.toContain("enter")
})

test("排队提示:展开态那一行也带着键与追加提示", async () => {
  const row = titleRow(await renderDock({}, false))
  expect(row).toContain("⇧")
  expect(row).toContain("2 条排队消息")
  expect(row).toContain("· enter 追加")
  expect(row).toContain("将按顺序自动发送")
})

test("排队提示:一条时用单数文案,键与追加提示仍在", async () => {
  const app = await testRender(
    () => (
      <TuiPathsProvider
        value={{
          cwd: "/tmp/NovaWay/packages/tui",
          home: "/tmp/NovaWay/home",
          state: "/tmp/NovaWay/state",
          worktree: "/tmp/NovaWay",
        }}
      >
        <TuiTerminalEnvironmentProvider value={{ platform: "linux" }}>
          <TuiStartupProvider value={{ skipInitialLoading: true }}>
            <TuiConfigProvider config={createTuiResolvedConfig()}>
              <ArgsProvider>
                <KVProvider>
                  <ThemeProvider mode="dark">
                    <KeymapLayer overrides={{}}>
                      <box width={WIDTH}>
                        <QueueDock
                          items={[draft("q1", "只有一条")]}
                          collapsed={true}
                          onToggle={() => {}}
                          onSend={() => {}}
                          onEdit={() => {}}
                          onDelete={() => {}}
                          onClearAll={() => {}}
                        />
                      </box>
                    </KeymapLayer>
                  </ThemeProvider>
                </KVProvider>
              </ArgsProvider>
            </TuiConfigProvider>
          </TuiStartupProvider>
        </TuiTerminalEnvironmentProvider>
      </TuiPathsProvider>
    ),
    { width: WIDTH, height: 10 },
  )
  try {
    let row = ""
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      row =
        app
          .captureCharFrame()
          .split("\n")
          .find((line) => line.includes("条排队消息")) ?? ""
      if (row) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(row).toContain("1 条排队消息")
    expect(row).toContain("· enter 追加")
  } finally {
    app.renderer.destroy()
  }
})
