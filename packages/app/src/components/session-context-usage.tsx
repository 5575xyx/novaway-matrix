import { Show, createMemo } from "solid-js"
import { Popover } from "@novaway/ui/popover"
import { ProgressCircle } from "@novaway/ui/progress-circle"

import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { CacheUsageBody } from "@/components/cache-usage-panel"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { useSessionLayout } from "@/pages/session/session-layout"

// 输入框工具条上的会话上下文占用入口（对齐 ZCode 的 ChatContextUsage：触发器在
// composer 工具条上，点开是明细面板）。明细曾经塞在右侧状态面板的 context 卡里，
// 那张卡已随状态面板「按需出现」改造退出；这里就是它的新家 —— 点击圆环看
// token 占用 / 预算 / 花费与缓存命中统计。
export function SessionContextUsage() {
  const sync = useSync()
  const language = useLanguage()
  const providers = useProviders()
  const { params } = useSessionLayout()

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const metrics = createMemo(() =>
    getSessionContextMetrics(messages(), providers.all(), sync.data.config?.compaction),
  )
  const context = createMemo(() => metrics().context)
  const cost = () => usd().format(metrics().totalCost)

  return (
    <Show when={params.id}>
      <Popover
        placement="top-end"
        gutter={8}
        triggerAs="button"
        triggerProps={{
          type: "button",
          "data-action": "prompt-context-usage",
          class: "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover",
          "aria-label": language.t("context.usage.view"),
        } as Record<string, unknown>}
        trigger={
          <div class="flex items-center justify-center">
            <ProgressCircle size={16} strokeWidth={2} percentage={context()?.usage ?? 0} />
          </div>
        }
      >
        <div class="w-64">
          <div class="flex flex-col gap-1.5 px-3 pt-3">
            <Show when={context()}>
              {(ctx) => (
                <>
                  <StatRow label={language.t("context.usage.tokens")} value={ctx().total.toLocaleString(language.intl())} />
                  <StatRow label={language.t("context.usage.usage")} value={`${ctx().usage ?? 0}%`} />
                  <Show when={ctx().budget}>
                    {(budget) => (
                      <span class="text-12-regular text-foreground-subtle">
                        {language.t("context.usage.remaining", { percent: budget().percentLeft ?? 0 })}
                      </span>
                    )}
                  </Show>
                  <Show when={ctx().budget && ctx().budget!.status !== "normal"}>
                    <span class="text-12-regular text-warning">
                      {language.t(ctx().budget!.status === "blocking" ? "context.usage.blocking" : "context.usage.warning")}
                    </span>
                  </Show>
                </>
              )}
            </Show>
            <StatRow label={language.t("context.usage.cost")} value={cost()} />
          </div>
          <CacheUsageBody />
        </div>
      </Popover>
    </Show>
  )
}

function StatRow(props: { label: string; value: string }) {
  return (
    <div class="flex items-center justify-between gap-3">
      <span class="text-12-regular text-foreground-subtle">{props.label}</span>
      <Show when={props.value}>
        <span class="text-12-medium tabular-nums text-foreground">{props.value}</span>
      </Show>
    </div>
  )
}
