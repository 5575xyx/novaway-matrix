import { Effect } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

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

export type VideoTaskStatus = "queued" | "processing" | "in_progress" | "completed" | "failed"

const resolveEndpoint = (baseURL: string, endpoint: string) => {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) return endpoint
  if (endpoint.startsWith("../")) return new URL(endpoint, `${baseURL.replace(/\/+$/, "")}/`).toString()
  return `${baseURL}${endpoint}`
}

const executeStatusRequest = (
  request: HttpClientRequest.HttpClientRequest,
  retries = 2,
): Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError, HttpClient.HttpClient> =>
  HttpClient.execute(request).pipe(
    Effect.catch((error) => {
      const retryable = HttpClientError.isHttpClientError(error) && error.reason._tag === "TransportError"
      if (!retryable || retries === 0) return Effect.fail(error)
      return Effect.sleep(200 * (3 - retries)).pipe(Effect.andThen(executeStatusRequest(request, retries - 1)))
    }),
  )

const retryAfterMs = (response: HttpClientResponse.HttpClientResponse, body: string) => {
  const milliseconds = Number.parseFloat(response.headers["retry-after-ms"] ?? "")
  if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds

  const seconds = Number.parseFloat(response.headers["retry-after"] ?? "")
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000

  const minutes = body.match(/allows\s+\d+\s+requests?\s+per\s+(\d+)\s+minute/i)?.[1]
  if (minutes) return Number.parseInt(minutes, 10) * 60_000
  return 60_000
}

const createRequest = (
  request: HttpClientRequest.HttpClientRequest,
  retries = 1,
): Effect.Effect<HttpClientResponse.HttpClientResponse, Error | HttpClientError.HttpClientError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(request)
    if (response.status < 400) return response

    const text = yield* response.text
    if (response.status !== 429) {
      return yield* Effect.fail(new Error(`Video generation failed: ${response.status} ${text}`))
    }

    const waitMs = retryAfterMs(response, text)
    if (retries === 0) {
      return yield* Effect.fail(
        new Error(`Agnes 视频生成请求仍受频率限制，请等待 ${Math.ceil(waitMs / 1000)} 秒后手动重试。`),
      )
    }

    yield* Effect.sleep(waitMs)
    return yield* createRequest(request, retries - 1)
  })

export interface VideoTaskCreateResult {
  readonly taskId: string
  readonly status: VideoTaskStatus
}

export interface VideoTaskStatusResult {
  readonly taskId: string
  readonly status: VideoTaskStatus
  readonly progress?: number
  readonly videoUrl?: string
  readonly error?: string
}

export interface VideoGenerationProtocol {
  readonly id: string
  readonly baseURL: string
  readonly createEndpoint: string
  readonly statusEndpoint: string
  readonly buildCreateBody: (params: VideoGenerationParams) => Record<string, unknown>
  readonly parseCreateResponse: (raw: unknown) => VideoTaskCreateResult
  readonly parseStatusResponse: (raw: unknown) => VideoTaskStatusResult
}

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
  ) => Effect.Effect<VideoTaskStatusResult, Error, HttpClient.HttpClient>
}

export const make = (): VideoGenerationService => ({
  createTask: (protocol, params, apiKey) =>
    Effect.gen(function* () {
      const body = protocol.buildCreateBody(params)
      const url = `${protocol.baseURL}${protocol.createEndpoint}`
      const bodyText = JSON.stringify(body)

      const request = HttpClientRequest.post(url).pipe(
        HttpClientRequest.setHeaders({
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        }),
        HttpClientRequest.bodyText(bodyText, "application/json"),
      )

      const response = yield* createRequest(request)
      const raw = yield* response.json
      return protocol.parseCreateResponse(raw)
    }),

  getStatus: (protocol, taskId, apiKey) =>
    Effect.gen(function* () {
      const url = resolveEndpoint(protocol.baseURL, protocol.statusEndpoint.replace("{taskId}", taskId))

      const request = HttpClientRequest.get(url).pipe(
        HttpClientRequest.setHeaders({
          Authorization: `Bearer ${apiKey}`,
        }),
      )

      const response = yield* executeStatusRequest(request)
      if (response.status >= 400) {
        const text = yield* response.text
        return yield* Effect.fail(new Error(`Video status request failed: ${response.status} ${text}`))
      }
      const raw = yield* response.json
      return protocol.parseStatusResponse(raw)
    }),

  waitForCompletion: (protocol, taskId, apiKey, options) =>
    Effect.gen(function* () {
      const pollIntervalMs = options?.pollIntervalMs ?? 10_000
      const maxWaitMs = options?.maxWaitMs ?? 1_800_000
      const startTime = Date.now()

      while (true) {
        const url = resolveEndpoint(protocol.baseURL, protocol.statusEndpoint.replace("{taskId}", taskId))

        const request = HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeaders({
            Authorization: `Bearer ${apiKey}`,
          }),
        )

        const response = yield* executeStatusRequest(request)
        if (response.status === 429) {
          const text = yield* response.text
          const waitMs = retryAfterMs(response, text)
          if (Date.now() - startTime + waitMs > maxWaitMs) {
            return yield* Effect.fail(new Error("Video generation timed out while waiting for the rate limit window"))
          }
          yield* Effect.sleep(waitMs)
          continue
        }
        if (response.status >= 400) {
          const text = yield* response.text
          return yield* Effect.fail(new Error(`Video status request failed: ${response.status} ${text}`))
        }
        const raw = yield* response.json
        const result = protocol.parseStatusResponse(raw)

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
