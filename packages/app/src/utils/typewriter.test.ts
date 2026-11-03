import { describe, expect, test } from "bun:test"
import { revealChunk, revealStep } from "./typewriter"

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
    const step = revealStep(text, 0)
    expect(step).toBeGreaterThanOrEqual(48)
    expect(step).toBeLessThanOrEqual(1024)
  })

  test("不会越过文本末尾", () => {
    expect(revealStep("hi", 0)).toBeLessThanOrEqual(2)
  })
})

describe("revealChunk", () => {
  test("剩余越少步长越小", () => {
    expect(revealChunk(0)).toBe(0)
    expect(revealChunk(10)).toBe(2)
    expect(revealChunk(600)).toBe(24)
    expect(revealChunk(100_000)).toBe(1024)
  })
})
