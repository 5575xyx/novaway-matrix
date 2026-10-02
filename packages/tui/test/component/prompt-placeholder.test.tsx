/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
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

// 纯函数断言只证明 buildPlaceholder 返回了两个 chunk;真正的风险是
// 「Textarea 哪天不认 StyledText」。所以最后再挂一次真 textarea,在 captureSpans()
// 上确认两段确实以两种 fg 落到了屏幕上。
test("真 textarea 把两段占位符渲染成两个不同 fg 的 span", async () => {
  const placeholder = build(["继续刚才的任务"], 0)
  const app = await testRender(
    () => (
      <box width={60}>
        <textarea width="100%" minHeight={1} placeholder={placeholder} placeholderColor={MUTED} />
      </box>
    ),
    { width: 60, height: 4 },
  )
  try {
    let spans: { text: string; fg: string }[] = []
    for (let attempt = 0; attempt < 200; attempt++) {
      await app.renderOnce()
      spans = app.captureSpans().lines.flatMap((line) =>
        line.spans.map((span) => ({
          text: span.text,
          fg: `${span.fg.r.toFixed(3)},${span.fg.g.toFixed(3)},${span.fg.b.toFixed(3)},${span.fg.a.toFixed(3)}`,
        })),
      )
      if (spans.some((span) => span.text.includes("继续刚才的任务"))) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const head = spans.findIndex((span) => span.text.includes("问我任何事"))
    const tail = spans.findIndex((span) => span.text.includes("继续刚才的任务"))
    expect(head).toBeGreaterThanOrEqual(0)
    expect(tail).toBe(head + 1)
    expect(spans[head]!.fg).not.toBe(spans[tail]!.fg)
  } finally {
    app.renderer.destroy()
  }
})
