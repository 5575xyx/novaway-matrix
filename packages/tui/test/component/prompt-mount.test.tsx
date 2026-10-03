/** @jsxImportSource @opentui/solid */
import { afterAll, expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { onCleanup, type JSX } from "solid-js"
import fs from "fs"
import os from "os"
import path from "path"

import { Prompt } from "../../src/component/prompt"
import { Home } from "../../src/routes/home"
import { ArgsProvider } from "../../src/context/args"
import { ClipboardProvider } from "../../src/context/clipboard"
import { DataProvider } from "../../src/context/data"
import { EditorContextProvider } from "../../src/context/editor"
import { ExitProvider } from "../../src/context/exit"
import { KVProvider } from "../../src/context/kv"
import { LocalProvider } from "../../src/context/local"
import { LocationProvider } from "../../src/context/location"
import { PermissionProvider } from "../../src/context/permission"
import { ProjectProvider } from "../../src/context/project"
import { PromptRefProvider } from "../../src/context/prompt"
import { RouteProvider } from "../../src/context/route"
import { SDKProvider } from "../../src/context/sdk"
import { SyncProvider } from "../../src/context/sync"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"
import { NovaWayKeymapProvider, registerNovaWayKeymap } from "../../src/keymap"
import { PluginRuntimeProvider, createPluginRuntime } from "../../src/plugin/runtime"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { FrecencyProvider } from "../../src/prompt/frecency"
import { PromptHistoryProvider } from "../../src/prompt/history"
import { PromptStashProvider } from "../../src/prompt/stash"

import { createEventSource, createFetch, directory } from "../fixture/tui-sdk"
import { createTuiPluginApi } from "../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

function KeymapContexts(props: { children: JSX.Element }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse({})), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
  const off = registerNovaWayKeymap(keymap, renderer, config)
  onCleanup(off)
  return <NovaWayKeymapProvider keymap={keymap}>{props.children}</NovaWayKeymapProvider>
}

// KV / prompt history / stash / frecency 都往 paths.state 落盘。fixture 默认的
// /tmp/NovaWay/state 在 Windows 上不存在,会刷一串 ENOENT;这里给一个真实临时目录,
// 整轮测完删掉 —— 不去动任何共享路径。
let state: string | undefined
function stateDir() {
  if (state) return state
  state = fs.mkdtempSync(path.join(os.tmpdir(), "novaway-tui-prompt-"))
  // KVProvider 直接把「读不到」打在 console.error 上,先铺一个空文件让它安静下来
  fs.writeFileSync(path.join(state, "kv.json"), "{}")
  return state
}

afterAll(() => {
  if (!state) return
  fs.rmSync(state, { recursive: true, force: true })
  state = undefined
})

// app.tsx 里围在 <Prompt> 外面的整串 provider(testRender 版)。顺序照抄 src/app.tsx:265-367 ——
// 少挂一层不会「安静地少点东西」,而是会以 xxx context must be used within a context provider
// 报出来,把测试的注意力引到错的行上。
function PromptMount(props: { children: JSX.Element }) {
  const events = createEventSource()
  const { fetch } = createFetch(undefined, events)
  const runtime = createPluginRuntime()
  // 生产里 app.tsx 通过 props.pluginHost.start(...) 触发 setupSlots;不接上这一下,
  // 每个 <Slot> 都渲染 null —— 首页的 <Prompt> 就挂在 home_prompt 这个 slot 里(slot 空 → 提示不画)。
  runtime.setupSlots({ ...createTuiPluginApi(), renderer: useRenderer() })
  return (
    <TestTuiContexts directory={directory} paths={{ state: stateDir() }}>
      <ClipboardProvider>
        <KeymapContexts>
          <ExitProvider exit={() => {}}>
            <ArgsProvider>
              <KVProvider>
                <ToastProvider>
                  <RouteProvider>
                    <TuiConfigProvider config={createTuiResolvedConfig()}>
                      <PluginRuntimeProvider value={runtime}>
                        <SDKProvider
                          url="http://localhost:1"
                          directory={directory}
                          fetch={fetch}
                          events={events.source}
                        >
                          <PermissionProvider>
                            <ProjectProvider>
                              <SyncProvider>
                                <DataProvider>
                                  <ThemeProvider mode="dark">
                                    <LocalProvider>
                                      <PromptStashProvider>
                                        <DialogProvider>
                                          <FrecencyProvider>
                                            <PromptHistoryProvider>
                                              <PromptRefProvider>
                                                <EditorContextProvider>
                                                  <LocationProvider>{props.children}</LocationProvider>
                                                </EditorContextProvider>
                                              </PromptRefProvider>
                                            </PromptHistoryProvider>
                                          </FrecencyProvider>
                                        </DialogProvider>
                                      </PromptStashProvider>
                                    </LocalProvider>
                                  </ThemeProvider>
                                </DataProvider>
                              </SyncProvider>
                            </ProjectProvider>
                          </PermissionProvider>
                        </SDKProvider>
                      </PluginRuntimeProvider>
                    </TuiConfigProvider>
                  </RouteProvider>
                </ToastProvider>
              </KVProvider>
            </ArgsProvider>
          </ExitProvider>
        </KeymapContexts>
      </ClipboardProvider>
    </TestTuiContexts>
  )
}

