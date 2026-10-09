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
  messageColumns,
  MESSAGE_MAX_WIDTH,
  MessageAnchor,
  NeonCard,
  AssistantMeta,
  BlockTool,
  metaModelLimit,
  partSiblingRef,
} from "../../../src/routes/session"
import { agentDisplayName } from "../../../src/util/agent-name"
import * as Locale from "../../../src/util/locale"
import { resolveTheme, type ThemeJson } from "../../../src/theme"

// AssistantMessage 挂在会话内部 context(模块私有)+ LocalProvider(SDK/Route/Event/Permission)上,
// 测试里脱不开这套栈,所以这里用与 AssistantMessage 同构的 harness 复现结构。
// 卡壳与 meta 行都用导出的生产件(NeonCard / AssistantMeta)本体,不手抄 ——
// 手抄的话改生产 padding 或 meta 顺序都不会有任何测试变红,`ctx.width - 9` 那类
// 宽度常量就会悄悄失准。
// 跑的都是生产件:NeonCard / AssistantMeta / partSiblingRef / alwaysSeparate /
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
  ready: (lines: string[]) => boolean,
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

// 生产 AssistantMessage 的外层三明治:wrapper(带 id,供会话跳转查)→ meta 行 → NeonCard。
// bubbleBody 额外在气泡后面挂一个真实的工具卡,用来测 wrapper 之后的兄弟间距。
// 挂的是 BlockTool 本体而不是 InlineToolRow:紧凑形态的工具现在也是一张带边框的卡
// (原型 card-design-v7.html:427-458),间距登记也在卡壳上,InlineToolRow 只是 head 行的内容。
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
      {/* 与生产 AssistantMessage 的锚点同款两个 prop(源码断言钉在 message-anchor.test.tsx):
          alignItems="flex-start" 让 meta 与卡按内容收缩(scrollbox 默认 stretch 会把它们拉满),
          卡壳 width="auto" 是收缩的另一半 —— 卡壳默认 100% 会按锚点宽度解析,少了它短回复照样撑满。 */}
      <box
        id="assistant-1"
        ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
        marginTop={1}
        flexShrink={0}
        alignItems="flex-start"
      >
        <AssistantMeta
          agentColor={RGBA.fromHex("#5fd7ff")}
          agent="build"
          created={new Date(2026, 0, 2, 14, 32).getTime()}
          model="claude-sonnet-4"
          width={WIDTH}
        />
        <NeonCard width="auto">
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
        </NeonCard>
      </box>
      <BlockTool title="Read src/index.ts">
        <text>TOOLBODY</text>
      </BlockTool>
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

// 卡内前兄弟有三种「不是多行 box」的形态,改造前 TextPart/ReasoningPart 是静态 marginTop={1},
// 恒有 1 行空行;如果卡内规则改成看「前兄弟是不是多行 / 在不在 alwaysSeparate 里」,
// 这两种形态后面的正文就会紧贴上来,整张卡变成一坨:
//   1. 没有 ref 的 1 行框(Read 在行内工具下面再吐的「↳ Loaded」框):1 行,完全没有 ref。
//   2. 工具卡自己(紧凑形态)后面:卡是多行的,走 alwaysSeparate 那条。
// 所以规则必须是「卡内只要有前一个兄弟就给 1」,与前兄弟的行数无关。
function afterPreviousBody(kind: "tool" | "refless") {
  return () => (
    // alignItems="flex-start" + width="auto":生产锚点与卡壳的那对 prop(见 bubbleBody 的注释)
    <box width={WIDTH} alignItems="flex-start">
      <NeonCard width="auto">
        <Show
          when={kind === "tool"}
          fallback={
            <box paddingLeft={3}>
              <text>{"↳ Loaded SUBMARK"}</text>
            </box>
          }
        >
          <BlockTool title="Read TOOLMARK">
            <text>TOOLBODY</text>
          </BlockTool>
        </Show>
        <box ref={partSiblingRef} flexShrink={0}>
          <text>AFTERMARK</text>
        </box>
      </NeonCard>
    </box>
  )
}

