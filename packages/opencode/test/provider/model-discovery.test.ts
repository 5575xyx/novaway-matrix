import { describe, expect, test } from "bun:test"
import { discoverProviderModels, ModelDiscoveryError } from "../../src/provider/model-discovery"

describe("provider model discovery", () => {
  test("uses the documented SenseNova Token Plan models endpoint", async () => {
    const calls: { url: string; headers: Headers }[] = []
    const models = await discoverProviderModels(
      {
        baseURL: "https://api.sensenova.cn/v1/llm/chat-completions",
        apiKey: "sk-test",
      },
      async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        calls.push({ url, headers: new Headers(init?.headers) })
        return Response.json({
          data: [{ id: "sensenova-6.7-flash-lite", name: "SenseNova 6.7 Flash-Lite" }, { id: "deepseek-v4-flash" }],
        })
      },
    )

    expect(calls[0].url).toBe("https://token.sensenova.cn/v1/models")
    expect(calls[0].headers.get("Authorization")).toBe("Bearer sk-test")
    expect(models).toEqual([
      { id: "sensenova-6.7-flash-lite", name: "SenseNova 6.7 Flash-Lite" },
      { id: "deepseek-v4-flash", name: "deepseek-v4-flash" },
    ])
  })

  test("keeps output modalities from the remote model list", async () => {
    const models = await discoverProviderModels(
      {
        baseURL: "https://token.sensenova.cn/v1",
        apiKey: "sk-test",
      },
      async () =>
        Response.json({
          data: [
            {
              id: "sensenova-u1-fast",
              name: "SenseNova U1 Fast",
              input_modalities: ["text"],
              output_modalities: ["image"],
            },
          ],
        }),
    )

    expect(models).toEqual([
      {
        id: "sensenova-u1-fast",
        name: "SenseNova U1 Fast",
        inputModalities: ["text"],
        outputModalities: ["image"],
      },
    ])
  })

  test("preserves an explicit authorization header", async () => {
    const calls: Headers[] = []
    await discoverProviderModels(
      {
        baseURL: "https://api.example.com/v1",
        apiKey: "ignored",
        headers: { Authorization: "Token custom" },
      },
      async (_input, init) => {
        calls.push(new Headers(init?.headers))
        return Response.json(["model-a"])
      },
    )

    expect(calls[0].get("Authorization")).toBe("Token custom")
  })

  test("preserves the remote status and error message", async () => {
    const error = await discoverProviderModels(
      {
        baseURL: "https://token.sensenova.cn/v1",
        apiKey: "expired",
      },
      async () =>
        Response.json(
          {
            error: {
              message: "Invalid API key",
            },
          },
          { status: 401 },
        ),
    ).catch((cause) => cause)

    expect(error).toBeInstanceOf(ModelDiscoveryError)
    expect(error.status).toBe(401)
    expect(error.message).toBe("Invalid API key")
  })

  test("rejects invalid JSON and empty model lists", async () => {
    const invalidJson = await discoverProviderModels(
      { baseURL: "https://api.example.com/v1", apiKey: "token" },
      async () => new Response("not-json"),
    ).catch((error) => error)
    const empty = await discoverProviderModels({ baseURL: "https://api.example.com/v1", apiKey: "token" }, async () =>
      Response.json({ data: [] }),
    ).catch((error) => error)

    expect(invalidJson).toBeInstanceOf(ModelDiscoveryError)
    expect(invalidJson.message).toContain("无效 JSON")
    expect(empty).toBeInstanceOf(ModelDiscoveryError)
    expect(empty.message).toContain("没有可识别的模型")
  })
})
