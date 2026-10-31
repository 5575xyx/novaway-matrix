import { Button } from "@novaway/ui/button"
import { useDialog } from "@novaway/ui/context/dialog"
import { Dialog } from "@novaway/ui/dialog"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { Select } from "@novaway/ui/select"
import { TextField } from "@novaway/ui/text-field"
import { showToast } from "@novaway/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { batch, createMemo, createSignal, For, Show } from "solid-js"
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
import { modelTypeOptions, type ModelType } from "@/utils/model-type"
import { type FormState, headerRow, modelRow, validateCustomProvider } from "./dialog-custom-provider-form"
import { SelectProviderCombobox } from "./select-provider-combobox"
import { DialogSelectProvider } from "./dialog-select-provider"

type Props = {
  back?: "providers" | "close"
}

type ProviderOption = {
  id: string
  name: string
  baseURL?: string
}

type Step = "basic" | "models"

/**
 * 自定义供应商：两步弹窗。
 *
 * 第一步填连接信息（选供应商 / ID / 名称 / 基础 URL / 密钥 / 请求头），
 * 第二步拉取供应商的模型列表并勾选要用的模型，再提交保存。
 * 底部固定一条操作栏：左边是可点击的步骤指示，右边是动作按钮，
 * 所以不管正文多长、滚到哪里，按钮永远在右下角。
 */
