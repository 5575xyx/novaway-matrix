import { describe, expect, test } from "bun:test"
import {
  MODEL_BRAND_COLORS,
  PLATFORM_BRAND_COLORS,
  PROVIDER_BRAND_COLORS,
  modelBrandColor,
  platformBrandColor,
  platformBrandForegroundColor,
  providerBrandColor,
} from "./brand"

describe("provider theme colors", () => {
  test("returns mode-resolved tokens for known providers", () => {
    expect(providerBrandColor("deepseek")).toBe("var(--provider-brand-deepseek, var(--icon-interactive-base))")
    expect(providerBrandColor("anthropic")).toBe("var(--provider-brand-anthropic, var(--icon-interactive-base))")
    expect(providerBrandColor("openai")).toBe("var(--provider-brand-openai, var(--icon-interactive-base))")
    expect(providerBrandColor("google")).toBe("var(--provider-brand-google, var(--icon-interactive-base))")
  })

  test("resolves coding-plan and -cn variants to theme tokens", () => {
    expect(providerBrandColor("zai-coding-plan")).toBe(
      "var(--provider-brand-zai-coding-plan, var(--icon-interactive-base))",
    )
    expect(providerBrandColor("minimax-cn")).toBe("var(--provider-brand-minimax-cn, var(--icon-interactive-base))")
  })

  test("matches ids case-insensitively", () => {
    expect(providerBrandColor("DeepSeek")).toBe("var(--provider-brand-deepseek, var(--icon-interactive-base))")
  })

  test("returns undefined for unknown providers", () => {
    expect(providerBrandColor("definitely-not-a-provider")).toBeUndefined()
    expect(providerBrandColor(undefined)).toBeUndefined()
    expect(providerBrandColor("")).toBeUndefined()
  })

  test("keeps model family hues as separate theme-resolved seeds", () => {
    expect(MODEL_BRAND_COLORS.sensenova).toBe("#0EA5A4")
    expect(MODEL_BRAND_COLORS.agnes).toBe("#F59E0B")
    expect(modelBrandColor("sensenova")).toBe("var(--model-brand-sensenova, var(--icon-interactive-base))")
    expect(modelBrandColor("agnes")).toBe("var(--model-brand-agnes, var(--icon-interactive-base))")
  })

  test("keeps separate manufacturer and platform primary color seeds", () => {
    expect(PLATFORM_BRAND_COLORS.xhs).toBe("#FF2442")
    expect(PLATFORM_BRAND_COLORS.bilibili).toBe("#00A1D6")
    expect(PLATFORM_BRAND_COLORS.kwai).toBe("#FF4906")
    expect(platformBrandColor("xhs")).toBe("var(--platform-brand-xhs, var(--icon-interactive-base))")
    expect(platformBrandForegroundColor("xhs")).toBe(
      "var(--platform-brand-xhs-foreground, var(--text-on-interactive-base))",
    )
  })

  test("preserves manufacturer primary hues as resolver seeds", () => {
    for (const [id, color] of Object.entries(PROVIDER_BRAND_COLORS)) {
      expect(color, id).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})
