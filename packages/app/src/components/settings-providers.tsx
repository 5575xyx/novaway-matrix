import { Button } from "@novaway/ui/button"
import { useDialog } from "@novaway/ui/context/dialog"
import { ProviderIcon } from "@novaway/ui/provider-icon"
import { Tag } from "@novaway/ui/tag"
import { showToast } from "@novaway/ui/toast"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createMemo, type Component, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { DialogManageProviderModels } from "./dialog-manage-provider-models"
import { DialogSelectProvider } from "./dialog-select-provider"
import { DialogCustomProvider } from "./dialog-custom-provider"
import { SettingsList } from "./settings-list"
type AuthEntry = { type: string; key?: string }

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

const PROVIDER_NOTES = [
  { match: (id: string) => id === "opencode", key: "dialog.provider.NovaWay.note" },
  { match: (id: string) => id === "NovaWay-go", key: "dialog.provider.NovaWayGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

export const SettingsProviders: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const providers = useProviders()

  const connected = createMemo(() => {
    return providers
      .connected()
      .filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input))
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  const source = (item: ProviderItem): ProviderSource | undefined => {
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") {
      if (isConfigCustom(item.id)) return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) => source(item) !== "env"

  const canAddKey = (item: ProviderItem) => source(item) !== "env"

  const [authEntries, setAuthEntries] = createStore<Record<string, AuthEntry[]>>({})

  const loadAuthEntries = async () => {
    const result: Record<string, AuthEntry[]> = {}
    for (const p of connected()) {
      try {
        const res = await globalSDK.client.auth.list({ providerID: p.id })
        result[p.id] = res.data ?? []
      } catch {
        result[p.id] = []
      }
    }
    setAuthEntries(result)
  }

  onMount(() => {
    void loadAuthEntries()
  })

  const maskKey = (key: string) => {
    if (key.length <= 8) return "****"
    return key.slice(0, 4) + "..." + key.slice(-4)
  }

  const removeEntry = async (providerID: string, index: number, name: string) => {
    try {
      await globalSDK.client.auth.removeEntry({ providerID, entryIndex: String(index) })
      await globalSDK.client.global.dispose()
      await loadAuthEntries()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    }
  }

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const isConfigCustom = (providerID: string) => {
    const provider = globalSync.data.config.provider?.[providerID]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }

  const disableProvider = async (providerID: string, name: string) => {
    const before = globalSync.data.config.disabled_providers ?? []
    const next = before.includes(providerID) ? before : [...before, providerID]
    globalSync.set("config", "disabled_providers", next)

    await globalSync
      .updateConfig({ disabled_providers: next })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        globalSync.set("config", "disabled_providers", before)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const disconnect = async (providerID: string, name: string) => {
    if (isConfigCustom(providerID)) {
      await globalSDK.client.auth.remove({ providerID }).catch(() => undefined)
      await disableProvider(providerID, name)
      return
    }
    await globalSDK.client.auth
      .remove({ providerID })
      .then(async () => {
        await globalSDK.client.global.dispose()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 w-full">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.providers.title")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <div class="flex flex-col gap-1" data-component="connected-providers-section">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.providers.section.connected")}</h3>
          <SettingsList>
            <Show
              when={connected().length > 0}
              fallback={
                <div class="py-4 text-14-regular text-text-weak">
                  {language.t("settings.providers.connected.empty")}
                </div>
              }
            >
              <For each={connected()}>
                {(item) => {
                  const entries = authEntries[item.id]
                  return (
                    <div class="group py-3 border-b border-border-weak-base last:border-none">
                      <div class="flex flex-wrap items-center justify-between gap-4 min-h-8">
                        <div class="flex items-center gap-3 min-w-0">
                          <ProviderIcon id={item.id} class="size-5 shrink-0 icon-strong-base" />
                          <span class="text-14-medium text-text-strong truncate">{item.name}</span>
                          <Tag>{type(item)}</Tag>
                        </div>
                        <div class="flex items-center gap-2">
                          <Show when={canAddKey(item)}>
                            <Button
                              size="small"
                              variant="ghost"
                              icon="plus-small"
                              onClick={() => {
                                dialog.show(() => <DialogConnectProvider provider={item.id} mode="addkey" />)
                              }}
                            >
                              {language.t("provider.connect.method.apiKey")}
                            </Button>
                          </Show>
                          <Button
                            size="small"
                            variant="ghost"
                            onClick={() => {
                              dialog.show(() => (
                                <DialogManageProviderModels providerID={item.id} providerName={item.name} />
                              ))
                            }}
                          >
                            {language.t("dialog.model.manage")}
                          </Button>
                          <Show
                            when={canDisconnect(item)}
                            fallback={
                              <span class="text-14-regular text-text-base opacity-0 group-hover:opacity-100 transition-opacity duration-200 pr-3 cursor-default">
                                {language.t("settings.providers.connected.environmentDescription")}
                              </span>
                            }
                          >
                            <Button size="large" variant="ghost" onClick={() => void disconnect(item.id, item.name)}>
                              {language.t("common.disconnect")}
                            </Button>
                          </Show>
                        </div>
                      </div>
                      <Show when={entries && entries.length > 0}>
                        <div class="pl-8 pt-2 flex flex-col gap-1">
                          <For each={entries}>
                            {(entry, index) => (
                              <div class="flex items-center justify-between gap-2 text-13-regular text-text-base">
                                <span class="truncate font-mono">
                                  {entry.type === "api"
                                    ? maskKey(entry.key ?? "")
                                    : entry.type === "oauth"
                                      ? "OAuth"
                                      : "WellKnown"}
                                </span>
                                <button
                                  class="text-12-regular text-text-weak hover:text-text-critical-base shrink-0"
                                  onClick={() => void removeEntry(item.id, index(), item.name)}
                                >
                                  {language.t("common.remove")}
                                </button>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </Show>
          </SettingsList>
        </div>

        <div class="flex flex-col gap-4">
          <Button
            size="large"
            variant="primary"
            icon="plus-small"
            class="w-full py-4"
            onClick={() => {
              dialog.show(() => <DialogCustomProvider back="close" />)
            }}
          >
            {language.t("settings.providers.add.provider")}
          </Button>
          <p class="text-12-regular text-text-weak text-center">
            {language.t("settings.providers.add.provider.description")}
          </p>
        </div>
      </div>
    </div>
  )
}
