/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { onCleanup, type JSX } from "solid-js"

import { DialogSelect } from "../../src/ui/dialog-select"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { ArgsProvider } from "../../src/context/args"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"
import { NovaWayKeymapProvider, registerNovaWayKeymap } from "../../src/keymap"

import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

// DialogSelect 的 action 标签来自键位表(getCommandBindings → formatKeyBindings),
// 不注册这一层的话 actionLabels() 全是空串,visibleActions() 会把 action 全滤掉 ——
// 那样即便 TDZ 还在也测不出来,所以这里照 prompt-card.test.tsx 的做法注册一层真键位。
function KeymapContexts(props: { commands: string[]; children: JSX.Element }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const keybinds = TuiKeybind.toBindingConfig(TuiKeybind.parse({}))
  const config = {
    keybinds: createBindingLookup(keybinds, {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
  const offKeymap = registerNovaWayKeymap(keymap, renderer, config)
  const offLayer = keymap.registerLayer({
    commands: props.commands.map((name) => ({ name, run() {} })),
    bindings: config.keybinds.gather("test.dialog", props.commands),
  })
  onCleanup(() => {
    offLayer()
    offKeymap()
  })
  return <NovaWayKeymapProvider keymap={keymap}>{props.children}</NovaWayKeymapProvider>
}

async function renderSelect(props: { commands: string[]; body: () => JSX.Element }) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <ArgsProvider>
            <KVProvider>
              <ToastProvider>
                <ThemeProvider mode="dark">
                  <KeymapContexts commands={props.commands}>
                    <DialogProvider>{props.body()}</DialogProvider>
                  </KeymapContexts>
                </ThemeProvider>
              </ToastProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 12 },
  )
  try {
    let frame = ""
    for (let attempt = 0; attempt < 200; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes("one") || frame.includes("one.ts")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return frame
  } finally {
    app.renderer.destroy()
  }
}

const OPTIONS = [{ title: "one.ts", value: "one" }]

// actionItems 这个 memo 在 createMemo 首帧就求值,里面调的 isActionDisabled 会读 selected()。
// selected 原本声明在 actionItems 之后,于是「disabled 是函数」的那种 action 一挂载就撞 TDZ
// (Cannot access 'selected' before initialization)——dialog-move-session 的「删除」action
// 正是这种写法。首帧不崩的条件只有一个:那次求值里一条 action 都没剩。
test("DialogSelect:action 的 disabled 是函数时也能挂载(不动 selected 的 TDZ)", async () => {
  const frame = await renderSelect({
    commands: ["dialog.move_session.delete"],
    body: () => (
      <DialogSelect
        title="移动"
        options={OPTIONS}
        actions={[
          {
            command: "dialog.move_session.delete",
            title: "删除",
            disabled: (option) => option?.value !== "one",
            onTrigger: () => {},
          },
        ]}
      />
    ),
  })
  expect(frame).toContain("删除")
})
