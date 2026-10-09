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
  expect(source).toContain("<MessageAnchor messageID={props.message.id}")
  // 用户气泡那条还要带上靠右/顶行那几个 prop,单独数一次:两处锚点,不多不少。
  expect(source.match(/<MessageAnchor/g)).toHaveLength(2)
  // 锚点是唯一写 message id 的地方:裸的 <box id={props.message.id} 必须已经不存在。
  expect(source).not.toContain("<box id={props.message.id}")
})

// 上面那条只管「两个方向都走锚点」,管不了**锚点自己摆在哪** —— 而右缘贴不贴面板就住在那一个
// prop 上,且 message-meta 的 harness 是手抄的生产结构,漂了不会有任何渲染测试变红。
// 用户原话:「不应该是左边就左边框对齐,右边就右边框对齐吗?」
test("用户那条锚点带 alignSelf=flex-end,助手那条不带(结构断言)", () => {
  const source = readFileSync(path.join(import.meta.dir, "../../../src/routes/session/index.tsx"), "utf8")
  const anchors = [...source.matchAll(/<MessageAnchor[\s\S]*?>/g)].map((match) => match[0])
  expect(anchors).toHaveLength(2)
  // 用户那条在源码里先出现(UserMessage 定义在 AssistantMessage 之前):宽 100% 被 78% 截断,
  // 再由 alignSelf="flex-end" 把带子摆到交叉轴末端 —— 少任何一个,右缘都退回 78% 那一列。
  expect(anchors[0]!).toContain('alignSelf="flex-end"')
  expect(anchors[0]!).toContain('alignItems="flex-end"')
  expect(anchors[0]!).toContain('width="100%"')
  // 助手那条是 flex-start(由 scrollbox 的默认 stretch 给,左缘本来就是面板左缘):
  // 多写一个 alignSelf 会把左对齐消息推到右边。
  expect(anchors[1]!).not.toContain("alignSelf")
})
