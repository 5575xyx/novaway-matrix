import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

/**
 * 图片生成请求参数
 */
export interface ImageGenerationParams {
  readonly prompt: string
  readonly model: string
  readonly size?: string
  readonly n?: number
  readonly image?: ReadonlyArray<string>
  readonly options?: Record<string, unknown>
}

/**
 * 生成的图片结果
 */
export interface GeneratedImage {
  readonly url?: string
  readonly base64?: string
  readonly revisedPrompt?: string
}

/**
 * 图片生成响应
 */
export interface ImageGenerationResult {
  readonly images: ReadonlyArray<GeneratedImage>
}

/**
 * 图片生成 Protocol 接口
 *
 * 各厂商需要实现此接口来适配不同的 API 格式。
 */
export interface ImageGenerationProtocol {
  readonly id: string
  readonly baseURL: string
  readonly buildBody: (params: ImageGenerationParams) => Record<string, unknown>
  readonly parseResponse: (raw: unknown) => ImageGenerationResult
}

/**
 * 图片生成 Service 接口
 */
export interface ImageGenerationService {
  readonly generate: (
    protocol: ImageGenerationProtocol,
    params: ImageGenerationParams,
    apiKey: string,
  ) => Effect.Effect<ImageGenerationResult, unknown, HttpClient.HttpClient>
}

/**
 * 创建图片生成 Service
 */
export const make = (): ImageGenerationService => ({
  generate: (protocol, params, apiKey) =>
    Effect.gen(function* () {
      const body = protocol.buildBody(params)
      const url = `${protocol.baseURL}/images/generations`
      const bodyText = JSON.stringify(body)

      const request = HttpClientRequest.post(url).pipe(
        HttpClientRequest.setHeaders({
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        }),
        HttpClientRequest.bodyText(bodyText, "application/json"),
      )

      const response = yield* HttpClient.execute(request)
      const raw = yield* response.json
      return protocol.parseResponse(raw)
    }),
})

export const ImageGeneration = { make }
