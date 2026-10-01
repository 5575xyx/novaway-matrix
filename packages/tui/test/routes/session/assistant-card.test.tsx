/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { For, Show, type JSX } from "solid-js"
import { testRender } from "@opentui/solid"
import { BoxRenderable, RGBA } from "@opentui/core"
import "../../../src/ui/card"
import { generateSubtleSyntax } from "../../../src/context/theme"
import novaway from "../../../src/theme/assets/novaway.json" with { type: "json" }
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TuiPathsProvider, TuiStartupProvider, TuiTerminalEnvironmentProvider } from "../../../src/context/runtime"
import {
  alwaysSeparate,
  AssistantCard,
  AssistantMeta,
  BlockTool,
  InlineToolRow,
  metaModelLimit,
  partSiblingRef,
} from "../../../src/routes/session"
import { agentDisplayName } from "../../../src/util/agent-name"
import * as Locale from "../../../src/util/locale"
import { resolveTheme, type ThemeJson } from "../../../src/theme"

// AssistantMessage 挂在会话内部 context(模块私有)+ LocalProvider(SDK/Route/Event/Permission)上,
// 测试里脱不开这套栈,所以这里用与 AssistantMessage 同构的 harness 复现结构。
// 卡壳与 meta 行都用导出的生产件(AssistantCard / AssistantMeta)本体,不手抄 ——
// 手抄的话改生产 padding 或 meta 顺序都不会有任何测试变红,`ctx.width - 9` 那类
// 宽度常量就会悄悄失准。
// 跑的都是生产件:AssistantCard / AssistantMeta / partSiblingRef / alwaysSeparate /
// InlineToolRow / BlockTool。
const theme = resolveTheme(novaway as ThemeJson, "dark")

const WIDTH = 48

// 卡内竖线是 NeonBox 自绘的左右边框,█ 是 scrollbox 自己的滚动条;两者都不是正文。
function inner(line: string) {
  return line.replace(/[│█\s]/g, "")
}

// 默认就绪判据:画面里已经有实质内容(卡边框 + 至少一个正文标记)。
const has =
  (...markers: string[]) =>
  (lines: string[]) =>
    lines.some((line) => line.includes("╭")) && markers.every((marker) => lines.some((l) => inner(l).includes(marker)))

// 取帧:等 ready 成立再返回。testRender 之后字体(CJK 字形)和主题都是异步就绪的,
// 实测 markdown 里的中文要 7 轮左右才稳定,所以单次 renderOnce 拿到的必然是半截帧 ——
// 在半截帧上断言只会让报错指向错误的行。超时则带着整帧抛错,而不是返回半截帧让断言去背锅。
async function renderFrame(
  body: () => JSX.Element,
  options: { width: number; height: number },
  ready: (lines: string[]) => boolean = has("X"),
) {
  // body 必须当组件渲染(<Body />)而不是直接调 body():后者在 provider 的 children
  // getter 里就把 JSX 建好了,不在任何渲染作用域内,插不进渲染树(实测整帧全空)。
  const Body = () => body()
  const app = await testRender(
    () => (
      // 这里不用 TestTuiContexts:它的 TuiStartupProvider 写死 skipInitialLoading:false,
      // 启动闸门要等异步初始化才放行。测试只要 theme,不需要启动流程。
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
                    <Body />
                  </ThemeProvider>
                </KVProvider>
              </ArgsProvider>
            </TuiConfigProvider>
          </TuiStartupProvider>
        </TuiTerminalEnvironmentProvider>
      </TuiPathsProvider>
    ),
    options,
  )
  try {
    let lines: string[] = []
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      lines = app
        .captureCharFrame()
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
      if (ready(lines)) return lines
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error("渲染未在 40 轮内就绪,实际帧:\n" + lines.join("\n"))
  } finally {
    app.renderer.destroy()
  }
}

// 生产 AssistantMessage 的外层三明治:wrapper(带 id,供会话跳转查)→ meta 行 → AssistantCard。
// bubbleBody 额外在气泡后面挂一个真实的 InlineToolRow,用来测 wrapper 之后的兄弟间距。
function bubbleBody(texts: readonly string[], probe = 0) {
  return () => (
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
        <AssistantMeta
          agentColor={RGBA.fromHex("#5fd7ff")}
          agent="build"
          created={new Date(2026, 0, 2, 14, 32).getTime()}
          model="claude-sonnet-4"
          width={WIDTH}
        />
        <AssistantCard>
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
        </AssistantCard>
      </box>
      <InlineToolRow complete={true} pending="">
        Read src/index.ts
      </InlineToolRow>
    </scrollbox>
  )
}

