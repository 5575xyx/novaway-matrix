import { describe, expect, test } from "bun:test"
import { displayModelGroup, displayModelName, sortModelOptions } from "../../../../src/component/dialog-model"

describe("displayModelName", () => {
  test("removes the trailing Free suffix from free NovaWay models", () => {
    expect(displayModelName("Hy3 Free", "NovaWay", true)).toBe("Hy3")
    expect(displayModelName("Nemotron 3 Ultra Free", "NovaWay", true)).toBe("Nemotron 3 Ultra")
    expect(displayModelName("Ox Alpha Free (Unlimited)", "NovaWay", true)).toBe("Ox Alpha (Unlimited)")
  })

  test("keeps other model names unchanged", () => {
    expect(displayModelName("Big Pickle", "NovaWay", true)).toBe("Big Pickle")
    expect(displayModelName("Free Model", "NovaWay", true)).toBe("Free Model")
    expect(displayModelName("Muse Free Spark", "NovaWay", true)).toBe("Muse Free Spark")
    expect(displayModelName("Other Free", "other", true)).toBe("Other Free")
    expect(displayModelName("Other Free", "NovaWay", false)).toBe("Other Free")
  })
})

describe("displayModelGroup", () => {
  test("uses the default group for NovaWay models", () => {
    expect(displayModelGroup("NovaWay", "NovaWay Zen")).toBe("默认")
  })

  test("keeps other provider group names unchanged", () => {
    expect(displayModelGroup("anthropic", "Anthropic")).toBe("Anthropic")
  })
})

describe("sortModelOptions", () => {
  test("orders provider-scoped model choices by newest release first", () => {
    const sorted = sortModelOptions(
      [
        { title: "GPT 5.2", releaseDate: "2025-12-11" },
        { title: "GPT 5.4", releaseDate: "2026-03-05" },
        { title: "GPT 5.1", releaseDate: "2025-11-13" },
      ],
      true,
    )

    expect(sorted.map((model) => model.title)).toEqual(["GPT 5.4", "GPT 5.2", "GPT 5.1"])
  })

  test("orders regular model choices free-first and then newest-first", () => {
    const sorted = sortModelOptions(
      [
        { title: "GLM 5", releaseDate: "2025-07-28" },
        { title: "GLM 5.1", releaseDate: "2025-12-09" },
        { title: "GLM 5.2", releaseDate: "2026-02-16" },
        { title: "Free old", releaseDate: "2024-01-01", free: true },
        { title: "Free new", releaseDate: "2025-01-01", free: true },
      ],
      false,
    )

    expect(sorted.map((model) => model.title)).toEqual(["Free new", "Free old", "GLM 5.2", "GLM 5.1", "GLM 5"])
  })
})
