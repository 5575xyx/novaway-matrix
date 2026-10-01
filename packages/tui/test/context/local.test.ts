import { expect, test } from "bun:test"
import { configuredModel, defaultSelectableModel, parseModel, recentModels } from "../../src/context/local"
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

test("内置提供商在手动模式下排除 auto，但保留实时模型作为兜底", () => {
  const builtin = {
    id: "builtin",
    models: { auto: { id: "auto" }, "gpt-5": { id: "gpt-5" } },
  }
  expect(defaultSelectableModel(builtin, { builtin: "auto" })).toBe("gpt-5")
  expect(defaultSelectableModel(builtin, {})).toBe("gpt-5")
  expect(defaultSelectableModel(builtin, { builtin: "gpt-5" })).toBe("gpt-5")
})

test("仅含 auto 的内置提供商没有可兜底模型", () => {
  const builtin = { id: "builtin", models: { auto: { id: "auto" } } }
  expect(defaultSelectableModel(builtin, { builtin: "auto" })).toBeUndefined()
})

test("非内置提供商沿用默认模型或首个模型", () => {
  const anthropic = {
    id: "anthropic",
    models: { "claude-4": { id: "claude-4" }, "claude-3": { id: "claude-3" } },
  }
  expect(defaultSelectableModel(anthropic, { anthropic: "claude-3" })).toBe("claude-3")
  expect(defaultSelectableModel(anthropic, {})).toBe("claude-4")
})

test("配置/CLI 指定 builtin/auto 时手动模式忽略它", () => {
  const alwaysValid = () => true
  expect(configuredModel("builtin/auto", alwaysValid)).toBeUndefined()
})

test("配置/CLI 指定普通模型时原样返回", () => {
  const alwaysValid = () => true
  expect(configuredModel("builtin/gpt-5", alwaysValid)).toEqual({ providerID: "builtin", modelID: "gpt-5" })
  expect(configuredModel("anthropic/family/model", alwaysValid)).toEqual({
    providerID: "anthropic",
    modelID: "family/model",
  })
})

test("未配置或校验不通过时返回 undefined", () => {
  expect(configuredModel(undefined, () => true)).toBeUndefined()
  expect(configuredModel("anthropic/gone", (m) => m.modelID === "claude-4")).toBeUndefined()
})
