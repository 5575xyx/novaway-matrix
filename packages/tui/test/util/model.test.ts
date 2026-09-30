import { describe, expect, test } from "bun:test"
import { parse, stripProviderPrefix } from "../../src/util/model"

describe("util.model", () => {
  test("splits provider from a nested model identifier", () => {
    expect(parse("provider/org/model")).toEqual({ providerID: "provider", modelID: "org/model" })
    expect(parse("invalid")).toEqual({ providerID: "invalid", modelID: "" })
  })
})

describe("stripProviderPrefix", () => {
  test("strips a leading provider separator for both colon and slash forms", () => {
    expect(stripProviderPrefix("opencode:big-pickle")).toBe("big-pickle")
    expect(stripProviderPrefix("qwen/qwen3.8-27b")).toBe("qwen3.8-27b")
  })

  test("keeps names without a leading provider prefix", () => {
    expect(stripProviderPrefix("Big Pickle")).toBe("Big Pickle")
    expect(stripProviderPrefix(":foo")).toBe(":foo")
    expect(stripProviderPrefix("qwen/")).toBe("qwen/")
    expect(stripProviderPrefix("")).toBe("")
  })
})
