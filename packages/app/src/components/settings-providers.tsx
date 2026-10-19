import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { useDialog } from "@novaway/ui/context/dialog"
import { ProviderIcon } from "@novaway/ui/provider-icon"
import { providerIconId } from "@/utils/provider-icon"
import { Tag } from "@novaway/ui/tag"
import { showToast } from "@novaway/ui/toast"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createMemo, createSignal, type Component, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { DialogManageProviderModels } from "./dialog-manage-provider-models"
import { DialogSelectProvider } from "./dialog-select-provider"
import { DialogCustomProvider } from "./dialog-custom-provider"
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

  const [selectedProvider, setSelectedProvider] = createSignal<string>()
  const current = createMemo(() => {
    const id = selectedProvider()
    return connected().find((item) => item.id === id) ?? connected()[0]
  })
  const addProvider = () => dialog.show(() => <DialogSelectProvider />)
  const customProvider = () => dialog.show(() => <DialogCustomProvider back="close" />)

  const providerRow = (item: ProviderItem, connectedRow: boolean) => (
    <button
      type="button"
      class="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors"
      classList={{
        "bg-selected": connectedRow && current()?.id === item.id,
        "hover:bg-hover": !connectedRow || current()?.id !== item.id,
      }}
      onClick={() => {
        if (!connectedRow) {
          dialog.show(() => <DialogConnectProvider provider={item.id} />)
          return
        }
        setSelectedProvider(item.id)
      }}
    >
      <ProviderIcon id={providerIconId(item.id, item.name)} class="size-4.5 shrink-0 text-foreground" />
      <span class="min-w-0 flex-1 truncate text-13-regular text-foreground">{item.name}</span>
      <Show when={connectedRow}>
        <span class="size-1.5 shrink-0 rounded-full bg-[var(--diff-added)]" />
      </Show>
      <Show when={!connectedRow}>
        <Icon name="plus-small" size="small" class="shrink-0 text-foreground-subtlest" />
      </Show>
    </button>
  )

  return (
    <div class="flex h-full flex-col overflow-hidden">
      <div class="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4 sm:px-10">
        <div class="flex flex-col gap-1">
          <h2 class="text-20-semibold text-foreground">{language.t("settings.providers.title")}</h2>
          <p class="text-13-regular text-foreground-subtle">{language.t("settings.providers.description")}</p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <IconButton
            icon="reset"
            variant="ghost"
            aria-label={language.t("common.refresh")}
            onClick={() => void loadAuthEntries()}
          />
          <Button variant="primary" size="small" icon="plus-small" onClick={addProvider}>
            {language.t("settings.providers.add.provider")}
          </Button>
        </div>
      </div>

      <div class="mx-4 mb-6 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border sm:mx-10">
        <div class="flex w-64 shrink-0 flex-col border-r border-border">
          <div class="flex-1 overflow-y-auto p-2">
            <div class="px-2 pb-1 pt-1 text-11-medium uppercase tracking-wide text-foreground-subtlest">
              {language.t("settings.providers.section.connected")}
            </div>
            <Show
              when={connected().length > 0}
              fallback={
                <div class="px-2 py-2 text-12-regular text-foreground-subtle">
                  {language.t("settings.providers.connected.empty")}
                </div>
              }
            >
              <For each={connected()}>{(item) => providerRow(item, true)}</For>
            </Show>
            <div class="px-2 pb-1 pt-4 text-11-medium uppercase tracking-wide text-foreground-subtlest">
              {language.t("settings.providers.section.available" as never)}
            </div>
            <For each={popular()}>{(item) => providerRow(item, false)}</For>
            <button
              type="button"
              class="mt-2 flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-13-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
              onClick={customProvider}
            >
              <span class="grid size-4.5 shrink-0 place-items-center rounded border border-dashed border-border">
                <Icon name="plus-small" size="small" />
              </span>
              {language.t("settings.providers.add.custom" as never)}
            </button>
          </div>
        </div>

        <div class="min-w-0 flex-1 overflow-y-auto">
          <Show
            when={current()}
            fallback={
              <div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <Icon name="providers" size="normal" class="text-foreground-subtlest" />
                <span class="text-13-regular text-foreground-subtle">
                  {language.t("settings.providers.connected.empty")}
                </span>
                <Button variant="secondary" size="small" icon="plus-small" onClick={addProvider}>
                  {language.t("settings.providers.add.provider")}
                </Button>
              </div>
            }
          >
            {(item) => (
              <div class="flex flex-col gap-5 p-6">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="flex min-w-0 items-center gap-3">
                    <ProviderIcon id={providerIconId(item().id, item().name)} class="size-8 shrink-0 text-foreground" />
                    <div class="flex min-w-0 flex-col gap-1">
                      <div class="flex min-w-0 flex-wrap items-center gap-2">
                        <span class="truncate text-16-medium text-foreground">{item().name}</span>
                        <Tag>{type(item())}</Tag>
                      </div>
                      <span class="text-12-regular text-foreground-subtle">
                        {language.t("settings.providers.detail.models" as never, {
                          count: Object.keys(item().models ?? {}).length,
                        } as never)}
                      </span>
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <Show when={canAddKey(item())}>
                      <Button
                        size="small"
                        variant="secondary"
                        icon="plus-small"
                        onClick={() => {
                          dialog.show(() => <DialogConnectProvider provider={item().id} mode="addkey" />)
                        }}
                      >
                        {language.t("provider.connect.method.apiKey")}
                      </Button>
                    </Show>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => {
                        dialog.show(() => (
                          <DialogManageProviderModels providerID={item().id} providerName={item().name} />
                        ))
                      }}
                    >
                      {language.t("dialog.model.manage")}
                    </Button>
                    <Show when={canDisconnect(item())}>
                      <Button size="small" variant="ghost" onClick={() => void disconnect(item().id, item().name)}>
                        {language.t("common.disconnect")}
                      </Button>
                    </Show>
                  </div>
                </div>

                <Show when={note(item().id)}>
                  {(key) => <p class="text-12-regular leading-5 text-foreground-subtle">{language.t(key() as never)}</p>}
                </Show>
                <div class="flex flex-col gap-2">
                  <span class="text-12-medium text-foreground-subtle">
                    {language.t("settings.providers.detail.credentials" as never)}
                  </span>
                  <Show
                    when={(authEntries[item().id] ?? []).length > 0}
                    fallback={
                      <span class="text-12-regular text-foreground-subtlest">
                        {language.t("settings.providers.connected.environmentDescription")}
                      </span>
                    }
                  >
                    <div class="flex flex-col overflow-hidden rounded-lg border border-border">
                      <For each={authEntries[item().id]}>
                        {(entry, index) => (
                          <div class="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-12-regular first:border-t-0">
                            <span class="truncate font-mono text-foreground">
                              {entry.type === "api"
                                ? maskKey(entry.key ?? "")
                                : entry.type === "oauth"
                                  ? "OAuth"
                                  : "WellKnown"}
                            </span>
                            <button
                              class="shrink-0 text-12-regular text-foreground-subtle hover:text-destructive"
                              onClick={() => void removeEntry(item().id, index(), item().name)}
                            >
                              {language.t("common.remove")}
                            </button>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}
