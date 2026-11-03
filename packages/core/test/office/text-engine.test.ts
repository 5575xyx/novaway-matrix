import { describe, expect, test } from "bun:test"
import { DocumentSession } from "../../src/office/engine/session"
import { engineFor, officeFormatOf } from "../../src/office/engine/registry"
import { markdownEngine, textEngine } from "../../src/office/text/engine"

const encoder = new TextEncoder()

describe("纯文本引擎", () => {
  test("注册表把 .txt / .md 交给文本引擎", () => {
    expect(officeFormatOf("notes.txt")).toBe("text")
    expect(officeFormatOf("README.md")).toBe("markdown")
    expect(engineFor("text")).toBe(textEngine)
    expect(engineFor("markdown")).toBe(markdownEngine)
    expect(markdownEngine.format).toBe("markdown")
  })

  test("setText 保留原文件的 CRLF 与 BOM", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("a\r\nb")])
    const opened = await textEngine.open(bytes)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.data.text).toBe("a\nb")
    expect(opened.data.format.eol).toBe("\r\n")
    expect(opened.data.format.bom).toBe(true)

    const applied = await textEngine.apply(opened.data, [{ op: "setText", text: "x\ny" }], bytes)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(Array.from(applied.data.bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(applied.data.bytes.slice(3))).toBe("x\r\ny")
  })

  test("行命令只改文字，不改编码", async () => {
    const bytes = encoder.encode("b\na\n")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return
    const applied = await textEngine.apply(opened.data, [{ op: "sortLines" }], bytes)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(new TextDecoder().decode(applied.data.bytes)).toBe("a\nb\n")
    expect(applied.data.state.text).toBe("a\nb\n")
  })

  test("倒序、去重、合并、注释都能通过 op 调用", async () => {
    const bytes = encoder.encode("b\na\nb\n")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return
    const applied = await textEngine.apply(
      opened.data,
      [
        { op: "uniqueLines" },
        { op: "reverseLines" },
        { op: "joinLines" },
        { op: "toggleComment", marker: "#" },
      ],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.state.text).toBe("# a b")
  })

  test("JSON 非法时失败且不返回新字节", async () => {
    const bytes = encoder.encode("{oops}")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return
    const applied = await textEngine.apply(opened.data, [{ op: "formatJson", indent: "  " }], bytes)
    expect(applied.ok).toBe(false)
    if (!applied.ok) expect(applied.error.code).toBe("invalid_params")
  })

  test("没有实际改动时 changed 为空", async () => {
    const bytes = encoder.encode("a\nb\n")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return
    const applied = await textEngine.apply(opened.data, [{ op: "sortLines" }], bytes)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.changed).toEqual([])
    expect(applied.data.bytes).toBe(bytes)
  })

  test("setSpanText 只接受整篇（第 1 段）", async () => {
    const bytes = encoder.encode("a")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return
    const bad = await textEngine.apply(opened.data, [{ op: "setSpanText", paragraph: 2, text: "b" }], bytes)
    expect(bad.ok).toBe(false)
    const good = await textEngine.apply(opened.data, [{ op: "setSpanText", paragraph: 1, text: "b" }], bytes)
    expect(good.ok).toBe(true)
    if (!good.ok) return
    expect(good.data.state.text).toBe("b")
  })

  test("会话保存版本语义：保存期间的新修改不会被标干净", async () => {
    const bytes = encoder.encode("a")
    const session = await DocumentSession.open(textEngine, bytes)
    if (!session.ok) return
    const revision = session.data.saveRevision()
    await session.data.apply([{ op: "setText", text: "b" }], "改文字")
    expect(session.data.markSaved(revision)).toBe(false)
    expect(session.data.dirty).toBe(true)
    expect(session.data.markSaved(session.data.saveRevision())).toBe(true)
    expect(session.data.dirty).toBe(false)
  })
})

describe("文本引擎的二进制兜底", () => {
  test("PNG 字节不会被当成文本打开", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
    const opened = await textEngine.open(png)
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.error.code).toBe("open_failed")
  })

  test("正常的 UTF-8 中文不会被误判", async () => {
    const opened = await textEngine.open(encoder.encode("中文\nutf-8"))
    expect(opened.ok).toBe(true)
  })
})
