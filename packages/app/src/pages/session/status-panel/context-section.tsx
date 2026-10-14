import { createMemo, For } from "solid-js"
import { useLanguage } from "@/context/language"
import { createSessionContextFormatter } from "@/components/session/session-context-format"
import { SessionContextBreakdownView } from "@/components/session/session-context-breakdown-view"
import { useSessionContextData } from "@/components/session/use-session-context"
import { contextSectionModel, type ContextSectionModel } from "./context-section-model"
import type { StatusPanelSection } from "./status-panel"

type TranslationKey = Parameters<ReturnType<typeof useLanguage>["t"]>[0]

type ContextStatRow = {
  label: TranslationKey
  value: string
}

// 区块描述符由调用方的 memo 驱动：model 为 null 时该区块整体不进 sections，面板随之不挂载。
// 数据链路走 useSessionContextData，与 Context tab 共用，展开态数字与 breakdown 必然一致。
export function useContextSection(): () => StatusPanelSection | null {
  const language = useLanguage()
  const { metrics, breakdown } = useSessionContextData()
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const model = createMemo(() => contextSectionModel(metrics(), breakdown()))

  const rows = (current: ContextSectionModel): ContextStatRow[] => [
    { label: "context.stats.usage", value: formatter().percent(current.usage) },
    { label: "context.stats.limit", value: formatter().number(current.limit) },
    { label: "context.stats.totalTokens", value: formatter().number(current.total) },
    { label: "context.stats.inputTokens", value: formatter().number(current.input) },
    { label: "context.stats.outputTokens", value: formatter().number(current.output) },
    { label: "context.stats.reasoningTokens", value: formatter().number(current.reasoning) },
    {
      label: "context.stats.cacheTokens",
      value: `${formatter().number(current.cacheRead)} / ${formatter().number(current.cacheWrite)}`,
    },
  ]

  // 收起摘要：有限制时给百分比，否则回落到已用 token 总数（capsule 只放数字，避免挤压宽度）。
  const summaryText = (current: ContextSectionModel) =>
    current.summary.kind === "percent"
      ? formatter().percent(current.summary.value)
      : formatter().number(current.summary.value)

  return () => {
    const current = model()
    if (!current) return null

    return {
      id: "context",
      title: language.t("context.panel.title"),
      summary: <>{summaryText(current)}</>,
      defaultOpen: false,
      children: (
        <div class="flex flex-col gap-2 px-3 pb-2">
          <div class="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <For each={rows(current)}>
              {(row) => (
                <div class="flex flex-col gap-0.5">
                  <span class="text-ui-sm text-foreground-subtle truncate">{language.t(row.label)}</span>
                  <span class="text-ui-base tabular-nums text-foreground truncate">{row.value}</span>
                </div>
              )}
            </For>
          </div>
          <SessionContextBreakdownView segments={current.breakdown} titleClass="text-ui-sm" legendClass="text-ui-sm" />
        </div>
      ),
    }
  }
}
