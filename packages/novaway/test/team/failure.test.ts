import { describe, expect, it } from "bun:test"
import { Cause } from "effect"
import { DeniedError } from "@/permission"
import { classify, retriable } from "@/team/failure"

const cause = (error: unknown) => Cause.fail(error)

describe("team failure classification", () => {
  it("recognizes permission denials by their tag and by our own policy wording", () => {
    expect(classify(cause(new DeniedError({ ruleset: [] }))).kind).toBe("permission")
    expect(classify(cause(new Error("只读运行不允许破坏性操作（write）。"))).kind).toBe("permission")
    expect(classify(cause(new Error("这次任务的范围是 src/team；/repo/src/app/a.ts 不在其中。"))).kind).toBe(
      "permission",
    )
  })

  it("recognizes provider failures from transport-level text, not from what the model wrote", () => {
    expect(classify(cause(new Error("AI_APICallError: fetch failed"))).kind).toBe("provider")
    expect(classify(cause(new Error("socket hang up"))).kind).toBe("provider")
    expect(classify(cause(new Error("rate limit exceeded"))).kind).toBe("provider")
    // 模型自己写的一句「permission denied」不能被当成用户拒绝：界面会显示一个并不存在的按钮。
    expect(classify(cause(new Error("permission denied by the file system"))).kind).toBe("unknown")
  })

  it("falls back to the step it knows, and never invents a kind it cannot see", () => {
    // 提交步骤失败：文本说明不了问题，但我知道它发生在哪一步。
    expect(classify(cause(new Error("fatal: could not lock")), "commit").kind).toBe("commit")
    // 验证器报错同理：结论只能是 unverified，原因归验证器。
    expect(classify(cause(new Error("boom")), "verifier").kind).toBe("verifier")
    expect(classify(cause(new Error("boom"))).kind).toBe("unknown")
    // 明确的分类优先于兜底：提交步骤里碰上用户拒绝，说的是权限，不是提交。
    expect(classify(cause(new DeniedError({ ruleset: [] })), "commit").kind).toBe("permission")
  })

  it("keeps the original message: classification is not a rewrite", () => {
    const message = "AI_APICallError: fetch failed at 10:31"
    const failure = classify(cause(new Error(message)))
    expect(failure.message).toBe(message)
    // 非 Error 的抛出物也要能读成一句话，不能变成 "[object Object]" 之外的谜语。
    expect(classify(cause("plain string")).message).toBe("plain string")
  })

  it("only timeout and provider failures are worth retrying as-is", () => {
    expect(retriable("timeout")).toBe(true)
    expect(retriable("provider")).toBe(true)
    expect(retriable("permission")).toBe(false)
    expect(retriable("commit")).toBe(false)
    expect(retriable("unknown")).toBe(false)
  })
})
