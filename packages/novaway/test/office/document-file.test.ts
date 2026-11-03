import { describe, expect, test } from "bun:test"
import { applyDocumentOpsAs, formatOfPath } from "../../src/office/document-file"

const encoder = new TextEncoder()

describe("文档写回", () => {
  test("格式按扩展名推断", () => {
    expect(formatOfPath("a.docx")).toBe("docx")
    expect(formatOfPath("a.html")).toBe("html")
    expect(formatOfPath("a.md")).toBe("markdown")
    expect(formatOfPath("a.ts")).toBe("text")
    expect(formatOfPath("a.xlsx")).toBeUndefined()
  })

  test("文本行命令整条链路：字节进、字节出", async () => {
    const bytes = encoder.encode("a\nb\n")
    const result = await applyDocumentOpsAs(bytes, "text", [{ op: "reverseLines" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.changed).toEqual(["text"])
    expect(new TextDecoder().decode(result.data.bytes)).toBe("b\na\n")
  })

  test("不支持的格式直接拒绝", async () => {
    const result = await applyDocumentOpsAs(encoder.encode("x"), undefined, [{ op: "setText", text: "y" }])
    expect(result.ok).toBe(false)
  })
})
