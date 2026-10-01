/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { For, Show } from "solid-js"
import { testRender } from "@opentui/solid"
import { BoxRenderable, RGBA } from "@opentui/core"
import "../../../src/ui/card"
import { semanticStops } from "../../../src/ui/neon"
import { resolveTheme, generateSubtleSyntax, type ThemeJson } from "../../../src/context/theme"
import novaway from "../../../src/theme/assets/novaway.json" with { type: "json" }
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { alwaysSeparate, BlockTool, InlineToolRow, partSiblingRef } from "../../../src/routes/session"
import { agentDisplayName } from "../../../src/util/agent-name"
import * as Locale from "../../../src/util/locale"

// AssistantMessage 挂在会话内部 context(模块私有)+ LocalProvider(SDK/Route/Event/Permission)上,
// 测试里脱不开这套栈,所以这里用与 AssistantMessage 逐行同构的 harness 复现结构,
// 跑真实的 alwaysSeparate / partSiblingRef / InlineToolRow / NeonBoxRenderable,
// 锁住四条不变量:meta 行与卡片边框同帧、卡内首 part 无多余顶 margin、相邻 part 之间仍有 1 行空行、
// 卡内可用宽度按「卡片 padding 3」扣减(工具输出宽度常量靠它算)。
const theme = resolveTheme(novaway as ThemeJson, "dark")

// TextPart/ReasoningPart 的根 box 就是用生产里的 partSiblingRef 拿 margin:
// 卡内首个子节点 previous 为 undefined → 0,之后按「前一个兄弟多行 或 在 alwaysSeparate 里」给 1。
// 这里直接复用生产实现而不是抄一份,否则策略改了测试不会响。

const WIDTH = 48

function bubbleFixture(texts: readonly string[], probe = 0) {
  return function AssistantBubbleFixture() {
    return (
      <scrollbox
        width={WIDTH}
        height={30}
        viewportOptions={{ paddingRight: 0 }}
        verticalScrollbarOptions={{ visible: false }}
      >
        <box height={1} flexShrink={0}>
          <text>PREV-ROW</text>
        </box>
        <box id="assistant-1" ref={(el: BoxRenderable) => alwaysSeparate.add(el)} marginTop={1} flexShrink={0}>
          <box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
            <text wrapMode="none">
              <span>{"◆ Build"}</span>
              <span>{" · claude-sonnet-4"}</span>
            </text>
          </box>
          <neonbox
            gradientStops={semanticStops(theme, "assistant")}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={1}
            width="100%"
            flexShrink={0}
          >
            <For each={texts}>
              {(value) => (
                <box ref={partSiblingRef} flexShrink={0}>
                  <text>{value}</text>
                </box>
              )}
            </For>
            <Show when={probe}>
              <box ref={partSiblingRef} flexShrink={0}>
                <text wrapMode="none">{"X".repeat(probe)}</text>
              </box>
            </Show>
          </neonbox>
        </box>
        <InlineToolRow complete={true} pending="">
          Read src/index.ts
        </InlineToolRow>
      </scrollbox>
    )
  }
}

// 卡内竖线是 NeonBox 自绘的左右边框,█ 是 scrollbox 自己的滚动条;两者都不是正文。
function inner(line: string) {
  return line.replace(/[│█\s]/g, "")
}

