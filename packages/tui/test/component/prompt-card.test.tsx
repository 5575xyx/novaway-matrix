/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { onCleanup, type ParentProps, type JSX } from "solid-js"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import type { CapturedFrame } from "@opentui/core"
import { ArgsProvider } from "../../src/context/args"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"
import { NovaWayKeymapProvider, formatKeySequence, registerNovaWayKeymap, type OpenTuiKeymap } from "../../src/keymap"
import { PromptCard, PromptHints, PromptSend } from "../../src/component/prompt/card"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

// 提示行要读 agent.cycle / command.palette.show / input.newline 的实际键位。这些命令在生产里
// 由 app.tsx 的 appBindingCommands(前两个)和 keymap.tsx 的 input 托管层(换行)注册
// (见 src/app.tsx:116-151、src/keymap.tsx:230-233)。这里照那两处挂上去 ——
// 不注册的话 useCommandShortcut 拿到空字符串,"键位提示在" 这条断言就会假通过。
type KeymapConfig = ReturnType<typeof createResolvedKeymapConfig>

function createResolvedKeymapConfig(input: TuiKeybind.KeybindOverrides = {}) {
  const keybinds = TuiKeybind.parse(input)
  return {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
}

// 故意改掉默认键位(tab / ctrl+p)。这样「提示行写死了默认键位」的实现一定会被断言打红。
const OVERRIDES: TuiKeybind.KeybindOverrides = {
  agent_cycle: "ctrl+t",
  command_list: "ctrl+g",
}

let mounted: { keymap: OpenTuiKeymap; config: KeymapConfig } | undefined

function KeymapContexts(props: ParentProps) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createResolvedKeymapConfig(OVERRIDES)
  const offKeymap = registerNovaWayKeymap(keymap, renderer, config)
  const offLayer = keymap.registerLayer({
    commands: [
      { name: "command.palette.show", run() {} },
      { name: "agent.cycle", run() {} },
    ],
    bindings: config.keybinds.gather("test.app", ["command.palette.show", "agent.cycle"]),
  })
  mounted = { keymap, config }
  onCleanup(() => {
    mounted = undefined
    offLayer()
    offKeymap()
  })
  return <NovaWayKeymapProvider keymap={keymap}>{props.children}</NovaWayKeymapProvider>
}

// 与 useCommandShortcut 内部同一条路径(getCommandBindings → formatKeySequence),但在组件之外
// 独立算一遍:期望值不该由被测组件自己提供。
function expectedShortcut(command: string) {
  const value = mounted
  if (!value) return ""
  const bindings = value.keymap.getCommandBindings({ visibility: "registered", commands: [command] }).get(command)
  return formatKeySequence(bindings?.[0]?.sequence, value.config)
}

async function renderCard(
  body: () => JSX.Element,
  options: { width: number; height: number },
  ready: (frame: string) => boolean,
) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig({ keybinds: OVERRIDES })}>
          <ArgsProvider>
            <KVProvider>
              <ThemeProvider mode="dark">
                <KeymapContexts>{body()}</KeymapContexts>
              </ThemeProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    options,
  )
  return app
}

function lines(app: { captureCharFrame(): string }) {
  return app
    .captureCharFrame()
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
}

function frame(app: { captureCharFrame(): string }) {
  return lines(app).join("\n")
}

