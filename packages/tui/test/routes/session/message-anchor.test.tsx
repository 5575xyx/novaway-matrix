/** @jsxImportSource @opentui/solid */
// 消息锚点的守卫。会话区有六处寻址全靠「消息列表 scrollbox 的直接子节点里 id === message.id」
// 那一层盒子(findNextVisibleMessage / scrollToMessage / timeline / fork / 首条上翻 /
// jumpToMessage),而整份 Session 组件挂不起来 —— 没有任何现成的测试会因为那个 id 被删掉而变红。
//
// 所以把那层盒子切成了 MessageAnchor(见 src/routes/session/message-anchor.tsx),这里直接
// 挂载它来断言两件事:它确实是 scrollbox 的直接子节点且带着那个 id;调用点没有绕开它。
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { readFileSync } from "node:fs"
import path from "node:path"
import "../../../src/ui/card"
import { alwaysSeparate, MessageAnchor } from "../../../src/routes/session/message-anchor"

const WIDTH = 30
const HEIGHT = 10

async function mountAnchor(messageID: string) {
  let scroll: ScrollBoxRenderable | undefined
  const app = await testRender(
    () => (
      <scrollbox ref={(box: ScrollBoxRenderable) => (scroll = box)} flexGrow={1} minHeight={0}>
        <MessageAnchor messageID={messageID} marginTop={1} flexShrink={0}>
          <text>hello</text>
        </MessageAnchor>
      </scrollbox>
    ),
    { width: WIDTH, height: HEIGHT },
  )
  await app.renderOnce()
  return { app, scroll: scroll! }
}

test("消息锚点挂在 scrollbox 的直接子节点上,并带着那条消息的 id", async () => {
  const mounted = await mountAnchor("msg_abc123")
  try {
    const children = mounted.scroll.getChildren()
    const found = children.find((child) => child.id === "msg_abc123")
    // findNextVisibleMessage 过滤的就是这个列表(c.id 非空 + 在 messages 里能查到)。
    expect(found).toBeDefined()
    // 「直接子节点」是硬要求:往里再包一层,按 id 查就查不到了。
    expect(children).toHaveLength(1)
    expect(found).toBe(children[0])
    // ref 那半边也在:注册进 alwaysSeparate,前一个 part 才会跟它隔开一行。
    expect(alwaysSeparate.has(found as BoxRenderable)).toBe(true)
    expect(mounted.app.captureCharFrame()).toContain("hello")
  } finally {
    mounted.app.renderer.destroy()
  }
})

// **结构断言(不是渲染断言)**:整份 Session 挂不起来,所以「用户/助手两条消息的外层盒子用的
// 都是 MessageAnchor」只能从源码上钉。理由与它守的东西写在 message-anchor.tsx 的注释里 ——
// 删掉那个 id,六处跳转路径会同时静默失效而画面完全正常。
// 它只保证「两处都走锚点、且没有裸的 id= 盒子」,不保证渲染结果;渲染那半在上面的用例里。
test("会话区的两条消息都走 MessageAnchor(结构断言,见上面的说明)", () => {
  const source = readFileSync(path.join(import.meta.dir, "../../../src/routes/session/index.tsx"), "utf8")
  // 两个调用点的开场标签都写成多行(中间夹着解释各 prop 的注释),所以这里匹配「<MessageAnchor
  // 之后紧跟 messageID」的空白形态,而不是逐字那一行。
  expect(source).toMatch(/<MessageAnchor\s+messageID=\{props\.message\.id\}/)
  // 用户气泡那条还要带上靠右/顶行那几个 prop,单独数一次:两处锚点,不多不少。
  expect(source.match(/<MessageAnchor/g)).toHaveLength(2)
  // 锚点是唯一写 message id 的地方:裸的 <box id={props.message.id} 必须已经不存在。
  expect(source).not.toContain("<box id={props.message.id}")
})

// 上面那条只管「两个方向都走锚点」,管不了**锚点自己摆在哪 / 子元素要不要被拉伸** —— 而
// 气泡右缘贴不贴面板、气泡会不会被拉成一个宽盒子,就住在那两个 prop 上;message-meta 的 harness
// 又是手抄的生产结构,漂了不会有任何渲染测试变红。
//
// 断言前**先剥注释**:源码里有一段注释逐字写着这两个 prop 名(解释它们各管什么),不剥的话
// 断言会匹配到注释本身 —— 我第一次就是这么拿到一个假绿的:prop 被删了,测试照样过。
test("用户那条锚点带 alignSelf/alignItems=flex-end,助手那条都不带(结构断言)", () => {
  const raw = readFileSync(path.join(import.meta.dir, "../../../src/routes/session/index.tsx"), "utf8")
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const anchors = [...source.matchAll(/<MessageAnchor[\s\S]*?>/g)].map((match) => match[0])
  expect(anchors).toHaveLength(2)
  // 用户那条在源码里先出现(UserMessage 定义在 AssistantMessage 之前)。
  // alignSelf:带子(78%)被摆到交叉轴末端 → 右缘贴面板;
  // alignItems:子元素按内容收缩 → 气泡不被拉满;缺任一个都有一种可见的毛病(见生产注释)。
  expect(anchors[0]!).toContain('alignSelf="flex-end"')
  expect(anchors[0]!).toContain('alignItems="flex-end"')
  expect(anchors[0]!).toContain('width="100%"')
  // 助手那条走默认 stretch(左缘本来就是面板左缘),由调用点显式写明,免得再靠隐式默认。
  expect(anchors[1]!).not.toContain("alignSelf")
})

// 助手那条的另一半契约:**子元素按内容收缩**(alignItems="flex-start"),而**不带** alignSelf ——
// 它的左缘本来就是面板左缘,加 flex-end 会把左对齐的消息推到右边(右缘贴面板是用户那条的事)。
// 收缩还缺一环在卡壳上:NeonCard 默认 width="100%" 会按锚点宽度解析成整条 78% 的带,
// 所以生产那个 <NeonCard> 必须带 width="auto" —— 少了它短回复照样横跨 messageColumns。
//
// 同样**先剥注释**:生产那段注释里逐字写着 `alignItems="flex-start"` 与 `width="100%"`,
// 不剥的话把 prop 删掉断言照样绿(上面那条测试就是为这个坑补的剥除步骤,别再踩第二次)。
test("助手那条锚点带 alignItems=flex-start、不带 alignSelf,卡壳带 width=auto(结构断言)", () => {
  const raw = readFileSync(path.join(import.meta.dir, "../../../src/routes/session/index.tsx"), "utf8")
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const anchors = [...source.matchAll(/<MessageAnchor[\s\S]*?>/g)].map((match) => match[0])
  expect(anchors).toHaveLength(2)
  const assistant = anchors[1]
  expect(assistant).toContain('alignItems="flex-start"')
  expect(assistant).not.toContain("alignSelf")
  // 卡壳只有一处(助手气泡那张),且带 width="auto"
  const cards = [...source.matchAll(/<NeonCard[\s\S]*?>/g)].map((match) => match[0])
  expect(cards).toHaveLength(1)
  expect(cards[0]).toContain('width="auto"')
})
