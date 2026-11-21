import { describe, expect, test } from "bun:test"
import { browserEmbeddedEnabled } from "./browser-preferences"

describe("browserEmbeddedEnabled", () => {
  test("defaults to the embedded browser for old and empty configs", () => {
    expect(browserEmbeddedEnabled(undefined)).toBe(true)
    expect(browserEmbeddedEnabled({})).toBe(true)
    expect(browserEmbeddedEnabled({ browser: {} })).toBe(true)
  })

  test("respects the explicit opt-out", () => {
    expect(browserEmbeddedEnabled({ browser: { open_in_app: false } })).toBe(false)
    expect(browserEmbeddedEnabled({ browser: { open_in_app: true } })).toBe(true)
  })
})
