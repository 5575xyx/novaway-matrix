import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { createSessionContextFormatter } from "@/components/session/session-context-format"
import { SessionContextBreakdownView } from "@/components/session/session-context-breakdown-view"
import { useSessionContextData } from "@/components/session/use-session-context"
import { useSessionCacheUsage } from "@/components/cache-usage-panel"
import { contextSectionModel, type ContextSectionModel } from "./context-section-model"
import type { StatusPanelSection } from "./status-panel"

type TranslationKey = Parameters<ReturnType<typeof useLanguage>["t"]>[0]

type ContextStatRow = {
  label: TranslationKey
  value: string
}

/**
 * 上下文区块：token 占用 + 缓存命中率。
 *
 * 这两块原本是两个卡片，但描述的是同一件事 —— 这一轮/这个会话把上下文用在了哪里、
 * 其中多少是缓存命中的。分开摆会在右上角占掉两倍高度，展开后信息还重复
 * （上下文卡片里已经有 cacheRead/cacheWrite）。合并后：数字在同一张网格里，
 * 命中率单独一行带进度条。
 */
export function useContextSection(): () => StatusPanelSection | null {
  const language = useLanguage()
  const { metrics, breakdown } = useSessionContextData()
  const cache = useSessionCacheUsage()
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

  const hasContext = () => model() !== null
  const hasCache = () => cache.metrics().calls > 0
  // 只有缓存没有上下文时（例如模型没返回 limit）仍然保留这张卡片，否则统计会凭空消失。
  const visible = () => hasContext() || hasCache()

  return () => {
    const current = model()
    if (!visible()) return null

    return {
      id: "context",
      title: language.t("context.panel.title"),
      summary: current ? <>{summaryText(current)}</> : <>{cache.hitRate()}%</>,
      defaultOpen: false,
      bodyHeight: "max-h-96",
      children: (
        <div class="flex flex-col gap-3 px-3 pb-3">
          <Show when={current}>
            {(value) => (
              <div class="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <For each={rows(value())}>
                  {(row) => (
                    <div class="flex flex-col gap-0.5">
                      <span class="text-ui-sm text-foreground-subtle truncate">{language.t(row.label)}</span>
                      <span class="text-ui-base tabular-nums text-foreground truncate">{row.value}</span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </Show>

          <Show when={hasCache()}>
            <div class="flex flex-col gap-1.5 border-t border-border pt-2.5">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-ui-sm text-foreground-subtle">{language.t("cache.hit.rate")}</span>
                <span class="text-ui-base tabular-nums text-foreground">
                  {cache.hitRate()}%
                  <span class="ml-1.5 text-ui-sm text-foreground-subtle">
                    {language.t("cache.hit.calls" as never, { count: cache.metrics().calls } as never)}
                  </span>
                </span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-hover">
                <div
                  class="h-full rounded-full bg-[var(--icon-blue)] transition-all duration-300"
                  style={{ width: `${cache.hitRate()}%` }}
                />
              </div>
            </div>
          </Show>

          <Show when={current && current.breakdown.length > 0}>
            <SessionContextBreakdownView
              segments={current!.breakdown}
              titleClass="text-ui-sm"
              legendClass="text-ui-sm"
            />
          </Show>
        </div>
      ),
    }
  }
}
