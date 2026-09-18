// 信息页"消息"列表(挂在上下文块下面):列出当前会话里用户发过的每条消息,
// 点一条就把聊天区滚到那条消息的位置。滚动动作通过 message-jump 信号发给
// 会话区(index.tsx 订阅),插件槽里拿不到会话的滚动容器。
// 会话一长这个列表就有几十行,把下面的待办事项、LSP 挤到要滚很远才看得见,
// 所以超过阈值时只保留最近的几条,箭头按钮手动展开全部
// (和"待办事项"块是同一套折叠模式)。
import type { TuiPlugin, TuiPluginApi } from "@opencode/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { setMessageJump } from "../../util/message-jump"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-messages"

// 消息摘要一行放得下:侧栏 42 列,减去缩进还有余量,超长截尾。
const MESSAGE_MAX = 26

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
  // 默认折叠:超阈值时新消息照样出现在列表末尾,旧消息藏在箭头后面。
  const [open, setOpen] = createSignal(false)
  // 切会话回到默认折叠态,否则上个会话手动展开过的状态会被带过来。
  createEffect(on(() => props.session_id, () => setOpen(false), { defer: true }))
  const all = createMemo(() =>
    props.api.state.session.messages(props.session_id).filter((message) => message.role === "user"),
  )
  const collapsible = createMemo(() => all().length > MESSAGE_COLLAPSE_AT)
  const visible = createMemo(() => visibleMessages(all(), open()))
  // 隐藏条数 > 0 就说明当前处于折叠态,顺手把"总数 / 当前显示数"都标出来,
  // 免得用户以为消息丢了。
  const hidden = createMemo(() => all().length - visible().length)

  return (
    <Show when={all().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => collapsible() && setOpen((value) => !value)}>
          <Show when={collapsible()}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>消息</b>
          </text>
          <text fg={theme().textMuted}>
            {hidden() > 0 ? `${all().length} 条 · 仅显示 ${visible().length} 条` : `${all().length} 条`}
          </text>
        </box>
        <For each={visible()}>
          {(message) => <MessageRow api={props.api} sessionID={props.session_id} messageID={message.id} />}
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
