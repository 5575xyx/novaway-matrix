import { describe, expect, test } from "bun:test"
import { displayModelGroup, displayModelName } from "./model-name"

describe("displayModelName", () => {
  test("removes the trailing Free suffix from free OpenCode models", () => {
    expect(displayModelName("Hy3 Free", "opencode", true)).toBe("Hy3")
    expect(displayModelName("Nemotron 3 Ultra Free", "opencode", true)).toBe("Nemotron 3 Ultra")
    expect(displayModelName("Ox Alpha Free (Unlimited)", "opencode", true)).toBe("Ox Alpha (Unlimited)")
  })

  test("keeps names unchanged when Free is not a trailing standalone suffix", () => {
    expect(displayModelName("Free Model", "opencode", true)).toBe("Free Model")
    expect(displayModelName("Muse Free Spark", "opencode", true)).toBe("Muse Free Spark")
    expect(displayModelName("Other Free", "other", true)).toBe("Other Free")
    expect(displayModelName("Other Free", "opencode", false)).toBe("Other Free")
  })
})

describe("displayModelGroup", () => {
  test("uses the default group for OpenCode models", () => {
    expect(displayModelGroup("opencode", "OpenCode Zen", "Default")).toBe("Default")
  })

  test("keeps other provider group names unchanged", () => {
    expect(displayModelGroup("anthropic", "Anthropic", "Default")).toBe("Anthropic")
  })
})
