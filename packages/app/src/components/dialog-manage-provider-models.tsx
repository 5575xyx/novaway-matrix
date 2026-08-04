import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { createMemo, createSignal, type Component, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useProviders } from "@/hooks/use-providers"
import { useLanguage } from "@/context/language"
import {
  fetchOpenAICompatibleModels,
  remoteModelType,
  type RemoteProviderModel,
} from "@/utils/provider-model-discovery"

type AuthEntry = { type: string; key?: string }

type RemoteModel = RemoteProviderModel
type ModelType = "text" | "image" | "video" | "audio"

const MODEL_TYPES: { value: ModelType; label: string }[] = [
  { value: "text", label: "文本模型" },
  { value: "image", label: "图片生成" },
  { value: "video", label: "视频生成" },
  { value: "audio", label: "音频生成" },
]

function inferModelType(model: RemoteProviderModel): ModelType {
  const fromModalities = remoteModelType(model)
  if (fromModalities !== "text") return fromModalities
  const id = model.id
  const name = model.name
  const text = `${id} ${name}`.toLowerCase()
  if (text.includes("image") || text.includes("img") || text.includes("dall") || text.includes("picture"))
    return "image"
  if (text.includes("video") || text.includes("clip")) return "video"
  if (text.includes("audio") || text.includes("sound") || text.includes("speech") || text.includes("voice"))
    return "audio"
  return "text"
}

function modelTypeFromCapabilities(model: {
  capabilities?: { output?: { image?: boolean; video?: boolean; audio?: boolean; text?: boolean } }
}): ModelType {
  const output = model.capabilities?.output
  if (output?.image) return "image"
  if (output?.video) return "video"
  if (output?.audio) return "audio"
  if (output?.text) return "text"
  return "text"
}

