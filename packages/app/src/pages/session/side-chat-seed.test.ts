import { describe, expect, test } from "bun:test"
import { buildSelectionSeed, setSideChatSeed, takeSideChatSeed } from "./side-chat-seed"

describe("buildSelectionSeed", () => {
  test("labels a single line", () => {
    expect(buildSelectionSeed({ path: "src/a.ts", start: 3, end: 3, code: "const a = 1" })).toBe(
      "src/a.ts 第 3 行：\n\n```\nconst a = 1\n```\n\n",
    )
  })

  test("labels a range", () => {
    const out = buildSelectionSeed({ path: "src/a.ts", start: 3, end: 7, code: "x" })
    expect(out).toContain("第 3-7 行")
  })

  test("trims trailing blank lines inside the fence", () => {
    // 用户选区常常带末尾空行，留在 fence 里会让草稿看起来很脏。
    const out = buildSelectionSeed({ path: "a.ts", start: 1, end: 2, code: "a\nb\n\n\n" })
    expect(out).toBe("a.ts 第 1-2 行：\n\n```\na\nb\n```\n\n")
  })
})

describe("pending draft cache", () => {
  test("is one-shot", () => {
    setSideChatSeed("ses_1", "hello")
    expect(takeSideChatSeed("ses_1")).toBe("hello")
    // 第二次必须拿不到 —— 否则切回标签会重复填草稿。
    expect(takeSideChatSeed("ses_1")).toBeUndefined()
  })

  test("unknown ids are undefined", () => {
    expect(takeSideChatSeed("ses_missing")).toBeUndefined()
  })
})
