import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Select } from "@opencode-ai/ui/select"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { batch, createSignal, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import {
  fetchOpenAICompatibleModels,
  remoteModelType,
  type RemoteProviderModel,
} from "@/utils/provider-model-discovery"
import {
  type FormState,
  headerRow,
  modelRow,
  type ModelType,
  validateCustomProvider,
} from "./dialog-custom-provider-form"

import { SelectProviderCombobox } from "./select-provider-combobox"
import { DialogSelectProvider } from "./dialog-select-provider"

const MODEL_TYPES: { value: ModelType; label: string }[] = [
  { value: "text", label: "文本模型" },
  { value: "image", label: "图片生成" },
  { value: "video", label: "视频生成" },
  { value: "audio", label: "音频生成" },
]

type Props = {
  back?: "providers" | "close"
}

type ProviderOption = {
  id: string
  name: string
  baseURL?: string
}

export function DialogCustomProvider(props: Props) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const [remoteModels, setRemoteModels] = createSignal<RemoteProviderModel[]>([])
  const [selectedRemoteModel, setSelectedRemoteModel] = createSignal<RemoteProviderModel>()

  const handleProviderSelect = (option: ProviderOption) => {
    batch(() => {
      setForm("providerID", option.id)
      setForm("name", option.name)
      if (option.baseURL) {
        setForm("baseURL", option.baseURL)
      }
    })
  }

  const [form, setForm] = createStore<FormState>({
    providerID: "",
    name: "",
    baseURL: "",
    apiKey: "",
    models: [modelRow()],
    headers: [headerRow()],
    err: {},
  })

  const goBack = () => {
    if (props.back === "close") {
      dialog.close()
      return
    }
    dialog.show(() => <DialogSelectProvider />)
  }

  const addModel = () => {
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setForm(
      "models",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setField = (key: "providerID" | "name" | "baseURL" | "apiKey", value: string) => {
    setForm(key, value)
    if (key === "apiKey") return
    setForm("err", key, undefined)
  }

  const setModel = (index: number, key: "id" | "name", value: string) => {
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const setModelType = (index: number, value: ModelType) => {
    setForm("models", index, "type", value)
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const inferModelType = (model: RemoteProviderModel): ModelType => {
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

  const applyRemoteModel = (model: RemoteProviderModel) => {
    setSelectedRemoteModel(model)
    const existing = form.models.findIndex((row) => row.id.trim() === model.id)
    const target = existing >= 0 ? existing : form.models.findIndex((row) => !row.id.trim() && !row.name.trim())
    const modelType = inferModelType(model)

    batch(() => {
      if (target >= 0) {
        setForm("models", target, "id", model.id)
        setForm("models", target, "name", model.name)
        setForm("models", target, "type", modelType)
        setForm("models", target, "err", {})
        return
      }
      setForm(
        "models",
        produce((rows) => {
          rows.push({ ...modelRow(), id: model.id, name: model.name, type: modelType })
        }),
      )
    })
  }

  const remoteModelMutation = useMutation(() => ({
    mutationFn: () =>
      fetchOpenAICompatibleModels({
        baseURL: form.baseURL,
        apiKey: form.apiKey,
        discover: async (payload) =>
          (
            await globalSDK.client.provider.models({
              providerModelDiscoveryPayload: payload,
            })
          ).data,
        headers: Object.fromEntries(
          form.headers
            .map((header) => ({ key: header.key.trim(), value: header.value.trim() }))
            .filter((header) => header.key && header.value)
            .map((header) => [header.key, header.value]),
        ),
      }),
    onSuccess: (models) => {
      setRemoteModels(models)
      setSelectedRemoteModel(undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.custom.models.fetch.success.title"),
        description: language.t("provider.custom.models.fetch.success.description", { count: models.length }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("provider.custom.models.fetch.error.title"), description: message })
    },
  }))

  const validate = () => {
    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: globalSync.data.config.disabled_providers ?? [],
      existingProviderIDs: new Set(globalSync.data.provider.all.map((p) => p.id)),
    })
    batch(() => {
      setForm("err", output.err)
      output.models.forEach((err, index) => setForm("models", index, "err", err))
      output.headers.forEach((err, index) => setForm("headers", index, "err", err))
    })
    return output.result
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>>) => {
      const disabledProviders = globalSync.data.config.disabled_providers ?? []
      const nextDisabled = disabledProviders.filter((id) => id !== result.providerID)

      if (result.key) {
        await globalSDK.client.auth.set({
          providerID: result.providerID,
          auth: {
            type: "api",
            key: result.key,
          },
        })
      }

      await globalSync.updateConfig({
        provider: { [result.providerID]: result.config },
        disabled_providers: nextDisabled,
      })
      return result
    },
    onSuccess: (result) => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
        description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return

    const result = validate()
    if (!result) return
    saveMutation.mutate(result)
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
      transition
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">{language.t("provider.custom.title")}</div>
        </div>

        <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
          <p class="text-14-regular text-text-base">
            {language.t("provider.custom.description.prefix")}
            <Link href="https://opencode.ai/docs/providers/#custom-provider" tabIndex={-1}>
              {language.t("provider.custom.description.link")}
            </Link>
            {language.t("provider.custom.description.suffix")}
          </p>

          <div class="flex flex-col gap-4">
            <SelectProviderCombobox
              class="w-full"
              current={form.providerID ? { id: form.providerID, name: form.name, baseURL: form.baseURL } : undefined}
              onSelect={handleProviderSelect}
            />
            <p class="text-11-regular text-text-weak">{language.t("provider.custom.field.provider.description")}</p>
            <TextField
              label={language.t("provider.custom.field.providerID.label")}
              placeholder={language.t("provider.custom.field.providerID.placeholder")}
              description={language.t("provider.custom.field.providerID.description")}
              value={form.providerID}
              onChange={(v) => setField("providerID", v)}
              validationState={form.err.providerID ? "invalid" : undefined}
              error={form.err.providerID}
            />
            <TextField
              label={language.t("provider.custom.field.name.label")}
              placeholder={language.t("provider.custom.field.name.placeholder")}
              value={form.name}
              onChange={(v) => setField("name", v)}
              validationState={form.err.name ? "invalid" : undefined}
              error={form.err.name}
            />
            <TextField
              label={language.t("provider.custom.field.baseURL.label")}
              placeholder={language.t("provider.custom.field.baseURL.placeholder")}
              value={form.baseURL}
              onChange={(v) => setField("baseURL", v)}
              validationState={form.err.baseURL ? "invalid" : undefined}
              error={form.err.baseURL}
            />
            <TextField
              label={language.t("provider.custom.field.apiKey.label")}
              placeholder={language.t("provider.custom.field.apiKey.placeholder")}
              description={language.t("provider.custom.field.apiKey.description")}
              value={form.apiKey}
              onChange={(v) => setField("apiKey", v)}
            />
          </div>

          <div class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <label class="text-12-medium text-text-weak">{language.t("provider.custom.models.label")}</label>
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  icon="download"
                  disabled={remoteModelMutation.isPending}
                  onClick={() => remoteModelMutation.mutate()}
                >
                  {remoteModelMutation.isPending
                    ? language.t("provider.custom.models.fetch.loading")
                    : language.t("provider.custom.models.fetch.action")}
                </Button>
                <Show when={remoteModels().length > 0}>
                  <Select
                    size="small"
                    variant="secondary"
                    options={remoteModels()}
                    current={selectedRemoteModel()}
                    value={(model) => model.id}
                    label={(model) => model.name}
                    groupBy={() => language.t("provider.custom.models.fetch.group")}
                    placeholder={language.t("provider.custom.models.fetch.select")}
                    onSelect={(model) => model && applyRemoteModel(model)}
                    triggerStyle={{ "min-width": "220px" }}
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
                </Show>
              </div>
            </div>
            <For each={form.models}>
              {(m, i) => (
                <div class="flex gap-2 items-start" data-row={m.row}>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.models.id.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.id.placeholder")}
                      value={m.id}
                      onChange={(v) => setModel(i(), "id", v)}
                      validationState={m.err.id ? "invalid" : undefined}
                      error={m.err.id}
                    />
                  </div>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.models.name.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.name.placeholder")}
                      value={m.name}
                      onChange={(v) => setModel(i(), "name", v)}
                      validationState={m.err.name ? "invalid" : undefined}
                      error={m.err.name}
                    />
                  </div>
                  <div class="w-28 shrink-0">
                    <Select
                      size="small"
                      options={MODEL_TYPES}
                      current={MODEL_TYPES.find((t) => t.value === m.type)}
                      value={(t) => t.value}
                      label={(t) => t.label}
                      onSelect={(t) => t && setModelType(i(), t.value)}
                      placeholder="模型类型"
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    class="mt-1.5"
                    onClick={() => removeModel(i())}
                    disabled={form.models.length <= 1}
                    aria-label={language.t("provider.custom.models.remove")}
                  />
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel} class="self-start">
              {language.t("provider.custom.models.add")}
            </Button>
          </div>

          <div class="flex flex-col gap-3">
            <label class="text-12-medium text-text-weak">{language.t("provider.custom.headers.label")}</label>
            <For each={form.headers}>
              {(h, i) => (
                <div class="flex gap-2 items-start" data-row={h.row}>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.headers.key.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.key.placeholder")}
                      value={h.key}
                      onChange={(v) => setHeader(i(), "key", v)}
                      validationState={h.err.key ? "invalid" : undefined}
                      error={h.err.key}
                    />
                  </div>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.headers.value.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.value.placeholder")}
                      value={h.value}
                      onChange={(v) => setHeader(i(), "value", v)}
                      validationState={h.err.value ? "invalid" : undefined}
                      error={h.err.value}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    class="mt-1.5"
                    onClick={() => removeHeader(i())}
                    disabled={form.headers.length <= 1}
                    aria-label={language.t("provider.custom.headers.remove")}
                  />
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader} class="self-start">
              {language.t("provider.custom.headers.add")}
            </Button>
          </div>

          <Button
            class="w-auto self-start"
            type="submit"
            size="large"
            variant="primary"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.submit")}
          </Button>
        </form>
      </div>
    </Dialog>
  )
}
