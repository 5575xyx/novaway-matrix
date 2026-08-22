import { describe, expect, test } from "bun:test"
import { parseRemoteProviderModels } from "@novaway/core/openai-compatible"
import { fetchOpenAICompatibleModels, remoteModelType } from "./provider-model-discovery"

describe("provider model discovery", () => {
  test("parses OpenAI-compatible data and removes duplicates", () => {
    expect(
      parseRemoteProviderModels({
        data: [
          { id: "SenseChat-5", name: "SenseChat 5" },
          { id: "SenseChat-5" },
          "SenseChat-Turbo",
          { name: "missing id" },
        ],
      }),
    ).toEqual([
      { id: "SenseChat-5", name: "SenseChat 5" },
      { id: "SenseChat-Turbo", name: "SenseChat-Turbo" },
    ])
  })

  test("uses the Token Plan models endpoint for a pasted legacy SenseNova chat URL", async () => {
    const calls: Record<string, unknown>[] = []
    const models = await fetchOpenAICompatibleModels({
      baseURL: "https://api.sensenova.cn/v1/llm/chat-completions",
      apiKey: "token",
      headers: { "X-Test": "enabled" },
      discover: async (payload) => {
        calls.push(payload)
        return { models: [{ id: "SenseChat-5" }] }
      },
    })

    expect(calls[0]).toEqual({
      baseURL: "https://api.sensenova.cn/v1/llm/chat-completions",
      apiKey: "token",
      headers: { "X-Test": "enabled" },
    })
    expect(models).toEqual([{ id: "SenseChat-5", name: "SenseChat-5" }])
  })

  test("surfaces a missing model response", async () => {
    await expect(
      fetchOpenAICompatibleModels({
        baseURL: "https://api.example.com/v1",
        apiKey: "token",
        discover: async () => {
          return { models: [] }
        },
      }),
    ).rejects.toThrow("没有返回可识别的模型")
  })

  test("adds a Token Plan key hint only for a remote SenseNova 401", async () => {
    const unauthorized = new Error("Invalid API key", {
      cause: {
        status: 502,
        body: {
          data: {
            status: 401,
            message: "Invalid API key",
          },
        },
      },
    })

    await expect(
      fetchOpenAICompatibleModels({
        baseURL: "https://token.sensenova.cn/v1",
        apiKey: "expired",
        discover: async () => {
          throw unauthorized
        },
      }),
    ).rejects.toThrow("Token Plan")
  })

  test("maps SenseNova image output modalities to the image model type", () => {
    expect(
      remoteModelType({
        id: "sensenova-u1-fast",
        name: "SenseNova U1 Fast",
        outputModalities: ["image"],
      }),
    ).toBe("image")
  })
})
