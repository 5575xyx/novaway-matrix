import { describe, expect, test } from "bun:test"
import { openaiImage } from "@novaway/llm/protocols/image-generation/openai"

describe("openai image protocol", () => {
  test("uses the OpenAI API gateway", () => {
    expect(openaiImage.baseURL).toBe("https://api.openai.com/v1")
    expect(openaiImage.endpoint).toBe("/images/generations")
  })

  test("gpt-image body omits response_format and defaults to square", () => {
    const body = openaiImage.buildBody({ prompt: "an app icon", model: "gpt-image-1" })
    expect(body).toEqual({
      model: "gpt-image-1",
      prompt: "an app icon",
      size: "1024x1024",
      n: 1,
    })
    expect(body).not.toHaveProperty("response_format")
  })

  test("dall-e body requests url response_format", () => {
    const body = openaiImage.buildBody({ prompt: "a cat", model: "dall-e-3", size: "1024x1024" })
    expect(body).toEqual({
      model: "dall-e-3",
      prompt: "a cat",
      size: "1024x1024",
      n: 1,
      response_format: "url",
    })
  })

  test("defaults model and merges options", () => {
    const body = openaiImage.buildBody({ prompt: "a cat", model: "", options: { quality: "high" } })
    expect(body.model).toBe("gpt-image-1")
    expect(body.quality).toBe("high")
  })

  test("parses base64 response", () => {
    const result = openaiImage.parseResponse({
      created: 1780000000,
      data: [{ b64_json: "base64data", revised_prompt: "revised" }],
    })
    expect(result.images).toEqual([{ base64: "base64data", revisedPrompt: "revised" }])
  })

  test("parses url response", () => {
    const result = openaiImage.parseResponse({
      created: 1780000000,
      data: [{ url: "https://example.com/out.png" }],
    })
    expect(result.images).toEqual([{ url: "https://example.com/out.png" }])
  })

  test("tolerates malformed responses", () => {
    expect(openaiImage.parseResponse(null).images).toEqual([])
    expect(openaiImage.parseResponse({ data: [null, 42, {}] }).images).toEqual([{}])
  })
})