export function DialogCustomProvider(props: Props) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const [step, setStep] = createSignal<Step>("basic")
  const [remoteModels, setRemoteModels] = createSignal<RemoteProviderModel[]>([])
  const [modelQuery, setModelQuery] = createSignal("")

  const [form, setForm] = createStore<FormState>({
    providerID: "",
    name: "",
    baseURL: "",
    apiKey: "",
    models: [modelRow()],
    headers: [headerRow()],
    err: {},
  })

  const handleProviderSelect = (option: ProviderOption) => {
    batch(() => {
      setForm("providerID", option.id)
      setForm("name", option.name)
      if (option.baseURL) setForm("baseURL", option.baseURL)
    })
  }

  const goBack = () => {
    if (props.back === "close") {
      dialog.close()
      return
    }
    dialog.show(() => <DialogSelectProvider />)
  }

  const filledModels = createMemo(() => form.models.filter((row) => row.id.trim() || row.name.trim()))
  const selectedIDs = createMemo(() => new Set(filledModels().map((row) => row.id.trim())))
  const filteredRemote = createMemo(() => {
    const query = modelQuery().trim().toLowerCase()
    const list = remoteModels()
    if (!query) return list
    return list.filter((model) => model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query))
  })

  const addModel = () => {
    setForm(
      "models",
      produce((rows) => rows.push(modelRow())),
    )
  }

  const removeModel = (index: number) => {
    setForm(
      "models",
      produce((rows) => rows.splice(index, 1)),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((rows) => rows.push(headerRow())),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => rows.splice(index, 1)),
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
    const text = `${model.id} ${model.name}`.toLowerCase()
    if (text.includes("image") || text.includes("img") || text.includes("dall") || text.includes("picture"))
      return "image"
    if (text.includes("video") || text.includes("clip")) return "video"
    if (text.includes("audio") || text.includes("sound") || text.includes("speech") || text.includes("voice"))
      return "audio"
    return "text"
  }

  /** 勾选/取消勾选远端模型：勾上就落一行到模型表，取消就把对应行删掉。 */
  const toggleRemoteModel = (model: RemoteProviderModel) => {
    const index = form.models.findIndex((row) => row.id.trim() === model.id)
    if (index >= 0) {
      removeModel(index)
      return
    }
    const payload = { id: model.id, name: model.name, type: inferModelType(model), err: {} }
    const empty = form.models.findIndex((row) => !row.id.trim() && !row.name.trim())
    if (empty >= 0) {
      setForm("models", empty, (prev) => ({ ...prev, ...payload }))
      return
    }
    setForm(
      "models",
      produce((rows) => rows.push({ ...modelRow(), ...payload })),
    )
  }

  const remoteModelMutation = useMutation(() => ({
    mutationFn: () =>
      fetchOpenAICompatibleModels({
        baseURL: form.baseURL,
        apiKey: form.apiKey,
        discover: async (payload) =>
          (await globalSDK.client.provider.models({ providerModelDiscoveryPayload: payload })).data,
        headers: Object.fromEntries(
          form.headers
            .map((header) => ({ key: header.key.trim(), value: header.value.trim() }))
            .filter((header) => header.key && header.value)
            .map((header) => [header.key, header.value]),
        ),
      }),
    onSuccess: (models) => {
      setRemoteModels(models)
      setModelQuery("")
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

  const validate = (scope: "basic" | "all") => {
    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: globalSync.data.config.disabled_providers ?? [],
      existingProviderIDs: new Set(globalSync.data.provider.all.map((p) => p.id)),
      scope,
    })
    batch(() => {
      setForm("err", output.err)
      output.models.forEach((err, index) => setForm("models", index, "err", err))
      output.headers.forEach((err, index) => setForm("headers", index, "err", err))
    })
    return output
  }

  /** 第一步只校验连接信息；通过才允许切到第二步。 */
  const goNext = () => {
    const output = validate("basic")
    if (!output.result) return
    setStep("models")
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>["result"]>) => {
      const nextDisabled = (globalSync.data.config.disabled_providers ?? []).filter((id) => id !== result.providerID)

      if (result.key) {
        await globalSDK.client.auth.set({
          providerID: result.providerID,
          auth: { type: "api", key: result.key },
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

  const save = () => {
    if (saveMutation.isPending) return
    const output = validate("all")
    if (!output.result) {
      // 模型没填（或填错）时停在第二步，别把用户丢回第一步。
      setStep("models")
      return
    }
    saveMutation.mutate(output.result)
  }

  const stepItems = () => [
    { id: "basic" as const, label: language.t("provider.custom.step.basic") },
    { id: "models" as const, label: language.t("provider.custom.step.models") },
  ]

  /**
   * 步骤指示放在弹窗顶部居中。
   *
   * 之前塞在底部动作栏里，窄窗口下会和「取消 / 下一步」挤成两行；
   * 而且用户填第一步表单时看不到自己在第几步，得滚到底才知道。
   */
  const steps = (
    // sticky：表单往下滚的时候步骤条仍然钉在弹窗顶部，用户随时知道自己在第几步。
    // 负的左右外边距把背景铺满整宽，遮住从下面滚过去的字段。
    <div
      data-component="dialog-steps"
      class="sticky top-0 z-[2] -mx-5 flex items-center justify-center gap-1 bg-popover px-5 pb-2 pt-2"
    >
      <For each={stepItems()}>
        {(item, index) => (
          <>
            <Show when={index() > 0}>
              <Icon name="chevron-right" size="small" class="shrink-0 text-foreground-subtlest" />
            </Show>
            <button
              type="button"
              class="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-12-medium transition-colors"
              classList={{
                "bg-[color-mix(in_srgb,var(--icon-blue)_12%,var(--background))] text-[var(--icon-blue)]":
                  step() === item.id,
                "text-foreground-subtle hover:text-foreground": step() !== item.id,
              }}
              aria-current={step() === item.id ? "step" : undefined}
              onClick={() => {
                if (item.id === "models" && step() === "basic") {
                  goNext()
                  return
                }
                setStep(item.id)
              }}
            >
              <span
                class="grid size-4 place-items-center rounded-full text-10-semibold tabular-nums"
                classList={{
                  "bg-[var(--icon-blue)] text-white": step() === item.id,
                  "bg-surface text-foreground-subtle": step() !== item.id,
                }}
              >
                {index() + 1}
              </span>
              {item.label}
            </button>
          </>
        )}
      </For>
    </div>
  )

  return (
    <Dialog
      title={language.t("provider.custom.title")}
      action={
        <div class="flex items-center gap-1">
          <IconButton
            tabIndex={-1}
            icon="arrow-left"
            variant="ghost"
            onClick={goBack}
            aria-label={language.t("common.goBack")}
          />
          <IconButton
            tabIndex={-1}
            icon="close"
            variant="ghost"
            onClick={() => dialog.close()}
            aria-label={language.t("ui.common.close")}
          />
        </div>
      }
      footer={
        <div class="flex w-full items-center justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Show when={step() === "models"}>
            <Button variant="secondary" size="large" onClick={() => setStep("basic")}>
              {language.t("provider.custom.step.back")}
            </Button>
          </Show>
          <Show
            when={step() === "basic"}
            fallback={
              <Button variant="primary" size="large" disabled={saveMutation.isPending} onClick={save}>
                {saveMutation.isPending ? language.t("common.saving") : language.t("common.submit")}
              </Button>
            }
          >
            <Button variant="primary" size="large" onClick={goNext} disabled={remoteModelMutation.isPending}>
              {language.t("provider.custom.step.next")}
            </Button>
          </Show>
        </div>
      }
    >
      <div class="flex flex-col gap-4 px-5 pb-5 pt-1">
        {steps}
        <p class="text-12-regular leading-5 text-foreground-subtle">
          {step() === "basic" ? (
            language.t("provider.custom.step.hint.basic")
          ) : (
            <>
              {language.t("provider.custom.step.hint.models")}
              <Link href="https://NovaWay.ai/docs/providers/#custom-provider" tabIndex={-1} class="ml-1">
                {language.t("provider.custom.description.link")}
              </Link>
            </>
          )}
        </p>

        <Show
          when={step() === "basic"}
          fallback={
            <div class="flex flex-col gap-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex min-w-0 flex-col">
                  <span class="text-12-medium text-foreground">{language.t("provider.custom.models.available")}</span>
                  <span class="text-11-regular text-foreground-subtle">
                    {language.t("provider.custom.models.selected", { count: filledModels().length })}
                  </span>
                </div>
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
              </div>

              <Show
                when={remoteModels().length > 0}
                fallback={
                  <div class="rounded-lg border border-dashed border-border px-3 py-3 text-12-regular text-foreground-subtlest">
                    {language.t("provider.custom.models.list.empty")}
                  </div>
                }
              >
                <div class="flex flex-col gap-2">
                  <TextField
                    label={language.t("provider.custom.models.search.placeholder")}
                    hideLabel
                    placeholder={language.t("provider.custom.models.search.placeholder")}
                    value={modelQuery()}
                    onChange={setModelQuery}
                  />
                  <div class="max-h-52 overflow-y-auto rounded-lg border border-border">
                    <For each={filteredRemote()}>
                      {(model) => {
                        const on = () => selectedIDs().has(model.id)
                        return (
                          <button
                            type="button"
                            class="flex w-full items-center gap-2.5 border-t border-border px-3 py-2 text-left transition-colors first:border-t-0 hover:bg-hover"
                            classList={{ "bg-selected": on() }}
                            aria-pressed={on()}
                            onClick={() => toggleRemoteModel(model)}
                          >
                            <span
                              class="grid size-4 shrink-0 place-items-center rounded-[4px] border border-border"
                              classList={{ "border-[var(--icon-blue)] bg-[var(--icon-blue)] text-white": on() }}
                            >
                              <Show when={on()}>
                                <Icon name="check-small" size="small" />
                              </Show>
                            </span>
                            <span class="flex min-w-0 flex-1 flex-col">
                              <span class="truncate text-13-regular text-foreground">{model.name}</span>
                              <Show when={model.name !== model.id}>
                                <span class="truncate text-11-regular text-foreground-subtle">{model.id}</span>
                              </Show>
                            </span>
                          </button>
                        )
                      }}
                    </For>
                  </div>
                </div>
              </Show>

              <div class="flex flex-col gap-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-12-medium text-foreground">{language.t("provider.custom.models.added")}</span>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    icon="plus-small"
                    class="self-start"
                    onClick={addModel}
                  >
                    {language.t("provider.custom.models.manual")}
                  </Button>
                </div>
                <For each={form.models}>
                  {(m, i) => (
                    <div class="flex items-start gap-2" data-row={m.row}>
                      <div class="min-w-0 flex-1">
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
                      <div class="min-w-0 flex-1">
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
                          options={modelTypeOptions(language.t)}
                          current={modelTypeOptions(language.t).find((t) => t.value === m.type)}
                          value={(t) => t.value}
                          label={(t) => t.label}
                          onSelect={(t) => t && setModelType(i(), t.value)}
                          placeholder={language.t("provider.custom.models.type.placeholder")}
                        />
                      </div>
                      <IconButton
                        type="button"
                        icon="trash"
                        variant="ghost"
                        class="mt-1.5"
                        onClick={() => removeModel(i())}
                        aria-label={language.t("provider.custom.models.remove")}
                      />
                    </div>
                  )}
                </For>
                <Show when={form.err.models}>
                  <span class="text-12-regular text-danger-base">{form.err.models}</span>
                </Show>
              </div>
            </div>
          }
        >
          <div class="flex flex-col gap-4">
            <SelectProviderCombobox
              class="w-full"
              current={form.providerID ? { id: form.providerID, name: form.name, baseURL: form.baseURL } : undefined}
              onSelect={handleProviderSelect}
            />
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

            <div class="flex flex-col gap-3">
              <label class="text-12-medium text-foreground-subtle">{language.t("provider.custom.headers.label")}</label>
              <For each={form.headers}>
                {(h, i) => (
                  <div class="flex items-start gap-2" data-row={h.row}>
                    <div class="min-w-0 flex-1">
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
                    <div class="min-w-0 flex-1">
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
              <Button
                type="button"
                size="small"
                variant="ghost"
                icon="plus-small"
                class="self-start"
                onClick={addHeader}
              >
                {language.t("provider.custom.headers.add")}
              </Button>
            </div>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
