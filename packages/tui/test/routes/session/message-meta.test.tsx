/** @jsxImportSource @opentui/solid */
// C2 用户消息 / 思考块 meta 行的**渲染**测试。
//
// 两条 meta 行都用导出的生产件本体(AssistantMeta / UserMeta / ThinkingMeta + NeonCard),
// 不在测试里手抄 —— 手抄的话把 meta 从卡里挪到卡外、把顺序改掉都不会有任何测试变红。
// 渲染 harness 与 assistant-card.test.tsx 是同一套做法(那两个组件住在会话内部 context 里,
// 测试脱不开 provider 栈),外层盒子的结构照生产 UserMessage / AssistantMessage 抄一份。
import { expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import "../../../src/ui/card"
import {
  AssistantMeta,
  NeonCard,
  ThinkingMeta,
  USER_META_DEFAULT_KV,
  UserMeta,
  userMetaVisible,
} from "../../../src/routes/session"
import { agentDisplayName } from "../../../src/util/agent-name"
import { Locale } from "../../../src/util/locale"
import { semanticStops } from "../../../src/ui/neon"
import { resolveTheme, type ThemeJson } from "../../../src/theme"
import novaway from "../../../src/theme/assets/novaway.json" with { type: "json" }
import { ThemeReady, ThemeTestProviders } from "../../fixture/providers"

const theme = resolveTheme(novaway as ThemeJson, "dark")

const WIDTH = 48

// 卡内竖线是 NeonBox 自绘的边框,█ 是 scrollbox 自己的滚动条;两者都不是正文。
const inner = (line: string) => line.replace(/[│█\s]/g, "")

const has =
  (...markers: string[]) =>
  (lines: string[]) =>
    lines.some((line) => line.includes("╭")) &&
    markers.every((marker) => lines.some((row) => inner(row).includes(marker)))

/**
 * 取帧:等 ready 成立再返回(字体与主题都是异步就绪的,单次 renderOnce 只会拿到半截帧)。
 *
 * provider 栈取 fixture 里那一串(测试只要主题,不需要启动流程)。ThemeReady 的 "READY"
 * 哨兵占掉第 0 行,下面的断言全部按内容找行号,所以不受它影响。
 */
async function renderFrame(body: () => JSX.Element, ready: (lines: string[]) => boolean, height = 24) {
  const Body = () => body()
  const app = await testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        <Body />
      </ThemeTestProviders>
    ),
    { width: WIDTH, height },
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

// 非今天的时间,走 todayTimeOrDateTime 最长的一档(「14:32 · 2026/1/2」),与助手 meta 同一档。
const CREATED = new Date(2026, 0, 2, 14, 32).getTime()
const STAMP = Locale.todayTimeOrDateTime(CREATED)
const AGENT_COLOR = RGBA.fromHex("#5fd7ff")

/**
 * 生产 UserMessage 的外层三明治:带 id 的消息盒(alignItems="flex-end",气泡靠右)→
 * meta 行 → 霓虹气泡卡。
 *
 * meta 行的盒子是 `alignSelf="stretch"`(撑满整列)而**文字右对齐** —— 原型的 `.msg.user` 是
 * `align-self: flex-end; align-items: flex-end`(card-design-v7.html:395),meta 与气泡共享同一条
 * 右缘。之前文字从左缘起,于是 `21:55 你` 贴在最左、气泡贴在最右,两者看着毫无关系。
 */
function userBubbleBody() {
  return () => (
    <box width={WIDTH}>
      <box width="100%" alignItems="flex-end">
        <box alignSelf="stretch" flexShrink={0}>
          <UserMeta created={CREATED} />
        </box>
        <neonbox
          gradientStops={[AGENT_COLOR]}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0)}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexShrink={0}
          maxWidth="70%"
          alignItems="flex-end"
        >
          <text>USER-BODY</text>
        </neonbox>
      </box>
    </box>
  )
}

/** 帧里一行的**显示列**数组(CJK 与 emoji 占两列,所以要摊开)。 */
function columns(line: string) {
  const out: string[] = []
  for (const part of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(line)) {
    out.push(part.segment)
    for (let i = 1; i < Bun.stringWidth(part.segment); i++) out.push("")
  }
  return out
}

/** 一格算不算「有字」:宽字符的第二列是 `""`(延续格),行内/行尾的空白是 `" "` —— 两者都不算。 */
function ink(cell: string | undefined) {
  return cell !== undefined && cell !== "" && cell !== " "
}

/** 这一行最后一个有字的那一列。 */
function lastInkColumn(line: string) {
  const cells = columns(line)
  for (let index = cells.length - 1; index >= 0; index--) if (ink(cells[index])) return index
  return -1
}

/** 这一行第一个有字的那一列。 */
function firstInkColumn(line: string) {
  const cells = columns(line)
  for (let index = 0; index < cells.length; index++) if (ink(cells[index])) return index
  return -1
}

