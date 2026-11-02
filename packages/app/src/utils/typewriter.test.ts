import { describe, expect, test } from "bun:test"
import { advancePaced, revealStep } from "./typewriter"

describe("revealStep", () => {
  test("无剩余时直接返回全文长度", () => {
    expect(revealStep("abc", 3)).toBe(3)
    expect(revealStep("abc", 5)).toBe(3)
  })

  test("短剩余小步推进", () => {
    expect(revealStep("abcdef", 0)).toBe(2)
    expect(revealStep("abcdef", 2)).toBe(4)
  })

  test("步进后优先吸附到标点/空白边界", () => {
    const end = revealStep("hello world", 0)
    expect("hello world".slice(0, end).endsWith(" ")).toBe(true)
  })

  test("大文件按比例加速但有上限", () => {
    const text = "x".repeat(10_000)
    expect(revealStep(text, 0)).toBe(32)
  })

  test("不会越过文本末尾", () => {
    expect(revealStep("hi", 0)).toBeLessThanOrEqual(2)
  })
})

describe("advancePaced", () => {
  test("不在跟写窗口时直接跳最新", () => {
    const target = "a".repeat(400)
    expect(advancePaced(target, "a", false)).toBe(target)
  })

  test("跟写期间只揭示前缀，绝不越过目标", () => {
    const target = "hello world, this is a longer line."
    const next = advancePaced(target, "hello", true)
    expect(next.startsWith("hello")).toBe(true)
    expect(next.length).toBeGreaterThan(5)
    expect(target.startsWith(next)).toBe(true)
  })

  test("逐帧推进最终能追平", () => {
    const target = "line one\nline two\nline three\n"
    let shown = ""
    for (let i = 0; i < 500 && shown !== target; i++) shown = advancePaced(target, shown, true)
    expect(shown).toBe(target)
  })

  test("内容被重写（非前缀）时直接跳最新", () => {
    expect(advancePaced("totally different", "old content", true)).toBe("totally different")
  })

  test("已追平或内容变短时返回目标", () => {
    expect(advancePaced("same", "same", true)).toBe("same")
    expect(advancePaced("short", "shorter than this", true)).toBe("short")
  })
})
