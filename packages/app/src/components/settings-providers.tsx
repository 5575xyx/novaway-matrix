import type { ProviderConfig } from "@novaway/sdk/v2/client"
import { Button } from "@novaway/ui/button"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { useDialog } from "@novaway/ui/context/dialog"
import { ProviderIcon } from "@novaway/ui/provider-icon"
import { Switch } from "@novaway/ui/switch"
import { modelIconId, providerIconId } from "@/utils/provider-icon"
import { Tag } from "@novaway/ui/tag"
import { showToast } from "@novaway/ui/toast"
import { writeClipboard } from "@novaway/ui/util/clipboard"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { useQueryClient } from "@tanstack/solid-query"
import { createMemo, createSignal, type Component, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useModels } from "@/context/models"
import { ModelCapabilitySummary } from "./model-capability-summary"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { DialogManageProviderModels } from "./dialog-manage-provider-models"
import { AiFixButton } from "./ai-fix-button"
import { DialogSelectProvider } from "./dialog-select-provider"
import { DialogCustomProvider } from "./dialog-custom-provider"
type AuthEntry = { type: string; key?: string }
type Modality = NonNullable<NonNullable<NonNullable<ProviderConfig["models"]>[string]["modalities"]>["input"]>[number]

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
  const models = useModels()
  const queryClient = useQueryClient()
  const [expandedModels, setExpandedModels] = createStore<Record<string, boolean>>({})

  // 供应商详情内联模型列表：模型页合并进来后，开关仍然沿用 useModels 的可见性状态。
  const providerModels = (providerID: string) =>
    models
      .list()
      .filter((model) => model.provider.id === providerID)
      .sort((a, b) => a.name.localeCompare(b.name))

  const modelsExpanded = (providerID: string) => expandedModels[providerID] ?? true

  const modelKey = (providerID: string, modelID: string) => ({ providerID, modelID })

  const markModelModality = async (providerID: string, modelID: string, modality: "image" | "video") => {
    try {
      const configResponse = await globalSDK.client.global.config.get()
      const currentConfig = configResponse.data ?? {}
      const providerConfig = currentConfig.provider?.[providerID] ?? {}
      const modelsConfig = providerConfig.models ?? {}
      const modelConfig = modelsConfig[modelID] ?? {}
      const currentModalities = modelConfig.modalities ?? { input: ["text"], output: [] }
      const input = new Set<Modality>(currentModalities.input ?? ["text"])
      const output = new Set<Modality>(currentModalities.output ?? [])
      input.add("image")
      output.add(modality)
      await globalSDK.client.global.config.update({
        config: {
          ...currentConfig,
          provider: {
            ...currentConfig.provider,
            [providerID]: {
              ...providerConfig,
              models: {
                ...modelsConfig,
                [modelID]: {
                  ...modelConfig,
                  modalities: { input: Array.from(input), output: Array.from(output) },
                },
              },
            },
          },
        },
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.providers.models.marked", {
          model: modelID,
          kind:
            modality === "image"
              ? language.t("settings.providers.models.image")
              : language.t("settings.providers.models.video"),
        }),
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    }
  }

  const connected = createMemo(() => {
    /*
     * `disabled_providers` 是本地的即时真值：断开时先写进 store，再等服务端
     * 重建实例 + 重新查询。服务端那趟往返要几秒，不在这里先过滤掉的话，
     * 用户点完「断开连接」会看到卡片原地不动 —— 就是"断开无效"的观感。
     */
    const disabled = new Set(globalSync.data.config.disabled_providers ?? [])
    return providers
      .connected()
      .filter((p) => !disabled.has(p.id))
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

  /**
   * 被「断开连接」屏蔽掉的配置类供应商。
   *
   * 服务端把这些 id 从 provider 列表里整个剔除了，所以它们既不在"已连接"里，
   * 也不会出现在可添加列表 —— 用户会以为供应商被删了、找不回来。
   * 这里从配置文件里把它们重新列出来，点一下就能恢复。
   */
  const disconnected = createMemo(() => {
    const disabled = new Set(globalSync.data.config.disabled_providers ?? [])
    const connectedIDs = new Set(connected().map((p) => p.id))
    return Object.entries(globalSync.data.config.provider ?? {})
      .filter(([id]) => disabled.has(id) && !connectedIDs.has(id))
      .map(([id, provider]) => ({ id, name: provider?.name ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const reconnect = async (providerID: string, name: string) => {
    const before = globalSync.data.config.disabled_providers ?? []
    const next = before.filter((id) => id !== providerID)
    globalSync.set("config", "disabled_providers", next)

    try {
      await globalSync.updateConfig({ disabled_providers: next })
      await globalSDK.client.global.dispose().catch(() => undefined)
      await refreshProviderQueries()
      await loadAuthEntries()
      setSelectedProvider(providerID)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: name }),
        description: language.t("provider.connect.toast.connected.description", { provider: name }),
      })
    } catch (err: unknown) {
      globalSync.set("config", "disabled_providers", before)
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    }
  }

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
  /** 哪些密钥行被「眼睛」揭开：`providerID:index` → 是否明文显示。 */
  const [revealed, setRevealed] = createStore<Record<string, boolean>>({})

  const copyKey = async (key: string, name: string) => {
    const copied = await writeClipboard(key)
    showToast(
      copied
        ? {
            variant: "success",
            icon: "circle-check",
            title: language.t("settings.providers.credentials.copied.title", { provider: name }),
            description: language.t("settings.providers.credentials.copied.description"),
          }
        : {
            title: language.t("common.requestFailed"),
            description: language.t("settings.providers.credentials.copyFailed"),
          },
    )
  }

  // 断开/移除凭据后必须让按目录缓存的 provider 查询失效：connected 列表来自那次查询，
  // 只刷 authEntries 不会动它，卡片会一直显示成"已连接"。
  const refreshProviderQueries = () =>
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[1] === "providers" })

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
      await refreshProviderQueries()
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
      .then(async () => {
        // config.update 触发的实例销毁是异步 fork 的，紧接着的查询可能仍打到旧实例；
        // 这里显式再 dispose 一次，再刷新 provider 查询，卡片才会立刻消失。
        await globalSDK.client.global.dispose().catch(() => undefined)
        await refreshProviderQueries()
        await loadAuthEntries()
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

  /**
   * 凭据那一行的说明文字。
   *
   * 以前只要没有 auth 条目就写「已通过环境变量连接」—— 对 config / 自定义供应商是错的，
   * 用户断开后看到这句话会以为"根本没断开"。
   */
  const credentialHint = (item: ProviderItem) => {
    const current = source(item)
    if (current === "env") {
      const vars = "env" in item ? (item.env ?? []) : []
      if (vars.length > 0)
        return language.t("settings.providers.credentials.environmentWithVars", { vars: vars.join(", ") })
      return language.t("settings.providers.connected.environmentDescription")
    }
    if (current === "config") return language.t("settings.providers.credentials.configDescription" as never)
    if (current === "custom") return language.t("settings.providers.credentials.customDescription" as never)
    return language.t("settings.providers.credentials.none" as never)
  }

  const disconnect = async (providerID: string, name: string) => {
    const item = providers.connected().find((provider) => provider.id === providerID)
    const current = item ? source(item) : undefined

    try {
      /*
       * config 里声明过的供应商不靠 auth 记录存在：哪怕没密钥，它也会因为
       * `config.provider[id]` 这一条继续出现在"已连接"里（用户看到的"配置"标签）。
       * 而全局配置接口是**深合并**写入的 —— 把键从 payload 里删掉并不会真的删文件里的键。
       * 所以这里用 `disabled_providers`：服务端会把它从 provider 列表里彻底剔除，
       * 设置页会把它列回"可添加"区，点一下即可重连。
       *
       * 这类供应商**不删密钥**：屏蔽只是"先停用"，删了密钥再恢复就得重新填一遍。
       */
      if (current === "config" || current === "custom") {
        await disableProvider(providerID, name)
      } else {
        // 其余来源（api / oauth）的凭据就是它存在的理由，断开时一并删掉。
        await globalSDK.client.auth.remove({ providerID }).catch(() => undefined)
        // 让实例立刻按新凭据重建；只等 config 事件里的异步 dispose 会和下面的刷新赛跑。
        await globalSDK.client.global.dispose().catch(() => undefined)
        await refreshProviderQueries()
        await loadAuthEntries()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    }
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
      <ProviderIcon
        id={providerIconId(item.id, item.name)}
        colorId={item.id}
        brand
        class="size-4.5 shrink-0 text-foreground"
      />
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
        </div>
      </div>

      <div class="mx-4 mb-6 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border sm:mx-10">
        <div class="flex w-64 shrink-0 flex-col border-r border-border">
          {/* 「添加供应商」是该页的主入口，放在左侧列表顶部的动作位，
              和下面的供应商列表形成"新增 → 选择 → 配置"的同一条视觉路径。 */}
          <div class="p-2 pb-0">
            <Button variant="primary" size="small" icon="plus-small" class="w-full justify-start" onClick={addProvider}>
              {language.t("settings.providers.add.provider")}
            </Button>
          </div>
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
            <For each={disconnected()}>
              {(item) => (
                <button
                  type="button"
                  class="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover"
                  onClick={() => void reconnect(item.id, item.name)}
                  title={language.t("settings.providers.reconnect.hint")}
                >
                  <ProviderIcon
                    id={providerIconId(item.id, item.name)}
                    colorId={item.id}
                    brand
                    class="size-4.5 shrink-0 text-foreground opacity-50"
                  />
                  <span class="min-w-0 flex-1 truncate text-13-regular text-foreground-subtle">{item.name}</span>
                  <span class="shrink-0 text-11-regular text-foreground-subtlest">
                    {language.t("settings.providers.tag.disconnected")}
                  </span>
                </button>
              )}
            </For>
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
                    <ProviderIcon
                      id={providerIconId(item().id, item().name)}
                      colorId={item().id}
                      brand
                      class="size-8 shrink-0 text-foreground"
                    />
                    <div class="flex min-w-0 flex-col gap-1">
                      <div class="flex min-w-0 flex-wrap items-center gap-2">
                        <span class="truncate text-16-medium text-foreground">{item().name}</span>
                        <Tag>{type(item())}</Tag>
                      </div>
                      <span class="text-12-regular text-foreground-subtle">
                        {language.t(
                          "settings.providers.detail.models" as never,
                          {
                            count: Object.keys(item().models ?? {}).length,
                          } as never,
                        )}
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
                        {language.t(
                          (authEntries[item().id] ?? []).length > 0
                            ? "provider.connect.addKey"
                            : "provider.connect.method.apiKey",
                        )}
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
                    {/* 连接异常或模型列表为空时，让 Agent 检查 baseURL / Key / 端点变体。 */}
                    <Show when={Object.keys(item().models ?? {}).length === 0}>
                      <AiFixButton
                        promptKey="settings.providers.aiFixPrompt"
                        variant="secondary"
                        class="h-6"
                        params={{
                          provider: item().id,
                          name: item().name,
                        }}
                        context={() => ({
                          status: language.t("settings.providers.aiFixNoModels", { name: item().name } as never),
                          facts: {
                            provider: item().id,
                            source: source(item()),
                            models: Object.keys(item().models ?? {}).length,
                          },
                        })}
                      />
                    </Show>
                    <Show when={canDisconnect(item())}>
                      <Button size="small" variant="ghost" onClick={() => void disconnect(item().id, item().name)}>
                        {language.t("common.disconnect")}
                      </Button>
                    </Show>
                  </div>
                </div>

                <Show when={note(item().id)}>
                  {(key) => (
                    <p class="text-12-regular leading-5 text-foreground-subtle">{language.t(key() as never)}</p>
                  )}
                </Show>
                <div class="flex flex-col gap-2">
                  <span class="text-12-medium text-foreground-subtle">
                    {language.t("settings.providers.detail.credentials" as never)}
                  </span>
                  <Show
                    when={(authEntries[item().id] ?? []).length > 0}
                    fallback={<span class="text-12-regular text-foreground-subtlest">{credentialHint(item())}</span>}
                  >
                    <div class="flex flex-col gap-2">
                      <div class="flex flex-col overflow-hidden rounded-lg border border-border">
                        <For each={authEntries[item().id]}>
                          {(entry, index) => {
                            const rowKey = () => `${item().id}:${index()}`
                            const visible = () => !!revealed[rowKey()]
                            const value = () => entry.key ?? ""
                            return (
                              <div class="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-12-regular first:border-t-0">
                                <span class="min-w-0 flex-1 truncate font-mono text-foreground">
                                  {entry.type === "api"
                                    ? visible()
                                      ? value() || "****"
                                      : maskKey(value())
                                    : entry.type === "oauth"
                                      ? "OAuth"
                                      : "WellKnown"}
                                </span>
                                <Show when={entry.type === "api" && !!value()}>
                                  <div class="flex shrink-0 items-center gap-0.5">
                                    {/* 密钥默认打码；眼睛只是「看一眼」，不会写回配置。 */}
                                    <IconButton
                                      icon="eye"
                                      size="small"
                                      variant="ghost"
                                      aria-pressed={visible()}
                                      aria-label={language.t(
                                        visible()
                                          ? "settings.providers.credentials.hide"
                                          : "settings.providers.credentials.reveal",
                                      )}
                                      onClick={() => setRevealed(rowKey(), !visible())}
                                    />
                                    <IconButton
                                      icon="copy"
                                      size="small"
                                      variant="ghost"
                                      aria-label={language.t("settings.providers.credentials.copy")}
                                      onClick={() => void copyKey(value(), item().name)}
                                    />
                                  </div>
                                </Show>
                                <button
                                  class="shrink-0 text-12-regular text-foreground-subtle hover:text-destructive"
                                  onClick={() => void removeEntry(item().id, index(), item().name)}
                                >
                                  {language.t("common.remove")}
                                </button>
                              </div>
                            )
                          }}
                        </For>
                      </div>
                      {/* 一个供应商存了多个 key 时，服务端会按顺序轮询使用（见 provider 的 keyRing），
                          这里说明一句，否则用户不知道多出来的 key 有没有生效。 */}
                      <Show when={(authEntries[item().id] ?? []).length > 1}>
                        <span class="text-11-regular text-foreground-subtlest">
                          {language.t("settings.providers.credentials.rotating")}
                        </span>
                      </Show>
                    </div>
                  </Show>
                </div>

                {/* 模型不再单独占一个设置页：供应商详情里直接展开，逐条开关可见性。
                    右键/菜单里保留原来的「标记为图片/视频生成」。 */}
                <div class="flex flex-col gap-2">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      class="flex items-center gap-1 text-12-medium text-foreground-subtle"
                      onClick={() => setExpandedModels(item().id, !modelsExpanded(item().id))}
                    >
                      <Icon
                        name={modelsExpanded(item().id) ? "chevron-down" : "chevron-right"}
                        size="small"
                        class="text-foreground-subtlest"
                      />
                      {language.t(
                        "settings.providers.detail.models" as never,
                        {
                          count: providerModels(item().id).length,
                        } as never,
                      )}
                    </button>
                    {/* 这里原来还有第二个「管理模型」按钮，和顶部那排里的同名按钮重复；
                        用户要求只保留一个，所以入口收敛到顶部的操作区。 */}
                  </div>
                  <Show when={modelsExpanded(item().id)}>
                    <Show
                      when={providerModels(item().id).length > 0}
                      fallback={
                        <span class="rounded-lg border border-dashed border-border px-3 py-3 text-12-regular text-foreground-subtlest">
                          {language.t("settings.providers.models.empty")}
                        </span>
                      }
                    >
                      <div class="flex flex-col overflow-hidden rounded-lg border border-border">
                        <For each={providerModels(item().id)}>
                          {(model) => (
                            <div class="flex min-w-0 items-center gap-3 border-t border-border px-3 py-2 first:border-t-0">
                              {/* 网关下一排模型各有各的厂商：这里也按模型认品牌，
                                  GLM / Kimi / Claude 不会全部共用网关那个图标。 */}
                              <ProviderIcon
                                id={modelIconId(item().id, item().name, model.id, model.name)}
                                colorId={modelIconId(item().id, item().name, model.id, model.name)}
                                brand
                                class="size-5 shrink-0"
                              />
                              <div class="min-w-0 flex-1">
                                <div class="truncate text-13-regular text-foreground">{model.name}</div>
                                <ModelCapabilitySummary model={model} compact />
                              </div>
                              <DropdownMenu>
                                <DropdownMenu.Trigger
                                  as={IconButton}
                                  icon="more-vertical"
                                  variant="ghost"
                                  size="small"
                                  aria-label={language.t("common.more")}
                                />
                                <DropdownMenu.Portal>
                                  <DropdownMenu.Content>
                                    <DropdownMenu.Item
                                      onSelect={() => void markModelModality(item().id, model.id, "image")}
                                    >
                                      <DropdownMenu.ItemLabel>
                                        {language.t("settings.providers.models.markImage")}
                                      </DropdownMenu.ItemLabel>
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item
                                      onSelect={() => void markModelModality(item().id, model.id, "video")}
                                    >
                                      <DropdownMenu.ItemLabel>
                                        {language.t("settings.providers.models.markVideo")}
                                      </DropdownMenu.ItemLabel>
                                    </DropdownMenu.Item>
                                  </DropdownMenu.Content>
                                </DropdownMenu.Portal>
                              </DropdownMenu>
                              <Switch
                                checked={models.visible(modelKey(item().id, model.id))}
                                onChange={(checked) => models.setVisibility(modelKey(item().id, model.id), checked)}
                                hideLabel
                              >
                                {model.name}
                              </Switch>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
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
