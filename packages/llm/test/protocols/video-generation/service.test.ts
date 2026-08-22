import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { VideoGeneration } from "@novaway/llm/protocols/video-generation"
import { agnesVideo } from "@novaway/llm/protocols/video-generation/agnes"

const mockHttpClient = (requests: Array<{ url: string; method: string }>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
        requests.push({ url: web.url, method: web.method })
        const body = JSON.stringify({
          id: "task_123",
          video_id: "video_456",
          status: "completed",
          metadata: {
            url: "https://platform-outputs.agnes-ai.space/videos/video_456.mp4",
          },
        })
        return HttpClientResponse.fromWeb(request, new Response(body, { status: 200 }))
      }),
    ),
  )

const flakyHttpClient = (requests: Array<{ url: string; method: string }>) => {
  let attempts = 0
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
        requests.push({ url: web.url, method: web.method })
        attempts += 1
        if (attempts === 1) {
          return yield* Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request }),
            }),
          )
        }
        const body = JSON.stringify({
          video_id: "video_456",
          status: "completed",
          metadata: {
            url: "https://platform-outputs.agnes-ai.space/videos/video_456.mp4",
          },
        })
        return HttpClientResponse.fromWeb(request, new Response(body, { status: 200 }))
      }),
    ),
  )
}

const rateLimitedCreateHttpClient = (requests: Array<{ url: string; method: string }>) => {
  let attempts = 0
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
        requests.push({ url: web.url, method: web.method })
        attempts += 1
        if (attempts === 1) {
          const body = JSON.stringify({
            error: {
              message: "video generation rate limit exceeded: allows 1 requests per 1 minute(s)",
              code: "rate_limit_exceeded",
            },
          })
          return HttpClientResponse.fromWeb(
            request,
            new Response(body, { status: 429, headers: { "retry-after-ms": "0" } }),
          )
        }
        const body = JSON.stringify({
          id: "task_123",
          video_id: "video_456",
          status: "queued",
        })
        return HttpClientResponse.fromWeb(request, new Response(body, { status: 200 }))
      }),
    ),
  )
}

describe("video generation service", () => {
  test("resolves the status endpoint against the current gateway", async () => {
    const requests: Array<{ url: string; method: string }> = []
    const result = await VideoGeneration.make()
      .waitForCompletion(agnesVideo, "video_456", "test-api-key", {
        pollIntervalMs: 0,
        maxWaitMs: 5000,
      })
      .pipe(Effect.provide(mockHttpClient(requests)), Effect.runPromise)

    expect(requests.length).toBeGreaterThanOrEqual(1)
    const statusRequest = requests.find((r) => r.method === "GET")
    expect(statusRequest).toBeDefined()
    expect(statusRequest!.url).toBe("https://api.agnes-ai.cn/agnesapi?video_id=video_456")
    expect(result.videoUrl).toBe("https://platform-outputs.agnes-ai.space/videos/video_456.mp4")
  })

  test("resolves the status endpoint against a custom provider gateway", async () => {
    const requests: Array<{ url: string; method: string }> = []
    const result = await VideoGeneration.make()
      .getStatus({ ...agnesVideo, baseURL: "https://gateway.example.com/v1" }, "video_456", "test-api-key")
      .pipe(Effect.provide(mockHttpClient(requests)), Effect.runPromise)

    expect(requests).toEqual([{ method: "GET", url: "https://gateway.example.com/agnesapi?video_id=video_456" }])
    expect(result.videoUrl).toBe("https://platform-outputs.agnes-ai.space/videos/video_456.mp4")
  })

  test("retries a transient status transport failure", async () => {
    const requests: Array<{ url: string; method: string }> = []
    const result = await VideoGeneration.make()
      .getStatus(agnesVideo, "video_456", "test-api-key")
      .pipe(Effect.provide(flakyHttpClient(requests)), Effect.runPromise)

    expect(requests).toHaveLength(2)
    expect(result.status).toBe("completed")
    expect(result.videoUrl).toBe("https://platform-outputs.agnes-ai.space/videos/video_456.mp4")
  })

  test("waits for the provider rate limit before recreating a video task", async () => {
    const requests: Array<{ url: string; method: string }> = []
    const result = await VideoGeneration.make()
      .createTask(
        agnesVideo,
        {
          prompt: "a waving lucky cat",
          model: "agnes-video-v2.0",
        },
        "test-api-key",
      )
      .pipe(Effect.provide(rateLimitedCreateHttpClient(requests)), Effect.runPromise)

    expect(requests).toEqual([
      { method: "POST", url: "https://api.agnes-ai.cn/v1/videos" },
      { method: "POST", url: "https://api.agnes-ai.cn/v1/videos" },
    ])
    expect(result.taskId).toBe("video_456")
  })
})
