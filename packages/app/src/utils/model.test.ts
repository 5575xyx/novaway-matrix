import { describe, expect, test } from "bun:test"
import { configuredModel, firstSelectableModel, isAutoModel, orderFallbackProviders } from "./model"

describe("isAutoModel", () => {
  test("only flags the built-in auto entry", () => {
    expect(isAutoModel("builtin", "auto")).toBe(true)
    expect(isAutoModel("builtin", "gpt-5")).toBe(false)
    expect(isAutoModel("anthropic", "auto")).toBe(false)
  })
})

describe("firstSelectableModel", () => {
  const alwaysValid = () => true

  test("内置提供商排除 auto，返回首个实时模型", () => {
    const builtin = {
      id: "builtin",
      models: { auto: { id: "auto" }, "gpt-5": { id: "gpt-5" } },
    }
    expect(firstSelectableModel(builtin, { builtin: "auto" }, alwaysValid)).toBe("gpt-5")
    expect(firstSelectableModel(builtin, {}, alwaysValid)).toBe("gpt-5")
  })

  test("仅含 auto 的内置提供商没有可选模型", () => {
    const builtin = { id: "builtin", models: { auto: { id: "auto" } } }
    expect(firstSelectableModel(builtin, { builtin: "auto" }, alwaysValid)).toBeUndefined()
  })

  test("非内置提供商优先使用默认模型", () => {
    const anthropic = {
      id: "anthropic",
      models: { "claude-4": { id: "claude-4" }, "claude-3": { id: "claude-3" } },
    }
    expect(firstSelectableModel(anthropic, { anthropic: "claude-3" }, alwaysValid)).toBe("claude-3")
    expect(firstSelectableModel(anthropic, {}, alwaysValid)).toBe("claude-4")
  })

  test("默认模型无效时回退到首个有效模型", () => {
    const anthropic = {
      id: "anthropic",
      models: { "claude-4": { id: "claude-4" } },
    }
    const isValid = (id: string) => id === "claude-4"
    expect(firstSelectableModel(anthropic, { anthropic: "gone" }, isValid)).toBe("claude-4")
  })

  test("内置提供商默认值为有效实时模型", () => {
    expect(firstSelectableModel({ id: "builtin", models: { gpt: { id: "gpt" } } }, { builtin: "gpt" }, alwaysValid)).toBe(
      "gpt",
    )
  })

  test("全部候选无效返回 undefined", () => {
    expect(firstSelectableModel({ id: "anthropic", models: { a: { id: "a" } } }, {}, () => false)).toBeUndefined()
  })

  test("非内置 provider 中名为 auto 的模型不应被剔除", () => {
    expect(firstSelectableModel({ id: "anthropic", models: { auto: { id: "auto" } } }, {}, alwaysValid)).toBe("auto")
  })
})

describe("configuredModel", () => {
  const alwaysValid = () => true

  test("配置为 builtin/auto 时手动模式忽略它", () => {
    expect(configuredModel("builtin/auto", alwaysValid)).toBeUndefined()
  })

  test("配置为普通模型时原样返回", () => {
    expect(configuredModel("anthropic/claude-4", alwaysValid)).toEqual({
      providerID: "anthropic",
      modelID: "claude-4",
    })
    expect(configuredModel("builtin/gpt-5", alwaysValid)).toEqual({ providerID: "builtin", modelID: "gpt-5" })
  })

  test("未配置或校验不通过时返回 undefined", () => {
    expect(configuredModel(undefined, alwaysValid)).toBeUndefined()
    expect(configuredModel("anthropic/gone", (m) => m.modelID === "claude-4")).toBeUndefined()
  })
})

describe("orderFallbackProviders", () => {
  test("把 builtin 排到最后且不改变其它顺序、不修改入参", () => {
    const input = [{ id: "builtin" }, { id: "anthropic" }, { id: "opencode" }]
    expect(orderFallbackProviders(input).map((p) => p.id)).toEqual(["anthropic", "opencode", "builtin"])
    expect(input.map((p) => p.id)).toEqual(["builtin", "anthropic", "opencode"])
  })
})
