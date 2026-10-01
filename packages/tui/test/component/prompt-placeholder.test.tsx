/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { buildPlaceholder } from "../../src/component/prompt"
import { SESSION_PLACEHOLDERS } from "../../src/routes/session"

const MUTED = RGBA.fromValues(0.5, 0.5, 0.5, 0.8)
const ALPHA = 0.55

function build(examples: readonly string[], index: number) {
  return buildPlaceholder({ prefix: "问我任何事... ", examples, index, muted: MUTED, exampleAlpha: ALPHA })
}

test("占位符是两段式:提示语 + 引号包住的示例,示例更暗", () => {
  const value = build(["继续刚才的任务"], 0)!
  expect(value.chunks).toHaveLength(2)
  expect(value.chunks[0]!.text).toBe("问我任何事... ")
  expect(value.chunks[1]!.text).toBe('"继续刚才的任务"')
  expect(value.chunks[0]!.fg).toBe(MUTED)
  // 更暗 = alpha 更低(rgb 不变);RGBA 走 8bit 量化,单步误差最大 1/255 ≈ 0.0039,
  // 所以比到小数第 2 位。
  expect(value.chunks[1]!.fg!.a).toBeCloseTo(MUTED.a * ALPHA, 2)
})

test("占位符:没有示例时返回 undefined(不留半截提示语)", () => {
  expect(build([], 0)).toBeUndefined()
})

test("占位符:轮换下标按 examples 长度取模", () => {
  expect(build(["a", "b"], 0)!.chunks[1]!.text).toBe('"a"')
  expect(build(["a", "b"], 1)!.chunks[1]!.text).toBe('"b"')
  expect(build(["a", "b"], 3)!.chunks[1]!.text).toBe('"b"')
})

// 会话页之前一个占位符都没传,聚焦时输入框是空的。
test("会话页传了占位符,含原型里的「继续刚才的任务」", () => {
  expect(SESSION_PLACEHOLDERS.normal.length).toBeGreaterThan(0)
  expect(SESSION_PLACEHOLDERS.shell.length).toBeGreaterThan(0)
  expect(SESSION_PLACEHOLDERS.normal).toContain("继续刚才的任务")
})
