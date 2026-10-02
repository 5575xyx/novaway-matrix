// 信息页"消息"列表(挂在上下文块下面):列出当前会话里用户发过的每条消息,
// 点一条就把聊天区滚到那条消息的位置。滚动动作通过 message-jump 信号发给
// 会话区(index.tsx 订阅),插件槽里拿不到会话的滚动容器。
// 会话一长这个列表就有几十行,把下面的待办事项、LSP 挤到要滚很远才看得见,
// 所以超过阈值时只保留最近的几条,箭头按钮手动展开全部
// (和"待办事项"块是同一套折叠模式)。
import type { TuiPlugin, TuiPluginApi } from "@opencode/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { CollapsibleSidebarCard } from "../../component/sidebar-card"
import { icon } from "../../util/panel-icons"
import { setMessageJump } from "../../util/message-jump"
import { Locale } from "../../util/locale"
import { SIDEBAR_CARD_MIN_CONTENT } from "../../util/sidebar-metrics"

const id = "internal:sidebar-messages"

// 消息摘要一行放得下:这条摘要落在「消息」分区卡的内容区里,最窄侧栏(44 列)下是 36 列
// (见 util/sidebar-metrics),26 留 10 列余量。按显示列算,中文摘要同样不会被撑破。
const MESSAGE_MAX = SIDEBAR_CARD_MIN_CONTENT - 10

// 超过这个条数才折叠:默认只留最近的几条,点箭头展开。
export const MESSAGE_COLLAPSE_AT = 5

// 折叠时只留最后(也就是最近)几条;展开或条数没超阈值时给全部。
// 列表按时间正序,所以"最近"在尾部。抽成纯函数是为了直接测阈值边界。
export function visibleMessages<T extends { id: string }>(
  messages: readonly T[],
  open: boolean,
  limit = MESSAGE_COLLAPSE_AT,
): T[] {
  if (open || messages.length <= limit) return [...messages]
  return messages.slice(-limit)
}

/**
 * 徽标要说实话:折叠时标「总数 · 仅显示 N 条」,全部可见时就只说总数。
 *
 * visible 必须来自 visibleMessages 的实时结果(也就是跟着 open 走),不能拿
 * MESSAGE_COLLAPSE_AT 顶替 —— 那样展开之后画面上是 8 行、徽标却还写着「仅显示 5 条」。
 */
export function messageBadge(total: number, visible: number): string {
  if (visible >= total) return `${total} 条`
  return `${total} 条 · 仅显示 ${visible} 条`
}

function MessageRow(props: { api: TuiPluginApi; sessionID: string; messageID: string }) {
  const theme = () => props.api.theme.current
  // 摘要 = 该消息第一条有效的用户文本;纯附件消息给个占位。
  // 按显示列压平成一行并截断(见 util/locale 的 oneLineToWidth):硬换行压不住,
  // 中文摘要按码元算又会超预算。
  const label = createMemo(() => {
    const parts = props.api.state.part(props.messageID)
    const text = parts.find(
      (part) => part.type === "text" && !part.synthetic && !part.ignored && part.text.trim().length > 0,
    )
    return text?.type === "text" ? Locale.oneLineToWidth(text.text, MESSAGE_MAX) : "(附件)"
  })
  return (
    <text
      fg={theme().textMuted}
      wrapMode="none"
      onMouseUp={() => setMessageJump({ messageID: props.messageID, nonce: Date.now() })}
    >
      {label()}
    </text>
  )
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const all = createMemo(() =>
    props.api.state.session.messages(props.session_id).filter((message) => message.role === "user"),
  )

  return (
    <Show when={all().length > 0}>
      {/* 默认折叠:超阈值时新消息照样出现在列表末尾,旧消息藏在箭头后面。
          折叠态只留最近几条(visibleMessages 那一段),展开后给全部。
          resetKey 让切会话回到默认折叠态。 */}
      <CollapsibleSidebarCard
        title="消息"
        icon={icon("chat")}
        // 徽标跟着当前可见条数走:展开之后不再说「仅显示 5 条」。
        badge={(open) => messageBadge(all().length, visibleMessages(all(), open()).length)}
        count={all().length}
        collapseAt={MESSAGE_COLLAPSE_AT}
        defaultOpen={false}
        resetKey={props.session_id}
        // 消息卡折叠时**不是**藏起来,而是只留最近几条 —— 所以由下面的 visibleMessages
        // 自己决定显示哪几条,不能让卡壳把正文一起收掉。
        hideWhenCollapsed={false}
      >
        {(open) => (
          <For each={visibleMessages(all(), open())}>
            {(message) => <MessageRow api={props.api} sessionID={props.session_id} messageID={message.id} />}
          </For>
        )}
      </CollapsibleSidebarCard>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    // 排在上下文(100)之后、MCP(200)之前,正好在"上下文"块下面。
    order: 150,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
