import { describe, expect, test } from "bun:test"
import { resolveThemeVariant } from "./resolve"
import { MODEL_BRAND_COLORS, PLATFORM_BRAND_COLORS, PROVIDER_BRAND_COLORS } from "../components/provider-icons/brand"
import { hexToRgb } from "./color"
import type { HexColor, ThemeSeedColors } from "./types"

const seeds: ThemeSeedColors = {
  neutral: "#64748b",
  primary: "#3b82f6",
  success: "#22c55e",
  warning: "#f59e0b",
  error: "#ef4444",
  info: "#06b6d4",
  interactive: "#6366f1",
  diffAdd: "#22c55e",
  diffDelete: "#ef4444",
}

const relativeLuminance = (hex: HexColor) => {
  const { r, g, b } = hexToRgb(hex)
  const linear = (value: number) => (value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4))
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

const contrastRatio = (a: HexColor, b: HexColor) => {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

describe("resolveThemeVariant semantic color families", () => {
  test.each([false, true])("generates theme-derived graph lane and shadow colors (dark=%s)", (isDark) => {
    const theme = resolveThemeVariant({ seeds }, isDark)

    for (let index = 0; index < 12; index++) {
      expect(theme[`graph-lane-${index}`]).toMatch(/^#[\da-f]{6}$/i)
    }
    expect(theme["shadow-color"]).toMatch(/^#[\da-f]{6}$/i)
    expect(theme["text-on-diff-add-base"]).toMatch(/^#[\da-f]{6}$/i)
  })

  test("keeps status and tool accent families distinct and theme-derived", () => {
    for (const isDark of [false, true]) {
      const theme = resolveThemeVariant({ seeds }, isDark)
      const toolAccents = [
        theme["icon-success-base"],
        theme["icon-warning-base"],
        theme["icon-critical-base"],
        theme["icon-info-base"],
        theme["icon-interactive-base"],
      ]
      expect(new Set(toolAccents).size).toBeGreaterThanOrEqual(4)
      expect(toolAccents.every((color) => /^#[\da-f]{6}$/i.test(color))).toBe(true)
      const background = theme["background-base"] as HexColor
      for (const color of toolAccents) {
        expect(contrastRatio(color as HexColor, background)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  test("status foreground families follow their custom theme seeds", () => {
    const base = resolveThemeVariant({ seeds }, false)
    const custom = resolveThemeVariant(
      {
        seeds: {
          ...seeds,
          success: "#14b8a6",
          warning: "#e879f9",
          error: "#a855f7",
          info: "#f97316",
          interactive: "#d946ef",
        },
      },
      false,
    )

    for (const family of ["success", "warning", "critical", "info", "interactive"]) {
      expect(custom[`icon-${family}-base`]).not.toBe(base[`icon-${family}-base`])
    }
  })

  test.each([false, true])("keeps semantic icon families contrasted on custom backgrounds (dark=%s)", (isDark) => {
    for (const background of ["#fafcff", "#777777", "#040b18"] as HexColor[]) {
      const theme = resolveThemeVariant({ seeds, overrides: { "background-base": background } }, isDark)
      const iconColors = [
        theme["icon-success-base"],
        theme["icon-warning-base"],
        theme["icon-critical-base"],
        theme["icon-info-base"],
        theme["icon-interactive-base"],
      ] as HexColor[]

      for (const color of iconColors) {
        expect(contrastRatio(color, background)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  test("resolves every manufacturer hue with at least 3:1 contrast in light and dark modes", () => {
    for (const isDark of [false, true]) {
      const theme = resolveThemeVariant({ seeds }, isDark)
      const background = theme["background-base"] as HexColor

      for (const [prefix, brands] of [
        ["provider", PROVIDER_BRAND_COLORS],
        ["model", MODEL_BRAND_COLORS],
        ["platform", PLATFORM_BRAND_COLORS],
      ] as const) {
        for (const brand of Object.keys(brands)) {
          const color = theme[`${prefix}-brand-${brand}`] as HexColor
          expect(color, `${prefix}:${brand}`).toMatch(/^#[\da-f]{6}$/i)
          expect(contrastRatio(color, background), `${prefix}:${brand} (dark=${isDark})`).toBeGreaterThanOrEqual(3)
          if (prefix === "platform") {
            const foreground = theme[`platform-brand-${brand}-foreground`] as HexColor
            expect(
              contrastRatio(color, foreground),
              `${prefix}:${brand} foreground (dark=${isDark})`,
            ).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    }
  })

  test("resolves model family colors across themes and modes", () => {
    for (const isDark of [false, true]) {
      const theme = resolveThemeVariant({ seeds }, isDark)
      const sensenova = theme["model-brand-sensenova"] as HexColor
      const agnes = theme["model-brand-agnes"] as HexColor
      const background = theme["background-base"] as HexColor

      expect(sensenova).not.toBe(agnes)
      expect(contrastRatio(sensenova, background)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(agnes, background)).toBeGreaterThanOrEqual(3)
    }
  })

  test("provider colors follow custom interactive seeds and background overrides", () => {
    const base = resolveThemeVariant({ seeds }, false)
    const custom = resolveThemeVariant(
      { seeds: { ...seeds, interactive: "#d946ef" }, overrides: { "background-base": "#111827" } },
      false,
    )

    expect(custom["provider-brand-openai"]).not.toBe(base["provider-brand-openai"])
    expect(custom["provider-brand-github"]).not.toBe(base["provider-brand-github"])
    expect(custom["model-brand-sensenova"]).not.toBe(base["model-brand-sensenova"])
    expect(custom["model-brand-agnes"]).not.toBe(base["model-brand-agnes"])
  })

  test("keeps provider hues distinct and adapts low-luminance brands between modes", () => {
    const light = resolveThemeVariant({ seeds }, false)
    const dark = resolveThemeVariant({ seeds }, true)

    expect(light["provider-brand-openai"]).not.toBe(light["provider-brand-google"])
    expect(light["provider-brand-github"]).not.toBe(dark["provider-brand-github"])
  })

  test("graph lane colors change with the custom interactive seed", () => {
    const base = resolveThemeVariant({ seeds }, false)
    const custom = resolveThemeVariant({ seeds: { ...seeds, interactive: "#d946ef" } }, false)

    expect(custom["graph-lane-0"]).not.toBe(base["graph-lane-0"])
  })

  test("explicit theme overrides remain authoritative", () => {
    const theme = resolveThemeVariant(
      {
        seeds,
        overrides: { "graph-lane-0": "#123456", "shadow-color": "#654321", "text-on-diff-add-base": "#abcdef" },
      },
      false,
    )

    expect(theme["graph-lane-0"]).toBe("#123456")
    expect(theme["shadow-color"]).toBe("#654321")
    expect(theme["text-on-diff-add-base"]).toBe("#abcdef")
  })
})
