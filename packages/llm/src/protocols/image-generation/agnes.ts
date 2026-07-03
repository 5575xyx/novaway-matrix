import type { ImageGenerationParams, ImageGenerationProtocol, ImageGenerationResult } from "./index"

/**
 * Agnes Image 2.1 Flash 适配器
 *
 * API: POST /v1/images/generations
 * 文档: https://agnes-ai.com/doc/agnes-image-21-flash
 */
export const agnesImage: ImageGenerationProtocol = {
  id: "agnes-image",
  baseURL: "https://apihub.agnes-ai.com/v1",

  buildBody: (params: ImageGenerationParams) => {
    const body: Record<string, unknown> = {
      model: params.model || "agnes-image-2.1-flash",
      prompt: params.prompt,
    }

    if (params.size) {
      body.size = params.size
    }

    if (params.image && params.image.length > 0) {
      body.image = params.image
    }

    if (params.options) {
      body.extra_body = params.options
    }

    return body
  },

  parseResponse: (raw: unknown): ImageGenerationResult => {
    const data = raw as { data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> }
    return {
      images: (data.data ?? []).map((item) => ({
        url: item.url ?? undefined,
        base64: item.b64_json ?? undefined,
        revisedPrompt: item.revised_prompt ?? undefined,
      })),
    }
  },
}
