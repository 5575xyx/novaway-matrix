// 信息页"消息"列表(挂在上下文块下面):列出当前会话里用户发过的每条消息,
// 点一条就把聊天区滚到那条消息的位置。滚动动作通过 message-jump 信号发给
// 会话区(index.tsx 订阅),插件槽里拿不到会话的滚动容器。
import type { TuiPlugin, TuiPluginApi } from "@opencode/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { setMessageJump } from "../../util/message-jump"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-messages"

// 消息摘要一行放得下:侧栏 42 列,减去缩进还有余量,超长截尾。
const MESSAGE_MAX = 26

function MessageRow(props: { api: TuiPluginApi; sessionID: string; messageID: string }) {
  const theme = () => props.api.theme.current
  // 摘要 = 该消息第一条有效的用户文本;纯附件消息给个占位。
  const label = createMemo(() => {
    const parts = props.api.state.part(props.messageID)
    const text = parts.find(
      (part) => part.type === "text" && !part.synthetic && !part.ignored && part.text.trim().length > 0,
    )
    return text?.type === "text" ? Locale.oneLine(text.text, MESSAGE_MAX) : "(附件)"
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
  const theme = () => props.api.theme.current
  const userMessages = createMemo(() =>
    props.api.state.session.messages(props.session_id).filter((message) => message.role === "user"),
  )

  return (
    <Show when={userMessages().length > 0}>
      <box>
        <text fg={theme().text}>
          <b>消息</b>
        </text>
        <For each={userMessages()}>
          {(message) => (
            <MessageRow api={props.api} sessionID={props.session_id} messageID={message.id} />
          )}
        </For>
      </box>
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
