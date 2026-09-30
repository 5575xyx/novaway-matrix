import { describe, expect, test } from "bun:test"
import { parse, stripProviderPrefix } from "../../src/util/model"

describe("util.model", () => {
  test("splits provider from a nested model identifier", () => {
    expect(parse("provider/org/model")).toEqual({ providerID: "provider", modelID: "org/model" })
    expect(parse("invalid")).toEqual({ providerID: "invalid", modelID: "" })
  })
})

describe("stripProviderPrefix", () => {
  const providerIDs = new Set(["opencode", "anthropic"])

  test("strips a leading known provider prefix", () => {
    expect(stripProviderPrefix("opencode:big-pickle", providerIDs)).toBe("big-pickle")
    expect(stripProviderPrefix("anthropic:claude-4", providerIDs)).toBe("claude-4")
  })

  test("keeps the name when the prefix is not a known provider", () => {
    expect(stripProviderPrefix("X:free", providerIDs)).toBe("X:free")
    expect(stripProviderPrefix("big-pickle", providerIDs)).toBe("big-pickle")
    expect(stripProviderPrefix(":foo", providerIDs)).toBe(":foo")
    expect(stripProviderPrefix("", providerIDs)).toBe("")
  })
})