function bubbleLines(texts: readonly string[], probe = 0) {
  return renderFrame(bubbleBody(texts, probe), { width: WIDTH, height: 30 }, has("FIRST-PART", "src/index.ts"))
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
function afterPreviousBody(kind: "tool" | "refless") {
  return () => (
    <box width={WIDTH}>
      <AssistantCard>
        <Show
          when={kind === "tool"}
          fallback={
            <box paddingLeft={3}>
              <text>{"↳ Loaded SUBMARK"}</text>
            </box>
          }
        >
          {/* 不传 separate —— 与生产里 Read/Glob/Grep 的调用一致 */}
          <InlineToolRow complete={true} pending="">
            {"Read TOOLMARK"}
          </InlineToolRow>
        </Show>
        <box ref={partSiblingRef} flexShrink={0}>
          <text>AFTERMARK</text>
        </box>
      </AssistantCard>
    </box>
  )
}

test("助手气泡卡:行内工具(1 行、不在 alwaysSeparate)后面仍有 1 行空行", async () => {
  const lines = await renderFrame(afterPreviousBody("tool"), { width: WIDTH, height: 12 }, has("AFTERMARK"))
  const tool = lines.findIndex((line) => inner(line).includes("TOOLMARK"))
  const after = lines.findIndex((line) => inner(line).includes("AFTERMARK"))
  expect(tool).toBeGreaterThanOrEqual(0)
  expect(after - tool).toBe(2)
  expect(inner(lines[tool + 1]!)).toBe("")
})

test("助手气泡卡:无 ref 的 1 行框(Read 的「↳ Loaded」)后面仍有 1 行空行", async () => {
  const lines = await renderFrame(afterPreviousBody("refless"), { width: WIDTH, height: 12 }, has("AFTERMARK"))
  const sub = lines.findIndex((line) => inner(line).includes("SUBMARK"))
  const after = lines.findIndex((line) => inner(line).includes("AFTERMARK"))
  expect(sub).toBeGreaterThanOrEqual(0)
  expect(after - sub).toBe(2)
  expect(inner(lines[sub + 1]!)).toBe("")
})

// 卡内可用列数 = 渲染宽 − AssistantCard 的 padding(2+1)。这条断言量的是**生产卡壳**:
// 改 AssistantCard 的 paddingLeft/paddingRight 它就会红(变异测试已自证)。
test("助手气泡卡:卡内可用宽度 = 卡宽 − AssistantCard 的 padding 3(边框画在 padding 列上)", async () => {
  const lines = await bubbleLines(["FIRST-PART"], 200)
  const row = lines.find((line) => line.includes("XXXX"))!
  const left = row.indexOf("│")
  const right = row.lastIndexOf("│")
  // 左:左边框画在 padding 首列上,正文从 left+2 起(paddingLeft=2)
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

// meta 行用生产导出的 AssistantMeta 本体(真实 agentDisplayName / Locale / metaModelLimit / 顺序),
// 不在测试里手抄 —— 手抄的话把顺序改回「模型在前」不会有任何测试变红。
// 时间取非今天,走 todayTimeOrDateTime 最长的一档(「14:32 · 2026/1/2」)。
const CREATED = new Date(2026, 0, 2, 14, 32).getTime()
const STAMP = Locale.todayTimeOrDateTime(CREATED)

function metaBody(model: string, width = WIDTH) {
  return () => (
    <box width={width}>
      <AssistantMeta agentColor={RGBA.fromHex("#5fd7ff")} agent="build" created={CREATED} model={model} width={width} />
      <AssistantCard>
        <box ref={partSiblingRef} flexShrink={0}>
          <text>BODYMARK</text>
        </box>
      </AssistantCard>
    </box>
  )
}

test("助手气泡卡:meta 行用真实 agentDisplayName/Locale 渲染「agent · 时间 · 模型」一行", async () => {
  const lines = await renderFrame(metaBody("claude-sonnet-4"), { width: WIDTH, height: 12 }, has("BODYMARK"))
  const meta = lines.findIndex((line) => inner(line).includes("◆"))
  const top = lines.findIndex((line) => line.includes("╭"))
  expect(meta).toBeGreaterThanOrEqual(0)
  // 一行:meta 下面紧接着就是卡片上边框
  expect(top).toBe(meta + 1)
  expect(lines[meta]).toContain(agentDisplayName("build"))
  expect(lines[meta]).toContain("claude-sonnet-4")
  expect(lines[meta]).toContain(STAMP)
})

// 回归:模型名不受控(可长达上百列),时间戳却是定长。原来的顺序是「agent · 模型 · 时间」,
// 48 列终端上模型名会把 wrapMode="none" 的尾部裁切吃满,时间戳直接消失。
// 改成时间在前之后,被裁的永远是模型名。
test("助手气泡卡:窄终端 + 超长模型名时 meta 行仍看得到时间戳", async () => {
  const lines = await renderFrame(metaBody("m".repeat(200)), { width: 48, height: 12 }, has("BODYMARK"))
  const meta = lines.find((line) => inner(line).includes("◆"))
  expect(meta).toBeDefined()
  // 断言整行(含空格):用户看到的就是「◆ 锻造工程 · 14:32 · 2026/1/2 · mmm…」这一行
  expect(meta).toContain(STAMP)
  // 时间在模型名之前 —— 顺序本身就是这条断言要锁的东西
  expect(meta!.indexOf(STAMP)).toBeLessThan(meta!.indexOf("mmm"))
})

test("助手气泡卡:metaModelLimit 给窄屏留 12 列下限,宽屏按剩余宽度给模型名", () => {
  expect(metaModelLimit(48)).toBe(22)
  expect(metaModelLimit(20)).toBe(12)
  expect(metaModelLimit(200)).toBe(174)
  // 截断真的生效(而不是靠终端裁切兜底)
  expect(Locale.oneLine("m".repeat(200), metaModelLimit(48)).length).toBe(22)
})

test("助手气泡卡:模型名里的换行被压平,不会把 meta 顶成两行", async () => {
  const lines = await renderFrame(
    metaBody("gpt-5-codex\n" + "x".repeat(200)),
    { width: WIDTH, height: 12 },
    has("BODYMARK"),
  )
  const meta = lines.findIndex((line) => inner(line).includes("◆"))
  const top = lines.findIndex((line) => line.includes("╭"))
  expect(meta).toBeGreaterThanOrEqual(0)
  expect(top).toBe(meta + 1)
})

// TextPart 删掉 paddingLeft={3} 之后,嵌套列表的缩进只能来自 markdown 自己的
// internalBlockMode="top-level"。这里用真实 <markdown> + 真实 AssistantCard 渲染一遍。
test("助手气泡卡:markdown 嵌套列表缩进保留,且正文不压右边框", async () => {
  const lines = await renderFrame(
    () => (
      <box width={WIDTH}>
        <AssistantCard>
          <markdown
            syntaxStyle={generateSubtleSyntax(theme)}
            internalBlockMode="top-level"
            content={"- 一级项\n  - 二级项\n- 另一个一级项"}
          />
        </AssistantCard>
      </box>
    ),
    { width: WIDTH, height: 12 },
    has("二级项"),
  )
  const top = lines.find((line) => inner(line).includes("一级项"))!
  const nested = lines.find((line) => inner(line).includes("二级项"))!
  // 实测(48 宽渲染下):左边框在第 0 列,markdown 列表标记落在第 2 列 —— 正好是
  // AssistantCard 的 paddingLeft=2 那一列,证明缩进由卡片提供,而不是靠 part 的 paddingLeft={3}。
  expect(top.indexOf("-")).toBe(2)
  // 二级项必须仍在一级项右侧(markdown 自己的 internalBlockMode="top-level" 层级缩进)
  expect(nested.indexOf("二")).toBeGreaterThan(top.indexOf("一"))
  // 正文不得越过右边框所在列
  for (const line of lines) {
    if (!inner(line).includes("项")) continue
    expect(line.trimEnd().length).toBeLessThanOrEqual(line.lastIndexOf("│") + 1)
  }
})

// 真实 BlockTool 的可用列数:顶层 = 宽 − BlockTool 自己的 padding 3,进 AssistantCard 后再扣卡片的 3 列。
// 工具输出折叠常量的 `ctx.width - 9` 里,这两项(3 + 3)是这里实测锁住的,剩下 3 列是保守余量。
test("真实 BlockTool 在助手卡内可用 42 列,顶层 45 列", async () => {
  const measure = async (inCard: boolean) => {
    const lines = await renderFrame(
      () =>
        inCard ? (
          <box width="100%">
            <AssistantCard>
              <BlockTool title="T">
                <text wrapMode="none">{"X".repeat(300)}</text>
              </BlockTool>
            </AssistantCard>
          </box>
        ) : (
          <BlockTool title="T">
            <text wrapMode="none">{"X".repeat(300)}</text>
          </BlockTool>
        ),
      { width: WIDTH, height: 12 },
      has("X"),
    )
    const row = lines.find((line) => line.includes("XXXX"))!
    return [...row].filter((char) => char === "X").length
  }
  expect(await measure(false)).toBe(45)
  expect(await measure(true)).toBe(42)
})