test("助手气泡卡:工具卡(多行、已登记 alwaysSeparate)后面仍有 1 行空行", async () => {
  const lines = await renderFrame(afterPreviousBody("tool"), { width: WIDTH, height: 12 }, has("AFTERMARK"))
  const tool = lines.findIndex((line) => inner(line).includes("TOOLMARK"))
  const after = lines.findIndex((line) => inner(line).includes("AFTERMARK"))
  expect(tool).toBeGreaterThanOrEqual(0)
  // 工具卡 = head / 分隔线 / body / 下边框四行(head 上面还有上边框),后面再空一行才是下一个 part
  expect(after - tool).toBe(5)
  expect(inner(lines[tool + 4]!)).toBe("")
})

test("助手气泡卡:无 ref 的 1 行框(Read 的「↳ Loaded」)后面仍有 1 行空行", async () => {
  const lines = await renderFrame(afterPreviousBody("refless"), { width: WIDTH, height: 12 }, has("AFTERMARK"))
  const sub = lines.findIndex((line) => inner(line).includes("SUBMARK"))
  const after = lines.findIndex((line) => inner(line).includes("AFTERMARK"))
  expect(sub).toBeGreaterThanOrEqual(0)
  expect(after - sub).toBe(2)
  expect(inner(lines[sub + 1]!)).toBe("")
})

