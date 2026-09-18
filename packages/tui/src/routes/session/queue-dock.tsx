import { For, Show, createMemo, createSignal } from "solid-js"
import { BoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import { draftPreview, type QueueDraft } from "../../prompt/queue"
import { useCommandShortcut } from "../../keymap"

type QueueDockProps = {
  items: QueueDraft[]
  sending?: string
  collapsed: boolean
  onToggle: () => void
  onSend: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onClearAll: () => void
  onMount?: (ref: BoxRenderable) => void
}

/**
 * 排队消息 dock：渲染在 Prompt 上方，展示当前会话中排队等待发送的提示。
 *
 * 折叠态显示条数 + 首条预览；展开态按顺序列出每条，支持「发送」「编辑」「删除」。
 * 键盘 `<leader>q` 切换折叠，鼠标点击操作按钮执行对应动作。
 */
export function QueueDock(props: QueueDockProps) {
  const { theme } = useTheme()
  const toggleShortcut = useCommandShortcut("session.queued_prompts")
  const [hover, setHover] = createSignal<string | null>(null)

  const count = createMemo(() => props.items.length)
  const preview = createMemo(() => (props.items[0] ? draftPreview(props.items[0], 48) : ""))
  const label = createMemo(() => (count() === 1 ? "1 条排队消息" : `${count()} 条排队消息`))

  return (
    <box
      ref={props.onMount}
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.secondary}
      customBorderChars={SplitBorder.customBorderChars}
      flexShrink={0}
    >
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={1} gap={1} flexShrink={0}>
        {/* 标题行：图标 + 条数 + 预览/提示 + 折叠按钮 */}
        <box
          flexDirection="row"
          gap={1}
          alignItems="center"
          onMouseUp={() => props.onToggle()}
          onMouseOver={() => setHover("toggle")}
          onMouseOut={() => setHover(null)}
          backgroundColor={hover() === "toggle" ? theme.backgroundElement : theme.backgroundPanel}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.secondary}>
            <span style={{ attributes: TextAttributes.BOLD }}>●</span>
          </text>
          <text fg={theme.text} wrapMode="none">
            <b>{label()}</b>
          </text>
          <Show when={props.collapsed}>
            <Show when={preview()}>
              <text fg={theme.textMuted} wrapMode="none">
                · {preview()}
              </text>
            </Show>
          </Show>
          <Show when={!props.collapsed}>
            <text fg={theme.textMuted} wrapMode="none">
              将按顺序自动发送
            </text>
          </Show>
          <box flexGrow={1} />
          <text fg={theme.textMuted} wrapMode="none">
            {props.collapsed ? "展开" : "折叠"} {toggleShortcut()}
          </text>
        </box>

        {/* 展开态：按序号列出每条消息 */}
        <Show when={!props.collapsed}>
          <box flexDirection="column" gap={1}>
            <For each={props.items}>
              {(item, index) => {
                const isSending = createMemo(() => item.id === props.sending)
                const isLast = createMemo(() => index() === props.items.length - 1)
                return (
                  <box
                    flexDirection="row"
                    gap={1}
                    paddingLeft={2}
                    paddingRight={1}
                    paddingTop={1}
                    paddingBottom={1}
                    backgroundColor={isSending() ? theme.backgroundElement : theme.backgroundPanel}
                    border={isLast() ? ["top"] : undefined}
                    borderColor={theme.border}
                    customBorderChars={SplitBorder.customBorderChars}
                    onMouseUp={() => props.onEdit(item.id)}
                    onMouseOver={() => setHover(`edit-${item.id}`)}
                    onMouseOut={() => setHover(null)}
                  >
                    <text fg={index() === 0 ? theme.secondary : theme.textMuted} wrapMode="none">
                      {index() + 1}
                    </text>
                    <text fg={theme.text} flexGrow={1}>
                      {isSending() ? <span style={{ fg: theme.secondary }}>发送中…</span> : draftPreview(item, 80)}
                    </text>
                    <Show when={!isSending()}>
                      <box
                        onMouseUp={(e) => {
                          e.stopPropagation()
                          props.onSend(item.id)
                        }}
                        onMouseOver={() => setHover(`send-${item.id}`)}
                        onMouseOut={() => setHover(null)}
                        backgroundColor={
                          hover() === `send-${item.id}` ? theme.backgroundElement : theme.backgroundPanel
                        }
                        paddingLeft={1}
                        paddingRight={1}
                      >
                        <text fg={theme.text}>发送</text>
                      </box>
                    </Show>
                    <Show when={!isSending()}>
                      <box
                        onMouseUp={(e) => {
                          e.stopPropagation()
                          props.onDelete(item.id)
                        }}
                        onMouseOver={() => setHover(`del-${item.id}`)}
                        onMouseOut={() => setHover(null)}
                        backgroundColor={hover() === `del-${item.id}` ? theme.backgroundElement : theme.backgroundPanel}
                        paddingLeft={1}
                        paddingRight={1}
                      >
                        <text fg={theme.textMuted}>删除</text>
                      </box>
                    </Show>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>

        {/* 展开态底部：清空全部 */}
        <Show when={!props.collapsed}>
          <box flexDirection="row" gap={1} paddingLeft={2} paddingRight={1}>
            <box flexGrow={1} />
            <box
              onMouseUp={(e) => {
                e.stopPropagation()
                props.onClearAll()
              }}
              onMouseOver={() => setHover("clear")}
              onMouseOut={() => setHover(null)}
              backgroundColor={hover() === "clear" ? theme.backgroundElement : theme.backgroundPanel}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.textMuted}>清空全部</text>
            </box>
          </box>
        </Show>
      </box>
    </box>
  )
}
