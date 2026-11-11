import { describe, expect, test } from "bun:test"
import { themeProviderSvg } from "./theme-provider-svg"

describe("themeProviderSvg", () => {
  test("replaces fixed SVG and inline CSS paints with currentColor", () => {
    const svg = '<svg fill="#111827"><path stroke="rgb(1, 2, 3)"/><style>.mark{fill:#fff}</style></svg>'

    expect(themeProviderSvg(svg)).toBe(
      '<svg fill="currentColor"><path stroke="currentColor"/><style>.mark{fill:currentColor}</style></svg>',
    )
  })

  test("preserves non-color paints and already semantic paints", () => {
    const svg =
      '<svg fill="none"><path fill="currentColor" stroke="url(#gradient)"/><style>.mark{fill:inherit}</style></svg>'

    expect(themeProviderSvg(svg)).toBe(svg)
  })
})
