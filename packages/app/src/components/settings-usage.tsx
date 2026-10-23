import type { AssistantMessage } from "@novaway/sdk/v2/client"
import { createMemo, For, Show, type Component } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { SettingsGroup } from "./settings-parts"

type Totals = {
  sessions: number
  messages: number
  cost: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

type ModelTotals = Totals & { key: string; providerID: string; modelID: string }

const emptyTotals = (): Totals => ({
  sessions: 0,
  messages: 0,
  cost: 0,
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
})

/**
 * 使用统计（对齐 ZCode 的「数据与统计 → 使用统计」）。
 *
 * 数据来自本目录已加载的会话消息：每条 assistant 消息自带 tokens 与 cost。
 * 只统计**当前工作区**，因为同步 store 按目录隔离；换目录后数字随之变化，
 * 比跨目录聚合更符合"我在这里花了多少"的直觉。
 */
export const SettingsUsage: Component<{ directory?: string }> = (props) => {
  const language = useLanguage()
  const globalSync = useGlobalSync()

  // 设置面板没有目录级 Sync Provider，直接取该目录的同步 store。
  const store = createMemo(() => {
    const directory = props.directory
    if (!directory) return { message: {} } as { message: Record<string, unknown[]> }
    return globalSync.child(directory, { bootstrap: false })[0] as unknown as {
      message: Record<string, unknown[]>
    }
  })

  const rows = createMemo(() =>
    Object.values(store().message ?? {})
      .flat()
      .filter((message): message is AssistantMessage => (message as AssistantMessage)?.role === "assistant"),
  )

  const totals = createMemo<Totals>(() => {
    const result = emptyTotals()
    for (const message of rows()) {
      result.messages += 1
      result.cost += Number(message.cost) || 0
      const tokens = message.tokens
      result.input += Number(tokens?.input) || 0
      result.output += Number(tokens?.output) || 0
      result.reasoning += Number(tokens?.reasoning) || 0
      result.cacheRead += Number(tokens?.cache?.read) || 0
      result.cacheWrite += Number(tokens?.cache?.write) || 0
    }
    result.sessions = Object.keys(store().message ?? {}).length
    return result
  })

  const byModel = createMemo<ModelTotals[]>(() => {
    const map = new Map<string, ModelTotals>()
    for (const message of rows()) {
      const providerID = message.providerID ?? "unknown"
      const modelID = message.modelID ?? "unknown"
      const key = `${providerID}/${modelID}`
      const current = map.get(key) ?? { ...emptyTotals(), key, providerID, modelID }
      current.messages += 1
      current.cost += Number(message.cost) || 0
      current.input += Number(message.tokens?.input) || 0
      current.output += Number(message.tokens?.output) || 0
      current.reasoning += Number(message.tokens?.reasoning) || 0
      current.cacheRead += Number(message.tokens?.cache?.read) || 0
      current.cacheWrite += Number(message.tokens?.cache?.write) || 0
      map.set(key, current)
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost || b.input - a.input)
  })

  const modelName = (providerID: string, modelID: string) => {
    const provider = globalSync.data.provider?.all?.find((item) => item.id === providerID)
    return provider?.models?.[modelID]?.name ?? modelID
  }

  const number = (value: number) => new Intl.NumberFormat().format(Math.round(value))
  const money = (value: number) => `$${value.toFixed(value < 1 ? 4 : 2)}`

  const summary = createMemo(() => [
    { label: language.t("settings.usage.total.cost" as never), value: money(totals().cost) },
    { label: language.t("settings.usage.total.messages" as never), value: number(totals().messages) },
    { label: language.t("settings.usage.total.sessions" as never), value: number(totals().sessions) },
    { label: language.t("settings.usage.total.input" as never), value: number(totals().input) },
    { label: language.t("settings.usage.total.output" as never), value: number(totals().output) },
    { label: language.t("settings.usage.total.reasoning" as never), value: number(totals().reasoning) },
    { label: language.t("settings.usage.total.cacheRead" as never), value: number(totals().cacheRead) },
    { label: language.t("settings.usage.total.cacheWrite" as never), value: number(totals().cacheWrite) },
  ])

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--popover)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 w-full">
          <h2 class="text-16-medium text-foreground">{language.t("settings.usage.title" as never)}</h2>
          <p class="text-13-regular text-foreground-subtle">{language.t("settings.usage.description" as never)}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <For each={summary()}>
            {(item) => (
              <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-3">
                <span class="text-11-regular text-foreground-subtle">{item.label}</span>
                <span class="text-16-medium tabular-nums text-foreground">{item.value}</span>
              </div>
            )}
          </For>
        </div>

        <div>
          <h3 class="pb-2 text-14-medium text-foreground">{language.t("settings.usage.byModel" as never)}</h3>
          <SettingsGroup>
            <Show
              when={byModel().length > 0}
              fallback={
                <div class="px-4 py-6 text-center text-13-regular text-foreground-subtle">
                  {language.t("settings.usage.empty" as never)}
                </div>
              }
            >
              <For each={byModel()}>
                {(item) => (
                  <div class="flex min-w-0 items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
                    <div class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate text-13-medium text-foreground">
                        {modelName(item.providerID, item.modelID)}
                      </span>
                      <span class="mt-0.5 truncate text-11-regular text-foreground-subtle">
                        {item.providerID} · {number(item.messages)} 条
                      </span>
                    </div>
                    <div class="flex shrink-0 items-center gap-4 text-11-regular tabular-nums text-foreground-subtle">
                      <span title={language.t("settings.usage.total.input" as never)}>{number(item.input)}</span>
                      <span title={language.t("settings.usage.total.output" as never)}>{number(item.output)}</span>
                      <span class="min-w-14 text-right text-12-medium text-foreground">{money(item.cost)}</span>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </SettingsGroup>
        </div>
      </div>
    </div>
  )
}
