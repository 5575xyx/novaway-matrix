import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import type { SessionContextBreakdownKey, SessionContextBreakdownSegment } from "./session-context-breakdown"

export const BREAKDOWN_COLOR: Record<SessionContextBreakdownKey, string> = {
  system: "var(--syntax-info)",
  user: "var(--syntax-success)",
  assistant: "var(--syntax-property)",
  tool: "var(--syntax-warning)",
  other: "var(--syntax-comment)",
}

const breakdownLabel = (language: ReturnType<typeof useLanguage>, key: SessionContextBreakdownKey) => {
  if (key === "system") return language.t("context.breakdown.system")
  if (key === "user") return language.t("context.breakdown.user")
  if (key === "assistant") return language.t("context.breakdown.assistant")
  if (key === "tool") return language.t("context.breakdown.tool")
  return language.t("context.breakdown.other")
}

// 条形图 + 图例是 Context tab 与 Status Panel Context 区块的唯一一份渲染，配色与百分比口径不可能分叉。
// 字号类必须由调用方注入：tab 沿用历史样式（12/11px），Status Panel 受规格约束只能用 text-ui-*，
// 组件内部写死 text-ui-* 会让 tab 出现视觉回归，因此默认值保持 tab 现状。
export function SessionContextBreakdownView(props: {
  segments: SessionContextBreakdownSegment[]
  titleClass?: string
  legendClass?: string
}): JSX.Element {
  const language = useLanguage()
  const titleClass = props.titleClass ?? "text-12-regular"
  const legendClass = props.legendClass ?? "text-11-regular"

  return (
    <Show when={props.segments.length > 0}>
      <div class="flex flex-col gap-2">
        <div class={`${titleClass} text-foreground-subtle`}>{language.t("context.breakdown.title")}</div>
        <div class="h-2 w-full rounded-full bg-surface overflow-hidden flex">
          <For each={props.segments}>
            {(segment) => (
              <div
                class="h-full"
                style={{
                  width: `${segment.width}%`,
                  "background-color": BREAKDOWN_COLOR[segment.key],
                }}
              />
            )}
          </For>
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-1">
          <For each={props.segments}>
            {(segment) => (
              <div class={`flex items-center gap-1 ${legendClass} text-foreground-subtle`}>
                <div class="size-2 rounded-sm" style={{ "background-color": BREAKDOWN_COLOR[segment.key] }} />
                <div>{breakdownLabel(language, segment.key)}</div>
                <div class="text-foreground-subtlest">{segment.percent.toLocaleString(language.intl())}%</div>
              </div>
            )}
          </For>
        </div>
        <div class={`hidden ${legendClass} text-foreground-subtlest`}>{language.t("context.breakdown.note")}</div>
      </div>
    </Show>
  )
}
