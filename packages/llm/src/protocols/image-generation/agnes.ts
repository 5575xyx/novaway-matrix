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
  endpoint: "/images/generations",

  buildBody: (params: ImageGenerationParams) => {
    const body: Record<string, unknown> = {
      model: params.model || "agnes-image-2.1-flash",
      prompt: params.prompt,
      size: params.size || "1024x768",
    }

    // 图片编辑（图生图）时，image 数组需要放在 extra_body.image 中
    const extraBody: Record<string, unknown> = { response_format: "url", ...params.options }
    if (params.image && params.image.length > 0) {
      extraBody.image = params.image
    }
    if (Object.keys(extraBody).length > 0) {
      body.extra_body = extraBody
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
