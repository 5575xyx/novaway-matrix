import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

/**
 * 视频生成请求参数
 */
export interface VideoGenerationParams {
  readonly prompt: string
  readonly model: string
  readonly height?: number
  readonly width?: number
  readonly numFrames?: number
  readonly frameRate?: number
  readonly image?: string
  readonly options?: Record<string, unknown>
}

/**
 * 任务状态
 */
export type VideoTaskStatus = "queued" | "processing" | "completed" | "failed"

/**
 * 任务创建响应
 */
export interface VideoTaskCreateResult {
  readonly taskId: string
  readonly status: VideoTaskStatus
}

/**
 * 任务状态响应
 */
export interface VideoTaskStatusResult {
  readonly taskId: string
  readonly status: VideoTaskStatus
  readonly progress?: number
  readonly videoUrl?: string
  readonly error?: string
}

/**
 * 视频生成 Protocol 接口
 *
 * 各厂商需要实现此接口来适配不同的 API 格式。
 */
export interface VideoGenerationProtocol {
  readonly id: string
  readonly baseURL: string
  readonly buildCreateBody: (params: VideoGenerationParams) => Record<string, unknown>
  readonly parseCreateResponse: (raw: unknown) => VideoTaskCreateResult
  readonly buildStatusUrl: (taskId: string) => string
  readonly parseStatusResponse: (raw: unknown) => VideoTaskStatusResult
}

/**
 * 视频生成 Service 接口
 */
export interface VideoGenerationService {
  readonly createTask: (
    protocol: VideoGenerationProtocol,
    params: VideoGenerationParams,
    apiKey: string,
  ) => Effect.Effect<VideoTaskCreateResult, unknown, HttpClient.HttpClient>
  readonly getStatus: (
    protocol: VideoGenerationProtocol,
    taskId: string,
    apiKey: string,
  ) => Effect.Effect<VideoTaskStatusResult, unknown, HttpClient.HttpClient>
  readonly waitForCompletion: (
    protocol: VideoGenerationProtocol,
    taskId: string,
    apiKey: string,
    options?: { readonly pollIntervalMs?: number; readonly maxWaitMs?: number },
  ) => Effect.Effect<VideoTaskStatusResult, Error, never>
}

/**
 * 创建视频生成 Service
 */
export const make = (): VideoGenerationService => ({
  createTask: (protocol, params, apiKey) =>
    Effect.gen(function* () {
      const body = protocol.buildCreateBody(params)
      const url = `${protocol.baseURL}/videos`
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
      return protocol.parseCreateResponse(raw)
    }),

  getStatus: (protocol, taskId, apiKey) =>
    Effect.gen(function* () {
      const url = `${protocol.baseURL}${protocol.buildStatusUrl(taskId)}`

      const request = HttpClientRequest.get(url).pipe(
        HttpClientRequest.setHeaders({
          Authorization: `Bearer ${apiKey}`,
        }),
      )

      const response = yield* HttpClient.execute(request)
      const raw = yield* response.json
      return protocol.parseStatusResponse(raw)
    }),

  waitForCompletion: (protocol, taskId, apiKey, options) =>
    Effect.gen(function* () {
      const pollIntervalMs = options?.pollIntervalMs ?? 10_000
      const maxWaitMs = options?.maxWaitMs ?? 1_800_000
      const startTime = Date.now()

      while (true) {
        const status = yield* Effect.promise(() =>
          fetch(`${protocol.baseURL}${protocol.buildStatusUrl(taskId)}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          }).then((r) => r.json()),
        )

        const result = protocol.parseStatusResponse(status)

        if (result.status === "completed" || result.status === "failed") {
          return result
        }

        if (Date.now() - startTime > maxWaitMs) {
          return yield* Effect.fail(new Error("Video generation timed out"))
        }

        yield* Effect.sleep(pollIntervalMs)
      }
    }),
})

export const VideoGeneration = { make }
