import { describe, expect, test } from "bun:test"
import { isAutoModel } from "./model"

describe("isAutoModel", () => {
  test("only flags the built-in auto entry", () => {
    expect(isAutoModel("builtin", "auto")).toBe(true)
    expect(isAutoModel("builtin", "gpt-5")).toBe(false)
    expect(isAutoModel("anthropic", "auto")).toBe(false)
  })
})
