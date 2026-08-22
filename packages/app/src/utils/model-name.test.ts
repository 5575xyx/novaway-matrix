import { describe, expect, test } from "bun:test"
import { displayModelGroup, displayModelName } from "./model-name"

describe("displayModelName", () => {
  test("removes the trailing Free suffix from free NovaWay models", () => {
    expect(displayModelName("Hy3 Free", "NovaWay", true)).toBe("Hy3")
    expect(displayModelName("Nemotron 3 Ultra Free", "NovaWay", true)).toBe("Nemotron 3 Ultra")
    expect(displayModelName("Ox Alpha Free (Unlimited)", "NovaWay", true)).toBe("Ox Alpha (Unlimited)")
  })

  test("keeps names unchanged when Free is not a trailing standalone suffix", () => {
    expect(displayModelName("Free Model", "NovaWay", true)).toBe("Free Model")
    expect(displayModelName("Muse Free Spark", "NovaWay", true)).toBe("Muse Free Spark")
    expect(displayModelName("Other Free", "other", true)).toBe("Other Free")
    expect(displayModelName("Other Free", "NovaWay", false)).toBe("Other Free")
  })
})

describe("displayModelGroup", () => {
  test("uses the default group for NovaWay models", () => {
    expect(displayModelGroup("NovaWay", "NovaWay Zen", "Default")).toBe("Default")
  })

  test("keeps other provider group names unchanged", () => {
    expect(displayModelGroup("anthropic", "Anthropic", "Default")).toBe("Anthropic")
  })
})