// 卡内可用列数 = 渲染宽 − NeonCard 的 padding(2+1)。这条断言量的是**生产卡壳**:
// 改 NeonCard 的 paddingLeft/paddingRight 它就会红(变异测试已自证)。
test("助手气泡卡:卡内可用宽度 = 卡宽 − NeonCard 的 padding 3(边框画在 padding 列上)", async () => {
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

test("助手气泡卡:wrapper 之后的兄弟(工具卡)仍按 alwaysSeparate 拿到 1 行间距", async () => {
  const lines = await bubbleLines(["FIRST-PART"])
  const bottom = lines.findIndex((line) => line.includes("╯"))
  // 工具卡的 head 在哪一行
  const head = lines.findIndex((line) => inner(line).includes("src/index.ts"))
  expect(head).toBeGreaterThan(bottom)
  // 空行在卡的上边框**之前** —— 所以 head 往上数两行才是那一行空行
  expect(inner(lines[head - 2]!)).toBe("")
  expect(lines[head - 1]).toContain("╭")
})

// meta 行用生产导出的 AssistantMeta 本体(真实 agentDisplayName / Locale / metaModelLimit / 顺序),
// 不在测试里手抄 —— 手抄的话把顺序改回「模型在前」不会有任何测试变红。
// 时间取非今天,走 todayTimeOrDateTime 最长的一档(「14:32 · 2026/1/2」)。
const CREATED = new Date(2026, 0, 2, 14, 32).getTime()
const STAMP = Locale.todayTimeOrDateTime(CREATED)

function metaBody(model: string, width = WIDTH) {
  return () => (
    <box width={width} alignItems="flex-start">
      <AssistantMeta agentColor={RGBA.fromHex("#5fd7ff")} agent="build" created={CREATED} model={model} width={width} />
      <NeonCard width="auto">
        <box ref={partSiblingRef} flexShrink={0}>
          <text>BODYMARK</text>
        </box>
      </NeonCard>
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
// internalBlockMode="top-level"。这里用真实 <markdown> + 真实 NeonCard 渲染一遍。
test("助手气泡卡:markdown 嵌套列表缩进保留,且正文不压右边框", async () => {
  const lines = await renderFrame(
    () => (
      <box width={WIDTH} alignItems="flex-start">
        <NeonCard width="auto">
          <markdown
            syntaxStyle={generateSubtleSyntax(theme)}
            internalBlockMode="top-level"
            content={"- 一级项\n  - 二级项\n- 另一个一级项"}
          />
        </NeonCard>
      </box>
    ),
    { width: WIDTH, height: 12 },
    has("二级项"),
  )
  const top = lines.find((line) => inner(line).includes("一级项"))!
  const nested = lines.find((line) => inner(line).includes("二级项"))!
  // 实测(48 宽渲染下):左边框在第 0 列,markdown 列表标记落在第 2 列 —— 正好是
  // NeonCard 的 paddingLeft=2 那一列,证明缩进由卡片提供,而不是靠 part 的 paddingLeft={3}。
  expect(top.indexOf("-")).toBe(2)
  // 二级项必须仍在一级项右侧(markdown 自己的 internalBlockMode="top-level" 层级缩进)
  expect(nested.indexOf("二")).toBeGreaterThan(top.indexOf("一"))
  // 正文不得越过右边框所在列
  for (const line of lines) {
    if (!inner(line).includes("项")) continue
    expect(line.trimEnd().length).toBeLessThanOrEqual(line.lastIndexOf("│") + 1)
  }
})

// 真实 BlockTool 的可用列数:顶层 = 宽 − BlockTool 自己的 padding 3,进 NeonCard 后再扣卡片的 3 列。
// 工具输出折叠常量的 `ctx.width - 9` 里,这两项(3 + 3)是这里实测锁住的,剩下 3 列是保守余量。
test("真实 BlockTool 在助手卡内可用 42 列,顶层 45 列", async () => {
  const measure = async (inCard: boolean) => {
    const lines = await renderFrame(
      () =>
        inCard ? (
          <box width="100%" alignItems="flex-start">
            <NeonCard width="auto">
              <BlockTool title="T">
                <text wrapMode="none">{"X".repeat(300)}</text>
              </BlockTool>
            </NeonCard>
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

// ── 消息列的宽度上限(原型的 `.msg { max-width: 78% }`,card-design-v7.html:394)──
//
// 判据是「右缘落在哪一列」,不是「有没有 maxWidth 这个属性」:手抄一个 maxWidth 也能通过后者。
// 同一条 `.msg` 在原型里同时管 user 与 assistant,所以两个方向量的是**同一个** messageColumns(…)。
//
// 锚点与卡壳的两个 prop 与生产同款(源码断言在 message-anchor.test.tsx):
// `alignItems="flex-start"`(子元素按内容收缩)+ `<NeonCard width="auto">`(卡壳不写死 100%)。
function capBody(messageID: string, text: string) {
  return () => (
    <box width={WIDTH}>
      <MessageAnchor messageID={messageID} flexShrink={0} alignItems="flex-start">
        <NeonCard width="auto">
          <box ref={partSiblingRef} flexShrink={0}>
            <text>{text}</text>
          </box>
        </NeonCard>
      </MessageAnchor>
    </box>
  )
}

// 自适应契约的前一半:**短回复按内容收缩**。用户那条量的是 9 + 2 + 2 = 13
// (message-meta.test.tsx),这里同样把数推出来而不是写「比上限窄」:
//   · 正文 CAPPEDBODY = 10 列;
//   · NeonCard 的 paddingLeft=2、paddingRight=1 —— 霓虹边框画在盒子**最外两列**上
//     (perimeterCells 按 this.width 取边界),不额外占列;
//   · 卡宽 = 10 + 2 + 1 = 13,右边框落在第 12 列(0 起)。
// 少一个 prop 都会退回旧行为:拉满时右缘是 messageColumns − 1 = 36,差 24 列 ——
// 肉眼就是「一个宽盒子里塞了一小截字」。
test("助手气泡卡:短回复的卡宽等于内容(10 列正文 + padding 3 = 13),不撑满消息列", async () => {
  const lines = await renderFrame(capBody("capped", "CAPPEDBODY"), { width: WIDTH, height: 12 }, has("CAPPEDBODY"))
  const bottom = lines.find((line) => line.includes("╯"))!
  expect(messageColumns(WIDTH)).toBe(37)
  expect(bottom.lastIndexOf("╯"), "短回复的右缘 = 内容右缘").toBe(10 + 2 + 1 - 1)
  expect(bottom.lastIndexOf("╯"), "不是封顶那一列").not.toBe(messageColumns(WIDTH) - 1)
  // 反向钉一次:连上限都没了的话右缘就是整列的右缘
  expect(bottom.lastIndexOf("╯")).not.toBe(WIDTH - 1)
})

// 自适应契约的后一半:长回复必须**封顶**在消息列,证明「按内容收缩」没有顺手取消 78% 那道上限。
test("助手气泡卡:长回复封顶在消息列,右缘仍落在 messageColumns − 1", async () => {
  const lines = await renderFrame(
    capBody("capped-long", "x".repeat(WIDTH * 3)),
    { width: WIDTH, height: 12 },
    has("xxx"),
  )
  const bottom = lines.find((line) => line.includes("╯"))!
  // 48 × 78% = 37.44 → 37 列(0..36),右边框落在第 36 列而不是第 47 列
  expect(messageColumns(WIDTH)).toBe(37)
  expect(bottom.lastIndexOf("╯")).toBe(messageColumns(WIDTH) - 1)
  // 反向钉一次:没有上限的话右缘就是整列的右缘
  expect(bottom.lastIndexOf("╯")).not.toBe(WIDTH - 1)
})

test("messageColumns 把百分比解析成整列,宽屏窄屏都是同一个比例", () => {
  expect(MESSAGE_MAX_WIDTH).toBe("78%")
  // 四舍五入到整列:yoga 的百分比落点
  expect(messageColumns(48)).toBe(37)
  expect(messageColumns(100)).toBe(78)
  expect(messageColumns(120)).toBe(94)
  expect(messageColumns(200)).toBe(156)
  // 比整列窄,而不是更宽
  for (const width of [20, 48, 80, 120, 200]) {
    expect(messageColumns(width)).toBeLessThan(width)
  }
})

test("助手 meta 行按消息列截模型名,不是按整列", async () => {
  const lines = await renderFrame(
    () => (
      <box width={WIDTH}>
        <MessageAnchor messageID="capped-meta" flexShrink={0} alignItems="flex-start">
          <AssistantMeta
            agentColor={RGBA.fromHex("#5fd7ff")}
            agent="build"
            created={new Date(2026, 0, 2, 14, 32).getTime()}
            model={"m".repeat(200)}
            width={messageColumns(WIDTH)}
          />
          <NeonCard width="auto">
            <box ref={partSiblingRef} flexShrink={0}>
              <text>METABODY</text>
            </box>
          </NeonCard>
        </MessageAnchor>
      </box>
    ),
    { width: WIDTH, height: 12 },
    has("METABODY"),
  )
  const meta = lines.find((line) => inner(line).includes("◆"))!
  // 模型名的预算跟着消息列收窄。48 列终端上消息列是 37,37 − 26 = 11 已经跌破 12 的下限,
  // 所以那条拿到的就是下限;宽一点的屏上差距才是真的:120 → 消息列 94 → 68,而按整列算是 94。
  expect(metaModelLimit(messageColumns(WIDTH))).toBe(12)
  expect(metaModelLimit(messageColumns(120))).toBe(68)
  expect(metaModelLimit(messageColumns(120))).toBeLessThan(metaModelLimit(120))
  // 12 列的预算在 37 列的消息列里放不下(前面还有 ◆ / 智能体名 / 时间戳),所以模型名被右缘切到
  // 只剩几个字符 —— 这正是「被裁的永远是模型名」那一条设计(见 AssistantMeta 的顺序注释)。
  expect(meta).not.toContain("m".repeat(12))
  // 时间戳排在模型名之前,所以它完好
  expect(meta).toContain(Locale.todayTimeOrDateTime(new Date(2026, 0, 2, 14, 32).getTime()))
})

test("工具卡在收窄后的消息列里仍留得住 head:摘要整段留着,标题让位", async () => {
  // 48 列终端 → 消息列 37 → 工具卡内宽 37 − 6 = 31 → head 文案预算 31 − 5 = 26
  const lines = await renderFrame(
    () => (
      <box width={WIDTH}>
        <MessageAnchor messageID="capped-tool" flexShrink={0} alignItems="flex-start">
          <NeonCard width="auto">
            <BlockTool
              title="bun test --timeout 30000"
              status={{ passed: 12, failed: 0 }}
              headWidth={Math.max(0, messageColumns(WIDTH) - 6)}
            >
              <text>TOOLBODY</text>
            </BlockTool>
          </NeonCard>
        </MessageAnchor>
      </box>
    ),
    { width: WIDTH, height: 14 },
    has("TOOLBODY"),
  )
  const head = lines.find((line) => line.includes("passed"))!
  expect(head).toContain("✓ 12 passed")
  // 26 列里放不下整条命令,但也不能把摘要挤掉:标题带省略号
  expect(head).toContain("…")
  expect(head).not.toContain("--timeout 30000")
  // 摘要在右缘之内,没被霓虹边框切掉
  expect(head.lastIndexOf("passed") + "passed".length).toBeLessThanOrEqual(head.lastIndexOf("│"))
  // 卡壳现在按内容收缩(headWidth 那笔账是**上界**,不是实际宽):助手卡的右缘必须落在
  // 消息列之内 —— head 截在预算里、卡长到刚好装下它,于是卡不会比 messageColumns 更宽,
  // 也就不会有任何一列被挤到霓虹边框外面。取最后一行 ╯(工具卡自己那张在里面,先出现)。
  const bottom = lines.filter((line) => line.includes("╯")).at(-1)!
  expect(bottom.lastIndexOf("╯")).toBeLessThanOrEqual(messageColumns(WIDTH) - 1)
})
