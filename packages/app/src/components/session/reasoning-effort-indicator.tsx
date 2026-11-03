import { Show } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { ReasoningIndicator, type ReasoningIndicatorProps } from "@novaway/ui/reasoning-indicator"
import { ThinkingEffortIcon } from "@/components/thinking-effort-icon"
import { effortRatio } from "@/components/thinking-effort-color"
import { useLocal } from "@/context/local"

/**
 * 「思考过程」卡片左侧的图标：和输入框右上角的思考强度是同一颗大脑、
 * 同一条配色斜坡（低档青绿 → 高档紫），用户一眼能对上"现在用的是几档"。
 *
 * 模型没有思考强度档位（`default` 之外没有别的档）时退回内置脑图标 ——
 * 那时候画一颗"档位大脑"反而是误导。
 */
function ReasoningEffortIndicator(props: ReasoningIndicatorProps) {
  const local = useLocal()
  const ratio = () => {
    const stops = ["default", ...local.model.variant.list()]
    if (stops.length <= 1) return undefined
    const index = stops.indexOf(local.model.variant.current() ?? "default")
    return effortRatio(index < 0 ? 0 : index, stops.length)
  }

  return (
    // 注意用 `!== undefined` 判空：最低档的 ratio 就是 0，直接判真假会把它
    // 当成"没有档位"而错误地退回默认图标。
    <Show
      when={ratio() !== undefined}
      fallback={<Icon name="lu-brain" size="small" class={props.streaming ? "animate-pulse" : ""} />}
    >
      <ThinkingEffortIcon size={14} ratio={ratio() ?? 0} class={props.streaming ? "animate-pulse" : ""} />
    </Show>
  )
}

// 注册一次就全局生效：会话主线、辅助对话、脉冲对话渲染的是同一份 message-part。
ReasoningIndicator.register(ReasoningEffortIndicator)
