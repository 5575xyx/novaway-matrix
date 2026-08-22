import { describe, expect, test } from "bun:test"
import { TUI_BRAND } from "../src/brand"

describe("TUI brand", () => {
  test("uses NovaWay for visible product branding", () => {
    expect(TUI_BRAND.name).toBe("NovaWay")
    expect(`${TUI_BRAND.left}${TUI_BRAND.right}`).toBe(TUI_BRAND.name)
  })
})
