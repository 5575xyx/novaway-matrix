import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List, type ListRef } from "@opencode-ai/ui/list"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Select } from "@opencode-ai/ui/select"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Switch as UISwitch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createResource, createSignal, Match, onCleanup, onMount, For, Show, Switch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"

type RemoteModel = { id: string; name: string }
type ModelType = "text" | "image" | "video" | "audio"

const MODEL_TYPES: { value: ModelType; label: string }[] = [
  { value: "text", label: "文本模型" },
  { value: "image", label: "图片生成" },
  { value: "video", label: "视频生成" },
  { value: "audio", label: "音频生成" },
]

export function DialogConnectProvider(props: { provider: string; mode?: "connect" | "addkey" }) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const providers = useProviders()

  const all = () => {
    void import("./dialog-select-provider").then((x) => {
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }

  const alive = { value: true }
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }

  onCleanup(() => {
    alive.value = false
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
  })

  const provider = createMemo(
    () =>
      providers.all().find((x) => x.id === props.provider) ??
      globalSync.data.provider.all.find((x) => x.id === props.provider)!,
  )
  const fallback = createMemo<ProviderAuthMethod[]>(() => {
    if (props.provider === "ollama") {
      return [
        {
          type: "api" as const,
          label: language.t("provider.connect.method.apiKey"),
        },
      ]
    }
    return [
      {
        type: "api" as const,
        label: language.t("provider.connect.method.apiKey"),
      },
    ]
  })
  const [auth] = createResource(
    () => props.provider,
    async () => {
      const cached = globalSync.data.provider_auth[props.provider]
      if (cached) return cached
      const res = await globalSDK.client.provider.auth()
      if (!alive.value) return fallback()
      globalSync.set("provider_auth", res.data ?? {})
      return res.data?.[props.provider] ?? fallback()
    },
  )
  const loading = createMemo(() => auth.loading && !globalSync.data.provider_auth[props.provider])
  const methods = createMemo(() => auth.latest ?? globalSync.data.provider_auth[props.provider] ?? fallback())
  const isAddKey = props.mode === "addkey"
  const [store, setStore] = createStore({
    methodIndex: (isAddKey ? 0 : undefined) as undefined | number,
    authorization: undefined as undefined | ProviderAuthAuthorization,
    state: (isAddKey ? undefined : "pending") as undefined | "pending" | "complete" | "error" | "prompt",
    error: undefined as string | undefined,
  })

  type Action =
    | { type: "method.select"; index: number }
    | { type: "method.reset" }
    | { type: "auth.prompt" }
    | { type: "auth.pending" }
    | { type: "auth.complete"; authorization: ProviderAuthAuthorization }
    | { type: "auth.error"; error: string }

  function dispatch(action: Action) {
    setStore(
      produce((draft) => {
        if (action.type === "method.select") {
          draft.methodIndex = action.index
          draft.authorization = undefined
          draft.state = undefined
          draft.error = undefined
          return
        }
        if (action.type === "method.reset") {
          draft.methodIndex = undefined
          draft.authorization = undefined
          draft.state = undefined
          draft.error = undefined
          return
        }
        if (action.type === "auth.prompt") {
          draft.state = "prompt"
          draft.error = undefined
          return
        }
        if (action.type === "auth.pending") {
          draft.state = "pending"
          draft.error = undefined
          return
        }
        if (action.type === "auth.complete") {
          draft.state = "complete"
          draft.authorization = action.authorization
          draft.error = undefined
          return
        }
        draft.state = "error"
        draft.error = action.error
      }),
    )
  }

  const method = createMemo(() => (store.methodIndex !== undefined ? methods().at(store.methodIndex!) : undefined))

  const methodLabel = (value?: { type?: string; label?: string }) => {
    if (!value) return ""
    if (value.type === "api") return language.t("provider.connect.method.apiKey")
    return value.label ?? ""
  }

  function formatError(value: unknown, fallback: string): string {
    if (value && typeof value === "object" && "data" in value) {
      const data = (value as { data?: { message?: unknown } }).data
      if (typeof data?.message === "string" && data.message) return data.message
    }
    if (value && typeof value === "object" && "error" in value) {
      const nested = formatError((value as { error?: unknown }).error, "")
      if (nested) return nested
    }
    if (value && typeof value === "object" && "message" in value) {
      const message = (value as { message?: unknown }).message
      if (typeof message === "string" && message) return message
    }
    if (value instanceof Error && value.message) return value.message
    if (typeof value === "string" && value) return value
    return fallback
  }

  async function selectMethod(index: number, inputs?: Record<string, string>) {
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }

    const method = methods()[index]
    dispatch({ type: "method.select", index })

    if (method.type === "oauth") {
      if (method.prompts?.length && !inputs) {
        dispatch({ type: "auth.prompt" })
        return
      }
      dispatch({ type: "auth.pending" })
      const start = Date.now()
      await globalSDK.client.provider.oauth
        .authorize(
          {
            providerID: props.provider,
            method: index,
            inputs,
          },
          { throwOnError: true },
        )
        .then((x) => {
          if (!alive.value) return
          const elapsed = Date.now() - start
          const delay = 1000 - elapsed

          if (delay > 0) {
            if (timer.current !== undefined) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
              timer.current = undefined
              if (!alive.value) return
              dispatch({ type: "auth.complete", authorization: x.data! })
            }, delay)
            return
          }
          dispatch({ type: "auth.complete", authorization: x.data! })
        })
        .catch((e) => {
          if (!alive.value) return
          dispatch({ type: "auth.error", error: formatError(e, language.t("common.requestFailed")) })
        })
    }
  }

  function OAuthPromptsView() {
    const [formStore, setFormStore] = createStore({
      value: {} as Record<string, string>,
      index: 0,
    })

    const prompts = createMemo<NonNullable<ProviderAuthMethod["prompts"]>>(() => {
      const value = method()
      if (value?.type !== "oauth") return []
      return value.prompts ?? []
    })
    const matches = (prompt: NonNullable<ReturnType<typeof prompts>[number]>, value: Record<string, string>) => {
      if (!prompt.when) return true
      const actual = value[prompt.when.key]
      if (actual === undefined) return false
      return prompt.when.op === "eq" ? actual === prompt.when.value : actual !== prompt.when.value
    }
    const current = createMemo(() => {
      const all = prompts()
      const index = all.findIndex((prompt, index) => index >= formStore.index && matches(prompt, formStore.value))
      if (index === -1) return
      return {
        index,
        prompt: all[index],
      }
    })
    const valid = createMemo(() => {
      const item = current()
      if (!item || item.prompt.type !== "text") return false
      const value = formStore.value[item.prompt.key] ?? ""
      return value.trim().length > 0
    })

    async function next(index: number, value: Record<string, string>) {
      if (store.methodIndex === undefined) return
      const next = prompts().findIndex((prompt, i) => i > index && matches(prompt, value))
      if (next !== -1) {
        setFormStore("index", next)
        return
      }
      await selectMethod(store.methodIndex, value)
    }

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()
      const item = current()
      if (!item || item.prompt.type !== "text") return
      if (!valid()) return
      await next(item.index, formStore.value)
    }

    const item = () => current()
    const text = createMemo(() => {
      const prompt = item()?.prompt
      if (!prompt || prompt.type !== "text") return
      return prompt
    })
    const select = createMemo(() => {
      const prompt = item()?.prompt
      if (!prompt || prompt.type !== "select") return
      return prompt
    })

    return (
      <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
        <Switch>
          <Match when={item()?.prompt.type === "text"}>
            <TextField
              type="text"
              label={text()?.message ?? ""}
              placeholder={text()?.placeholder}
              value={text() ? (formStore.value[text()!.key] ?? "") : ""}
              onChange={(value) => {
                const prompt = text()
                if (!prompt) return
                setFormStore("value", prompt.key, value)
              }}
            />
            <Button class="w-auto" type="submit" size="large" variant="primary" disabled={!valid()}>
              {language.t("common.continue")}
            </Button>
          </Match>
          <Match when={item()?.prompt.type === "select"}>
            <div class="w-full flex flex-col gap-1.5">
              <div class="text-14-regular text-text-base">{select()?.message}</div>
              <div>
                <List
                  items={select()?.options ?? []}
                  key={(x) => x.value}
                  current={select()?.options.find((x) => x.value === formStore.value[select()!.key])}
                  onSelect={(value) => {
                    if (!value) return
                    const prompt = select()
                    if (!prompt) return
                    const nextValue = {
                      ...formStore.value,
                      [prompt.key]: value.value,
                    }
                    setFormStore("value", prompt.key, value.value)
                    void next(item()!.index, nextValue)
                  }}
                >
                  {(option) => (
                    <div class="w-full flex items-center gap-x-2">
                      <div class="w-4 h-2 rounded-[1px] bg-input-base shadow-xs-border-base flex items-center justify-center">
                        <div class="w-2.5 h-0.5 ml-0 bg-icon-strong-base hidden" data-slot="list-item-extra-icon" />
                      </div>
                      <span>{option.label}</span>
                      <span class="text-14-regular text-text-weak">{option.hint}</span>
                    </div>
                  )}
                </List>
              </div>
            </div>
          </Match>
        </Switch>
      </form>
    )
  }

  let listRef: ListRef | undefined
  function handleKey(e: KeyboardEvent) {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      return
    }
    if (e.key === "Escape") return
    listRef?.onKeyDown(e)
  }

  let auto = false
  createEffect(() => {
    if (auto) return
    if (loading()) return
    if (methods().length === 1) {
      auto = true
      void selectMethod(0)
    }
  })

  async function complete() {
    await globalSDK.client.global.dispose()
    dialog.close()
    if (isAddKey) {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: `已为 ${provider().name} 添加密钥`,
      })
    } else {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: provider().name }),
        description: language.t("provider.connect.toast.connected.description", { provider: provider().name }),
      })
    }
  }

  function goBack() {
    if (methods().length === 1) {
      all()
      return
    }
    if (store.authorization) {
      dispatch({ type: "method.reset" })
      return
    }
    if (store.methodIndex !== undefined) {
      dispatch({ type: "method.reset" })
      return
    }
    all()
  }

  function MethodSelection() {
    return (
      <>
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.selectMethod", { provider: provider().name })}
        </div>
        <div>
          <List
            ref={(ref) => {
              listRef = ref
            }}
            items={methods}
            key={(m) => m?.label}
            onSelect={async (selected, index) => {
              if (!selected) return
              void selectMethod(index)
            }}
          >
            {(i) => (
              <div class="w-full flex items-center gap-x-2">
                <div class="w-4 h-2 rounded-[1px] bg-input-base shadow-xs-border-base flex items-center justify-center">
                  <div class="w-2.5 h-0.5 ml-0 bg-icon-strong-base hidden" data-slot="list-item-extra-icon" />
                </div>
                <span>{methodLabel(i)}</span>
              </div>
            )}
          </List>
        </div>
      </>
    )
  }

  function ApiAuthView() {
    const [formStore, setFormStore] = createStore({
      value: "",
      error: undefined as string | undefined,
    })
    const [step, setStep] = createSignal<"auth" | "models">("auth")
    const [remoteModels, setRemoteModels] = createSignal<RemoteModel[]>([])
    const [selectedModels, setSelectedModels] = createStore<Record<string, { id: string; name: string; type: ModelType }>>({})
    const [fetching, setFetching] = createSignal(false)
    const [modelTypes, setModelTypes] = createStore<Record<string, ModelType>>({})

    async function fetchModels(apiKey: string) {
      let baseURL = globalSync.data.config.provider?.[props.provider]?.options?.baseURL
      if (!baseURL) {
        try {
          const res = await globalSDK.client.v2.provider.get({ providerID: props.provider })
          const info = res.data
          if (info?.endpoint && "url" in info.endpoint && info.endpoint.url) {
            baseURL = info.endpoint.url
          }
        } catch {}
      }

      if (!baseURL) {
        showToast({
          title: language.t("common.requestFailed"),
          description: "当前供应商未配置 base URL",
        })
        return
      }

      setFetching(true)
      try {
        const url = baseURL.trim().replace(/\/+$/, "")
        const envKey = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
        const response = await fetch(`${url}/models`, {
          headers: {
            Accept: "application/json",
            ...(apiKey && !envKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
        })

        if (!response.ok) throw new Error(`获取模型列表失败：HTTP ${response.status}`)
        const payload = await response.json()

        const rows = Array.isArray(payload)
          ? payload
          : typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)
            ? (payload as { data: unknown[] }).data
            : []

        const models: RemoteModel[] = rows
          .map((row) => {
            if (typeof row === "string") return { id: row, name: row }
            if (typeof row !== "object" || row === null) return undefined
            const value = row as { id?: unknown; name?: unknown }
            if (typeof value.id !== "string" || !value.id.trim()) return undefined
            return {
              id: value.id.trim(),
              name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : value.id.trim(),
            }
          })
          .filter((model): model is RemoteModel => !!model)

        if (models.length === 0) {
          await complete()
          return
        }

        setRemoteModels(models)
        models.forEach((m) => {
          setModelTypes(m.id, "text")
          setSelectedModels(m.id, { id: m.id, name: m.name, type: "text" })
        })
        setStep("models")
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        showToast({
          title: language.t("provider.custom.models.fetch.error.title"),
          description: message,
        })
        await complete()
      } finally {
        setFetching(false)
      }
    }

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()

      const form = e.currentTarget as HTMLFormElement
      const formData = new FormData(form)
      const apiKey = formData.get("apiKey") as string

      if (!apiKey?.trim()) {
        setFormStore("error", language.t("provider.connect.apiKey.required"))
        return
      }

      setFormStore("error", undefined)
      if (isAddKey) {
        await globalSDK.client.auth.addEntry({
          providerID: props.provider,
          auth: {
            type: "api",
            key: apiKey,
          },
        })
        await complete()
      } else {
        await globalSDK.client.auth.set({
          providerID: props.provider,
          auth: {
            type: "api",
            key: apiKey,
          },
        })
        await fetchModels(apiKey)
      }
    }

    async function saveModelsAndComplete(apiKey: string) {
      const enabledModels = Object.values(selectedModels).filter((m) => m.id)
      const modelConfig: Record<string, unknown> = {}
      enabledModels.forEach((m) => {
        modelConfig[m.id] = {
          id: m.id,
          name: m.name,
          modalities: {
            output: [m.type],
          },
        }
      })

      const existing = { ...globalSync.data.config.provider?.[props.provider] }
      const patch: Record<string, unknown> = { ...existing }
      patch.models = modelConfig

      await globalSync.updateConfig({ provider: { [props.provider]: patch } })
      await complete()
    }

    return (
      <div class="flex flex-col gap-6">
        <Show when={step() === "auth"}>
          <Switch>
            <Match when={provider().id === "opencode"}>
              <div class="flex flex-col gap-4">
                <div class="text-14-regular text-text-base">{language.t("provider.connect.opencodeZen.line1")}</div>
                <div class="text-14-regular text-text-base">{language.t("provider.connect.opencodeZen.line2")}</div>
                <div class="text-14-regular text-text-base">
                  {language.t("provider.connect.opencodeZen.visit.prefix")}
                  <Link href="https://opencode.ai/zen" tabIndex={-1}>
                    {language.t("provider.connect.opencodeZen.visit.link")}
                  </Link>
                  {language.t("provider.connect.opencodeZen.visit.suffix")}
                </div>
              </div>
            </Match>
            <Match when={provider().id === "ollama"}>
              <div class="text-14-regular text-text-base">{language.t("dialog.provider.ollama.note")}</div>
            </Match>
            <Match when={true}>
              <div class="text-14-regular text-text-base">
                {language.t("provider.connect.apiKey.description", { provider: provider().name })}
              </div>
            </Match>
          </Switch>
          <Show when={provider().id !== "ollama"}>
            <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
              <TextField
                autofocus
                type="text"
                label={language.t("provider.connect.apiKey.label", { provider: provider().name })}
                placeholder={language.t("provider.connect.apiKey.placeholder")}
                name="apiKey"
                value={formStore.value}
                onChange={(v) => setFormStore("value", v)}
                validationState={formStore.error ? "invalid" : undefined}
                error={formStore.error}
              />
              <Button class="w-auto" type="submit" size="large" variant="primary">
                {language.t("common.continue")}
              </Button>
              <div class="text-12-regular text-text-weak mt-1">
                {language.t("provider.connect.fetchModelsHint")}
              </div>
            </form>
          </Show>
          <Show when={provider().id === "ollama"}>
            <Button
              class="w-auto"
              type="button"
              size="large"
              variant="primary"
              onClick={async () => {
                if (isAddKey) {
                  await globalSDK.client.auth.addEntry({
                    providerID: props.provider,
                    auth: {
                      type: "api",
                      key: "local",
                    },
                  })
                } else {
                  await globalSDK.client.auth.set({
                    providerID: props.provider,
                    auth: {
                      type: "api",
                      key: "local",
                    },
                  })
                }
                await complete()
              }}
            >
              {language.t("common.continue")}
            </Button>
          </Show>
        </Show>
        <Show when={step() === "models"}>
          <div class="flex flex-col gap-4">
            <div class="text-14-regular text-text-base">
              {language.t("provider.connect.models.description", { provider: provider().name })}
            </div>
            <Show when={fetching()}>
              <div class="flex items-center gap-x-2">
                <Spinner />
                <span>{language.t("provider.custom.models.fetch.loading")}</span>
              </div>
            </Show>
            <Show when={!fetching()}>
              <div class="flex flex-col max-h-80 overflow-y-auto gap-2">
                <For each={remoteModels()}>
                  {(model) => (
                    <div class="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md hover:bg-surface-hover-base">
                      <div class="min-w-0">
                        <div class="text-14-medium truncate">{model.name}</div>
                        <div class="text-12-regular text-text-weak truncate">{model.id}</div>
                      </div>
                      <div class="flex items-center gap-2 shrink-0">
                        <Select
                          size="small"
                          options={MODEL_TYPES}
                          current={MODEL_TYPES.find((t) => t.value === modelTypes[model.id])}
                          value={(t) => t.value}
                          label={(t) => t.label}
                          onSelect={(t) => t && setModelTypes(model.id, t.value)}
                          triggerStyle={{ "min-width": "100px" }}
                        />
                        <UISwitch
                          checked={!!selectedModels[model.id]}
                          onChange={(checked: boolean) => {
                            if (checked) {
                              setSelectedModels(model.id, {
                                id: model.id,
                                name: model.name,
                                type: modelTypes[model.id] || "text",
                              })
                            } else {
                              setSelectedModels(model.id, undefined as never)
                            }
                          }}
                          hideLabel
                        >
                          {model.name}
                        </UISwitch>
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <div class="flex justify-between items-center pt-2 border-t border-border-weak-base">
                <span class="text-12-medium text-text-weak">
                  {Object.values(selectedModels).filter(Boolean).length}/{remoteModels().length} {language.t("common.selected")}
                </span>
                <div class="flex gap-2">
                  <Button size="small" variant="ghost" onClick={() => setStep("auth")}>
                    {language.t("common.back")}
                  </Button>
                  <Button size="large" variant="primary" onClick={() => saveModelsAndComplete(formStore.value)}>
                    {language.t("common.submit")}
                  </Button>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    )
  }

  function OAuthCodeView() {
    const [formStore, setFormStore] = createStore({
      value: "",
      error: undefined as string | undefined,
    })

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()

      const form = e.currentTarget as HTMLFormElement
      const formData = new FormData(form)
      const code = formData.get("code") as string

      if (!code?.trim()) {
        setFormStore("error", language.t("provider.connect.oauth.code.required"))
        return
      }

      setFormStore("error", undefined)
      const result = await globalSDK.client.provider.oauth
        .callback({
          providerID: props.provider,
          method: store.methodIndex,
          code,
        })
        .then((value) => (value.error ? { ok: false as const, error: value.error } : { ok: true as const }))
        .catch((error) => ({ ok: false as const, error }))
      if (result.ok) {
        await complete()
        return
      }
      setFormStore("error", formatError(result.error, language.t("provider.connect.oauth.code.invalid")))
    }

    return (
      <div class="flex flex-col gap-6">
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.oauth.code.visit.prefix")}
          <Link href={store.authorization!.url}>{language.t("provider.connect.oauth.code.visit.link")}</Link>
          {language.t("provider.connect.oauth.code.visit.suffix", { provider: provider().name })}
        </div>
        <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
          <TextField
            autofocus
            type="text"
            label={language.t("provider.connect.oauth.code.label", { method: method()?.label ?? "" })}
            placeholder={language.t("provider.connect.oauth.code.placeholder")}
            name="code"
            value={formStore.value}
            onChange={(v) => setFormStore("value", v)}
            validationState={formStore.error ? "invalid" : undefined}
            error={formStore.error}
          />
          <Button class="w-auto" type="submit" size="large" variant="primary">
            {language.t("common.continue")}
          </Button>
        </form>
      </div>
    )
  }

  function OAuthAutoView() {
    const code = createMemo(() => {
      const instructions = store.authorization?.instructions
      if (instructions?.includes(":")) {
        return instructions.split(":")[1]?.trim()
      }
      return instructions
    })

    onMount(() => {
      void (async () => {
        const result = await globalSDK.client.provider.oauth
          .callback({
            providerID: props.provider,
            method: store.methodIndex,
          })
          .then((value) => (value.error ? { ok: false as const, error: value.error } : { ok: true as const }))
          .catch((error) => ({ ok: false as const, error }))

        if (!alive.value) return

        if (!result.ok) {
          const message = formatError(result.error, language.t("common.requestFailed"))
          dispatch({ type: "auth.error", error: message })
          return
        }

        await complete()
      })()
    })

    return (
      <div class="flex flex-col gap-6">
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.oauth.auto.visit.prefix")}
          <Link href={store.authorization!.url}>{language.t("provider.connect.oauth.auto.visit.link")}</Link>
          {language.t("provider.connect.oauth.auto.visit.suffix", { provider: provider().name })}
        </div>
        <TextField
          label={language.t("provider.connect.oauth.auto.confirmationCode")}
          class="font-mono"
          value={code()}
          readOnly
          copyable
        />
        <div class="text-14-regular text-text-base flex items-center gap-4">
          <Spinner />
          <span>{language.t("provider.connect.status.waiting")}</span>
        </div>
      </div>
    )
  }

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={goBack}
          aria-label={language.t("common.goBack")}
        />
      }
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id={props.provider} class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">
            <Switch>
              <Match when={isAddKey}>{`添加密钥 - ${provider().name}`}</Match>
              <Match when={props.provider === "anthropic" && method()?.label?.toLowerCase().includes("max")}>
                {language.t("provider.connect.title.anthropicProMax")}
              </Match>
              <Match when={true}>{language.t("provider.connect.title", { provider: provider().name })}</Match>
            </Switch>
          </div>
        </div>
        <div class="px-2.5 pb-10 flex flex-col gap-6">
          <div onKeyDown={handleKey} tabIndex={0} autofocus={store.methodIndex === undefined ? true : undefined}>
            <Switch>
              <Match when={loading()}>
                <div class="text-14-regular text-text-base">
                  <div class="flex items-center gap-x-2">
                    <Spinner />
                    <span>{language.t("provider.connect.status.inProgress")}</span>
                  </div>
                </div>
              </Match>
              <Match when={store.methodIndex === undefined}>
                <MethodSelection />
              </Match>
              <Match when={store.state === "pending"}>
                <div class="text-14-regular text-text-base">
                  <div class="flex items-center gap-x-2">
                    <Spinner />
                    <span>{language.t("provider.connect.status.inProgress")}</span>
                  </div>
                </div>
              </Match>
              <Match when={store.state === "prompt"}>
                <OAuthPromptsView />
              </Match>
              <Match when={store.state === "error"}>
                <div class="text-14-regular text-text-base">
                  <div class="flex items-center gap-x-2">
                    <Icon name="circle-ban-sign" class="text-icon-critical-base" />
                    <span>{language.t("provider.connect.status.failed", { error: store.error ?? "" })}</span>
                  </div>
                </div>
              </Match>
              <Match when={method()?.type === "api"}>
                <ApiAuthView />
              </Match>
              <Match when={method()?.type === "oauth"}>
                <Switch>
                  <Match when={store.authorization?.method === "code"}>
                    <OAuthCodeView />
                  </Match>
                  <Match when={store.authorization?.method === "auto"}>
                    <OAuthAutoView />
                  </Match>
                </Switch>
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
