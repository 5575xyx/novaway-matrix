import { describe, expect, test } from "bun:test"
import { normalizeCustomProviderID, providerOptions } from "../../../../src/component/dialog-provider"

describe("providerOptions", () => {
  test("includes a synthetic Other option for custom providers", () => {
    expect(providerOptions([{ id: "openai", name: "OpenAI" }]).at(-1)).toMatchObject({
      title: "其他",
      description: "自定义提供商",
      category: "提供商",
    })
  })

  test("does not use Other as the generic provider category", () => {
    expect(providerOptions([{ id: "mistral", name: "Mistral" }])[0]?.category).toBe("提供商")
  })

  test("keeps popular providers first and sorts the rest alphabetically", () => {
    expect(
      providerOptions([
        { id: "openai", name: "OpenAI" },
        { id: "custom-z", name: "Zebra Provider" },
        { id: "anthropic", name: "Anthropic" },
        { id: "mistral", name: "Mistral" },
        { id: "aws", name: "AWS Bedrock" },
      ]).map((option) => option.value),
    ).toEqual(["openai", "anthropic", "aws", "mistral", "custom-z", "__NovaWay_custom_provider__"])
  })

  test("does not collide with a configured provider named other", () => {
    const values = providerOptions([{ id: "other", name: "Other Provider" }]).map((option) => option.value)
    expect(new Set(values).size).toBe(values.length)
  })

  test("curates free-tier providers into a dedicated section right after NovaWay", () => {
    const options = providerOptions([
      { id: "openai", name: "OpenAI" },
      { id: "sensenova", name: "SenseNova (China)" },
      { id: "NovaWay", name: "NovaWay" },
    ])
    expect(options.map((option) => option.value)).toEqual(["NovaWay", "sensenova", "openai", "__NovaWay_custom_provider__"])
    const sense = options.find((option) => option.value === "sensenova")!
    expect(sense.category).toBe("免费接入")
    expect(sense.description).toContain("免费")
  })

  test("marks every curated free provider with the free category and tagline", () => {
    const ids = [
      "sensenova",
      "modelscope",
      "iflowcn",
      "openrouter",
      "zhipuai",
      "agnes",
      "google",
      "groq",
      "nvidia",
      "kilo",
      "siliconflow-cn",
    ]
    const options = providerOptions(ids.map((id) => ({ id, name: id })))
    for (const id of ids) {
      const option = options.find((item) => item.value === id)!
      expect(option.category).toBe("免费接入")
      expect(option.description).toContain("免费")
    }
  })

  test("labels free nature in the badge: permanent, rate-limited, credits", () => {
    const options = providerOptions([
      { id: "sensenova", name: "SenseNova" },
      { id: "google", name: "Google" },
      { id: "nvidia", name: "Nvidia" },
    ])
    // 模型定价为 0 的直接标「免费」
    expect(options.find((item) => item.value === "sensenova")!.description).toMatch(/^（免费）/)
    // 限速免费：模型有标价但 key 免费层可用
    expect(options.find((item) => item.value === "google")!.description).toMatch(/^（限速免费）/)
    // 额度制：注册送固定次数，用完转付费
    expect(options.find((item) => item.value === "nvidia")!.description).toMatch(/^（免费额度）/)
  })

  test("normalizes and validates custom provider ids", () => {
    expect(normalizeCustomProviderID("  custom-provider  ")).toBe("custom-provider")
    expect(normalizeCustomProviderID("custom_provider")).toBe("custom_provider")
    expect(normalizeCustomProviderID("@ai-sdk/custom-provider")).toBe("custom-provider")
    expect(normalizeCustomProviderID("-custom-provider")).toBeUndefined()
    expect(normalizeCustomProviderID("Custom Provider")).toBeUndefined()
  })
})
