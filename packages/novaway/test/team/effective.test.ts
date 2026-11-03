import { describe, expect, it } from "bun:test"
import { compose, formatModel, hash, instructions, of, parseModel } from "@/team/effective"
import type { RosterEntry } from "@/team/profile"

const entry = (overrides: Partial<RosterEntry["employee"]> = {}): RosterEntry => ({
  employee: {
    id: "emp_review",
    name: "小林",
    job: "general",
    archived: false,
    ...overrides,
  },
  role: "worker",
  order: 1,
  canAutoDispatch: true,
})

describe("employee effective config", () => {
  it("reads provider/model and refuses half-written values", () => {
    expect(parseModel("test/test-model")).toEqual({ providerID: "test", modelID: "test-model" })
    expect(parseModel("  anthropic/claude-sonnet  ")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet" })
    // 只取第一个斜杠：模型名里带斜杠是合法的。
    expect(parseModel("openrouter/meta/llama")).toEqual({ providerID: "openrouter", modelID: "meta/llama" })
    // 写错就当没写：让会话默认模型接手，而不是带着坏 id 去请求。
    expect(parseModel(undefined)).toBeUndefined()
    expect(parseModel("")).toBeUndefined()
    expect(parseModel("no-slash")).toBeUndefined()
    expect(parseModel("/model")).toBeUndefined()
    expect(parseModel("provider/")).toBeUndefined()
  })

  it("formats the same shape it parses, and keeps slashes inside model ids", () => {
    expect(formatModel({ providerID: "openrouter", modelID: "meta/llama" })).toBe("openrouter/meta/llama")
    expect(parseModel(formatModel({ providerID: "sensenova", modelID: "deepseek-v4-pro" }))).toEqual({
      providerID: "sensenova",
      modelID: "deepseek-v4-pro",
    })
    expect(formatModel(undefined)).toBeUndefined()
  })

  it("freezes what the person declared, and nothing it cannot know", () => {
    const declared = of(entry({ model: "test/test-model", prompt: "只找安全问题", skills: ["review", "risk"] }))
    expect(declared).toEqual({
      agent: "general",
      model: "test/test-model",
      promptHash: hash("只找安全问题"),
      skills: ["review", "risk"],
    })
    // 没有声明的字段就不出现 —— 不写一个运行时才知道的默认值冒充「生效」。
    expect(of(entry())).toEqual({ agent: "general" })
    // 空白的模型 / 说明同样不算声明。
    expect(of(entry({ model: "   ", prompt: "  " }))).toEqual({ agent: "general" })
  })

  it("the instruction hash changes when the instruction changes", () => {
    expect(hash("a")).not.toBe(hash("b"))
    expect(hash("a")).toBe(hash("a"))
    expect(hash("a").startsWith("sha256:")).toBe(true)
  })

  it("puts the person's instruction before the task, and leaves the prompt alone without one", () => {
    const text = compose(entry({ prompt: "只找安全问题" }), "review the download flow")
    expect(text.startsWith("【你的岗位说明 · 小林（general）】")).toBe(true)
    expect(text).toContain("只找安全问题")
    expect(text.endsWith("review the download flow")).toBe(true)
    // 没有岗位说明：一个字节都不加（空标题比没有更糟）。
    expect(compose(entry(), "review")).toBe("review")
    expect(compose(undefined, "review")).toBe("review")
    expect(instructions(entry())).toBeUndefined()
  })
})
