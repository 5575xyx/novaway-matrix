import { describe, expect, test } from "bun:test"
import { resolveTheme, type ThemeJson } from "../../src/theme"
import novaway from "../../src/theme/assets/novaway.json" with { type: "json" }

describe("霓虹渐变三端 token", () => {
  test("主题 JSON 未定义时兜底到 primary/secondary/accent", () => {
    const theme = resolveTheme(novaway as ThemeJson, "dark")
    expect(theme.neonStart).toEqual(theme.primary)
    expect(theme.neonMid).toEqual(theme.secondary)
    expect(theme.neonEnd).toEqual(theme.accent)
  })

  test("主题 JSON 显式定义时按定义解析", () => {
    const custom: ThemeJson = {
      ...novaway,
      theme: {
        ...novaway.theme,
        neonStart: "#ff0000",
        neonMid: "#00ff00",
        neonEnd: "#0000ff",
      },
    }
    const theme = resolveTheme(custom, "dark")
    expect(theme.neonStart.r).toBeCloseTo(1, 2)
    expect(theme.neonMid.g).toBeCloseTo(1, 2)
    expect(theme.neonEnd.b).toBeCloseTo(1, 2)
  })

  test("light 模式同样解析出兜底值", () => {
    const theme = resolveTheme(novaway as ThemeJson, "light")
    expect(theme.neonStart).toEqual(theme.primary)
  })
})