// 通用的取帧:渲染到 ready 成立为止,返回去掉行尾空白的帧。
async function cardLines(fixture: Parameters<typeof testRender>[0], ready: (lines: string[]) => boolean) {
  const app = await testRender(fixture, { width: WIDTH, height: 30 })
  try {
    let lines: string[] = []
    for (let attempt = 0; attempt < 10; attempt++) {
      await app.renderOnce()
      lines = app
        .captureCharFrame()
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
      if (ready(lines)) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return lines
  } finally {
    app.renderer.destroy()
  }
}

async function bubbleLines(texts: readonly string[], probe = 0) {
  const app = await testRender(bubbleFixture(texts, probe), { width: WIDTH, height: 30 })
  try {
    let lines: string[] = []
    for (let attempt = 0; attempt < 10; attempt++) {
      await app.renderOnce()
      lines = app
        .captureCharFrame()
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
      if (
        lines.some((line) => line.includes("╭")) &&
        lines.some((line) => inner(line).includes("FIRST-PART")) &&
        lines.some((line) => inner(line).includes("src/index.ts"))
      )
        break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return lines
  } finally {
    app.renderer.destroy()
  }
}

test("助手气泡卡:meta 行在卡上方,与卡片边框同帧出现", async () => {
  const lines = await bubbleLines(["FIRST-PART"])
  const meta = lines.findIndex((line) => line.includes("claude-sonnet-4"))
  const top = lines.findIndex((line) => line.includes("╭"))
  const bottom = lines.findIndex((line) => line.includes("╯"))
  expect(meta).toBeGreaterThanOrEqual(0)
  expect(top).toBeGreaterThan(meta)
  expect(bottom).toBeGreaterThan(top)
})

test("助手气泡卡:首 part 紧贴卡内顶部(顶 margin 由 wrapper 承担,卡内 part 不再加)", async () => {
  const lines = await bubbleLines(["FIRST-PART"])
  const top = lines.findIndex((line) => line.includes("╭"))
  // NeonBox 把上边框画在自己第 0 行,paddingTop=1 正好把正文推到边框行的下一行 ——
  // 所以这里没有多余空行,首 part 的 marginTop 必须是 0。
  expect(inner(lines[top + 1]!)).toContain("FIRST-PART")
})

test("助手气泡卡:相邻 part 之间仍有 1 行空行", async () => {
  const lines = await bubbleLines(["FIRST-PART", "SECOND-PART"])
  const first = lines.findIndex((line) => inner(line).includes("FIRST-PART"))
  const second = lines.findIndex((line) => inner(line).includes("SECOND-PART"))
  expect(first).toBeGreaterThanOrEqual(0)
  expect(second - first).toBe(2)
  expect(inner(lines[first + 1]!)).toBe("")
})

// 卡内前兄弟有两种「不是多行 box」的形态,改造前 TextPart/ReasoningPart 是静态 marginTop={1},
// 恒有 1 行空行;如果卡内规则改成看「前兄弟是不是多行 / 在不在 alwaysSeparate 里」,
// 这两种形态后面的正文就会紧贴上来,整张卡变成一坨:
//   1. 不带 separate 的行内工具(Read/Glob/Grep/WebFetch/WebSearch/Write…):1 行,
//      且 InlineToolRow 只在 separate 为真时才 alwaysSeparate.add(只有 Task 传了)。
//   2. Read 在行内工具下面再吐的「↳ Loaded」框:1 行,而且完全没有 ref。
// 所以规则必须是「卡内只要有前一个兄弟就给 1」,与前兄弟的行数无关。
//
// 注意 part 必须用 <For> 渲染(与生产 PART_MAPPING 的 <For> 一致):util/layout.ts 靠给
// el.onLifecyclePass 赋值来注册,而 opentui 只在 append 子节点**之前**onLifecyclePass
// 已是函数时才注册;静态写死的 JSX 子节点是 append 之后才调 ref,回调根本不会跑。
function afterPreviousFixture(kind: "tool" | "refless") {
  return function AssistantAfterPreviousFixture() {
    return (
      <box width={WIDTH}>
        <neonbox
          gradientStops={semanticStops(theme, "assistant")}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={1}
          width="100%"
          flexShrink={0}
        >
          {kind === "tool" ? (
            // 不传 separate —— 与生产里 Read/Glob/Grep 的调用一致
            <InlineToolRow complete={true} pending="">
              {"Read TOOLMARK"}
            </InlineToolRow>
          ) : (
            <box paddingLeft={3}>
              <text>{"↳ Loaded SUBMARK"}</text>
            </box>
          )}
          <For each={["AFTERMARK"]}>
            {(value) => (
              <box ref={partSiblingRef} flexShrink={0}>
                <text>{value}</text>
              </box>
            )}
          </For>
        </neonbox>
      </box>
    )
  }
}

test("助手气泡卡:行内工具(1 行、不在 alwaysSeparate)后面仍有 1 行空行", async () => {
  const lines = await cardLines(afterPreviousFixture("tool"), (frame) =>
    frame.some((line) => inner(line).includes("AFTERMARK")),
  )
  const tool = lines.findIndex((line) => inner(line).includes("TOOLMARK"))
  const after = lines.findIndex((line) => inner(line).includes("AFTERMARK"))
  expect(tool).toBeGreaterThanOrEqual(0)
  expect(after - tool).toBe(2)
  expect(inner(lines[tool + 1]!)).toBe("")
})

test("助手气泡卡:无 ref 的 1 行框(Read 的「↳ Loaded」)后面仍有 1 行空行", async () => {
  const lines = await cardLines(afterPreviousFixture("refless"), (frame) =>
    frame.some((line) => inner(line).includes("AFTERMARK")),
  )
  const sub = lines.findIndex((line) => inner(line).includes("SUBMARK"))
  const after = lines.findIndex((line) => inner(line).includes("AFTERMARK"))
  expect(sub).toBeGreaterThanOrEqual(0)
  expect(after - sub).toBe(2)
  expect(inner(lines[sub + 1]!)).toBe("")
})

test("助手气泡卡:卡内可用宽度 = 卡片宽 − padding 3(边框画在 padding 列上,不占 Yoga 列)", async () => {
  const lines = await bubbleLines(["FIRST-PART"], 200)
  const row = lines.find((line) => line.includes("XXXX"))!
  const left = row.indexOf("│")
  const right = row.lastIndexOf("│")
  // 左:左边框画在 padding 首列上,正文从 left+2 起
  expect(row[left + 2]).toBe("X")
  expect(row.slice(0, left + 2).replace(/[│\s]/g, "")).toBe("")
  // 右:paddingRight 1 列正好挡住右边框,右 padding 那一列是空白、边框字符完好
  expect(row[right - 1]).toBe("X")
  expect(row[right]).toBe("│")
  // 正文可写列数 = 48 − padding(2+1) = 45;工具卡再扣自己的 3 列 → 宽度常量按 −9 扣减。
  expect([...row].filter((char) => char === "X").length).toBe(WIDTH - 3)
})

test("助手气泡卡:wrapper 之后的兄弟(InlineToolRow)仍按 alwaysSeparate 拿到 1 行间距", async () => {
  const lines = await bubbleLines(["FIRST-PART"])
  const bottom = lines.findIndex((line) => line.includes("╯"))
  const row = lines.findIndex((line) => inner(line).includes("src/index.ts"))
  expect(row).toBeGreaterThan(bottom)
  expect(inner(lines[row - 1]!)).toBe("")
})

// meta 行用真实的 agentDisplayName / Locale(与 AssistantMessage :1884-1904 同构):
// agent 名与模型名长度不受控,模型名还可能带换行,靠 Locale.oneLine(model(), 60) 压平 + 截断。
const CREATED = new Date(2026, 0, 2, 14, 32).getTime()

function metaFixture(model: string) {
  return function AssistantMetaFixture() {
    return (
      <box width={WIDTH}>
        <box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
          <text wrapMode="none">
            <span>{`◆ ${agentDisplayName("build")}`}</span>
            <span>{` · ${Locale.oneLine(model, 60)} · ${Locale.todayTimeOrDateTime(CREATED)}`}</span>
          </text>
        </box>
        <neonbox
          gradientStops={semanticStops(theme, "assistant")}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={1}
          width="100%"
          flexShrink={0}
        >
          <box ref={partSiblingRef} flexShrink={0}>
            <text>BODYMARK</text>
          </box>
        </neonbox>
      </box>
    )
  }
}

test("助手气泡卡:meta 行用真实 agentDisplayName/Locale 渲染「agent · 模型 · 时间」", async () => {
  const lines = await cardLines(metaFixture("claude-sonnet-4"), (frame) =>
    frame.some((line) => inner(line).includes("BODYMARK")),
  )
  const meta = lines.findIndex((line) => inner(line).includes("◆"))
  const top = lines.findIndex((line) => line.includes("╭"))
  expect(meta).toBeGreaterThanOrEqual(0)
  expect(top).toBe(meta + 1)
  expect(lines[meta]).toContain(agentDisplayName("build"))
  expect(lines[meta]).toContain("claude-sonnet-4")
  expect(lines[meta]).toContain(Locale.todayTimeOrDateTime(CREATED))
})

test("助手气泡卡:meta 行遇到超长带换行的模型名仍只有一行(压平 + 截到 60 列,不溢出)", async () => {
  const lines = await cardLines(metaFixture("gpt-5-codex\n" + "x".repeat(120)), (frame) =>
    frame.some((line) => inner(line).includes("BODYMARK")),
  )
  const meta = lines.findIndex((line) => inner(line).includes("◆"))
  const top = lines.findIndex((line) => line.includes("╭"))
  expect(meta).toBeGreaterThanOrEqual(0)
  // 换行被 oneLine 压平:meta 下面紧接着就是卡片上边框,没有被顶成两行
  expect(top).toBe(meta + 1)
  // 模型名被截到 60 列以内(帧里最长的一段 x 不超过 60)
  expect(Math.max(...lines.map((line) => line.match(/x+/)?.[0].length ?? 0))).toBeLessThanOrEqual(60)
  // wrapMode="none" 是裁切而不是换行:行宽不会超过终端宽度
  expect(lines[meta]!.trimEnd().length).toBeLessThanOrEqual(WIDTH)
})

// Step 3 的实测回归:TextPart 删掉 paddingLeft={3} 之后,嵌套列表的缩进只能来自
// markdown 自己的 internalBlockMode="top-level"。这里用真实 <markdown> + 真实卡片 padding
// 渲染一遍,断言二级项仍在一级项右侧、且正文不越过右边框。
test("助手气泡卡:markdown 嵌套列表缩进保留,且正文不压右边框", async () => {
  const app = await testRender(
    () => (
      <box width={WIDTH}>
        <neonbox
          gradientStops={semanticStops(theme, "assistant")}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={1}
          width="100%"
          flexShrink={0}
        >
          <markdown
            syntaxStyle={generateSubtleSyntax(theme)}
            internalBlockMode="top-level"
            content={"- 一级项\n  - 二级项\n- 另一个一级项"}
          />
        </neonbox>
      </box>
    ),
    { width: WIDTH, height: 12 },
  )
  try {
    let lines: string[] = []
    for (let attempt = 0; attempt < 10; attempt++) {
      await app.renderOnce()
      lines = app
        .captureCharFrame()
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
      if (lines.some((line) => inner(line).includes("二级项"))) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const top = lines.find((line) => inner(line).includes("一级项"))!
    const nested = lines.find((line) => inner(line).includes("二级项"))!
    // 实测(48 宽渲染下):左边框在第 0 列,markdown 列表标记落在第 2 列 —— 正好是卡片
    // paddingLeft=2 那一列,证明缩进由卡片提供,而不是靠 part 自己的 paddingLeft={3}。
    expect(top.indexOf("-")).toBe(2)
    // 二级项必须仍在一级项右侧(markdown 自己的 internalBlockMode="top-level" 层级缩进)
    expect(nested.indexOf("二")).toBeGreaterThan(top.indexOf("一"))
    // 正文不得越过右边框所在列
    for (const line of lines) {
      if (!inner(line).includes("项")) continue
      expect(line.trimEnd().length).toBeLessThanOrEqual(line.lastIndexOf("│") + 1)
    }
  } finally {
    app.renderer.destroy()
  }
})

// 真实 BlockTool 在助手卡内的可用列数:顶层 45(= 宽 − 自己的 padding 3),进卡后再扣卡片的 3 列 → 42。
// 工具输出折叠常量的 `ctx.width - 9` 就是这么来的(9 = 卡 3 + BlockTool 3 + 原有 3 列保守余量)。
test("真实 BlockTool 在助手卡内可用 42 列,顶层 45 列", async () => {
  const measure = async (inCard: boolean) => {
    const app = await testRender(
      () => (
        <TestTuiContexts>
          <TuiConfigProvider config={createTuiResolvedConfig()}>
            <ArgsProvider>
              <KVProvider>
                <ThemeProvider mode="dark">
                  {inCard ? (
                    <box width="100%">
                      <neonbox
                        gradientStops={[RGBA.fromHex("#5fd7ff"), RGBA.fromHex("#0090ff")]}
                        paddingTop={1}
                        paddingBottom={1}
                        paddingLeft={2}
                        paddingRight={1}
                        width="100%"
                      >
                        <BlockTool title="T">
                          <text wrapMode="none">{"X".repeat(300)}</text>
                        </BlockTool>
                      </neonbox>
                    </box>
                  ) : (
                    <BlockTool title="T">
                      <text wrapMode="none">{"X".repeat(300)}</text>
                    </BlockTool>
                  )}
                </ThemeProvider>
              </KVProvider>
            </ArgsProvider>
          </TuiConfigProvider>
        </TestTuiContexts>
      ),
      { width: WIDTH, height: 12 },
    )
    try {
      let rows: string[] = []
      for (let attempt = 0; attempt < 10; attempt++) {
        await app.renderOnce()
        rows = app.captureCharFrame().split("\n")
        if (rows.some((line) => line.includes("XXXX"))) break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      const row = rows.find((line) => line.includes("XXXX"))!
      return [...row].filter((char) => char === "X").length
    } finally {
      app.renderer.destroy()
    }
  }
  expect(await measure(false)).toBe(45)
  expect(await measure(true)).toBe(42)
})
