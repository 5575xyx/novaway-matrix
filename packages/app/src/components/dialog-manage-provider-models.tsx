import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Select } from "@novaway/ui/select"
import { Switch } from "@novaway/ui/switch"
import { TextField } from "@novaway/ui/text-field"
import { createMemo, createSignal, type Component, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { showToast } from "@novaway/ui/toast"
import { useDialog } from "@novaway/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useProviders } from "@/hooks/use-providers"
import { useLanguage } from "@/context/language"
import { modelTypeOptions, type ModelType } from "@/utils/model-type"
import {
  fetchOpenAICompatibleModels,
  remoteModelType,
  type RemoteProviderModel,
} from "@/utils/provider-model-discovery"

type AuthEntry = { type: string; key?: string }

type RemoteModel = RemoteProviderModel

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
    <Dialog
      title={props.title}
      fit
      footer={
        <div class="flex w-full items-center justify-end gap-2">
          <Button variant="ghost" size="large" disabled={confirm.isPending} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
            {props.confirmLabel}
          </Button>
        </div>
      }
    >
      <div class="flex flex-col gap-1 px-5 pb-4 pt-1">
        <span class="text-14-regular text-foreground">{props.description}</span>
        <Show when={error()}>
          <span class="text-12-regular text-danger-base">{error()}</span>
        </Show>
      </div>
    </Dialog>
  )
}

