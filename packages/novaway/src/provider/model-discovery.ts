import {
  parseRemoteProviderModels,
  resolveOpenAICompatibleEndpoint,
  type RemoteProviderModel,
} from "@novaway/core/openai-compatible"

export class ModelDiscoveryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "ModelDiscoveryError"
  }
}

type Fetcher = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>

function remoteError(body: string, status: number) {
  try {
    const payload = JSON.parse(body)
    const error = Reflect.get(payload, "error")
    if (typeof error === "object" && error !== null) {
      const message = Reflect.get(error, "message")
      if (typeof message === "string" && message.trim()) return new ModelDiscoveryError(message.trim(), status)
    }
  } catch {}
  return new ModelDiscoveryError(body.trim() || `HTTP ${status}`, status)
}

export async function discoverProviderModels(
  input: {
    baseURL: string
    apiKey: string
    headers?: Record<string, string>
  },
  fetcher: Fetcher = fetch,
): Promise<RemoteProviderModel[]> {
  const endpoint = resolveOpenAICompatibleEndpoint(input.baseURL)
  if (!endpoint) throw new ModelDiscoveryError("基础 URL 无效")

  const headers = new Headers(input.headers)
  headers.set("Accept", "application/json")
  if (input.apiKey.trim() && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${input.apiKey.trim()}`)
  }

  const response = await fetcher(endpoint.modelsURL, {
    headers,
    signal: AbortSignal.timeout(30_000),
  })
  const body = await response.text()
  if (!response.ok) throw remoteError(body, response.status)

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new ModelDiscoveryError("模型列表返回了无效 JSON", response.status)
  }

  const models = parseRemoteProviderModels(payload)
  if (models.length === 0) throw new ModelDiscoveryError("模型列表响应中没有可识别的模型", response.status)
  return models
}