test("用户消息:meta 行渲染「时间 你」,且就在气泡卡上方一行的位置", async () => {
  const lines = await renderFrame(userBubbleBody(), has("USER-BODY"))
  const meta = lines.findIndex((line) => line.includes("你"))
  const top = lines.findIndex((line) => line.includes("╭"))
  const bottom = lines.findIndex((line) => line.includes("╯"))
  expect(meta).toBeGreaterThanOrEqual(0)
  // 与助手气泡卡同一层语义:meta 在卡**外面**,所以卡的上边框紧跟在 meta 下一行,
  // 而不是在卡内(卡内第一行是正文)。
  expect(top).toBe(meta + 1)
  expect(bottom).toBeGreaterThan(top)
  expect(lines[meta]).toContain(STAMP)
  expect(lines[meta]).toContain("你")
  // 卡内第一行是正文,不是时间戳 —— 时间戳已经搬到卡外了
  expect(inner(lines[top + 1]!)).toContain("USER-BODY")
  expect(inner(lines[top + 1]!)).not.toContain(STAMP)
})

// 这一条是「时间和气泡分到了两边」那一处的判据:**右缘齐平**,而不是「两者都在」。
// 只断言「meta 在、卡也在」的话,把对齐方向改回去也不会有任何一条测试变红。
test("用户消息:meta 行的右缘与气泡卡的右缘齐平(原型 .msg.user 两块都 align-self: flex-end)", async () => {
  const lines = await renderFrame(userBubbleBody(), has("USER-BODY", "╯"))
  const meta = lines.find((line) => line.includes("你"))
  expect(meta, "帧里没有 meta 行").toBeDefined()
  // 气泡卡的右边框在那一列(卡内右侧只空一列 padding,边框画在最外列上,见 neon-card 的注释)。
  const borders = lines.filter((line) => line.includes("╭") || line.includes("│") || line.includes("╯"))
  expect(borders.length, "帧里没有气泡卡的边框").toBeGreaterThan(0)
  const cardRight = Math.max(...borders.map((line) => lastInkColumn(line)))
  const metaRight = lastInkColumn(meta!)
  // 差的这两列是算得出来的,不是「差不多」:
  //   · 1 列 = `paddingRight={1}`(原型 `.msg-meta { padding: 0 4px }` 的右半边,card-design-v7.html:397);
  //   · 1 列 = 「你」是宽字符,占两列而末列是延续格,`lastInkColumn` 只认字形的第一列。
  // 关键是**它不再是几十列** —— 改回左对齐时这个差是 40 多。
  expect(cardRight - metaRight, "meta 行的右缘").toBe(2)
  expect(metaRight, "meta 行该贴着右缘而不是整列左缘").toBeGreaterThan(WIDTH - 6)
  // 反过来钉一次:改回左对齐的话 meta 会从整列左缘起,右边空出一大片 —— 所以左缘也必须靠右。
  expect(firstInkColumn(meta!), "meta 行的左缘").toBeGreaterThan(WIDTH / 2)
})

// 两条 meta 行摆在一起量:用户那条**右**对齐,助手那条**左**对齐 —— 两个方向都来自原型
// (card-design-v7.html:395-396),所以这一条钉的是「方向相反」而不是「从同一列起」。
function bothMetasBody() {
  return () => (
    <box width={WIDTH}>
      <AssistantMeta agentColor={AGENT_COLOR} agent="build" created={CREATED} model="claude-sonnet-4" width={WIDTH} />
      <box alignSelf="stretch" flexShrink={0}>
        <UserMeta created={CREATED} />
      </box>
    </box>
  )
}

test("用户消息:助手 meta 左对齐、用户 meta 右对齐(原型的 flex-start / flex-end)", async () => {
  const lines = await renderFrame(bothMetasBody(), (rows) => rows.some((row) => inner(row).includes("你")), 12)
  const assistant = lines.findIndex((line) => line.includes("◆"))
  const user = lines.findIndex((line) => line.includes("你"))
  expect(assistant).toBeGreaterThanOrEqual(0)
  // 两条 meta 相邻 —— 各自只占一行,不是两行
  expect(user).toBe(assistant + 1)
  expect(lines[assistant]!.indexOf("◆"), "助手那条从左缘起(paddingLeft 一列)").toBe(1)
  expect(lines[user]!.indexOf(STAMP), "用户那条不是从左缘起").toBeGreaterThan(1)
  expect(lastInkColumn(lines[user]!), "用户那条的右缘").toBe(WIDTH - 3)
  // 用户那条不带 ◆ 与模型名:它标的是「你」,不是智能体
  expect(lines[user]).not.toContain("◆")
  expect(lines[user]).not.toContain("claude-sonnet-4")
})

/**
 * 同 renderFrame,但取的是 marker 那一格的**字色**(captureCharFrame 里没有颜色)。
 * 颜色断言只能走这条:改「你」的颜色不会让字符帧有任何变化。
 */
