import { Show } from "solid-js"
import { useCommandShortcut } from "../keymap"
import { useTheme } from "../context/theme"
import { Logo } from "./logo"
import { AgentShowcase } from "./agent-showcase"

// 空会话首屏:大 Logo + 当前智能体的特征行 + 快捷键提示。
// 首页(尚无会话)和会话页(会话里还没有消息)共用同一块,保证两边布局一致不跳变;
// 发出第一条消息后随消息流自然上移消失。
export function EmptySessionHero(props: { paddingTop?: number }) {
  const { theme } = useTheme()
  const helpShortcut = useCommandShortcut("help.show")

  return (
    <box alignItems="center" width="100%" paddingTop={props.paddingTop ?? 3} flexShrink={0}>
      <Logo />
      <box height={1} flexShrink={0} />
      <AgentShowcase />
      <box height={2} flexShrink={0} />
      <Show when={helpShortcut()}>
        <text fg={theme.textMuted} wrapMode="none">
          按 <span style={{ fg: theme.text }}>{helpShortcut()}</span> 显示键盘快捷键
        </text>
      </Show>
    </box>
  )
}
