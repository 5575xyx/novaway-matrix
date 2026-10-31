import { resolveOpenAICompatibleEndpoint } from "@novaway/core/openai-compatible"

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type ModelErr = {
  id?: string
  name?: string
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModelType = "text" | "image" | "video" | "audio"

export type ModelRow = {
  row: string
  id: string
  name: string
  type: ModelType
  err: ModelErr
}

export type HeaderRow = {
  row: string
  key: string
  value: string
  err: HeaderErr
}

export type FormState = {
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
  err: {
    providerID?: string
    name?: string
    baseURL?: string
    /** 第二步的整体错误（一个模型都没有）。 */
    models?: string
  }
}

type ValidateArgs = {
  form: FormState
  t: Translator
  disabledProviders: string[]
  existingProviderIDs: Set<string>
  /**
   * 校验范围。两步弹窗里第一步只校验"能不能连"（ID / 名称 / 地址 + 请求头），
   * 模型留到第二步再查 —— 否则用户刚打开弹窗、还没填模型就先看到一串红字。
   */
  scope?: "basic" | "all"
}

export function validateCustomProvider(input: ValidateArgs) {
  const scope = input.scope ?? "all"
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()
  const endpoint = resolveOpenAICompatibleEndpoint(baseURL)

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  const key = apiKey && !env ? apiKey : undefined

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(providerID)
      ? input.t("provider.custom.error.providerID.format")
      : undefined

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const urlError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !endpoint
      ? input.t("provider.custom.error.baseURL.format")
      : undefined

  const disabled = input.disabledProviders.includes(providerID)
  const existsError = idError
    ? undefined
    : input.existingProviderIDs.has(providerID) && !disabled
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  // 完全空白的行（没 id 也没名字）当作"没填"，不参与校验和保存 ——
  // 两步弹窗里用户可能把勾选的模型全取消了，留一个空行不该报"必填"。
  const rows = input.form.models.filter((m) => m.id.trim() || m.name.trim())

  const seenModels = new Set<string>()
  const models = rows.map((m) => {
    const id = m.id.trim()
    const idError =
      scope === "basic"
        ? undefined
        : !id
          ? input.t("provider.custom.error.required")
          : seenModels.has(id)
            ? input.t("provider.custom.error.duplicate")
            : (() => {
                seenModels.add(id)
                return undefined
              })()
    const nameError =
      scope === "basic" ? undefined : !m.name.trim() ? input.t("provider.custom.error.required") : undefined
    return { id: idError, name: nameError }
  })
  const modelsValid = scope === "basic" || (rows.length > 0 && models.every((m) => !m.id && !m.name))
  const modelsError =
    scope === "basic" || rows.length > 0 ? undefined : input.t("provider.custom.error.models.required")
  const modelConfig = Object.fromEntries(
    rows.map((m) => [m.id.trim(), { name: m.name.trim(), modalities: { input: [], output: [m.type] } }]),
  )

  const seenHeaders = new Set<string>()
  const headers = input.form.headers.map((h) => {
    const key = h.key.trim()
    const value = h.value.trim()

    // 第一步不查请求头：那些行默认是空的，一进来就标红只会让人以为填错了。
    if (scope === "basic") return {}
    if (!key && !value) return {}
    const keyError = !key
      ? input.t("provider.custom.error.required")
      : seenHeaders.has(key.toLowerCase())
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenHeaders.add(key.toLowerCase())
            return undefined
          })()
    const valueError = !value ? input.t("provider.custom.error.required") : undefined
    return { key: keyError, value: valueError }
  })
  const headersValid = headers.every((h) => !h.key && !h.value)
  const headerConfig = Object.fromEntries(
    input.form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
      .map((h) => [h.key, h.value]),
  )

  const err = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
    models: modelsError,
  }

  const ok = !idError && !existsError && !nameError && !urlError && modelsValid && headersValid
  if (!ok) return { err, models, headers }

  return {
    err,
    models,
    headers,
    result: {
      providerID,
      name,
      key,
      config: {
        npm: OPENAI_COMPATIBLE,
        name,
        ...(env ? { env: [env] } : {}),
        options: {
          baseURL: endpoint!.baseURL,
          ...(Object.keys(headerConfig).length ? { headers: headerConfig } : {}),
        },
        models: modelConfig,
      },
    },
  }
}

let row = 0

const nextRow = () => `row-${row++}`

export const modelRow = (): ModelRow => ({ row: nextRow(), id: "", name: "", type: "text", err: {} })
export const headerRow = (): HeaderRow => ({ row: nextRow(), key: "", value: "", err: {} })
