import { describe, expect, test } from "bun:test"
import { ModelID, ProviderID } from "@/provider/schema"
import { ModelNotFoundError } from "@/provider/provider"
import { describeFailure, modelNotice, pickDispatchModel } from "@/team/model-fallback"

const pinned = { providerID: "builtin", modelID: "agnes-3.0" }
const fallback = { providerID: "builtin", modelID: "novaway:grok-4.7" }

describe("pickDispatchModel", () => {
  test("会话记住的模型还能用：原样派发，不提回退", () => {
    expect(pickDispatchModel({ pinned, pinnedUsable: true, fallback })).toEqual({ model: pinned })
  })

  test("记住的模型已不可用：换成默认模型，并记住被换掉的是哪个", () => {
    expect(pickDispatchModel({ pinned, pinnedUsable: false, fallback })).toEqual({
      model: fallback,
      replaced: pinned,
    })
  })

  test("会话还没记住模型：直接用默认模型，不算回退", () => {
    expect(pickDispatchModel({ pinnedUsable: false, fallback })).toEqual({ model: fallback })
  })

  test("连默认模型都没有：不编一个，交给调用方报错", () => {
    expect(pickDispatchModel({ pinned, pinnedUsable: false })).toBeUndefined()
  })
})

describe("modelNotice", () => {
  test("回退说一次，同一个目标不再重复；恢复后清掉记录", () => {
    const seen = new Map<string, string>()
    const picked = { model: fallback, replaced: pinned }
    expect(modelNotice(seen, "ses_1", picked)).toContain("模型已回退到 builtin/novaway:grok-4.7")
    expect(modelNotice(seen, "ses_1", picked)).toBe("")
    expect(modelNotice(seen, "ses_1", { model: pinned })).toBe("")
    // 恢复之后再回到回退模型，要重新提示一次：这是一次新的变化。
    expect(modelNotice(seen, "ses_1", picked)).not.toBe("")
  })

  test("没有回退就没有提示", () => {
    expect(modelNotice(new Map(), "ses_1", { model: pinned })).toBe("")
  })
})

describe("describeFailure", () => {
  test("模型不存在：指出是哪个模型，并给出可用项", () => {
    const error = new ModelNotFoundError({
      providerID: ProviderID.make("builtin"),
      modelID: ModelID.make("agnes-3.0"),
      suggestions: ["novaway:grok-4.7", "agnes-2.5"],
    })
    const text = describeFailure(error)
    expect(text).toContain("builtin/agnes-3.0")
    expect(text).toContain("novaway:grok-4.7")
    // 不能把 Effect 的内部结构贴给用户。
    expect(text).not.toContain("Cause")
  })

  test("普通错误只说 message；什么都没有时说不清原因", () => {
    expect(describeFailure(new Error("连接超时"))).toBe("连接超时")
    expect(describeFailure({ message: "rate limited" })).toBe("rate limited")
    expect(describeFailure(undefined)).toBe("未知原因")
  })
})
