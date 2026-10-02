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
import { ThemeReady, ThemeTestProviders } from "../../fixture/providers"

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
 * meta 行 → 霓虹气泡卡。meta 行要 alignSelf="stretch" 才能从右对齐的气泡列里伸到整列左缘
 * ——它标的是「这条用户消息在这」,不是气泡的一部分。
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

// 两条 meta 行摆在一起量:用户那条与助手那条必须从**同一列**起(同一个 paddingLeft),
// 否则会话流里用户消息的标注会比助手的缩进深一列,一眼就看出不对称。
function bothMetasBody() {
  return () => (
    <box width={WIDTH}>
      <AssistantMeta agentColor={AGENT_COLOR} agent="build" created={CREATED} model="claude-sonnet-4" width={WIDTH} />
      <UserMeta created={CREATED} />
    </box>
  )
}

test("用户消息:meta 行与助手 meta 行从同一列起(两条标注视觉对称、各占一行)", async () => {
  const lines = await renderFrame(bothMetasBody(), (rows) => rows.some((row) => inner(row).includes("你")), 12)
  const assistant = lines.findIndex((line) => line.includes("◆"))
  const user = lines.findIndex((line) => line.includes("你"))
  expect(assistant).toBeGreaterThanOrEqual(0)
  // 两条 meta 相邻 —— 各自只占一行,不是两行
  expect(user).toBe(assistant + 1)
  expect(lines[assistant]!.indexOf("◆")).toBe(lines[user]!.indexOf(STAMP))
  expect(lines[user]!.indexOf(STAMP)).toBeGreaterThanOrEqual(0)
  // 用户那条不带 ◆ 与模型名:它标的是「你」,不是智能体
  expect(lines[user]).not.toContain("◆")
  expect(lines[user]).not.toContain("claude-sonnet-4")
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
