import { expect, test } from "bun:test"
import { parseModel, recentModels } from "../../src/context/local"
import { fadeColor } from "../../src/component/prompt"
import { RGBA } from "@opentui/core"

test("parses model IDs containing slashes", () => {
  expect(parseModel("provider/family/model")).toEqual({
    providerID: "provider",
    modelID: "family/model",
  })
})

test("moves a model to the front, deduplicates, and limits recents", () => {
  const recent = Array.from({ length: 12 }, (_, index) => ({
    providerID: "provider",
    modelID: `model-${index}`,
  }))

  expect(recentModels({ providerID: "provider", modelID: "model-5" }, recent)).toEqual([
    { providerID: "provider", modelID: "model-5" },
    ...recent.slice(0, 5),
    ...recent.slice(6, 10),
  ])
})

test("fades a missing color with a fallback instead of throwing", () => {
  const color = fadeColor(undefined, 0.5, RGBA.fromInts(10, 20, 30))
  expect(color.r).toBeCloseTo(10 / 255)
  expect(color.g).toBeCloseTo(20 / 255)
  expect(color.b).toBeCloseTo(30 / 255)
  expect(color.a).toBeCloseTo(0.5)
})
