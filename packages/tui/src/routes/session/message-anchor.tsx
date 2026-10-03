/** @jsxImportSource @opentui/solid */
import type { JSX } from "@opentui/solid"
import type { BoxRenderable } from "@opentui/core"

/**
 * 消息锚点:消息列表里**每一条消息最外层那个盒子**,也是消息跳转唯一认的东西。
 *
 * 会话区有六处寻址全都按它工作,查的都是消息滚动容器的**直接子节点**里
 * `id === message.id` 的那一个(括号里是 routes/session 的行号):
 *   - findNextVisibleMessage / scrollToMessage:上一条 / 下一条(821、857);
 *   - `session.timeline`「跳转到消息」(1028)与 `session.fork`「分叉会话」(1051);
 *   - 首条用户消息上翻(1357);
 *   - jumpToMessage:信息页「消息」列表点一条、以及 subscribeMessageJump 的订阅者(1741)。
 *
 * 所以那个 id 写在哪个盒子上、那个盒子是不是直接子节点,都不是外观问题:删掉它,上面六处
 * 会同时静默失效,而整屏看起来完全正常 —— 没有一条现成的测试能发现(整份 Session 组件都
 * 挂不起来)。
 *
 * 因此这一层是**从 index.tsx 里切出来的缝**,为的是让「id 写在锚点上」这件事有一个能直接
 * 挂载、能直接断言的地方(test/routes/session/message-anchor.test.tsx)。切缝只搬了两件
 * 东西:那个 id,和注册进 alwaysSeparate 的那个 ref。盒子的其余形状(用户气泡靠右、
 * 助手恒 flexShrink=0、首条用户消息不顶行……)由调用点原样传进来,这里不猜 ——
 * 只有一个例外:宽度上限 MESSAGE_MAX_WIDTH 住在这一层(理由见那段注释)。
 */

/**
 * 消息列的宽度上限(原型的 `.msg { max-width: 78% }`,card-design-v7.html:394)。
 *
 * **一条,两个方向**:原型那一条 `.msg` 同时管 `.msg.user` 与 `.msg.assistant` —— 两条消息共用
 * 同一个阅读宽度。用户那条与助手那条因此在同一条右缘/左缘上,一屏里两种气泡看起来是同一套尺寸。
 * 给两个方向各写一个数(改造前用户气泡是 70%、助手卡没有上限)只会得到「看不出理由的不对称」。
 *
 * **为什么上限落在消息列这一层,而不是各自的气泡上**:`.msg` 里装的是 meta 行 + 气泡两块。
 * 挂在气泡上的话,meta 行仍然按整列排 —— 用户那条的 meta 右缘就会比气泡右缘多出 8% 的宽度,
 * 「时间和气泡分到了两边」那一处又回来了(见 test/routes/session/message-meta.test.tsx)。
 *
 * **为什么是 78% 而不是更小的数**:这一列右边留白的那部分在原型的 `.chat` 里就是消息流本身;
 * 助手气泡里嵌着工具卡,工具卡的 head 上还并排着状态摘要(原型的 `✓ 12 passed`),三者都要横向
 * 的位置。收到 60% 的话,窄一点的终端上 head 上最先被牺牲的就是摘要。
 */
export const MESSAGE_MAX_WIDTH = "78%"

/**
 * 消息列在 `ctxWidth` 列下解析出来的**整列**宽度。
 *
 * 宽度上限是百分比,而这一层所有的宽度预算(metaModelLimit、工具卡的 head 预算、diff 的并排阈值)
 * 都要一个整数列数才能算 —— 这个函数就是那一步换算,四舍五入到整列,与 yoga 落百分比的方式一致。
 *
 * 算错了的代价是可见的:少算一列,head 上的状态摘要就被霓虹边框切掉一截,而 `<text>` 默认
 * wrapMode 是 word,切掉的部分既不折行也不留省略号(那一层是自己按列截断的,见 toolHeadLayout)。
 */
export function messageColumns(ctxWidth: number) {
  return Math.round((ctxWidth * 78) / 100)
}

/** ref 由这里统一挂:调用点传自己的 ref 只会把注册这一步漏掉。 */
type AnchorProps = Omit<JSX.IntrinsicElements["box"], "id" | "ref">

export function MessageAnchor(props: AnchorProps & { messageID: string }) {
  return (
    <box
      {...props}
      id={props.messageID}
      maxWidth={MESSAGE_MAX_WIDTH}
      ref={(element: BoxRenderable) => alwaysSeparate.add(element)}
    >
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
