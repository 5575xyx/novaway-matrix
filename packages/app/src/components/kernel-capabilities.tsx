import { createMemo, createSignal, For, onMount, Show, type Component } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Switch } from "@novaway/ui/switch"
import { Tag } from "@novaway/ui/tag"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { SettingsGroup } from "./settings-parts"
import {
  featureDescription,
  featureDetail,
  featureLabel,
  orderFeatures,
  summarize,
  type Capability,
} from "./kernel-capabilities-model"

const BUDGET_OPTIONS = [30_000, 60_000, 120_000, 240_000] as const

/**
 * 「内核能力」概览。
 *
 * 这一块存在的意义是**可验证**：用户不用翻配置文件就能看到工具/技能/Hook/扩展
 * 真实加载了多少、哪些特性开着。数字全部来自运行中的服务（`GET /kernel`），
 * 不是写死的文案；没加载到东西时也会显示 0，而不是整块消失。
 */
export const KernelCapabilitiesCard: Component<{
  directory: string
  onOpenSettings?: (tab: "general" | "agents" | "hooks") => void
  onOpenTeams?: () => void
}> = (props) => {
  const sdk = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const [caps, setCaps] = createSignal<Capability | undefined>(undefined)
  const [error, setError] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const load = () => {
    setBusy(true)
    void sdk.client.kernel
      .capabilities({ directory: props.directory })
      .then((result) => {
        setCaps((result.data ?? undefined) as Capability | undefined)
        setError("")
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }

  onMount(load)

  const summary = createMemo(() => {
    const value = caps()
    if (!value) return undefined
    return summarize(value, (key, vars) => language.t(key as never, vars as never))
  })
  const features = createMemo(() => orderFeatures(caps()?.features ?? []))

  const experimental = createMemo(() => {
    const value = globalSync.data.config as { experimental?: Record<string, unknown> }
    return value.experimental ?? {}
  })
  const deferOn = () => experimental().defer_loading !== false
  const backgroundOn = () => experimental().background_subagents !== false
  const autoDelegateOn = () => experimental().auto_delegate !== false
  const budget = () => {
    const value = Number(experimental().tool_result_budget_chars)
    return Number.isFinite(value) && value > 0 ? value : 60_000
  }
  const budgetOptions = createMemo(() => {
    const values = new Set<number>([...BUDGET_OPTIONS, budget()])
    return [...values].sort((a, b) => a - b)
  })

  const save = async (patch: Record<string, unknown>) => {
    try {
      await globalSync.updateConfig({ experimental: { ...experimental(), ...patch } } as never)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const showDetail = (id: string) => id !== "background_subagents" && id !== "tool_result_budget"
  const selectClass =
    "h-6 rounded-md border border-border bg-surface px-1.5 text-ui-xs text-foreground outline-none focus:border-border-focus"

  return (
    <SettingsGroup>
      <div class="flex items-center gap-2 border-b border-border px-4 py-2">
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <span class="text-13-medium text-foreground">{language.t("settings.kernel.title")}</span>
            <Show when={summary()?.version}>{(version) => <Tag>{version()}</Tag>}</Show>
          </div>
          <div class="mt-0.5 text-12-regular text-foreground-subtle">{language.t("settings.kernel.hint")}</div>
        </div>
        <Button variant="ghost" size="small" disabled={busy()} onClick={load}>
          <Icon name="refresh" size="small" />
          {language.t("settings.kernel.refresh")}
        </Button>
      </div>

      <Show when={error()}>
        <div class="border-b border-border px-4 py-1.5 text-ui-xs text-destructive">{error()}</div>
      </Show>

      <Show when={summary()}>
        {(value) => (
          <div class="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
            <Tag>{value().tools}</Tag>
            <Tag>{value().skills}</Tag>
            <Tag>{value().hooks}</Tag>
            <Tag>{value().extensions}</Tag>
          </div>
        )}
      </Show>

      <Show when={features().length > 0}>
        <div class="flex flex-col divide-y divide-border">
          <For each={features()}>
            {(feature) => (
              <div class="flex min-w-0 items-center gap-2 px-4 py-2">
                <Icon
                  name={feature.enabled ? "circle-check" : "circle-ban-sign"}
                  size="small"
                  class="shrink-0"
                  classList={{
                    "text-success": feature.enabled,
                    "text-foreground-subtlest": !feature.enabled,
                  }}
                />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-ui-base text-foreground">
                    {featureLabel(feature.id, (key) => language.t(key as never))}
                  </div>
                  <Show when={featureDescription(feature.id, (key) => language.t(key as never))}>
                    {(description) => (
                      <div class="mt-0.5 text-ui-xs leading-relaxed text-foreground-subtle">{description()}</div>
                    )}
                  </Show>
                </div>
                <Show when={showDetail(feature.id) && featureDetail(feature)}>
                  {(detail) => (
                    <Tag>
                      {feature.id === "teams"
                        ? language.t("settings.kernel.roles", { count: Number(detail()) })
                        : feature.id === "defer_loading"
                          ? language.t("settings.kernel.deferredCount", { count: Number(detail()) })
                          : detail()}
                    </Tag>
                  )}
                </Show>
                <Show when={feature.id === "defer_loading"}>
                  <Switch checked={deferOn()} onChange={(value) => void save({ defer_loading: value })} hideLabel>
                    {language.t("settings.kernel.feature.defer_loading")}
                  </Switch>
                </Show>
                <Show when={feature.id === "background_subagents"}>
                  <Switch
                    checked={backgroundOn()}
                    onChange={(value) => void save({ background_subagents: value })}
                    hideLabel
                  >
                    {language.t("settings.kernel.feature.background_subagents")}
                  </Switch>
                </Show>
                <Show when={feature.id === "auto_delegate"}>
                  <Switch
                    checked={autoDelegateOn()}
                    onChange={(value) => void save({ auto_delegate: value })}
                    hideLabel
                  >
                    {language.t("settings.kernel.feature.auto_delegate")}
                  </Switch>
                </Show>
                <Show when={feature.id === "tool_result_budget"}>
                  <select
                    class={selectClass}
                    value={String(budget())}
                    aria-label={language.t("settings.kernel.feature.tool_result_budget")}
                    onChange={(event) => void save({ tool_result_budget_chars: Number(event.currentTarget.value) })}
                  >
                    <For each={budgetOptions()}>
                      {(value) => <option value={String(value)}>{Math.round(value / 1_000)}k</option>}
                    </For>
                  </select>
                </Show>
                <Show when={feature.id === "permission_mode" && props.onOpenSettings}>
                  <Button variant="ghost" size="small" onClick={() => props.onOpenSettings!("general")}>
                    {language.t("settings.kernel.edit")}
                  </Button>
                </Show>
                <Show when={feature.id === "teams"}>
                  <Show when={props.onOpenTeams}>
                    <Button variant="ghost" size="small" onClick={() => props.onOpenTeams!()}>
                      {language.t("sidebar.team")}
                    </Button>
                  </Show>
                  <Show when={props.onOpenSettings}>
                    <Button
                      variant="ghost"
                      size="small"
                      title={language.t("settings.kernel.manageAgentsHint")}
                      onClick={() => props.onOpenSettings!("agents")}
                    >
                      {language.t("settings.kernel.manageAgents")}
                    </Button>
                  </Show>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </SettingsGroup>
  )
}
