import { describe, expect, test } from "bun:test"
import { PROVIDER_BRAND_COLORS, providerBrandColor } from "./brand"

describe("provider brand colors", () => {
  test("returns known brand colors", () => {
    expect(providerBrandColor("deepseek")).toBe("#4D6BFE")
    expect(providerBrandColor("anthropic")).toBe("#D97757")
    expect(providerBrandColor("openai")).toBe("#10A37F")
    expect(providerBrandColor("google")).toBe("#4285F4")
  })

  test("resolves coding-plan and -cn variants", () => {
    expect(providerBrandColor("zai-coding-plan")).toBe(PROVIDER_BRAND_COLORS.zai)
    expect(providerBrandColor("minimax-cn")).toBe(PROVIDER_BRAND_COLORS.minimax)
  })

  test("matches ids case-insensitively", () => {
    expect(providerBrandColor("DeepSeek")).toBe("#4D6BFE")
  })

  test("returns undefined for unknown providers", () => {
    expect(providerBrandColor("definitely-not-a-provider")).toBeUndefined()
    expect(providerBrandColor(undefined)).toBeUndefined()
    expect(providerBrandColor("")).toBeUndefined()
  })

  test("every mapped color is a valid hex value", () => {
    for (const [id, color] of Object.entries(PROVIDER_BRAND_COLORS)) {
      expect(color, id).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})
