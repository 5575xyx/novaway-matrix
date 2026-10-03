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

async function renderCard(body: () => JSX.Element, options: { width: number; height: number }) {
  return testRender(
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
  const app = await renderCard(body, options)
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

// 输入卡的生产结构:「>」盒(w2)+ gap + textarea 容器(flexGrow/flexShrink/minWidth)+ gap
// + PromptSend,第二行是 PromptHints。用**真 textarea** 而不是 <text>ASK</text> ——
// 只有真 textarea 才会按 maxHeight 长高,「卡片有没有跟着长、提示行有没有被顶掉」才有兜底。
function card(props: { focused: boolean; model?: string; canSend?: boolean; lines?: number; maxHeight?: number }) {
  return () => (
    <PromptCard focused={props.focused}>
      <box width="100%" flexDirection="row" gap={1} flexShrink={0}>
        <box flexShrink={0} width={2} height={1}>
          <text>&gt;</text>
        </box>
        <box flexGrow={1} flexShrink={1} minWidth={4}>
          <textarea
            width="100%"
            minHeight={1}
            maxHeight={props.maxHeight ?? 6}
            initialValue={Array.from({ length: props.lines ?? 1 }, (_, index) => `L${index}`).join("\n")}
          />
        </box>
        <PromptSend model={props.model ?? "big-pickle"} canSend={props.canSend ?? true} onSend={() => {}} />
      </box>
      <PromptHints />
    </PromptCard>
  )
}

test("输入卡:霓虹描边画出圆角边框,内容在边框内侧", async () => {
  const app = await renderReady(card({ focused: false }), { width: WIDTH, height: 10 }, (text) => text.includes("L0"))
  try {
    const text = lines(app)
    expect(text[0]).toContain("╭")
    expect(text.some((line) => line.includes("╯"))).toBe(true)
    expect(text.some((line) => line.includes("L0"))).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("输入卡:发送按钮与模型芯片在卡片内", async () => {
  const app = await renderReady(card({ focused: false }), { width: WIDTH, height: 10 }, (text) => text.includes("发送"))
  try {
    const text = frame(app)
    // 按钮上的键位现取 input.submit(默认渲染成小写 "enter");写死 "Enter" 会被这条打红。
    expect(text).toContain(`发送 ${expectedShortcut("input.submit")}`)
    expect(text).toContain("◆ big-pickle")
  } finally {
    app.renderer.destroy()
  }
})

test("输入卡:focused 时描边流动 —— 两次渲染之间边框颜色变化", async () => {
  const app = await renderReady(card({ focused: true }), { width: WIDTH, height: 10 }, (text) => text.includes("L0"))
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
  const app = await renderReady(card({ focused: false }), { width: WIDTH, height: 10 }, (text) => text.includes("L0"))
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
  const app = await renderReady(
    card({ focused: false, model: "m".repeat(200) }),
    { width: WIDTH, height: 10 },
    (text) => text.includes("发送"),
  )
  try {
    const text = frame(app)
    // 上限 = 60 − 37 = 23(卡 padding 2+2 + 定长开销 21 + 输入框下限 12)。
    // Locale.truncate 拿最后一格放省略号,23 → 22 个 m + 一个「…」。
    expect(text).toContain("m".repeat(22))
    expect(text).not.toContain("m".repeat(23))
    // 芯片吃掉的宽度是有上限的:输入框那一行仍然是「提示符 + 输入框 + 芯片 + 发送」四段,
    // 没被顶到折行(折行会把「发送」甩到第二行)。
    const input = lines(app).find((line) => line.includes("L0"))!
    expect(input).toContain(`发送 ${expectedShortcut("input.submit")}`)
    expect(input).toContain(">")
  } finally {
    app.renderer.destroy()
  }
})

// 多行输入:textarea 长到 maxHeight 时卡片要跟着长,提示行不能被挤没、
// 也不能被顶到卡片外面去。这是「卡片壳 + 真 textarea」组合才测得到的东西 ——
// 之前用 <text>ASK</text> 代替输入框时,这块几何完全没有兜底。
test("输入卡:多行输入把卡片撑高,提示行仍紧贴下边框", async () => {
  const app = await renderReady(
    card({ focused: false, lines: 4, maxHeight: 4 }),
    { width: WIDTH, height: 12 },
    (text) => text.includes("agents"),
  )
  try {
    const text = lines(app)
    const top = text.findIndex((line) => line.includes("╭"))
    const first = text.findIndex((line) => line.includes("L0"))
    const last = text.findIndex((line) => line.includes("L3"))
    const hints = text.findIndex((line) => line.includes("agents"))
    const bottom = text.findIndex((line) => line.includes("╯"))
    expect(top).toBeGreaterThanOrEqual(0)
    // paddingTop = 2,第 0 行是上边框、第 1 行是留白,正文从第 2 行开始 —— 正是
    // 「padding 格就是边框格,≥2 才空得出呼吸区」那一条(见 component/prompt/card 的注释)。
    expect(first).toBe(top + 2)
    // 4 行输入都在卡片内、连续
    expect(last).toBe(first + 3)
    // 提示行紧跟最后一行输入,没有被顶到别处
    expect(hints).toBe(last + 1)
    // 下边框前还空着 paddingBottom 那一行
    expect(bottom).toBe(hints + 2)
  } finally {
    app.renderer.destroy()
  }
})

// visible 参与 animated:宿主在 visible={false} 时只是不画,盒子仍挂在树上,
// 不掐掉定时器就会 12.5 次/秒地空 requestRender 一棵没人看的子树。
// 故意不从 KV 那一侧拨 animations_enabled 来测:kv.set 会写进共享的 state/kv.json
// (context/kv.tsx 的 write 是异步链),一旦中途失败就把后续所有测试的动画关掉 ——
// 实测踩过。animations_enabled 的折算是 PromptCard 里的一行响应式表达式,靠 visible
// 这条同一条路径间接覆盖。
test("输入卡:visible=false 时不启动描边动画(隐藏的卡片不该空转)", async () => {
  const app = await renderReady(
    () => (
      <PromptCard focused={true} visible={false}>
        <PromptHints />
      </PromptCard>
    ),
    { width: WIDTH, height: 10 },
    (text) => text.includes("agents"),
  )
  try {
    const border = () => topBorder(app.captureSpans()).map((item) => item.cell)
    const before = border()
    await new Promise((resolve) => setTimeout(resolve, 200))
    await app.renderOnce()
    expect(border()).toEqual(before)
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
  // NeonBox 把下边框画在自己最后一行,PromptCard 的 paddingBottom=2 意味着
  // 提示行与下边框之间还空着一行 —— 键位提示没有被折行(折行会多出至少一行)。
  expect(bottom).toBe(hints + 2)
})

test("输入卡:60 列下提示行仍只有一行", async () => {
  const { hints, bottom } = await hintRowBounds(60)
  expect(hints).toBeGreaterThanOrEqual(0)
  expect(bottom).toBe(hints + 2)
})

// 卡内留白那一档把输入行的宽度预算整体收窄了两列(卡 padding 1+1 → 2+2)。这一组量的就是
// 收窄之后各档宽度下三段东西还在不在:发送按钮、模型芯片、提示行,外加输入框自己还剩几列。
//
// 期望值按 component/prompt/card 里 MODEL_CHIP_MARGIN 的算式**独立写一遍字面量**,
// 不 import 那个常量 —— 常量改了这里跟着改就等于没测。
//   模型名上限 = 终端宽 − 4(卡 padding 2+2)− 21(定长开销)− 12(输入框下限),再夹到 [8, 28]
//   40 → max(8, min(28, 3)) = 8;60 → 23;80 → 28;120 → 28(封顶)
// Locale.oneLine 拿最后一格放省略号,所以「上限 N」渲染出来是 N−1 个 m 加一个「…」。
const CHIP_CASES = [
  { width: 40, modelColumns: 8 },
  { width: 60, modelColumns: 23 },
  { width: 80, modelColumns: 28 },
  { width: 120, modelColumns: 28 },
]

for (const { width, modelColumns } of CHIP_CASES) {
  test(`输入卡:${width} 列下发送按钮/模型芯片/提示行都还在卡内一行`, async () => {
    const app = await renderReady(card({ focused: false, model: "m".repeat(200) }), { width, height: 12 }, (text) =>
      text.includes("发送"),
    )
    try {
      const all = lines(app)
      // 三段都在同一条输入行上:折行会把「发送」甩到下一行,输入区高度就失控了。
      const input = all.find((line) => line.includes("L0"))!
      expect(input, `输入行:\n${all.join("\n")}`).toContain(`发送 ${expectedShortcut("input.submit")}`)
      expect(input).toContain(">")
      // 模型芯片封顶:上限 N 列 → N−1 个 m 加一个省略号,再多一格就是没封顶。
      expect(input).toContain("m".repeat(modelColumns - 1))
      expect(input).not.toContain("m".repeat(modelColumns))
      // 输入框保底 minWidth=4 没被挤没:「>」之后至少还有 4 列才轮到芯片。
      const chip = input.indexOf("◆")
      expect(input.indexOf(">")).toBeGreaterThanOrEqual(0)
      expect(chip - input.indexOf(">")).toBeGreaterThanOrEqual(4 + 2 + 2)
      // 提示行整行都在卡内,且只有一行。
      const hints = all.filter((line) => line.includes("agents"))
      expect(hints).toHaveLength(1)
      expect(all.filter((line) => line.includes("commands"))).toHaveLength(1)
      // 「换行」那一档的门槛是 50 列(见 component/prompt/card 的 HINT_ROW_MIN_WIDTH)。
      expect(all.some((line) => line.includes("换行"))).toBe(width >= 50)
      // 四边留白:正文行不挨着上下边框。
      const top = all.findIndex((line) => line.includes("╭"))
      const first = all.findIndex((line) => line.includes("L0"))
      const bottom = all.findIndex((line) => line.includes("╯"))
      expect(first).toBe(top + 2)
      expect(bottom).toBe(first + 3)
    } finally {
      app.renderer.destroy()
    }
  })
}

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
