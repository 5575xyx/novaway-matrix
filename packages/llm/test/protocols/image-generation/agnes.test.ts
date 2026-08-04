import { describe, expect, test } from "bun:test"
import { agnesImage } from "@opencode-ai/llm/protocols/image-generation/agnes"

describe("agnes image protocol", () => {
  test("uses the current Agnes API gateway", () => {
    expect(agnesImage.baseURL).toBe("https://api.agnes-ai.cn/v1")
  })

  test("builds text-to-image body without image", () => {
    const body = agnesImage.buildBody({
      prompt: "a cat",
      model: "agnes-image-2.1-flash",
      size: "1024x768",
    })

    expect(body).toEqual({
      model: "agnes-image-2.1-flash",
      prompt: "a cat",
      size: "1024x768",
      extra_body: { response_format: "url" },
    })
  })

  test("builds image-to-image body with image in extra_body", () => {
    const body = agnesImage.buildBody({
      prompt: "make it orange",
      model: "agnes-image-2.1-flash",
      size: "1024x768",
      image: ["https://example.com/input.png"],
    })

    expect(body).toEqual({
      model: "agnes-image-2.1-flash",
      prompt: "make it orange",
      size: "1024x768",
      extra_body: {
        response_format: "url",
        image: ["https://example.com/input.png"],
      },
    })
    expect(body).not.toHaveProperty("image")
  })

  test("merges options into extra_body", () => {
    const body = agnesImage.buildBody({
      prompt: "make it orange",
      model: "agnes-image-2.1-flash",
      image: ["https://example.com/input.png"],
      options: { response_format: "b64_json" },
    })

    expect(body.extra_body).toEqual({
      response_format: "b64_json",
      image: ["https://example.com/input.png"],
    })
  })

  test("adds a supported ratio for tiered sizes", () => {
    const body = agnesImage.buildBody({
      prompt: "a desktop wallpaper",
      model: "agnes-image-2.1-flash",
      size: "2K",
      ratio: "16:9",
    })

    expect(body).toEqual({
      model: "agnes-image-2.1-flash",
      prompt: "a desktop wallpaper",
      size: "2K",
      ratio: "16:9",
      extra_body: { response_format: "url" },
    })
  })

  test("parses url response", () => {
    const result = agnesImage.parseResponse({
      created: 1780000000,
      data: [
        {
          url: "https://storage.googleapis.com/agnes-aigc/xxx.png",
          b64_json: null,
          revised_prompt: null,
        },
      ],
    })

    expect(result.images).toEqual([
      {
        url: "https://storage.googleapis.com/agnes-aigc/xxx.png",
        revisedPrompt: undefined,
      },
    ])
  })

  test("parses base64 response", () => {
    const result = agnesImage.parseResponse({
      created: 1780000000,
      data: [
        {
          url: null,
          b64_json: "base64data",
          revised_prompt: "revised",
        },
      ],
    })

    expect(result.images).toEqual([
      {
        base64: "base64data",
        revisedPrompt: "revised",
      },
    ])
  })
})
