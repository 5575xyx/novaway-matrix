/** @jsxImportSource @opentui/solid */
//
// 工作区与 keymap 的接线测试:tab/shift+tab 必须切面板,不能被全局 agent.cycle(切代理)抢走。
// 背景:keymap host 用 prependListener 抢在所有 useKeyboard 前面,命中 binding 后直接
// stopPropagation —— 所以光在工作区里 preventDefault 拦不住,必须在 keymap 层面赢下同键冲突。
import { expect, test } from "bun:test"
import { KeyEvent } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup, type JSX } from "solid-js"
import { GitWorkspace } from "../../src/component/git-workspace"
import { TuiConfigProvider } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { NovaWay_BASE_MODE, NovaWayKeymapProvider, registerNovaWayKeymap } from "../../src/keymap"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

// agent.cycle 被 keymap 执行的次数。工作区活着时必须是 0 —— 按 tab 只许切面板。
const agentRuns = { count: 0 }

/** 模拟 app.tsx 启动时注册的 agent.cycle 层(mode: base)+ 命令本体,顺序也照抄:先于工作区注册。 */
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
  const offKeymap = registerNovaWayKeymap(keymap, renderer, config)
  const offAgent = keymap.registerLayer({
    mode: NovaWay_BASE_MODE,
    commands: [
      {
        name: "agent.cycle",
        run() {
          agentRuns.count += 1
        },
      },
      {
        name: "agent.cycle.reverse",
        run() {
          agentRuns.count += 1
        },
      },
    ],
    bindings: config.keybinds.gather("app", ["agent.cycle", "agent.cycle.reverse"]),
  })
  onCleanup(() => {
    offAgent()
    offKeymap()
  })
  return <NovaWayKeymapProvider keymap={keymap}>{props.children}</NovaWayKeymapProvider>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 取一帧;空帧(还没画出来)就重试几轮 —— 和 git-workspace.test.tsx 的 renderWorkspace 同款。 */
async function captureFrame(app: Awaited<ReturnType<typeof testRender>>) {
  await app.renderOnce()
  await sleep(25)
  await app.renderOnce()
  for (let attempt = 0; attempt < 5; attempt++) {
    const frame = app.captureCharFrame()
    if (frame.trim().length > 0) return frame
    await sleep(25)
    await app.renderOnce()
  }
  return app.captureCharFrame()
}

/** 造一个 opentui 键事件并从 keyInput 派发 —— keymap 与 useKeyboard 都挂在同一个发射器上。 */
function pressKey(
  renderer: { keyInput: { emit(event: string, payload: KeyEvent): void } },
  name: string,
  shift = false,
) {
  renderer.keyInput.emit(
    "keypress",
    new KeyEvent({
      name,
      ctrl: false,
      meta: false,
      shift,
      option: false,
      sequence: "",
      number: false,
      raw: "",
      eventType: "press",
      source: "raw",
    }),
  )
}

test("tab/shift+tab 切工作区面板,不被 agent.cycle 抢走", async () => {
  agentRuns.count = 0
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <KeymapContexts>
                <GitWorkspace rootPath={process.cwd()} onClose={() => {}} width={100} />
              </KeymapContexts>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30 },
  )
  try {
    // 边框化之后聚焦色在字符帧里看不见,焦点改从**键位条焦点段**辨认:
    // status 段有「作用于当前行」,files 段有「全部暂存」,段落跟着 panel() 走。
    expect(await captureFrame(app)).toContain("作用于当前行")

    pressKey(app.renderer, "tab")
    expect(await captureFrame(app)).toContain("全部暂存")

    pressKey(app.renderer, "tab", true)
    expect(await captureFrame(app)).toContain("作用于当前行")

    // 整个过程中 tab 不许落到切代理上。
    expect(agentRuns.count).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})
