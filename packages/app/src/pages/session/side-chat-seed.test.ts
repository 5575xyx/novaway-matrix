import { describe, expect, test } from "bun:test"
import { buildSelectionQuote, buildSelectionSeed, setSideChatSeed, takeSideChatSeed } from "./side-chat-seed"

describe("buildSelectionQuote", () => {
  test("labels a single line", () => {
    expect(buildSelectionQuote({ path: "src/a.ts", start: 3, end: 3, code: "const a = 1" })).toEqual({
      text: "const a = 1",
      label: "src/a.ts 第 3 行",
      path: "src/a.ts",
    })
  })

  test("labels a range and trims trailing blank lines", () => {
    const quote = buildSelectionQuote({ path: "a.ts", start: 1, end: 2, code: "a\nb\n\n\n" })
    expect(quote.label).toBe("a.ts 第 1-2 行")
    expect(quote.text).toBe("a\nb")
  })
})

describe("buildSelectionSeed", () => {
  test("keeps the legacy fenced draft shape", () => {
    expect(buildSelectionSeed({ path: "src/a.ts", start: 3, end: 7, code: "x" })).toBe(
      "src/a.ts 第 3-7 行：\n\n```\nx\n```\n\n",
    )
  })
})

describe("pending seed cache", () => {
  test("is one-shot", () => {
    setSideChatSeed("ses_1", { quote: { text: "hello" } })
    expect(takeSideChatSeed("ses_1")).toEqual({ quote: { text: "hello" } })
    // 第二次必须拿不到 —— 否则切回标签会重复填草稿。
    expect(takeSideChatSeed("ses_1")).toBeUndefined()
  })

  test("unknown ids are undefined", () => {
    expect(takeSideChatSeed("ses_missing")).toBeUndefined()
  })
})
