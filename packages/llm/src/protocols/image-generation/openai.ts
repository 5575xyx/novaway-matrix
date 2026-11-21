import type { ImageGenerationParams, ImageGenerationProtocol, ImageGenerationResult } from "./index"

/**
 * OpenAI Images 适配器（gpt-image-1 / dall-e-3）
 *
 * API: POST /v1/images/generations
 * gpt-image 系列固定返回 b64_json，且不接受 response_format 参数；
 * dall-e 系列通过 response_format 指定返回 URL。
 */
export const openaiImage: ImageGenerationProtocol = {
  id: "openai-image",
  baseURL: "https://api.openai.com/v1",
  endpoint: "/images/generations",

  buildBody: (params: ImageGenerationParams) => {
    const model = params.model || "gpt-image-1"
    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
      size: params.size || "1024x1024",
      n: params.n ?? 1,
    }
    if (!/^gpt-image/i.test(model)) {
      body.response_format = "url"
    }
    return { ...body, ...params.options }
  },

  parseResponse: (raw: unknown): ImageGenerationResult => {
    const data = typeof raw === "object" && raw !== null ? Reflect.get(raw, "data") : undefined
    const rows = Array.isArray(data) ? data : []
    return {
      images: rows.flatMap((item) => {
        if (typeof item !== "object" || item === null) return []
        const url = Reflect.get(item, "url")
        const base64 = Reflect.get(item, "b64_json")
        const revisedPrompt = Reflect.get(item, "revised_prompt")
        return [
          {
            url: typeof url === "string" && url ? url : undefined,
            base64: typeof base64 === "string" && base64 ? base64 : undefined,
            revisedPrompt: typeof revisedPrompt === "string" && revisedPrompt ? revisedPrompt : undefined,
          },
        ]
      }),
    }
  },
}