import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, type HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"
import { generateImage } from "@/image/generate"

const gateway = "https://gateway.example.com/v1"

type Captured = { url?: string; auth?: string; calls: number }

function makeLayer(captured: Captured, unsupportedFirst = false) {
  const builtin = {
    id: "builtin",
    name: "内置",
    source: "custom",
    env: [],
    options: { baseURL: gateway, apiKey: "gw-key" },
    models: {
      "agnes-image-2.5-flash": {
        id: "agnes-image-2.5-flash",
        capabilities: { output: { image: true } },
        api: { url: gateway },
      },
      "gpt-image-1": {
        id: "gpt-image-1",
        capabilities: { output: { image: true } },
        api: { url: gateway },
      },
      "gpt-image-2.5": {
        id: "gpt-image-2.5",
        capabilities: { output: { image: true } },
        api: { url: gateway },
      },
    },
  } as unknown as Provider.Info

  const okResponse = {
    status: 200,
    json: Effect.succeed({ data: [{ url: "https://cdn.example.com/out.png" }] }),
    text: Effect.succeed(""),
  } as unknown as HttpClientResponse.HttpClientResponse

  const unsupportedResponse = {
    status: 400,
    json: Effect.succeed({}),
    text: Effect.succeed(
      JSON.stringify({
        error: {
          message:
            "Model agnes-image-2.5-flash is not supported on /v1/images/generations or /v1/images/edits. Use gpt-image-2.5, grok-imagine-image, or a configured openai-compatibility image model.",
          type: "invalid_request_error",
        },
      }),
    ),
  } as unknown as HttpClientResponse.HttpClientResponse

  return Layer.mergeAll(
    Layer.mock(Provider.Service, {
      list: () => Effect.succeed({ builtin } as unknown as Record<Provider.Info["id"], Provider.Info>),
    }),
    Layer.mock(Auth.Service, { get: () => Effect.succeed(undefined) }),
    Layer.mock(HttpClient.HttpClient, {
      execute: (req: HttpClientRequest.HttpClientRequest) => {
        captured.url = req.url
        captured.calls += 1
        const headers = req.headers as unknown as Record<string, string>
        captured.auth = headers["Authorization"] ?? headers["authorization"]
        if (unsupportedFirst && captured.calls === 1) return Effect.succeed(unsupportedResponse)
        return Effect.succeed(okResponse)
      },
    } as unknown as HttpClient.HttpClient),
  )
}

describe("generateImage builtin gateway resolution", () => {
  test("resolves a builtin agnes-image model to the gateway with its key", async () => {
    const captured: Captured = { calls: 0 }
    const result = await Effect.runPromise(
      generateImage({ prompt: "an app icon", model: "agnes-image-2.5-flash", size: "1024x1024" }).pipe(
        Effect.provide(makeLayer(captured)),
      ),
    )
    expect(result.providerId).toBe("builtin")
    expect(result.model).toBe("agnes-image-2.5-flash")
    expect(captured.url).toBe(`${gateway}/images/generations`)
    expect(captured.auth).toBe("Bearer gw-key")
    expect(result.images[0]?.url).toBe("https://cdn.example.com/out.png")
  })

  test("resolves a builtin gpt-image model to the gateway", async () => {
    const captured: Captured = { calls: 0 }
    const result = await Effect.runPromise(
      generateImage({ prompt: "an app icon", model: "gpt-image-1" }).pipe(Effect.provide(makeLayer(captured))),
    )
    expect(result.providerId).toBe("builtin")
    expect(result.model).toBe("gpt-image-1")
    expect(captured.url).toBe(`${gateway}/images/generations`)
    expect(captured.auth).toBe("Bearer gw-key")
  })

  test("falls back to a supported gateway model when the gateway rejects agnes-image", async () => {
    const captured: Captured = { calls: 0 }
    const result = await Effect.runPromise(
      generateImage({ prompt: "an app icon", model: "agnes-image-2.5-flash" }).pipe(
        Effect.provide(makeLayer(captured, true)),
      ),
    )
    expect(captured.calls).toBe(2)
    expect(result.providerId).toBe("builtin")
    expect(result.model).toBe("gpt-image-2.5")
    expect(result.fallbackFrom).toBe("agnes-image-2.5-flash")
    expect(captured.url).toBe(`${gateway}/images/generations`)
    expect(result.images[0]?.url).toBe("https://cdn.example.com/out.png")
  })

  test("does not fall back when allowFallback is false", async () => {
    const captured: Captured = { calls: 0 }
    const exit = await Effect.runPromiseExit(
      generateImage({ prompt: "an app icon", model: "agnes-image-2.5-flash", allowFallback: false }).pipe(
        Effect.provide(makeLayer(captured, true)),
      ),
    )
    expect(exit._tag).toBe("Failure")
    expect(captured.calls).toBe(1)
  })

  test("fails clearly when no image provider has a key", async () => {
    const empty = Layer.mergeAll(
      Layer.mock(Provider.Service, {
        list: () => Effect.succeed({} as unknown as Record<Provider.Info["id"], Provider.Info>),
      }),
      Layer.mock(Auth.Service, { get: () => Effect.succeed(undefined) }),
      Layer.mock(HttpClient.HttpClient, {
        execute: () => Effect.die("should not be called"),
      } as unknown as HttpClient.HttpClient),
    )
    const exit = await Effect.runPromiseExit(generateImage({ prompt: "x" }).pipe(Effect.provide(empty)))
    expect(exit._tag).toBe("Failure")
  })
})