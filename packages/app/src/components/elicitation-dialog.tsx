import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { Icon } from "@novaway/ui/icon"
import type { ElicitationRequest } from "@novaway/sdk/v2/client"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"

/**
 * MCP elicitation 弹窗：服务器在工具调用中途要一个答案。
 *
 * 与问题/权限弹窗的区别：它不属于任何会话（工具可能还没结束、也可能在后台跑），
 * 所以挂在应用级 layout 上，靠 elicitation.* 事件驱动，而不是从会话 store 里读。
 */

type Field = {
  name: string
  label: string
  description?: string
  type: "string" | "number" | "integer" | "boolean"
  options?: string[]
  value: unknown
  required: boolean
}

function fieldsOf(request: ElicitationRequest): Field[] {
  const schema = request.requestedSchema as { properties?: Record<string, unknown>; required?: unknown } | undefined
  if (!schema?.properties || typeof schema.properties !== "object") return []
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : [])
  const fields: Field[] = []
  for (const [name, raw] of Object.entries(schema.properties)) {
    if (!raw || typeof raw !== "object") continue
    const prop = raw as { type?: string; title?: string; description?: string; enum?: unknown[]; default?: unknown }
    const type = prop.type === "boolean" || prop.type === "number" || prop.type === "integer" ? prop.type : "string"
    fields.push({
      name,
      label: prop.title || name,
      ...(prop.description ? { description: prop.description } : {}),
      type,
      ...(Array.isArray(prop.enum) ? { options: prop.enum.map((item) => String(item)) } : {}),
      value: prop.default ?? (type === "boolean" ? false : ""),
      required: required.has(name),
    })
  }
  return fields
}

function FieldInput(props: {
  field: Field
  values: Record<string, unknown>
  setValues: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void
}) {
  const value = () => {
    const raw = props.values[props.field.name]
    return typeof raw === "string" || typeof raw === "number" ? String(raw) : ""
  }
  const change = (next: string) => props.setValues((prev) => ({ ...prev, [props.field.name]: next }))
  const style = "h-9 rounded-md border border-border bg-background px-2 text-13-regular text-foreground"
  return (
    <Show
      when={props.field.options}
      fallback={
        <input
          class={style}
          type={props.field.type === "number" || props.field.type === "integer" ? "number" : "text"}
          value={value()}
          onInput={(event) => change(event.currentTarget.value)}
        />
      }
    >
      {(options) => (
        <select class={style} value={value()} onChange={(event) => change(event.currentTarget.value)}>
          <For each={options()}>{(option) => <option value={option}>{option}</option>}</For>
        </select>
      )}
    </Show>
  )
}

