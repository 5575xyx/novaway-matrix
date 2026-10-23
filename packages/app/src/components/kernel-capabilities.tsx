import { createMemo, createSignal, For, onMount, Show, type Component } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Tag } from "@novaway/ui/tag"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { SettingsGroup } from "./settings-parts"
import { featureDetail, featureLabel, orderFeatures, summarize, type Capability } from "./kernel-capabilities-model"

/**
 * 「内核能力」概览。
 *
 * 这一块存在的意义是**可验证**：用户不用翻配置文件就能看到工具/技能/Hook/扩展
 * 真实加载了多少、哪些特性开着。数字全部来自运行中的服务（`GET /kernel`），
 * 不是写死的文案；没加载到东西时也会显示 0，而不是整块消失。
 */
export const KernelCapabilitiesCard: Component<{ directory: string }> = (props) => {
  const sdk = useGlobalSDK()
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
              <div class="flex min-w-0 items-center gap-2 px-4 py-1.5">
                <Icon
                  name={feature.enabled ? "circle-check" : "circle-ban-sign"}
                  size="small"
                  class="shrink-0"
                  classList={{
                    "text-success": feature.enabled,
                    "text-foreground-subtlest": !feature.enabled,
                  }}
                />
                <span class="min-w-0 flex-1 truncate text-ui-base text-foreground">
                  {featureLabel(feature.id, (key) => language.t(key as never))}
                </span>
                <Show when={featureDetail(feature)}>{(detail) => <Tag>{detail()}</Tag>}</Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </SettingsGroup>
  )
}
