import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { resolveThemeVariant, themeToCss } from "./resolve"
import { MODEL_BRAND_COLORS, PLATFORM_BRAND_COLORS, PROVIDER_BRAND_COLORS } from "../components/provider-icons/brand"
import { hexToRgb } from "./color"
import { NOVAWAY_TOKENS_DARK, NOVAWAY_TOKENS_LIGHT } from "./novaway-tokens"
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
  test.each([false, true])("keeps the legacy border-color alias theme-derived (dark=%s)", (isDark) => {
    const theme = resolveThemeVariant({ seeds }, isDark)
    expect(theme["border-color"]).toBe(theme["border-base"])
  })

  test("keeps legacy identity, visualization, and diff tokens on their dedicated semantic roles", () => {
    for (const tokens of [NOVAWAY_TOKENS_LIGHT, NOVAWAY_TOKENS_DARK]) {
      expect(tokens["plugin-node"]).toContain("var(--graph-lane-5)")
      expect(tokens["plugin-node-foreground"]).toBe("var(--graph-lane-5)")
      expect(tokens["session-node"]).toContain("var(--graph-lane-0)")
      expect(tokens["session-node-foreground"]).toBe("var(--graph-lane-0)")
      expect(tokens["subagent-node"]).toContain("var(--graph-lane-2)")
      expect(tokens["subagent-node-foreground"]).toBe("var(--graph-lane-2)")
      expect(tokens["skill-node"]).toContain("var(--graph-lane-1)")
      expect(tokens["skill-node-foreground"]).toBe("var(--graph-lane-1)")
      expect(tokens["git-renamed"]).toBe("var(--icon-diff-modified-base)")
      expect(tokens["terminal-magenta"]).toBe("var(--syntax-keyword)")
      for (const key of ["file-icon-code", "file-icon-data", "file-icon-doc", "file-icon-shell", "file-icon-style"]) {
        expect(tokens[key]).toMatch(/^var\(--icon-file-category-[0-3]\)$/)
      }
      for (let index = 0; index < 7; index++) {
        expect(tokens[`context-breakdown-${index + 1}`]).toBe(`var(--graph-lane-${index})`)
      }
      for (let index = 0; index < 6; index++) {
        expect(tokens[`usage-chart-${index + 1}`]).toBe(`var(--graph-lane-${index})`)
      }
      expect(tokens["diff-added-foreground"]).toBe("var(--text-on-diff-add-base)")
      expect(tokens["diff-removed-foreground"]).toBe("var(--text-on-diff-delete-base)")
      expect(tokens["terminal-blue"]).toBe("var(--syntax-info)")
      expect(tokens["terminal-bright-magenta"]).toBe("var(--syntax-keyword)")
      expect(tokens["usage-heatmap-0"]).toBe("var(--surface)")
      expect(tokens["usage-heatmap-4"]).toContain("var(--graph-lane-0)")
    }
  })

  test.each([false, true])("generates theme-derived graph lane and shadow colors (dark=%s)", (isDark) => {
    const theme = resolveThemeVariant({ seeds }, isDark)

    for (let index = 0; index < 12; index++) {
      expect(theme[`graph-lane-${index}`]).toMatch(/^#[\da-f]{6}$/i)
    }
    expect(theme["shadow-color"]).toMatch(/^#[\da-f]{6}$/i)
    expect(theme["surface-highlight-base"]).toMatch(/^#[\da-f]{6}$/i)
    expect(theme["surface-presentation-stage"]).toBe("#000000")
    expect(theme["text-on-presentation-stage"]).toBe("#ffffff")
    expect(theme["indicator-interactive-base"]).toBe(theme["icon-interactive-base"])
    expect(theme["indicator-success-base"]).toBe(theme["icon-success-base"])
    expect(theme["indicator-critical-base"]).toBe(theme["icon-critical-base"])
    expect(theme["indicator-info-base"]).toBe(theme["icon-info-base"])
    expect(theme["text-on-diff-add-base"]).toMatch(/^#[\da-f]{6}$/i)
    expect(theme["text-on-diff-delete-base"]).toMatch(/^#[\da-f]{6}$/i)
    for (const mode of ["forge", "zen"]) {
      expect(theme[`app-mode-${mode}`]).toMatch(/^#[\da-f]{6}$/i)
      expect(theme[`app-mode-${mode}-foreground`]).toMatch(/^#[\da-f]{6}$/i)
    }
    expect(new Set(["forge", "zen"].map((mode) => theme[`app-mode-${mode}`])).size).toBe(2)
    for (let index = 0; index < 5; index++) {
      expect(theme[`team-category-${index}`]).toMatch(/^#[\da-f]{6}$/i)
      expect(theme[`team-category-${index}-foreground`]).toMatch(/^#[\da-f]{6}$/i)
    }
    for (let index = 0; index < 6; index++) {
      expect(theme[`tool-category-${index}`]).toMatch(/^#[\da-f]{6}$/i)
    }
    for (let index = 0; index < 4; index++) {
      expect(theme[`icon-file-category-${index}`]).toMatch(/^#[\da-f]{6}$/i)
      expect(theme[`surface-file-category-${index}`]).toMatch(/^color-mix\(/)
    }
    const presentation = readFileSync(
      new URL("../../../app/src/pages/session/pptx-file-preview.tsx", import.meta.url),
      "utf8",
    )
    expect(presentation).toContain("bg-surface-presentation-stage")
    expect(presentation).toContain("text-on-presentation-stage-muted")
    expect(presentation).not.toMatch(/\b(?:bg-black|text-white)\b/)
    const toolStyles = readFileSync(new URL("../components/basic-tool.css", import.meta.url), "utf8")
    expect(toolStyles).toContain("var(--tool-category-0)")
    expect(toolStyles).not.toContain("--tool-tone: var(--icon-agent-")
    const fileKinds = readFileSync(new URL("../../../app/src/utils/knowledge-file.ts", import.meta.url), "utf8")
    expect(fileKinds).toContain("var(--icon-file-category-0)")
    expect(fileKinds).not.toContain("var(--icon-agent-")
  })

  test("status text roles retain readable contrast on themed backgrounds", () => {
    for (const isDark of [false, true]) {
      const theme = resolveThemeVariant({ seeds }, isDark)
      const background = theme["background-base"] as HexColor
      for (const role of ["success", "warning", "critical", "info", "interactive"]) {
        expect(
          contrastRatio(theme[`text-${role}-base`] as HexColor, background),
          `text-${role}-base (dark=${isDark})`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test("static light and dark status text colors meet readable contrast", () => {
    const css = readFileSync(new URL("../styles/theme.css", import.meta.url), "utf8")
    const darkStart = css.indexOf("@media")
    const blocks = [css.slice(0, darkStart), css.slice(darkStart)]
    const color = (block: string, name: string) => {
      const match = block.match(new RegExp(`--${name}:\\s*(#[\\da-f]{6})`, "i"))
      expect(match, `${name} has a static color`).not.toBeNull()
      return match![1] as HexColor
    }

    const pairs = [
      ["text-on-brand-base", "surface-brand-base"],
      ["text-on-interactive-base", "surface-interactive-base"],
      ["text-on-interactive-weak", "surface-interactive-weak"],
      ["text-on-success-base", "surface-success-base"],
      ["text-on-success-weak", "surface-success-weak"],
      ["text-on-success-strong", "surface-success-strong"],
      ["text-on-warning-base", "surface-warning-base"],
      ["text-on-warning-weak", "surface-warning-weak"],
      ["text-on-warning-strong", "surface-warning-strong"],
      ["text-on-critical-base", "surface-critical-base"],
      ["text-on-critical-weak", "surface-critical-weak"],
      ["text-on-critical-strong", "surface-critical-strong"],
      ["text-on-info-base", "surface-info-base"],
      ["text-on-info-weak", "surface-info-weak"],
      ["text-on-info-strong", "surface-info-strong"],
      ["text-on-diff-add-base", "surface-diff-add-base"],
      ["text-on-diff-delete-base", "surface-diff-delete-base"],
      ["text-on-presentation-stage", "surface-presentation-stage"],
    ] as const

    for (const block of blocks) {
      const background = color(block, "background-base")
      expect(color(block, "surface-highlight-base")).toMatch(/^#[\da-f]{6}$/i)
      for (const role of ["success", "warning", "critical", "info", "interactive"]) {
        expect(
          contrastRatio(color(block, `text-${role}-base`), background),
          `static text-${role}-base contrast`,
        ).toBeGreaterThanOrEqual(4.5)
      }
      for (const role of ["plan", "docs", "ask", "build"]) {
        expect(
          contrastRatio(color(block, `text-agent-${role}-base`), background),
          `static text-agent-${role}-base contrast`,
        ).toBeGreaterThanOrEqual(4.5)
      }
      for (const [foreground, surface] of pairs) {
        expect(
          contrastRatio(color(block, foreground), color(block, surface)),
          `static ${foreground} against ${surface}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test("emits theme color-mix values accepted by the desktop theme schema", () => {
    const resolved = resolveThemeVariant({ seeds }, false)
    const schema = JSON.parse(readFileSync(new URL("./desktop-theme.schema.json", import.meta.url), "utf8"))
    const colorValue = new RegExp(schema.definitions.ColorValue.pattern)
    for (const token of [
      "surface-agent-plan-base",
      "surface-agent-docs-hover",
      "border-agent-ask-base",
      "surface-file-category-0",
    ]) {
      expect(resolved[token]).toContain("color-mix(in oklab, ")
      expect(colorValue.test(resolved[token])).toBe(true)
    }
    expect(colorValue.test(resolved["text-on-presentation-stage-muted"])).toBe(true)
    expect(colorValue.test("rgba(255, 255, 255, 0.7)")).toBe(true)
  })

  test("keeps Agent identity colors theme-derived and surfaces linked to their icon hues", () => {
    const base = resolveThemeVariant({ seeds }, false)
    const custom = resolveThemeVariant(
      { seeds: { ...seeds, info: "#ec4899", warning: "#06b6d4", interactive: "#a855f7" } },
      false,
    )

    for (const role of ["plan", "docs", "ask", "build"]) {
      expect(custom[`icon-agent-${role}-base`]).not.toBe(base[`icon-agent-${role}-base`])
      expect(custom[`surface-agent-${role}-base`]).toContain(`var(--icon-agent-${role}-base)`)
      expect(custom[`border-agent-${role}-base`]).toContain(`var(--icon-agent-${role}-base)`)
    }
  })

  test("generates readable foregrounds for diff colors in both modes", () => {
    for (const isDark of [false, true]) {
      const theme = resolveThemeVariant({ seeds }, isDark)
      expect(
        contrastRatio(theme["text-on-diff-add-base"] as HexColor, theme["surface-diff-add-base"] as HexColor),
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(theme["text-on-diff-delete-base"] as HexColor, theme["surface-diff-delete-base"] as HexColor),
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  test("provides readable Agent text roles distinct from icon roles", () => {
    for (const isDark of [false, true]) {
      const theme = resolveThemeVariant({ seeds }, isDark)
      const background = theme["background-base"] as HexColor
      for (const role of ["plan", "docs", "ask", "build"]) {
        const textColor = theme[`text-agent-${role}-base`] as HexColor
        expect(contrastRatio(textColor, background)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test("keeps semantic text-on colors matched to their exact surface roles", () => {
    const pairs = [
      ["text-on-brand-base", "surface-brand-base"],
      ["text-on-interactive-base", "surface-interactive-base"],
      ["text-on-interactive-weak", "surface-interactive-weak"],
      ["text-on-success-base", "surface-success-base"],
      ["text-on-success-weak", "surface-success-weak"],
      ["text-on-success-strong", "surface-success-strong"],
      ["text-on-warning-base", "surface-warning-base"],
      ["text-on-warning-weak", "surface-warning-weak"],
      ["text-on-warning-strong", "surface-warning-strong"],
      ["text-on-critical-base", "surface-critical-base"],
      ["text-on-critical-weak", "surface-critical-weak"],
      ["text-on-critical-strong", "surface-critical-strong"],
      ["text-on-info-base", "surface-info-base"],
      ["text-on-info-weak", "surface-info-weak"],
      ["text-on-info-strong", "surface-info-strong"],
      ["text-on-presentation-stage", "surface-presentation-stage"],
    ] as const

    for (const isDark of [false, true]) {
      const theme = resolveThemeVariant({ seeds }, isDark)
      for (const [foreground, surface] of pairs) {
        expect(
          contrastRatio(theme[foreground] as HexColor, theme[surface] as HexColor),
          `${foreground} against ${surface} (dark=${isDark})`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
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
    for (const family of ["success", "warning", "critical", "info"]) {
      expect(custom[`text-${family}-base`]).not.toBe(base[`text-${family}-base`])
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
        ...Array.from({ length: 6 }, (_, index) => theme[`tool-category-${index}`]),
        ...Array.from({ length: 4 }, (_, index) => theme[`icon-file-category-${index}`]),
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

  test("serializes app-mode and team-category tokens for runtime theme injection", () => {
    for (const isDark of [false, true]) {
      const css = themeToCss(resolveThemeVariant({ seeds }, isDark))
      for (const mode of ["forge", "zen"]) {
        expect(css).toContain(`--app-mode-${mode}:`)
        expect(css).toContain(`--app-mode-${mode}-foreground:`)
      }
      for (let index = 0; index < 5; index++) {
        expect(css).toContain(`--team-category-${index}:`)
        expect(css).toContain(`--team-category-${index}-foreground:`)
      }
    }
  })

  test("explicit theme overrides remain authoritative", () => {
    const theme = resolveThemeVariant(
      {
        seeds,
        overrides: {
          "graph-lane-0": "#123456",
          "shadow-color": "#654321",
          "text-on-diff-add-base": "#abcdef",
          "app-mode-forge": "#112233",
          "team-category-0": "#445566",
        },
      },
      false,
    )

    expect(theme["graph-lane-0"]).toBe("#123456")
    expect(theme["shadow-color"]).toBe("#654321")
    expect(theme["text-on-diff-add-base"]).toBe("#abcdef")
    expect(theme["app-mode-forge"]).toBe("#112233")
    expect(theme["team-category-0"]).toBe("#445566")
  })
})