async function renderMount(
  body: () => JSX.Element,
  options: { width: number; height: number },
  ready: (text: string) => boolean,
) {
  const app = await testRender(() => <PromptMount>{body()}</PromptMount>, options)
  let text = ""
  for (let attempt = 0; attempt < 200; attempt++) {
    await app.renderOnce()
    text = app.captureCharFrame()
    if (ready(text)) return app
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  app.renderer.destroy()
  throw new Error("渲染未在 200 轮内就绪,实际帧:\n" + text)
}

// 真挂载 Prompt(不是抽出来的 PromptCard 壳)。这条存在的理由就是它能兜住「组件一挂载就崩」:
// canSend 这个 memo 曾经在 createStore 之前读 store.prompt.input,createMemo 首帧求值撞 TDZ,
// `bun dev` 起手即崩(Cannot access 'store' before initialization)——而当时全套 612 个测试
// 因为只挂 PromptCard/PromptHints/PromptSend 这几个壳,没有一个真的把 Prompt 挂起来过。
test("Prompt:真组件挂载不抛,输入卡的霓虹描边与发送按钮都在画面上", async () => {
  const app = await renderMount(
    () => <Prompt />,
    { width: 80, height: 20 },
    (text) => text.includes("发送"),
  )
  try {
    const text = app.captureCharFrame()
    expect(text).toContain("╭")
    expect(text).toContain("发送")
  } finally {
    app.renderer.destroy()
  }
})

// 目录在整个底部区域**只出现一次**,在会话页底栏(routes/session/footer.tsx)里。
// 这一行原来印的是 `location()?.directory ?? paths.cwd`,和底栏的 path.get().directory
// 是同一个目录(服务端 Session.createNext 的两个调用方都传 InstanceState.context.directory),
// 屏幕上于是上下叠着两条一模一样的路径。
//
// 这条特意用「sync 里没有这个会话」的 sessionID:那时 location() 是 undefined,旧实现会退到
// paths.cwd(测试 fixture 里就是 fixture 的 directory),所以断言对「打了任何一条路径」都成立,
// 不依赖会话数据。
test("Prompt:带 sessionID 挂载时,输入卡下的状态行不再打印目录路径", async () => {
  const app = await renderMount(
    () => <Prompt sessionID="ses_test" />,
    { width: 80, height: 20 },
    (text) => text.includes("发送"),
  )
  try {
    const rows = app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
    const border = rows.findIndex((line) => line.includes("╯"))
    expect(border).toBeGreaterThanOrEqual(0)
    // 状态行在卡片下边框之下(见 prompt/index.tsx 的状态行布局)。那一段里不该有任何路径形态
    // 的文本:既没有实例目录,也没有「/」开头的相对路径。
    const status = rows.slice(border + 1)
    expect(status.join("\n")).not.toContain(directory)
    expect(status.some((line) => line.includes("/"))).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

// 同一串 provider 下面再挂一次首页路由本身:`bun dev` 起手画的就是这棵树,而崩就崩在它
// 渲染 <Prompt> 的那一帧上(home_prompt 那个 slot 的默认内容就是 Prompt)。
// slot 不接 setupSlots 的话它渲染 null,这条会假通过 —— PromptMount 里那一步是这条成立的前提。
test("首页:整棵 home 树挂载不抛,输入卡在画面上", async () => {
  const app = await renderMount(
    () => <Home />,
    { width: 120, height: 40 },
    (text) => text.includes("发送"),
  )
  try {
    const text = app.captureCharFrame()
    expect(text).toContain("发送")
    expect(text).toContain("╭")
  } finally {
    app.renderer.destroy()
  }
})
