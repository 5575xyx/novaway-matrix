import type { ImageGenerationParams, ImageGenerationProtocol, ImageGenerationResult } from "./index"

const DEFAULT_MODEL = "sensenova-u1-fast"
const DEFAULT_SIZE = "2752x1536"

const SENSENOVA_SIZES = new Set([
  "1664x2496",
  "2496x1664",
  "1760x2368",
  "2368x1760",
  "1824x2272",
  "2272x1824",
  "2048x2048",
  "2752x1536",
  "1536x2752",
  "3072x1376",
  "1344x3136",
])

const SENSENOVA_RATIO_SIZES: Record<string, string> = {
  "2:3": "1664x2496",
  "3:2": "2496x1664",
  "3:4": "1760x2368",
  "4:3": "2368x1760",
  "4:5": "1824x2272",
  "5:4": "2272x1824",
  "1:1": "2048x2048",
  "16:9": "2752x1536",
  "9:16": "1536x2752",
  "21:9": "3072x1376",
  "9:21": "1344x3136",
}

function resolveSize(size: string | undefined, ratio: string | undefined) {
  if (size && SENSENOVA_SIZES.has(size)) return size
  if (ratio) {
    const normalized = ratio.trim().toLowerCase()
    const exact = SENSENOVA_RATIO_SIZES[normalized]
    if (exact) return exact
    const flipped = SENSENOVA_RATIO_SIZES[normalized.split(":").reverse().join(":")]
    if (flipped) return flipped
  }
  return DEFAULT_SIZE
}

/**
 * SenseNova U1 Fast 适配器
 *
 * API: POST /v1/images/generations
 * 文档: https://platform.sensenova.cn/docs
 * 注意：U1 Fast 不支持图像输入，返回的图片 URL 有效期固定为 1 小时。
 */
export const sensenovaImage: ImageGenerationProtocol = {
  id: "sensenova-image",
  baseURL: "https://token.sensenova.cn/v1",
  endpoint: "/images/generations",

  buildBody: (params: ImageGenerationParams) => ({
    model: params.model || DEFAULT_MODEL,
    prompt: params.prompt,
    size: resolveSize(params.size, params.ratio),
    n: params.n ?? 1,
    ...params.options,
  }),

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
