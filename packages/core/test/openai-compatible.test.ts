import { describe, expect, test } from "bun:test"
import {
  parseRemoteProviderModels,
  resolveOpenAICompatibleEndpoint,
  stripProviderPrefix,
} from "@novaway/core/openai-compatible"

describe("OpenAI-compatible endpoint", () => {
  test("keeps a standard base URL", () => {
    expect(resolveOpenAICompatibleEndpoint("https://api.example.com/v1/")).toEqual({
      baseURL: "https://api.example.com/v1",
      modelsURL: "https://api.example.com/v1/models",
    })
  })

  test("normalizes standard chat and models URLs", () => {
    expect(resolveOpenAICompatibleEndpoint("https://api.example.com/v1/chat/completions")).toEqual({
      baseURL: "https://api.example.com/v1",
      modelsURL: "https://api.example.com/v1/models",
    })
    expect(resolveOpenAICompatibleEndpoint("https://api.example.com/v1/models")).toEqual({
      baseURL: "https://api.example.com/v1",
      modelsURL: "https://api.example.com/v1/models",
    })
  })

  test("normalizes SenseNova endpoints to the Token Plan API documented for OpenCode", () => {
    expect(resolveOpenAICompatibleEndpoint("https://api.sensenova.cn/v1/llm")).toEqual({
      baseURL: "https://token.sensenova.cn/v1",
      modelsURL: "https://token.sensenova.cn/v1/models",
    })
    expect(resolveOpenAICompatibleEndpoint("https://api.sensenova.cn/v1/llm/chat-completions")).toEqual({
      baseURL: "https://token.sensenova.cn/v1",
      modelsURL: "https://token.sensenova.cn/v1/models",
    })
    expect(resolveOpenAICompatibleEndpoint("https://token.sensenova.cn/v1")).toEqual({
      baseURL: "https://token.sensenova.cn/v1",
      modelsURL: "https://token.sensenova.cn/v1/models",
    })
  })

  test("rejects invalid and unsupported URLs", () => {
    expect(resolveOpenAICompatibleEndpoint("api.example.com/v1")).toBeUndefined()
    expect(resolveOpenAICompatibleEndpoint("file:///tmp/models")).toBeUndefined()
  })

  test("keeps SenseNova model output modalities", () => {
    const parsed = parseRemoteProviderModels({
      data: [
        {
          id: "sensenova-u1-fast",
          name: "SenseNova U1 Fast",
          input_modalities: ["text"],
          output_modalities: ["image"],
        },
      ],
    })
    expect(parsed).toEqual([
      {
        id: "sensenova-u1-fast",
        name: "SenseNova U1 Fast",
        inputModalities: ["text"],
        outputModalities: ["image"],
      },
    ])
  })
})

describe("stripProviderPrefix", () => {
  test("strips a leading provider separator for both colon and slash forms", () => {
    expect(stripProviderPrefix("opencode:big-pickle")).toBe("big-pickle")
    expect(stripProviderPrefix("qwen/qwen3.8-27b")).toBe("qwen3.8-27b")
  })

  test("keeps names without a leading provider prefix", () => {
    expect(stripProviderPrefix("Big Pickle")).toBe("Big Pickle")
    expect(stripProviderPrefix(":foo")).toBe(":foo")
    expect(stripProviderPrefix("qwen/")).toBe("qwen/")
    expect(stripProviderPrefix("")).toBe("")
  })
})
