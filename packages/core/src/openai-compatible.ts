export type OpenAICompatibleEndpoint = {
  baseURL: string
  modelsURL: string
}

export type RemoteProviderModel = {
  id: string
  name: string
  inputModalities?: string[]
  outputModalities?: string[]
}

const STANDARD_CHAT_COMPLETIONS_PATH = "/chat/completions"
const SENSENOVA_BASE_URL = "https://token.sensenova.cn/v1"
const SENSENOVA_MODELS_URL = "https://token.sensenova.cn/v1/models"

function formatURL(url: URL) {
  url.search = ""
  url.hash = ""
  if (url.pathname === "/") return url.origin
  url.pathname = url.pathname.replace(/\/+$/, "")
  return url.toString().replace(/\/+$/, "")
}

function withPath(url: URL, path: string) {
  const next = new URL(url)
  next.pathname = `${next.pathname.replace(/\/+$/, "")}${path}`
  return formatURL(next)
}

function isSenseNova(url: URL) {
  const hostname = url.hostname.toLowerCase()
  return hostname === "api.sensenova.cn" || hostname === "token.sensenova.cn"
}

export function parseRemoteProviderModels(payload: unknown): RemoteProviderModel[] {
  const data = typeof payload === "object" && payload !== null ? Reflect.get(payload, "data") : undefined
  const rows = Array.isArray(payload) ? payload : Array.isArray(data) ? data : []
  const seen = new Set<string>()

  return rows
    .map((row) => {
      if (typeof row === "string") return { id: row.trim(), name: row.trim() }
      if (typeof row !== "object" || row === null) return undefined

      const id = Reflect.get(row, "id")
      const name = Reflect.get(row, "name")
      if (typeof id !== "string" || !id.trim()) return undefined
      const inputModalities = Reflect.get(row, "input_modalities")
      const outputModalities = Reflect.get(row, "output_modalities")
      const model: RemoteProviderModel = {
        id: id.trim(),
        name: typeof name === "string" && name.trim() ? name.trim() : id.trim(),
      }
      if (Array.isArray(inputModalities))
        model.inputModalities = inputModalities.filter((item): item is string => typeof item === "string")
      if (Array.isArray(outputModalities))
        model.outputModalities = outputModalities.filter((item): item is string => typeof item === "string")
      return model
    })
    .filter((model): model is RemoteProviderModel => {
      if (!model || !model.id || seen.has(model.id)) return false
      seen.add(model.id)
      return true
    })
}

export function resolveOpenAICompatibleEndpoint(input: string): OpenAICompatibleEndpoint | undefined {
  const value = input.trim()
  if (!URL.canParse(value)) return undefined

  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined

  url.search = ""
  url.hash = ""
  url.pathname = url.pathname.replace(/\/+$/, "") || "/"

  if (isSenseNova(url)) {
    return {
      baseURL: SENSENOVA_BASE_URL,
      modelsURL: SENSENOVA_MODELS_URL,
    }
  }

  const completionPath = url.pathname.endsWith(STANDARD_CHAT_COMPLETIONS_PATH)
    ? STANDARD_CHAT_COMPLETIONS_PATH
    : undefined
  const isModelsURL = url.pathname.endsWith("/models")
  const base = new URL(url)

  if (completionPath) base.pathname = base.pathname.slice(0, -completionPath.length) || "/"
  if (isModelsURL) base.pathname = base.pathname.slice(0, -"/models".length) || "/"

  const baseURL = formatURL(base)
  const modelsURL = isModelsURL ? formatURL(url) : withPath(base, "/models")
  return {
    baseURL,
    modelsURL,
  }
}