const ConfirmActionDialog: Component<{
  title: string
  description: string
  confirmLabel: string
  successTitle?: string
  successDescription?: string
  onConfirm: () => Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [error, setError] = createSignal("")
  const confirm = useMutation(() => ({
    mutationFn: props.onConfirm,
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: props.successTitle ?? language.t("settings.management.toast.saved.title"),
        description: props.successDescription ?? language.t("settings.management.toast.saved.description"),
      })
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  }))

  return (
    <Dialog title={props.title} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">{props.description}</span>
          <Show when={error()}>
            <span class="text-12-regular text-danger-base">{error()}</span>
          </Show>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" disabled={confirm.isPending} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
            {props.confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

const maskKey = (key: string | undefined) => {
  if (!key) return "****"
  if (key.length <= 8) return "****"
  return key.slice(0, 4) + "..." + key.slice(-4)
}

export const DialogManageProviderModels: Component<{
  providerID: string
  providerName: string
}> = (props) => {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const providers = useProviders()
  const language = useLanguage()

  const [authEntries, setAuthEntries] = createStore<AuthEntry[]>([])
  const [providerInfo, setProviderInfo] = createStore<{
    endpointURL?: string
  }>({})
  const [expanded, setExpanded] = createStore<Record<number, boolean>>({})
  const [fetching, setFetching] = createStore<Record<number, boolean>>({})
  const [remoteModels, setRemoteModels] = createStore<Record<number, RemoteModel[]>>({})
  const [selectedRemoteModel, setSelectedRemoteModel] = createStore<Record<number, RemoteModel | undefined>>({})
  const [extraModels, setExtraModels] = createStore<Record<string, RemoteModel>>({})
  const [modelTypes, setModelTypes] = createStore<Record<string, ModelType>>({})

  const provider = createMemo(() => providers.all().find((p) => p.id === props.providerID))

  const allModels = createMemo(() => {
    const p = provider()
    const server = p
      ? Object.entries(p.models ?? {}).map(([id, model]) => ({
          id,
          name: (model as { name?: string } | undefined)?.name ?? id,
        }))
      : []
    const extra = Object.values(extraModels)
    return [...server, ...extra]
  })

  const whitelist = () => globalSync.data.config.provider?.[props.providerID]?.whitelist
  const baseURL = () =>
    globalSync.data.config.provider?.[props.providerID]?.options?.baseURL || providerInfo.endpointURL

  const [toggles, setToggles] = createStore<Record<string, boolean>>(
    Object.fromEntries(allModels().map((m) => [m.id, !whitelist() || whitelist()!.includes(m.id)])),
  )

  const isMultiKey = createMemo(() => authEntries.length > 1)

  const isKeyExpanded = (keyIndex: number) => {
    if (!isMultiKey()) return true
    return expanded[keyIndex] ?? keyIndex === 0
  }

  const toggleKeyExpanded = (keyIndex: number) => {
    setExpanded(keyIndex, (prev) => !prev)
  }

  const getProviderKeys = (): AuthEntry[] => {
    return authEntries.length > 0 ? authEntries : [{ type: "api" }]
  }

  const countForKey = () => Object.values(toggles).filter(Boolean).length

  const totalForKey = () => allModels().length

  const selectAllForKey = () => {
    for (const m of allModels()) setToggles(m.id, true)
  }

  const deselectAllForKey = () => {
    for (const m of allModels()) setToggles(m.id, false)
  }

  const removeKey = (keyIndex: number) => {
    const label = `${language.t("model.key.label")} ${keyIndex + 1} · ${maskKey(authEntries[keyIndex]?.key)}`
    dialog.show(() => (
      <ConfirmActionDialog
        title={language.t("common.delete")}
        description={language.t("model.key.removeConfirm", { label })}
        confirmLabel={language.t("common.delete")}
        successTitle={language.t("model.key.removed")}
        successDescription={label}
        onConfirm={() =>
          globalSDK.client.auth
            .removeEntry({ providerID: props.providerID, entryIndex: String(keyIndex) })
            .then(() => loadAuthEntries())
        }
      />
    ))
  }

  const loadAuthEntries = async () => {
    try {
      const res = await globalSDK.client.auth.list({ providerID: props.providerID })
      setAuthEntries(res.data ?? [])
    } catch {
      setAuthEntries([])
    }
  }

  const loadProviderInfo = async () => {
    try {
      const res = await globalSDK.client.v2.provider.get({ providerID: props.providerID })
      const info = res.data
      if (info?.endpoint && "url" in info.endpoint && info.endpoint.url) {
        setProviderInfo("endpointURL", info.endpoint.url)
      }
    } catch {}
  }

  onMount(() => {
    void loadAuthEntries()
    void loadProviderInfo()
    const p = provider()
    if (p) {
      const initial: Record<string, ModelType> = {}
      for (const [id, model] of Object.entries(p.models ?? {})) {
        initial[id] = modelTypeFromCapabilities(
          model as {
            capabilities?: { output?: { image?: boolean; video?: boolean; audio?: boolean; text?: boolean } }
          },
        )
      }
      setModelTypes(initial)
    }
  })

  const fetchModelListForKey = async (keyIndex: number) => {
    const url = baseURL()
    if (!url) {
      showToast({
        title: language.t("common.requestFailed"),
        description: "当前供应商未配置 base URL，请在供应商设置中填写",
      })
      return
    }
    const key = authEntries[keyIndex]?.key
    if (!key) {
      showToast({
        title: language.t("common.requestFailed"),
        description: "未找到该 key 的 API 密钥",
      })
      return
    }
    setFetching(keyIndex, true)
    try {
      const models = await fetchOpenAICompatibleModels({
        baseURL: url,
        apiKey: key,
        discover: async (payload) =>
          (
            await globalSDK.client.provider.models({
              providerModelDiscoveryPayload: payload,
            })
          ).data,
      })
      const existing = new Set(allModels().map((m) => m.id))
      const filtered = models.filter((m) => !existing.has(m.id))
      setRemoteModels(keyIndex, filtered)
      setSelectedRemoteModel(keyIndex, undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.custom.models.fetch.success.title"),
        description: language.t("provider.custom.models.fetch.success.description", {
          count: models.length,
        }),
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({
        title: language.t("provider.custom.models.fetch.error.title"),
        description: message,
      })
    } finally {
      setFetching(keyIndex, false)
    }
  }

  const applyRemoteModel = (keyIndex: number, model: RemoteModel) => {
    const id = model.id
    if (extraModels[id]) return
    setExtraModels(id, model)
    setToggles(id, true)
    setModelTypes(id, inferModelType(model))
    setSelectedRemoteModel(keyIndex, undefined)
    const updated = (remoteModels[keyIndex] ?? []).filter((m) => m.id !== id)
    setRemoteModels(keyIndex, updated)
  }

  const save = async () => {
    const enabled = Object.entries(toggles)
      .filter(([, v]) => v)
      .map(([id]) => id)

    const existing = { ...globalSync.data.config.provider?.[props.providerID] }
    const patch: Record<string, unknown> = { ...existing }
    patch.whitelist = Object.values(toggles).every(Boolean) ? null : enabled

    const existingModels: Record<string, unknown> = (existing as any)?.models ?? {}
    const all = allModels()
    if (all.length > 0) {
      patch.models = {
        ...existingModels,
        ...Object.fromEntries(
          all.map((m) => {
            const existingModel = existingModels[m.id] as Record<string, unknown> | undefined
            return [
              m.id,
              {
                ...existingModel,
                id: m.id,
                name: m.name,
                modalities: { input: [], output: [modelTypes[m.id] ?? "text"] },
              },
            ]
          }),
        ),
      }
    }

    try {
      await globalSync.updateConfig({ provider: { [props.providerID]: patch } })
      await globalSDK.client.global.dispose()
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.management.toast.saved.title"),
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    }
  }

  return (
    <Dialog title={language.t("dialog.model.manage")} description={language.t("dialog.model.manage.description")}>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col max-h-80 overflow-y-auto">
          <For each={getProviderKeys()}>
            {(entry, keyIndex) => {
              const isOpen = createMemo(() => isKeyExpanded(keyIndex()))
              const isFetching = createMemo(() => fetching[keyIndex()])
              const fetched = createMemo(() => remoteModels[keyIndex()] ?? [])
              return (
                <div class="flex flex-col">
                  <div class="flex items-center justify-between gap-2 px-2 py-1.5 mt-1 bg-surface-raised-base rounded-md border border-border-weak-base">
                    <Show when={isMultiKey()}>
                      <button
                        type="button"
                        class="flex items-center gap-2 flex-1 min-w-0 text-left text-13-medium text-text-strong"
                        onClick={() => toggleKeyExpanded(keyIndex())}
                        aria-expanded={isOpen()}
                      >
                        <Show
                          when={isOpen()}
                          fallback={<Icon name="chevron-right" size="small" class="text-icon-weak-base" />}
                        >
                          <Icon name="chevron-down" size="small" class="text-icon-weak-base" />
                        </Show>
                        <span class="flex items-center gap-1.5 min-w-0">
                          <span class="truncate">
                            {language.t("model.key.label")} {keyIndex() + 1}
                          </span>
                          <span class="text-12-regular text-text-weak font-mono truncate">{maskKey(entry.key)}</span>
                        </span>
                      </button>
                    </Show>
                    <Show when={!isMultiKey()}>
                      <span class="text-13-medium text-text-strong flex-1">
                        {countForKey()}/{totalForKey()} {language.t("common.selected")}
                      </span>
                    </Show>
                    <div class="flex gap-1 items-center shrink-0">
                      <Show when={isMultiKey()}>
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={() => removeKey(keyIndex())}
                          title={language.t("common.delete")}
                        >
                          <Icon name="trash" size="small" class="text-icon-weak-base" />
                        </Button>
                      </Show>
                      <Show when={fetched().length === 0}>
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={() => fetchModelListForKey(keyIndex())}
                          disabled={isFetching()}
                        >
                          <Show when={!isFetching()} fallback={language.t("provider.custom.models.fetch.loading")}>
                            {language.t("provider.custom.models.fetch.action")}
                          </Show>
                        </Button>
                      </Show>
                      <Show when={fetched().length > 0}>
                        <Select
                          size="small"
                          variant="secondary"
                          options={fetched()}
                          current={selectedRemoteModel[keyIndex()]}
                          value={(model) => model.id}
                          label={(model) => model.name}
                          groupBy={() => language.t("provider.custom.models.fetch.group")}
                          placeholder={language.t("provider.custom.models.fetch.select")}
                          onSelect={(model) => {
                            if (model) applyRemoteModel(keyIndex(), model)
                          }}
                          triggerStyle={{ "min-width": "200px" }}
                          valueClass="truncate"
                        >
                          {(model) => (
                            <div class="flex min-w-0 flex-col">
                              <span class="truncate text-13-medium text-text-strong">{model?.name}</span>
                              <Show when={model && model.name !== model.id}>
                                <span class="truncate text-11-regular text-text-weak">{model?.id}</span>
                              </Show>
                            </div>
                          )}
                        </Select>
                        <Button size="small" variant="ghost" onClick={() => setRemoteModels(keyIndex(), [])}>
                          {language.t("common.clear")}
                        </Button>
                      </Show>
                      <Button size="small" variant="ghost" onClick={selectAllForKey}>
                        {language.t("common.selectAll")}
                      </Button>
                      <Button size="small" variant="ghost" onClick={deselectAllForKey}>
                        {language.t("common.deselectAll")}
                      </Button>
                    </div>
                  </div>
                  <Show when={isOpen()}>
                    <div class="flex flex-col">
                      <For each={allModels()}>
                        {(model) => (
                          <div class="flex items-center justify-between py-1.5 px-1 hover:bg-surface-hover-base rounded-md gap-2">
                            <div class="min-w-0 flex-1">
                              <div class="text-14-medium truncate flex items-center gap-1.5">
                                {model.name}
                                <Show when={extraModels[model.id]}>
                                  <span class="text-10-medium px-1.5 py-0.5 rounded bg-surface-base text-text-weak">
                                    {language.t("dialog.model.manage.new")}
                                  </span>
                                </Show>
                              </div>
                              <div class="text-12-regular text-text-weak truncate">{model.id}</div>
                            </div>
                            <div class="w-24 shrink-0">
                              <Select
                                size="small"
                                options={MODEL_TYPES}
                                current={MODEL_TYPES.find((t) => t.value === modelTypes[model.id])}
                                value={(t) => t.value}
                                label={(t) => t.label}
                                onSelect={(t) => t && setModelTypes(model.id, t.value)}
                                placeholder="类型"
                              />
                            </div>
                            <Switch
                              checked={toggles[model.id]}
                              onChange={(checked: boolean) => setToggles(model.id, checked)}
                              hideLabel
                            >
                              {model.name}
                            </Switch>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-border-weak-base">
          <Button variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button onClick={save}>{language.t("common.save")}</Button>
        </div>
      </div>
    </Dialog>
  )
}
