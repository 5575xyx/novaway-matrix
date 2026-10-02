/** @jsxImportSource @opentui/solid */
import type { JSX } from "@opentui/solid"
import type { BoxRenderable } from "@opentui/core"

/**
 * 消息锚点:消息列表里**每一条消息最外层那个盒子**,也是消息跳转唯一认的东西。
 *
 * 会话区有四条寻址路径全都按它工作(见 routes/session 的注释与实现):
 *   - `findNextVisibleMessage` / `scrollToMessage`:上一条 / 下一条;
 *   - `jumpToMessage`(信息页「消息」列表点一条、命令面板的跳转);
 *   - 时间线 / 子代理那条链上的同款查找。
 * 它们查的都是消息滚动容器的**直接子节点**里 `id === message.id` 的那一个。所以那个 id
 * 写在哪个盒子上、那个盒子是不是直接子节点,都不是外观问题:
 * 删掉它,四条路径会同时静默失效,而整屏看起来完全正常 —— 没有一条现成的测试能发现
 * (整份 Session 组件都挂不起来)。
 *
 * 所以这一层是**从 index.tsx 里切出来的缝**,为的是让「id 写在锚点上」这件事有一个能直接
 * 挂载、能直接断言的地方(test/routes/session/message-anchor.test.tsx)。切缝只搬了两件
 * 东西:那个 id,和注册进 alwaysSeparate 的那个 ref。盒子的其余形状(用户气泡靠右、
 * 助手恒 flexShrink=0、首条用户消息不顶行……)由调用点原样传进来,这里不猜。
 */

/** ref 由这里统一挂:调用点传自己的 ref 只会把注册这一步漏掉。 */
type AnchorProps = Omit<JSX.IntrinsicElements["box"], "id" | "ref">

export function MessageAnchor(props: AnchorProps & { messageID: string }) {
  return (
    <box {...props} id={props.messageID} ref={(element: BoxRenderable) => alwaysSeparate.add(element)}>
      {props.children}
    </box>
  )
}

/**
 * 「这个盒子即使只有 1 行,前一个 part 也要跟它隔开一行」的登记表。
 *
 * 住在 component/part 之前一直是 routes/session 里的一个 WeakSet(setPreLayoutSiblingMargin
 * 在 InlineTool / Task 那些行内工具上读它)。搬到这里是因为 MessageAnchor 的 ref 要用它 ——
 * 反过来让 message-anchor 反向依赖 routes/session 会成环(锚点壳必须能脱离会话区挂载测试)。
 * routes/session 仍然 re-export 它,既有 import 路径不变。
 */
export const alwaysSeparate = new WeakSet<BoxRenderable>()
