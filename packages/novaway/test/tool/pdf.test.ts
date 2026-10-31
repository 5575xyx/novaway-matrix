import { describe, expect, test } from "bun:test"
import { defaultOutputName } from "../../src/tool/pdf"

describe("pdf_create", () => {
  // 输出名只从 source 推：写盘位置由调用方决定，这里保证不会把整个路径带进文件名。
  test("derives the output name from a local file", () => {
    expect(defaultOutputName("E:/AImoney/demo/report.html")).toBe("report")
    expect(defaultOutputName("/home/me/deck.HTM")).toBe("deck")
    expect(defaultOutputName("./notes.md")).toBe("notes")
  })

  test("derives the output name from a URL", () => {
    expect(defaultOutputName("https://example.com/docs/guide.html?x=1")).toBe("guide")
    expect(defaultOutputName("https://example.com/")).toBe("example.com")
  })
})
