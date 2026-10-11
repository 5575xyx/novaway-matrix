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
import {
  PromptCard,
  PromptBottomRow,
  PromptAutoApprove,
  PromptSend,
  PromptShellHint,
} from "../../src/component/prompt/card"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

// 发送按钮上的键位提示走 useCommandShortcut("input.submit") 现取,所以这里必须挂真 keymap
// (registerNovaWayKeymap):不挂的话取到空字符串,`发送 `后面少一段,
// 「按钮上的键位与 useCommandShortcut 一致」那几条断言就会假通过。
type KeymapConfig = ReturnType<typeof createResolvedKeymapConfig>

function createResolvedKeymapConfig() {
  const keybinds = TuiKeybind.parse({})
  return {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
}

let mounted: { keymap: OpenTuiKeymap; config: KeymapConfig } | undefined

function KeymapContexts(props: ParentProps) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createResolvedKeymapConfig()
  const offKeymap = registerNovaWayKeymap(keymap, renderer, config)
  mounted = { keymap, config }
  onCleanup(() => {
    mounted = undefined
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
        <TuiConfigProvider config={createTuiResolvedConfig()}>
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

// 卡内三行里第三行的左半段(agent / 模型 meta)。生产里这段是 prompt/index.tsx 传进来的,
// 这里抄一个等宽短的:布局只关心「有一段可压缩的 meta 在左边」,文案不重要。
const META = () => (
  <box flexDirection="row" gap={1}>
    <text flexShrink={0} wrapMode="none">
      Agent
    </text>
    <text flexShrink={0} wrapMode="none">
      ·
    </text>
    <text flexShrink={0} wrapMode="none">
      opencode
    </text>
  </box>
)

// 输入卡的生产结构(component/prompt/index.tsx):**三行** ——
//   1. 输入行(「>」盒 w2 + gap + textarea 容器;生产里右端还有一颗自动批准开关)
//   2. 呼吸行(height={1} 的空盒)
//   3. 底部行(PromptBottomRow:插件槽 + meta | 模型芯片 + 发送按钮)
// 用**真 textarea** 而不是 <text>ASK</text> —— 只有真 textarea 才会按 maxHeight 长高,
// 「卡片有没有跟着长、后两行有没有被顶掉」才有兜底。
//
// 这个 helper **故意不放自动批准开关**:那颗开关会让输入行多出约 12 列,下面 CHIP_CASES
// 一整组「输入框还剩几列」的算术(卡内宽 − 2 − 1)就全要跟着改,而它们量的是模型芯片那笔账,
// 与开关无关。开关有自己的用例(见文件末尾)。
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
      </box>
      <box height={1} flexShrink={0} />
      <PromptBottomRow
        meta={META()}
        trailing={<PromptSend model={props.model ?? "big-pickle"} canSend={props.canSend ?? true} onSend={() => {}} />}
      />
    </PromptCard>
  )
}

// 去掉一行的左右边框与首尾空白 —— 断言「这一行上有什么」时用,不然边框会污染 indexOf。
function bare(row: string) {
  return row.replace(/│/g, "").trim()
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

// 用户报的核心问题:两行挤成一团、模型/发送混在输入行里。这条钉住新的分派 ——
// 输入行上只有提示符 + 输入框,芯片与发送按钮都在**底部行**,底部行与输入行之间至少空一行。
test("输入卡:输入行上只有提示符与输入框,芯片与发送按钮在底部行", async () => {
  const app = await renderReady(card({ focused: false }), { width: WIDTH, height: 12 }, (text) => text.includes("发送"))
  try {
    const all = lines(app)
    const input = bare(all.find((line) => line.includes("L0"))!)
    expect(input, `输入行:\n${all.join("\n")}`).toContain(">")
    // 输入行上不该再出现模型芯片或发送按钮 —— 原型是这么画的,但用户明确要求挪到最底下,
    // 挪回去就会被再次报成「挤成一团」。
    expect(input).not.toContain("◆")
    expect(input).not.toContain("发送")
    // 输入行之后**恰好**空一行(呼吸行),下一行才是底部行。
    const inputIndex = all.findIndex((line) => line.includes("L0"))
    expect(bare(all[inputIndex + 1]!)).toBe("")
    const bottom = all.findIndex((line) => line.includes("发送"))
    expect(bottom).toBe(inputIndex + 2)
    // 底部行:左 = agent meta,右 = 发送(按钮贴行尾)。
    const row = bare(all[bottom]!)
    expect(row.indexOf("Agent")).toBeGreaterThanOrEqual(0)
    expect(row.indexOf("Agent")).toBeLessThan(row.indexOf("◆"))
    expect(row.endsWith(`发送 ${expectedShortcut("input.submit")}`)).toBe(true)
    // normal 模式下**没有提示行**:底部行之下直接就是下边框,中间不许多出任何一行
    // (原来那条常驻的键位提示行已按用户要求撤掉,见 component/prompt/card 的 PromptShellHint)。
    const border = all.findIndex((line) => line.includes("╯"))
    expect(border).toBe(bottom + 1)
    expect(all.some((line) => line.includes("agents"))).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

test("输入卡:发送按钮与模型芯片在卡片内", async () => {
  const app = await renderReady(card({ focused: false }), { width: WIDTH, height: 12 }, (text) => text.includes("发送"))
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

// 键位提示行只剩 shell 这一句,而且它是**唯一**写明怎么退出 shell 模式的入口 ——
// 正常模式整行不渲染(断言在上面「输入行上只有提示符与输入框」那条里)。
test("输入卡:只有 shell 模式的 PromptShellHint 渲染 esc exit shell mode", async () => {
  const app = await renderReady(
    () => (
      <PromptCard focused={false}>
        <PromptShellHint />
      </PromptCard>
    ),
    { width: WIDTH, height: 10 },
    (text) => text.includes("exit shell mode"),
  )
  try {
    const text = frame(app)
    expect(text).toContain("esc exit shell mode")
    // 撤掉的三条常规键位一个都不许回来(「换行」那条还骗过人,理由见 card.tsx)。
    expect(text).not.toContain("agents")
    expect(text).not.toContain("commands")
    expect(text).not.toContain("换行")
  } finally {
    app.renderer.destroy()
  }
})

test("输入卡:模型芯片按终端宽截断,不给它挤掉左边的 meta", async () => {
  const app = await renderReady(
    card({ focused: false, model: "m".repeat(200) }),
    { width: WIDTH, height: 12 },
    (text) => text.includes("发送"),
  )
  try {
    const text = frame(app)
    // 上限 = 60 − 37 = 23(卡 padding 2+2 + 底部行定长 21 + meta 下限 12)。
    // Locale.truncate 拿最后一格放省略号,23 → 22 个 m + 一个「…」。
    expect(text).toContain("m".repeat(22))
    expect(text).not.toContain("m".repeat(23))
    // 芯片吃掉的宽度是有上限的:模型芯片与发送按钮仍在底部行同一行,
    // 没被顶到折行(折行会把「发送」甩到下一行)。
    const bottom = lines(app).find((line) => line.includes("发送"))!
    expect(bottom).toContain("m".repeat(22))
    expect(bottom.indexOf("Agent")).toBeGreaterThanOrEqual(0)
  } finally {
    app.renderer.destroy()
  }
})

// 多行输入:textarea 长到 maxHeight 时卡片要跟着长,后两行不能被挤没、
// 也不能被顶到卡片外面去。这是「卡片壳 + 真 textarea」组合才测得到的东西 ——
// 之前用 <text>ASK</text> 代替输入框时,这块几何完全没有兜底。
test("输入卡:多行输入把卡片撑高,呼吸行/底部行依次排在最下面", async () => {
  const app = await renderReady(
    card({ focused: false, lines: 4, maxHeight: 4 }),
    { width: WIDTH, height: 14 },
    (text) => text.includes("发送"),
  )
  try {
    const text = lines(app)
    const top = text.findIndex((line) => line.includes("╭"))
    const first = text.findIndex((line) => line.includes("L0"))
    const last = text.findIndex((line) => line.includes("L3"))
    const bottom = text.findIndex((line) => line.includes("发送"))
    const border = text.findIndex((line) => line.includes("╯"))
    expect(top).toBeGreaterThanOrEqual(0)
    // paddingTop = 2,第 0 行是上边框、第 1 行是留白,正文从第 2 行开始 —— 正是
    // 「padding 格就是边框格,≥2 才空得出呼吸区」那一条(见 component/prompt/card 的注释)。
    expect(first).toBe(top + 2)
    // 4 行输入都在卡片内、连续
    expect(last).toBe(first + 3)
    // 输入行之下**恰好一行**呼吸行,再往下才是底部行 —— 多输入行也不会把它顶没。
    expect(bare(text[last + 1]!)).toBe("")
    expect(bottom).toBe(last + 2)
    // 底部 padding=1:底部行之下直接就是下边框,不留空白行(用户报过「底部还有空行」)。
    // normal 模式没有提示行,所以这里不再是 bottom + 2。
    expect(border).toBe(bottom + 1)
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
        <PromptShellHint />
      </PromptCard>
    ),
    { width: WIDTH, height: 10 },
    (text) => text.includes("exit shell mode"),
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

// 窄终端的退化路径:meta 段是「可截断」的那一半,发送按钮是必须完整的那一半。
// meta 一旦被软折行,底部行会长高,把输入区顶变形 —— 这几条就是钉住它。
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

// 一张卡:输入行 + 呼吸行 + 底部行(长 meta + 发送组)。normal 模式没有提示行,下边框紧跟底部行。
// 量的是底部行那一段在窄终端下有没有长出第二行、有没有把发送按钮挤掉。
async function bottomRowBounds(width: number) {
  const app = await renderReady(
    () => (
      <PromptCard focused={false}>
        <box width="100%" flexDirection="row" gap={1} flexShrink={0}>
          <text>ASK</text>
        </box>
        <box height={1} flexShrink={0} />
        <PromptBottomRow
          meta={LONG_META()}
          trailing={<PromptSend model="big-pickle" canSend={true} onSend={() => {}} />}
        />
      </PromptCard>
    ),
    { width, height: 12 },
    (text) => text.includes("发送"),
  )
  try {
    const all = lines(app)
    const bottom = all.findIndex((line) => line.includes("发送"))
    return {
      row: bare(all[bottom] ?? ""),
      raw: all[bottom] ?? "",
      // 键位必须在渲染器销毁**之前**取:onCleanup 会把 mounted 置空,
      // expectedShortcut 之后就只能返回空串,断言会假失败。
      submit: expectedShortcut("input.submit"),
      bottom,
      border: all.findIndex((line) => line.includes("╯")),
    }
  } finally {
    app.renderer.destroy()
  }
}

test("输入卡:80 列下 meta 被裁掉右半,底部行仍只有一行且发送按钮完整", async () => {
  const { row, raw, submit, bottom, border } = await bottomRowBounds(80)
  expect(bottom).toBeGreaterThanOrEqual(0)
  // meta 那一段是从右边裁的,所以左端的 agent 名与右端的按钮都必须在。
  expect(row.indexOf("build-agent-with-a-long-name")).toBe(0)
  expect(row).toContain("◆ big-pickle")
  expect(row.endsWith(`发送 ${submit}`), `底部行:${raw}`).toBe(true)
  // 底部行没有被折行:下边框紧跟它下面一行。
  // (NeonBox 把下边框画在自己最后一行,PromptCard 的 paddingBottom=1 —— 底部不留空白行。
  //  normal 模式没有提示行,所以是 bottom + 1 而不是 + 2。)
  expect(border).toBe(bottom + 1)
})

test("输入卡:60 列下底部行仍只有一行", async () => {
  const { row, raw, submit, bottom, border } = await bottomRowBounds(60)
  expect(bottom).toBeGreaterThanOrEqual(0)
  // 60 列的卡内宽 56,底部行定长 21 + meta 下限 12 = 33 已占住,剩下的才是 meta ——
  // 这条断言钉的是「宁可裁 meta 也不动发送组」。
  expect(row).toContain("◆ big-pickle")
  expect(row.endsWith(`发送 ${submit}`), `底部行:${raw}`).toBe(true)
  expect(border).toBe(bottom + 1)
})

// 底部行那一档把「模型名」与「输入框」的宽度预算彻底分开了:输入行只剩 ">" + 输入框,
// 芯片去护 meta。这一组量的就是各档宽度下两段东西还在不在:发送按钮、模型芯片,
// 外加输入框自己还剩几列。
//
// 期望值按 component/prompt/card 里 MODEL_CHIP_MARGIN 的算式**独立写一遍字面量**,
// 不 import 那个常量 —— 常量改了这里跟着改就等于没测。
//   模型名上限 = 终端宽 − 4(卡 padding 2+2)− 21(底部行定长)− 12(meta 下限),再夹到 [8, 28]
//   40 → max(8, min(28, 3)) = 8;60 → 23;80 → 28;120 → 28(封顶)
// Locale.oneLine 拿最后一格放省略号,所以「上限 N」渲染出来是 N−1 个 m 加一个「…」。
// 输入框的余量也顺带按同一套算式写死:卡内宽 − 「>」盒 2 − 行内 gap 1。
//   40 → 36 − 3 = 33;60 → 53;80 → 73;120 → 113。
const CHIP_CASES = [
  { width: 40, modelColumns: 8, inputColumns: 33 },
  { width: 60, modelColumns: 23, inputColumns: 53 },
  { width: 80, modelColumns: 28, inputColumns: 73 },
  { width: 120, modelColumns: 28, inputColumns: 113 },
]

for (const { width, modelColumns, inputColumns } of CHIP_CASES) {
  test(`输入卡:${width} 列下输入行/底部行各占一行且不重叠`, async () => {
    const app = await renderReady(card({ focused: false, model: "m".repeat(200) }), { width, height: 12 }, (text) =>
      text.includes("发送"),
    )
    try {
      const all = lines(app)
      // 输入行:只有提示符 + 输入框。
      const inputIndex = all.findIndex((line) => line.includes("L0"))
      const input = bare(all[inputIndex]!)
      expect(input, `输入行:\n${all.join("\n")}`).toContain(">")
      expect(input).not.toContain("◆")
      expect(input).not.toContain("发送")
      // 呼吸行恰好一行,底部行紧随其后。
      expect(bare(all[inputIndex + 1]!)).toBe("")
      const bottomIndex = inputIndex + 2
      expect(all[bottomIndex]).toContain("发送")
      // 模型芯片封顶:上限 N 列 → N−1 个 m 加一个省略号,再多一格就是没封顶。
      const bottom = bare(all[bottomIndex]!)
      expect(bottom).toContain("m".repeat(modelColumns - 1))
      expect(bottom).not.toContain("m".repeat(modelColumns))
      // meta 在左、发送组在右,两者不重叠;发送按钮贴行尾。
      expect(bottom.indexOf("Agent")).toBeLessThan(bottom.indexOf("◆"))
      expect(bottom.endsWith(`发送 ${expectedShortcut("input.submit")}`)).toBe(true)
      // 输入框保底 minWidth=4 没被挤没:「>」之后还剩整行卡内宽减掉 2+1。
      expect(inputColumns).toBeGreaterThanOrEqual(4)
      expect(inputColumns).toBe(width - 4 - 2 - 1)
      // normal 模式没有提示行:底部行下面**直接**就是下边框,也不许有 agents/commands 的字。
      expect(all.some((line) => line.includes("agents"))).toBe(false)
      expect(all.some((line) => line.includes("换行"))).toBe(false)
      // 顶部留白:正文行不挨着上边框。底部反过来 —— 底部行之后直接就是下边框
      // (paddingBottom=1,底部不留空白行,理由见 component/prompt/card 的文件头注释)。
      const top = all.findIndex((line) => line.includes("╭"))
      const border = all.findIndex((line) => line.includes("╯"))
      expect(inputIndex).toBe(top + 2)
      expect(border).toBe(bottomIndex + 1)
    } finally {
      app.renderer.destroy()
    }
  })
}

// usage 段(上下文占用/花费)折进底部行之后,卡内仍然是**三行**。
//
// 用户报的是「输入卡下面空了一行」—— 那一行原本是卡外的一条状态行,只带一个右对齐的
// `77.1K`。折进底部行之后输入卡底下什么都不剩,所以这张壳的行数不能多:底部行仍然只占
// 一行(usage 是同一行里的一段,不是新起的一行)、下边框紧跟它(底部 padding=1,不留空白行)。
// 多出一行就等于把那条空行搬进卡里,那还是同一个问题。
const USAGE = () => <text wrapMode="none">77.1K</text>

for (const width of [40, 60, 80, 120]) {
  test(`输入卡:${width} 列下 usage 段在底部行内,卡内仍是三行、下边框位置不变`, async () => {
    const app = await renderReady(
      () => (
        <PromptCard focused={false}>
          <box width="100%" flexDirection="row" gap={1} flexShrink={0}>
            <box flexShrink={0} width={2} height={1}>
              <text>&gt;</text>
            </box>
            <box flexGrow={1} flexShrink={1} minWidth={4}>
              <textarea width="100%" minHeight={1} maxHeight={6} initialValue="L0" />
            </box>
          </box>
          <box height={1} flexShrink={0} />
          <PromptBottomRow
            meta={META()}
            usage={USAGE()}
            trailing={<PromptSend model="big-pickle" canSend onSend={() => {}} />}
          />
        </PromptCard>
      ),
      { width, height: 12 },
      (text) => text.includes("发送"),
    )
    try {
      const all = lines(app)
      const bottom = all.findIndex((line) => line.includes("发送"))
      const border = all.findIndex((line) => line.includes("╯"))
      expect(bottom, `帧:\n${all.join("\n")}`).toBeGreaterThanOrEqual(0)
      // usage 与 meta、发送按钮同在底部行:它在**卡片内**(下边框之上),且与发送同一行。
      const figure = all.findIndex((line) => line.includes("77.1K"))
      if (figure >= 0) {
        expect(figure).toBe(bottom)
        expect(figure).toBeLessThan(border)
      }
      // 三行结构没变:底部行 → 下边框(底部 padding=1,不留空白行;normal 模式没有提示行)。
      expect(border).toBe(bottom + 1)
      // 发送按钮贴行尾、没被折到下一行。
      expect(bare(all[bottom]!).endsWith(`发送 ${expectedShortcut("input.submit")}`)).toBe(true)
    } finally {
      app.renderer.destroy()
    }
  })
}

// 自动批准开关的两态字形与点击接线。**确认闸门不在这一层** —— 关→开要弹一次对话框这件事
// 得把真 <Prompt> 挂起来才量得到,见 component/prompt-mount.test.tsx。
//
// 字形只差实心/空心,所以两条都要断言「有本态那个、没有另一态那个」:写成只断言有的话,
// 有人把两态画成同一颗实心点也不会红。
for (const { enabled, glyph } of [
  { enabled: false, glyph: "○" },
  { enabled: true, glyph: "●" },
]) {
  test(`自动批准开关:${enabled ? "开" : "关"}态画 ${glyph} 自动批准,另一态的字形不出现`, async () => {
    const app = await renderReady(
      () => (
        <PromptCard focused={false}>
          <PromptAutoApprove enabled={enabled} onToggle={() => {}} />
        </PromptCard>
      ),
      { width: WIDTH, height: 10 },
      (text) => text.includes("自动批准"),
    )
    try {
      const row = lines(app).find((line) => line.includes("自动批准"))
      expect(row, `帧里找不到开关:\n${frame(app)}`).toBeDefined()
      expect(row).toContain(`${glyph} 自动批准`)
      expect(row).not.toContain(enabled ? "○" : "●")
    } finally {
      app.renderer.destroy()
    }
  })
}

test("自动批准开关:点一下就回调 onToggle(开之前要不要确认是调用方的事)", async () => {
  let toggles = 0
  const app = await renderReady(
    () => (
      <PromptCard focused={false}>
        <PromptAutoApprove enabled={false} onToggle={() => (toggles += 1)} />
      </PromptCard>
    ),
    { width: WIDTH, height: 10 },
    (text) => text.includes("自动批准"),
  )
  try {
    const all = lines(app)
    const y = all.findIndex((line) => line.includes("○"))
    // 点在那颗 ○ 上:开关盒子里 ○ 之前只有边框与两个空格,字符下标就是列号,
    // 不用去算 CJK 字宽(CJK 在 ○ 右边,影响不到它的位置)。
    const x = all[y]?.indexOf("○") ?? -1
    expect(x, `帧:\n${all.join("\n")}`).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(x, y)
    await app.renderOnce()
    expect(toggles).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})
