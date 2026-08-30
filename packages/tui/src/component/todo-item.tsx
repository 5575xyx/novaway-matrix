import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"

export interface TodoItemProps {
  status: string
  content: string
}

// 待办文本是模型写的,长度和换行都不受约束。这一行的结构是"固定宽度的 [ ] 标记 + 正文",
// 正文多一行、标记列就少一行,而侧栏那一份只有 40 列宽 —— 一条几百字的待办能把整个面板顶掉。
// 这里统一压平并截断,两个调用方(会话流和侧栏)都受这一处保护。
const CONTENT_MAX = 200

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  return (
    <box flexDirection="row" gap={0}>
      <text
        flexShrink={0}
        style={{
          fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
      >
        [{props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "}]{" "}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        style={{
          fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
      >
        {Locale.oneLine(props.content, CONTENT_MAX)}
      </text>
    </box>
  )
}
