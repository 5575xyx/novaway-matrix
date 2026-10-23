import { describe, expect, test } from "bun:test"
import { locateSnippet } from "./knowledge-locate"

describe("locateSnippet", () => {
  test("finds an exact match", () => {
    const result = locateSnippet("alpha beta gamma", "beta")
    expect(result).toEqual({ start: 6, end: 10, mode: "exact" })
  })

  test("strips ellipsis before matching", () => {
    const result = locateSnippet("release notes for v2", "…notes for…")
    expect(result?.mode).toBe("trimmed")
    expect(result?.start).toBe(8)
  })

  test("matches through normalized whitespace", () => {
    const result = locateSnippet("line one\n\nline   two", "line one line two")
    expect(result?.mode).toBe("normalized")
    expect(result?.start).toBe(0)
    expect(result?.end).toBeGreaterThan(10)
  })

  test("returns undefined when nothing matches", () => {
    expect(locateSnippet("alpha", "delta")).toBeUndefined()
    expect(locateSnippet("alpha", "")).toBeUndefined()
  })

  test("is case insensitive on the normalized path", () => {
    const result = locateSnippet("Alpha Beta", "alpha beta")
    expect(result?.mode).toBe("normalized")
    expect(result?.start).toBe(0)
  })
})

describe("offset-first locating", () => {
  const text = "前言部分。这里是一段很长的正文，用来测试偏移定位是否准确。后面还有更多内容。"

  test("uses the offset when the snippet sits there", () => {
    const at = text.indexOf("用来测试偏移定位")
    const result = locateSnippet(text, "用来测试偏移定位是否准确。", at)
    expect(result?.mode).toBe("offset")
    expect(result?.start).toBe(at)
  })

  test("tolerates a snippet offset inside the chunk window", () => {
    const chunkStart = text.indexOf("这里是一段")
    const result = locateSnippet(text, "用来测试偏移定位是否准确。", chunkStart)
    expect(result?.mode).toBe("offset")
  })

  test("falls back to full-text search when the offset is far off", () => {
    // 目标片段离 offset 超过 ±64 的窗口，说明 offset 已过期（索引是旧版本）。
    const far = "甲".repeat(400) + "目标片段在这里。"
    const result = locateSnippet(far, "目标片段在这里。", 0)
    expect(result?.mode).not.toBe("offset")
    expect(result?.start).toBe(far.indexOf("目标片段在这里。"))
  })

  test("ignores a negative offset", () => {
    const result = locateSnippet(text, "前言部分。", -5)
    expect(result?.mode).toBe("exact")
  })

  test("strips ellipsis before matching by offset", () => {
    const at = text.indexOf("用来测试偏移定位")
    const result = locateSnippet(text, "…用来测试偏移定位是否准确。…", at)
    expect(result?.mode).toBe("offset")
    expect(text.slice(result!.start, result!.end)).toBe("用来测试偏移定位是否准确。")
  })
})
