import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { VideoGeneration } from "@opencode-ai/llm/protocols/video-generation"
import { agnesVideo } from "@opencode-ai/llm/protocols/video-generation/agnes"

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
          url: "https://platform-outputs.agnes-ai.space/videos/video_456.mp4",
        })
        return HttpClientResponse.fromWeb(request, new Response(body, { status: 200 }))
      }),
    ),
  )

describe("video generation service", () => {
  test("uses absolute status endpoint without baseURL prefix", async () => {
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
    expect(statusRequest!.url).toBe("https://apihub.agnes-ai.com/agnesapi?video_id=video_456")
    expect(result.videoUrl).toBe("https://platform-outputs.agnes-ai.space/videos/video_456.mp4")
  })
})