// testRender 之后字体(CJK 字形)是异步就绪的,单次 renderOnce 拿到的必然是半截帧 ——
// 在半截帧上断言只会让报错指向错误的行,所以先等 ready 成立再断言。
async function renderReady(
  body: () => JSX.Element,
  options: { width: number; height: number },
  ready: (text: string) => boolean,
) {
  const app = await renderCard(body, options, ready)
  let text = ""
  for (let attempt = 0; attempt < 200; attempt++) {
    await app.renderOnce()
    text = frame(app)
    if (ready(text)) return app
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  app.renderer.destroy()
  throw new Error("渲染未在 200 轮内就绪,实际帧:\n" + text)
}

function rowCells(value: CapturedFrame, row: number) {
  const line = value.lines[row]
  if (!line) return []
  return line.spans.flatMap((span) =>
    [...span.text].map((ch) => ({
      ch,
      cell: `${span.fg.r.toFixed(4)},${span.fg.g.toFixed(4)},${span.fg.b.toFixed(4)}`,
    })),
  )
}

function topBorder(value: CapturedFrame) {
  const cells = rowCells(value, 0)
  const start = cells.findIndex((item) => item.ch === "╭")
  const end = cells.findIndex((item) => item.ch === "╮")
  if (start < 0 || end < start) return []
  return cells.slice(start, end + 1)
}

const WIDTH = 60

function card(focused: boolean, model = "big-pickle", canSend = true) {
  return () => (
    <PromptCard focused={focused}>
      <box width="100%">
        <text>ASK</text>
      </box>
      <PromptHints />
      <PromptSend model={model} canSend={canSend} onSend={() => {}} />
    </PromptCard>
  )
}

test("输入卡:霓虹描边画出圆角边框,内容在边框内侧", async () => {
  const app = await renderReady(card(false), { width: WIDTH, height: 10 }, (text) => text.includes("ASK"))
  try {
    const text = lines(app)
    expect(text[0]).toContain("╭")
    expect(text.some((line) => line.includes("╯"))).toBe(true)
    expect(text.some((line) => line.includes("ASK"))).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("输入卡:发送按钮与模型芯片在卡片内", async () => {
  const app = await renderReady(card(false), { width: WIDTH, height: 10 }, (text) => text.includes("发送"))
  try {
    const text = frame(app)
    expect(text).toContain("发送")
    expect(text).toContain("◆ big-pickle")
  } finally {
    app.renderer.destroy()
  }
})

test("输入卡:focused 时描边流动 —— 两次渲染之间边框颜色变化", async () => {
  const app = await renderReady(card(true), { width: WIDTH, height: 10 }, (text) => text.includes("ASK"))
  try {
    const before = topBorder(app.captureSpans())
    await new Promise((resolve) => setTimeout(resolve, 200))
    await app.renderOnce()
    const after = topBorder(app.captureSpans())
    expect(after.map((item) => item.ch)).toEqual(before.map((item) => item.ch))
    expect(after.map((item) => item.cell)).not.toEqual(before.map((item) => item.cell))
  } finally {
    app.renderer.destroy()
  }
})

test("输入卡:失焦时描边静止 —— 两次渲染之间边框颜色不变", async () => {
  const app = await renderReady(card(false), { width: WIDTH, height: 10 }, (text) => text.includes("ASK"))
  try {
    const before = topBorder(app.captureSpans())
    await new Promise((resolve) => setTimeout(resolve, 200))
    await app.renderOnce()
    expect(topBorder(app.captureSpans())).toEqual(before)
  } finally {
    app.renderer.destroy()
  }
})

// 提示行的键位提示必须现取:期望值在组件之外按 useCommandShortcut 的同一条路径算出,
// 而测试故意把 agent.cycle / command.palette.show 改成了 ctrl+t / ctrl+g ——
// 写死 "tab" / "ctrl+p" 的实现会被打红。
test("输入卡:提示行的键位文案与 useCommandShortcut 一致", async () => {
  const app = await renderReady(
    () => (
      <PromptCard focused={false}>
        <PromptHints />
      </PromptCard>
    ),
    { width: WIDTH, height: 10 },
    (text) => text.includes("agents"),
  )
  try {
    const agent = expectedShortcut("agent.cycle")
    const palette = expectedShortcut("command.palette.show")
    const newline = expectedShortcut("input.newline")
    expect(agent).toBe("ctrl+t")
    expect(palette).toBe("ctrl+g")
    expect(newline).not.toBe("")
    const text = frame(app)
    expect(text).toContain(`${agent} agents`)
    expect(text).toContain(`${palette} commands`)
    expect(text).toContain(`${newline} 换行`)
  } finally {
    app.renderer.destroy()
  }
})

test("输入卡:shell 模式的提示行把 agents/commands 换成 esc exit shell mode", async () => {
  const app = await renderReady(
    () => (
      <PromptCard focused={false}>
        <PromptHints shell={true} />
      </PromptCard>
    ),
    { width: WIDTH, height: 10 },
    (text) => text.includes("exit shell mode"),
  )
  try {
    const text = frame(app)
    expect(text).toContain("esc exit shell mode")
    expect(text).not.toContain("agents")
  } finally {
    app.renderer.destroy()
  }
})

test("输入卡:模型芯片按终端宽截断,不给它挤掉输入框的宽度", async () => {
  const app = await renderReady(card(false, "m".repeat(200)), { width: WIDTH, height: 10 }, (text) =>
    text.includes("发送"),
  )
  try {
    const text = frame(app)
    // 上限 = 60 − 29 = 31,再被 MODEL_CHIP_MAX(28) 截一道。Locale.truncate 拿最后一格
    // 放省略号,所以 200 个 m 变成 27 个 m + 一个「…」。
    expect(text).toContain("m".repeat(27))
    expect(text).not.toContain("m".repeat(28))
  } finally {
    app.renderer.destroy()
  }
})

// 窄终端的退化路径:meta 段是「可截断」的那一半,键位提示是必须完整的那一半。
// meta 一旦被软折行,提示行会长高一倍以上,把输入区顶变形 —— 这两条就是钉住它。
const LONG_META = () => (
  <box flexDirection="row" gap={1}>
    <text flexShrink={0} wrapMode="none">
      build-agent-with-a-long-name
    </text>
    <text flexShrink={0} wrapMode="none">
      auto
    </text>
    <text flexShrink={0} wrapMode="none">
      ·
    </text>
    <text flexShrink={0} wrapMode="none">
      anthropic-provider
    </text>
    <text flexShrink={0} wrapMode="none">
      ·
    </text>
    <text flexShrink={0} wrapMode="none">
      thinking
    </text>
  </box>
)

async function hintRowBounds(width: number) {
  const app = await renderReady(
    () => (
      <PromptCard focused={false}>
        <box width="100%" flexDirection="row" gap={1} flexShrink={0}>
          <text>ASK</text>
        </box>
        <PromptHints meta={LONG_META()} />
      </PromptCard>
    ),
    { width, height: 10 },
    (text) => text.includes("agents"),
  )
  try {
    const text = lines(app)
    const hints = text.findIndex((line) => line.includes("agents"))
    return { hints, bottom: text.findIndex((line) => line.includes("╯")) }
  } finally {
    app.renderer.destroy()
  }
}

test("输入卡:80 列下 meta 被裁掉右半,提示行仍只有一行", async () => {
  const { hints, bottom } = await hintRowBounds(80)
  expect(hints).toBeGreaterThanOrEqual(0)
  // NeonBox 把下边框画在自己最后一行,PromptCard 的 paddingBottom=1 就是那一行 ——
  // 所以键位提示行紧挨着下边框,中间不会再多出空行(多了就说明提示行被折行了)。
  expect(bottom).toBe(hints + 1)
})

test("输入卡:60 列下提示行仍只有一行", async () => {
  const { hints, bottom } = await hintRowBounds(60)
  expect(hints).toBeGreaterThanOrEqual(0)
  expect(bottom).toBe(hints + 1)
})

test("输入卡:40 列下放不下完整键位组,整条丢掉「换行」而不是把它裁成半个词", async () => {
  const app = await renderReady(
    () => (
      <PromptCard focused={false}>
        <PromptHints />
      </PromptCard>
    ),
    { width: 40, height: 10 },
    (text) => text.includes("agents"),
  )
  try {
    const row = lines(app)
      .find((line) => line.includes("agents"))!
      .replace(/│/g, "")
      .trimEnd()
    expect(row).toContain("commands")
    expect(row).not.toContain("换行")
    expect(row.endsWith("commands")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})