export function ElicitationDialog(props: { directory: string }) {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const [requests, setRequests] = createStore<{ items: ElicitationRequest[] }>({ items: [] })
  const [values, setValues] = createSignal<Record<string, unknown>>({})
  const [busy, setBusy] = createSignal(false)
  /** 事件自带目录：后台会话的请求也能回到正确的实例上回答。 */
  const directoryOf = new Map<string, string>()

  const current = createMemo(() => requests.items[0])
  const title = createMemo(() => {
    const request = current()
    if (!request) return undefined
    return language.t("elicitation.title", { server: request.serverName })
  })
  const fields = createMemo(() => {
    const request = current()
    if (!request || request.mode !== "form") return []
    return fieldsOf(request)
  })

  const reset = (request: ElicitationRequest | undefined) => {
    if (!request) {
      setValues({})
      return
    }
    const next: Record<string, unknown> = {}
    for (const field of fieldsOf(request)) next[field.name] = field.value
    setValues(next)
  }

  onMount(() => {
    const upsert = (request: ElicitationRequest) => {
      setRequests(
        produce((draft) => {
          const index = draft.items.findIndex((item) => item.id === request.id)
          if (index === -1) draft.items.push(request)
          else draft.items[index] = request
        }),
      )
    }
    const remove = (id: string) => {
      setRequests(
        produce((draft) => {
          draft.items = draft.items.filter((item) => item.id !== id)
        }),
      )
    }

    const unsubscribe = globalSDK.event.listen((event) => {
      const details = event.details
      if (!details) return
      switch (details.type) {
        case "elicitation.asked":
          directoryOf.set(details.properties.id, event.name)
          upsert(details.properties)
          return
        case "elicitation.replied":
        case "elicitation.rejected":
          directoryOf.delete(details.properties.requestID)
          remove(details.properties.requestID)
          return
        case "elicitation.completed": {
          const pending = requests.items.filter(
            (item) =>
              item.serverName === details.properties.serverName &&
              item.elicitationId === details.properties.elicitationId,
          )
          for (const item of pending) upsert({ ...item, completed: true })
          return
        }
      }
    })
    onCleanup(unsubscribe)

    // 重连/刷新后事件已经错过：拉一次待处理队列。
    void globalSDK.client.elicitation
      .list({ directory: props.directory })
      .then((response) => {
        for (const item of response.data ?? []) {
          directoryOf.set(item.id, props.directory)
          upsert(item)
        }
      })
      .catch(() => undefined)
  })

  let initialized: string | undefined
  createEffect(() => {
    const request = current()
    if (!request) {
      initialized = undefined
      reset(undefined)
      return
    }
    if (initialized === request.id) return
    initialized = request.id
    reset(request)
  })

  const reply = (action: "accept" | "decline") => {
    const request = current()
    if (!request || busy()) return
    setBusy(true)
    const content =
      action === "accept" && request.mode === "form"
        ? Object.fromEntries(
            Object.entries(values()).map(([key, value]) => {
              const field = fields().find((item) => item.name === key)
              if (field?.type === "number" || field?.type === "integer") {
                const parsed = typeof value === "string" ? Number.parseFloat(value) : Number(value)
                return [key, Number.isNaN(parsed) ? value : parsed]
              }
              return [key, value]
            }),
          )
        : undefined
    void globalSDK.client.elicitation
      .reply({
        requestID: request.id,
        action,
        ...(content ? { content } : {}),
        directory: directoryOf.get(request.id) ?? props.directory,
      })
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }

  const dismiss = () => {
    const request = current()
    if (!request || busy()) return
    setBusy(true)
    void globalSDK.client.elicitation
      .reject({ requestID: request.id, directory: directoryOf.get(request.id) ?? props.directory })
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }

  return (
    <Kobalte modal preventScroll={false} open={!!current()} onOpenChange={(open: boolean) => !open && dismiss()}>
      <Kobalte.Portal>
        <Kobalte.Overlay data-component="dialog-overlay" />
        <Dialog title={title()} fit>
          <Show when={current()}>
            {(request) => (
              <>
                <div data-slot="dialog-body" class="flex flex-col gap-3 p-4">
                  <div class="text-14-regular text-foreground">{request().message}</div>
                  <Show when={request().mode === "url"}>
                    <div class="flex flex-col gap-2">
                      <div class="text-12-regular text-foreground-subtle">{language.t("elicitation.url.hint")}</div>
                      <Show when={request().url}>
                        {(url) => (
                          <a
                            href={url()}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-12-regular text-accent underline break-all"
                          >
                            {url()}
                          </a>
                        )}
                      </Show>
                      <Show when={request().completed}>
                        <div class="text-12-regular text-foreground-subtle">{language.t("elicitation.completed")}</div>
                      </Show>
                    </div>
                  </Show>
                  <Show when={request().mode === "form" && fields().length > 0}>
                    <div class="flex flex-col gap-3">
                      <For each={fields()}>
                        {(field) => (
                          <label class="flex flex-col gap-1">
                            <span class="text-12-regular text-foreground-subtle">
                              {field.label}
                              <Show when={field.required}>
                                <span class="text-rose-500"> *</span>
                              </Show>
                            </span>
                            <Show
                              when={field.type === "boolean"}
                              fallback={<FieldInput field={field} values={values()} setValues={setValues} />}
                            >
                              <input
                                type="checkbox"
                                checked={!!values()[field.name]}
                                onChange={(event) =>
                                  setValues((prev) => ({ ...prev, [field.name]: event.currentTarget.checked }))
                                }
                              />
                            </Show>
                            <Show when={field.description}>
                              <span class="text-11-regular text-foreground-subtle">{field.description}</span>
                            </Show>
                          </label>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
                <div class="flex justify-end gap-2 p-4 pt-0">
                  <Button variant="ghost" size="large" onClick={dismiss} disabled={busy()}>
                    {language.t("common.cancel")}
                  </Button>
                  <Button variant="ghost" size="large" onClick={() => reply("decline")} disabled={busy()}>
                    {language.t("elicitation.decline")}
                  </Button>
                  <Button variant="primary" size="large" onClick={() => reply("accept")} disabled={busy()}>
                    <Icon name="check-small" size="small" />
                    {request().mode === "url" ? language.t("elicitation.done") : language.t("elicitation.accept")}
                  </Button>
                </div>
              </>
            )}
          </Show>
        </Dialog>
      </Kobalte.Portal>
    </Kobalte>
  )
}