/** 输入框清空或填了非法值时，按「没设置」处理，而不是写 0 进配置。 */
const positive = (value: string) => {
  const parsed = Number(value.replace(/[^0-9]/g, ""))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
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
  // 多密钥是轮询使用同一份模型列表，所以这里只有一份远端结果，不再按密钥分开。
  const [fetching, setFetching] = createSignal(false)
  const [remoteModels, setRemoteModels] = createSignal<RemoteModel[]>([])
  const [extraModels, setExtraModels] = createStore<Record<string, RemoteModel>>({})
  const [modelTypes, setModelTypes] = createStore<Record<string, ModelType>>({})
  /** 每个模型展开的「高级设置」：上下文窗口 / 最大输出 / 推理 / 多模态。 */
  const [expandedModel, setExpandedModel] = createSignal<string>()
  const [modelLimits, setModelLimits] = createStore<Record<string, { context?: number; output?: number }>>({})
  const [modelCaps, setModelCaps] = createStore<Record<string, { reasoning: boolean; attachment: boolean }>>({})

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

  /** 底部摘要用：开启了几个 / 一共几个。 */
  const enabledCount = createMemo(() => Object.values(toggles).filter(Boolean).length)

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
      const limits: Record<string, { context?: number; output?: number }> = {}
      const caps: Record<string, { reasoning: boolean; attachment: boolean }> = {}
      for (const [id, model] of Object.entries(p.models ?? {})) {
        initial[id] = modelTypeFromCapabilities(
          model as {
            capabilities?: { output?: { image?: boolean; video?: boolean; audio?: boolean; text?: boolean } }
          },
        )
        const value = model as {
          limit?: { context?: number; output?: number }
          capabilities?: { reasoning?: boolean; attachment?: boolean }
        }
        if (value.limit?.context || value.limit?.output) {
          limits[id] = { context: value.limit?.context, output: value.limit?.output }
        }
        caps[id] = {
          reasoning: Boolean(value.capabilities?.reasoning),
          attachment: Boolean(value.capabilities?.attachment),
        }
      }
      setModelTypes(initial)
      setModelLimits(limits)
      setModelCaps(caps)
    }
  })

  /**
   * 拉取供应商的完整模型列表。
   *
   * 多密钥时用第一个请求 —— 同一供应商的模型列表与密钥无关，每个密钥各拉一遍
   * 只会得到同样的结果；真正需要区分密钥的是请求本身（服务端按顺序轮询）。
   */
  const fetchModelList = async () => {
    const url = baseURL()
    if (!url) {
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("dialog.model.manage.missingBaseURL"),
      })
      return
    }
    const key = authEntries[0]?.key
    if (!key) {
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("dialog.model.manage.missingKey"),
      })
      return
    }
    setFetching(true)
    try {
      const models = await fetchOpenAICompatibleModels({
        providerID: props.providerID,
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
      setRemoteModels(models.filter((m) => !existing.has(m.id)))
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
      setFetching(false)
    }
  }

  const applyRemoteModel = (model: RemoteModel) => {
    const id = model.id
    setRemoteModels((prev) => prev.filter((m) => m.id !== id))
    if (extraModels[id]) return
    setExtraModels(id, model)
    setToggles(id, true)
    setModelTypes(id, inferModelType(model))
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
            const limit = modelLimits[m.id]
            const caps = modelCaps[m.id]
            const context = limit?.context && limit.context > 0 ? limit.context : undefined
            const output = limit?.output && limit.output > 0 ? limit.output : undefined
            return [
              m.id,
              {
                ...existingModel,
                id: m.id,
                name: m.name,
                modalities: { input: [], output: [modelTypes[m.id] ?? "text"] },
                // 只在用户真的填了值时才写进配置，否则会把内置目录里的上下文一起覆盖成 0。
                ...(context || output
                  ? { limit: { ...(context ? { context } : {}), ...(output ? { output } : {}) } }
                  : {}),
                ...(caps ? { reasoning: caps.reasoning, attachment: caps.attachment } : {}),
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
    <Dialog
      title={language.t("dialog.model.manage")}
      description={language.t("dialog.model.manage.description")}
      footer={
        <div class="flex w-full items-center justify-between gap-3">
          <span class="min-w-0 truncate text-12-regular text-foreground-subtle" aria-live="polite">
            {language.t("dialog.model.manage.summary", {
              selected: enabledCount(),
              total: allModels().length,
            })}
          </span>
          <div class="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={save}>
              {language.t("common.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div class="flex flex-col gap-3 px-5 pb-3">
        {/* 多密钥：轮询用的同一套模型，所以密钥只在这里管理（查看/删除），
            不再给每个密钥复制一份模型开关 —— 那会让人以为开关是按密钥生效的。 */}
        <Show when={isMultiKey()}>
          <div class="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-2">
            <span class="text-11-medium uppercase tracking-wide text-foreground-subtlest">
              {language.t("dialog.model.manage.keys", { count: authEntries.length })}
            </span>
            <For each={authEntries}>
              {(entry, index) => (
                <div class="flex items-center justify-between gap-2 text-12-regular">
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="shrink-0 text-foreground-subtle">
                      {language.t("model.key.label")} {index() + 1}
                    </span>
                    <span class="truncate font-mono text-foreground">{maskKey(entry.key)}</span>
                  </span>
                  <button
                    type="button"
                    class="shrink-0 text-11-regular text-foreground-subtlest hover:text-destructive"
                    onClick={() => removeKey(index())}
                  >
                    {language.t("common.delete")}
                  </button>
                </div>
              )}
            </For>
            <span class="text-11-regular text-foreground-subtlest">
              {language.t("settings.providers.credentials.rotating")}
            </span>
          </div>
        </Show>

        {/* 摘要只在底部出现一次（右下角动作栏），这里只放动作，避免同一句话重复两遍。 */}
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-12-medium text-foreground-subtle">{language.t("provider.custom.models.available")}</span>
          <div class="flex items-center gap-1">
            <Button size="small" variant="ghost" icon="download" disabled={fetching()} onClick={fetchModelList}>
              {fetching()
                ? language.t("provider.custom.models.fetch.loading")
                : language.t("provider.custom.models.fetch.action")}
            </Button>
            <Button size="small" variant="ghost" onClick={selectAllForKey}>
              {language.t("common.selectAll")}
            </Button>
            <Button size="small" variant="ghost" onClick={deselectAllForKey}>
              {language.t("common.deselectAll")}
            </Button>
          </div>
        </div>

        <Show when={remoteModels().length > 0}>
          <div class="flex flex-col gap-1 rounded-lg border border-border bg-surface px-2.5 py-2">
            <span class="text-11-medium uppercase tracking-wide text-foreground-subtlest">
              {language.t("provider.custom.models.fetch.group")}
            </span>
            <div class="flex flex-wrap gap-1.5">
              <For each={remoteModels()}>
                {(model) => (
                  <button
                    type="button"
                    class="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-12-regular text-foreground transition-colors hover:bg-hover"
                    onClick={() => applyRemoteModel(model)}
                  >
                    <Icon name="plus-small" size="small" class="text-foreground-subtlest" />
                    <span class="max-w-52 truncate">{model.name}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <div class="flex flex-col">
          <For each={allModels()}>
            {(model) => {
              const open = () => expandedModel() === model.id
              const limit = () => modelLimits[model.id] ?? {}
              const caps = () => modelCaps[model.id] ?? { reasoning: false, attachment: false }
              return (
                <div
                  class="flex flex-col rounded-md px-1 py-1.5 transition-colors"
                  classList={{ "bg-surface": open(), "hover:bg-hover": !open() }}
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5 text-14-medium">
                        <span class="truncate">{model.name}</span>
                        <Show when={extraModels[model.id]}>
                          <span class="rounded bg-surface px-1.5 py-0.5 text-10-medium text-foreground-subtle">
                            {language.t("dialog.model.manage.new")}
                          </span>
                        </Show>
                      </div>
                      <div class="truncate text-12-regular text-foreground-subtle">{model.id}</div>
                    </div>
                    <div class="w-24 shrink-0">
                      <Select
                        size="small"
                        options={modelTypeOptions(language.t)}
                        current={modelTypeOptions(language.t).find((t) => t.value === modelTypes[model.id])}
                        value={(t) => t.value}
                        label={(t) => t.label}
                        onSelect={(t) => t && setModelTypes(model.id, t.value)}
                        placeholder={language.t("provider.custom.models.type.placeholder")}
                      />
                    </div>
                    <IconButton
                      icon="sliders"
                      variant="ghost"
                      size="small"
                      class="shrink-0"
                      aria-expanded={open()}
                      aria-label={language.t("dialog.model.manage.advanced")}
                      onClick={() => setExpandedModel(open() ? undefined : model.id)}
                    />
                    <Switch
                      checked={toggles[model.id]}
                      onChange={(checked: boolean) => setToggles(model.id, checked)}
                      hideLabel
                    >
                      {model.name}
                    </Switch>
                  </div>

                  <Show when={open()}>
                    <div class="mt-2 flex flex-col gap-2 rounded-md border border-border bg-background px-2.5 py-2">
                      <div class="flex flex-wrap gap-2">
                        <div class="min-w-32 flex-1">
                          <TextField
                            type="number"
                            label={language.t("dialog.model.manage.context")}
                            placeholder="128000"
                            value={limit().context ? String(limit().context) : ""}
                            onChange={(v) => setModelLimits(model.id, "context", positive(v))}
                          />
                        </div>
                        <div class="min-w-32 flex-1">
                          <TextField
                            type="number"
                            label={language.t("dialog.model.manage.output")}
                            placeholder="8192"
                            value={limit().output ? String(limit().output) : ""}
                            onChange={(v) => setModelLimits(model.id, "output", positive(v))}
                          />
                        </div>
                      </div>
                      {/* 不要用 <label> 包 Switch：没写 for 的 label 会绑定到 Kobalte 藏起来的
                          checkbox，点击时开关会被翻回去。文案交给 Switch 自己的 Label。 */}
                      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <Switch
                          class="text-12-regular"
                          checked={caps().reasoning}
                          onChange={(checked: boolean) => setModelCaps(model.id, "reasoning", checked)}
                        >
                          {language.t("dialog.model.manage.reasoning")}
                        </Switch>
                        <Switch
                          class="text-12-regular"
                          checked={caps().attachment}
                          onChange={(checked: boolean) => setModelCaps(model.id, "attachment", checked)}
                        >
                          {language.t("dialog.model.manage.attachment")}
                        </Switch>
                      </div>
                      <span class="text-11-regular text-foreground-subtlest">
                        {language.t("dialog.model.manage.limitHint")}
                      </span>
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </Dialog>
  )
}
