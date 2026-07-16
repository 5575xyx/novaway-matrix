import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

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

const resolveEndpoint = (baseURL: string, endpoint: string) =>
  endpoint.startsWith("http://") || endpoint.startsWith("https://") ? endpoint : `${baseURL}${endpoint}`

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

      const response = yield* HttpClient.execute(request)
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
        const url = resolveEndpoint(protocol.baseURL, protocol.statusEndpoint.replace("{taskId}", taskId))

        const request = HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeaders({
            Authorization: `Bearer ${apiKey}`,
          }),
        )

        const response = yield* HttpClient.execute(request)
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
