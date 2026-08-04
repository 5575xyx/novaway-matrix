import { describe, expect, test } from "bun:test"
import { sensenovaImage } from "@opencode-ai/llm/protocols/image-generation/sensenova"

describe("sensenova image protocol", () => {
  test("uses the Token Plan image generation endpoint", () => {
    expect(sensenovaImage.baseURL).toBe("https://token.sensenova.cn/v1")
    expect(sensenovaImage.endpoint).toBe("/images/generations")
  })

  test("builds a text-to-infographic body with the documented default size", () => {
    expect(
      sensenovaImage.buildBody({
        prompt: "生成一张信息图",
        model: "sensenova-u1-fast",
      }),
    ).toEqual({
      model: "sensenova-u1-fast",
      prompt: "生成一张信息图",
      size: "2752x1536",
      n: 1,
    })
  })

  test("maps common ratios to the documented 2K dimensions", () => {
    expect(
      sensenovaImage.buildBody({
        prompt: "1:1 信息图",
        model: "sensenova-u1-fast",
        size: "1:1",
        ratio: "1:1",
      }),
    ).toMatchObject({ size: "2048x2048" })
    expect(
      sensenovaImage.buildBody({
        prompt: "竖图",
        model: "sensenova-u1-fast",
        ratio: "9:16",
      }),
    ).toMatchObject({ size: "1536x2752" })
  })

  test("ignores image input because U1 Fast does not support it", () => {
    const body = sensenovaImage.buildBody({
      prompt: "text only",
      model: "sensenova-u1-fast",
      image: ["https://example.com/input.png"],
    })
    expect(body).not.toHaveProperty("image")
  })

  test("parses the documented url response", () => {
    const result = sensenovaImage.parseResponse({
      created: 1780000000,
      data: [{ url: "https://cdn.sensenova.dev/gen/example.png" }],
    })
    expect(result.images).toEqual([{ url: "https://cdn.sensenova.dev/gen/example.png" }])
  })
})