async function renderCellColor(body: () => JSX.Element, ready: (lines: string[]) => boolean, marker: string) {
  const Body = () => body()
  const app = await testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        <Body />
      </ThemeTestProviders>
    ),
    { width: WIDTH, height: 24 },
  )
  try {
    let lines: string[] = []
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      lines = app
        .captureCharFrame()
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
      if (ready(lines)) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const row = lines.findIndex((line) => line.includes(marker))
    expect(row, `帧里没有 ${marker}`).toBeGreaterThanOrEqual(0)
    const column = lines[row]!.indexOf(marker)
    const captured = app.captureSpans().lines[row]!.spans
    let offset = 0
    for (const span of captured) {
      if (column < offset + span.text.length) return span.fg.toInts()
      offset += span.text.length
    }
    throw new Error(`${marker} 落在 span 之外`)
  } finally {
    app.renderer.destroy()
  }
}

// ---------- 颜色:时间戳 muted,「你」是 user 语义色 ----------

// 原型 card-design-v7.html:397-399 的两段规则:
//   .msg-meta { color: var(--muted) }  .msg.user .msg-meta .who { color: var(--pink) }
// 所以用户那条 meta 里,时间戳 muted、而「你」是 user 语义色(theme.accent,novaway 深色 #ff2d7b)。
// 之前把「你」也画成 muted 是对原型的误读:整行 muted 之后那一行就没有任何彩色了。
test("用户消息:「你」是 user 语义色(theme.accent),时间戳仍是 muted", async () => {
  const who = await renderCellColor(userBubbleBody(), has("USER-BODY"), "你")
  const stamp = await renderCellColor(userBubbleBody(), has("USER-BODY"), STAMP.slice(0, 2))
  expect(who).toEqual(semanticStops(theme, "user")[0]!.toInts())
  expect(stamp).toEqual(theme.textMuted.toInts())
  // 两者必须不同 —— 这一条才是「你 不再是 muted」的真正判据
  expect(who).not.toEqual(stamp)
})

// ---------- timestamps 旗标的语义 ----------
//
// 原来 `timestamps` 控制的是「气泡卡内的那个时间戳」,默认 hide;C2 把时间戳搬成常显的 meta 行
// 之后,它控制的是**整条 meta 行**。默认值随之翻成 show(原型是常显)。
// 这里断言的是「默认值 + 显隐判定」这一层 —— 真正的 KV 落盘不能在这儿拨(共享 state/kv.json)。
test("timestamps 旗标:默认常显,关掉时整条 meta 行都不画", async () => {
  expect(userMetaVisible(USER_META_DEFAULT_KV)).toBe(true)
  expect(userMetaVisible("hide")).toBe(false)
})

// ---------- 思考块的 meta 行 ----------

/**
 * 生产 AssistantMessage 的外层:wrapper(带 id)→ AssistantMeta → NeonCard,思考块作为
 * 卡内的一个 part(带自己的 partSiblingRef 盒 + 霓虹思考卡)。
 */
function thinkingBody() {
  return () => (
    <box width={WIDTH}>
      <AssistantMeta agentColor={AGENT_COLOR} agent="build" created={CREATED} model="claude-sonnet-4" width={WIDTH} />
      <NeonCard>
        <ThinkingMeta agentColor={AGENT_COLOR} agent="build" />
        <neonbox
          gradientStops={[AGENT_COLOR]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexShrink={0}
        >
          <text>THINK-BODY</text>
        </neonbox>
      </NeonCard>
    </box>
  )
}

test("思考块:meta 行是「◆ 智能体 正在工作」,在思考卡上方、仍在助手卡内", async () => {
  const lines = await renderFrame(thinkingBody(), has("THINK-BODY"))
  const thinking = lines.findIndex((line) => line.includes("正在工作"))
  const top = lines.findIndex((line) => line.includes("╭"))
  const bottom = lines.findIndex((line) => line.includes("╯"))
  expect(thinking).toBeGreaterThanOrEqual(0)
  expect(lines[thinking]).toContain(agentDisplayName("build"))
  expect(lines[thinking]).toContain("正在工作")
  // 层级判断:思考块是**嵌套在助手气泡卡内**的一个 part,所以它的 meta 也在卡内
  // (原型里 `.msg.assistant .msg-meta` 同理),不是与助手 meta 平级。
  expect(top).toBeLessThan(thinking)
  expect(bottom).toBeGreaterThan(thinking)
  // 紧贴在思考卡上方:思考卡的上边框就是 meta 的下一行
  const innerTop = lines.findIndex((line, index) => index > thinking && line.includes("╭"))
  expect(innerTop).toBe(thinking + 1)
})

test("思考块:meta 行与助手 meta 行都在画面上,不会互相顶掉", async () => {
  const lines = await renderFrame(thinkingBody(), has("THINK-BODY"))
  const assistant = lines.findIndex((line) => line.includes("claude-sonnet-4"))
  const thinking = lines.findIndex((line) => line.includes("正在工作"))
  expect(assistant).toBeGreaterThanOrEqual(0)
  expect(thinking).toBeGreaterThan(assistant)
  expect(thinking).toBeGreaterThan(lines.findIndex((line) => line.includes("╭")))
})
