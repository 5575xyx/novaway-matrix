import { parseRemoteProviderModels, type RemoteProviderModel } from "@novaway/core/openai-compatible"

export type { RemoteProviderModel } from "@novaway/core/openai-compatible"

export type RemoteModelType = "text" | "image" | "video" | "audio"

export function remoteModelType(model: RemoteProviderModel): RemoteModelType {
  const outputs = model.outputModalities ?? []
  if (outputs.includes("image")) return "image"
  if (outputs.includes("video")) return "video"
  if (outputs.includes("audio")) return "audio"
  return "text"
}

type DiscoveryPayload = {
  baseURL: string
  apiKey: string
  headers?: Record<string, string>
}

export async function fetchOpenAICompatibleModels(input: {
  baseURL: string
  apiKey: string
  headers?: Record<string, string>
  discover: (payload: DiscoveryPayload) => Promise<unknown>
}) {
  const response = await input
    .discover({
      baseURL: input.baseURL,
      apiKey: input.apiKey,
      ...(input.headers ? { headers: input.headers } : {}),
    })
    .catch((error) => {
      if (!(error instanceof Error)) throw error
      const cause = error.cause
      const body = typeof cause === "object" && cause !== null ? Reflect.get(cause, "body") : undefined
      const data = typeof body === "object" && body !== null ? Reflect.get(body, "data") : undefined
      const status = typeof data === "object" && data !== null ? Reflect.get(data, "status") : undefined
      if (!input.baseURL.includes("sensenova.cn") || status !== 401) throw error
      throw new Error(`${error.message}；请使用 Token Plan 控制台生成的 sk- API Key，并撤销截图中泄露的旧密钥`)
    })
  const data = typeof response === "object" && response !== null ? Reflect.get(response, "data") : undefined
  const result = data ?? response
  const models = typeof result === "object" && result !== null ? Reflect.get(result, "models") : undefined
  const parsed = parseRemoteProviderModels(models)
  if (parsed.length === 0) throw new Error("模型发现接口没有返回可识别的模型")
  return parsed
}
