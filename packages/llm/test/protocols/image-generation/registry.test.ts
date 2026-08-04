import { describe, expect, test } from "bun:test"
import { ProtocolRegistry } from "@opencode-ai/llm/protocols"
import { agnesImage } from "@opencode-ai/llm/protocols/image-generation/agnes"
import { sensenovaImage } from "@opencode-ai/llm/protocols/image-generation/sensenova"

ProtocolRegistry.registerImageProtocol("agnes", agnesImage)
ProtocolRegistry.registerImageProtocol("sensenova", sensenovaImage)

describe("image protocol registry", () => {
  test("selects a protocol by base URL even when the provider ID is custom", () => {
    expect(ProtocolRegistry.getImageProtocol("custom-provider", "https://token.sensenova.cn/v1")?.id).toBe(
      "sensenova-image",
    )
    expect(ProtocolRegistry.getImageProtocol("custom-provider", "https://api.agnes-ai.cn/v1")?.id).toBe("agnes-image")
  })

  test("keeps the provider base URL when the protocol matches", () => {
    expect(ProtocolRegistry.getImageProtocol("sensenova", "https://gateway.example.com/v1")?.baseURL).toBe(
      "https://gateway.example.com/v1",
    )
  })
})
