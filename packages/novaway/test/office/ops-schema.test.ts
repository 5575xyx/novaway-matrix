import { describe, expect, test } from "bun:test"
import { toOfficeOp } from "../../src/office/ops-schema"

describe("文档操作 schema", () => {
  test("段落文字 / 富文本整段替换", () => {
    const paragraph = toOfficeOp({ op: "setParagraphText", paragraph: 3, text: "新" })
    expect(paragraph.ok).toBe(true)
    if (paragraph.ok) expect(paragraph.op).toEqual({ op: "setParagraphText", paragraph: 3, text: "新" })

    const span = toOfficeOp({ op: "setSpanText", paragraph: 1, text: "整篇" })
    expect(span.ok).toBe(true)
    if (span.ok) expect(span.op.op).toBe("setSpanText")
  })

  test("缺字段时给可读错误，而不是静默失败", () => {
    const result = toOfficeOp({ op: "setParagraphText", paragraph: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("text")
  })

  test("富文本块操作校验枚举", () => {
    expect(toOfficeOp({ op: "setBlockType", block: 1, tag: "h2" }).ok).toBe(true)
    expect(toOfficeOp({ op: "setBlockType", block: 1, tag: "video" }).ok).toBe(false)
    expect(toOfficeOp({ op: "setBlockAlign", block: 1, align: "center" }).ok).toBe(true)
    expect(toOfficeOp({ op: "setBlockAlign", block: 1, align: "middle" }).ok).toBe(false)
  })

  test("行内格式区间可省略", () => {
    const all = toOfficeOp({ op: "formatRange", block: 2, patch: { bold: true } })
    expect(all.ok).toBe(true)
    if (all.ok) expect(all.op).toEqual({ op: "formatRange", block: 2, patch: { bold: true } })

    const part = toOfficeOp({ op: "formatRange", block: 2, start: 1, end: 4, patch: { italic: true } })
    expect(part.ok).toBe(true)
    if (part.ok) expect(part.op).toEqual({ op: "formatRange", block: 2, start: 1, end: 4, patch: { italic: true } })
  })

  test("段落格式按 DOCX 契约透传", () => {
    const result = toOfficeOp({ op: "setParagraphStyle", paragraph: 2, style: { bold: true, size: 18, align: "ctr" } })
    expect(result.ok).toBe(true)
    if (result.ok && result.op.op === "setParagraphStyle") {
      expect(result.op.style).toEqual({ bold: true, size: 18, align: "ctr" })
    }
  })

  test("文本行命令与未知操作", () => {
    expect(toOfficeOp({ op: "sortLines", descending: true }).ok).toBe(true)
    expect(toOfficeOp({ op: "formatJson", indent: "  " }).ok).toBe(true)
    expect(toOfficeOp({ op: "replaceImage" }).ok).toBe(false)
  })
})

describe("设计视图保存", () => {
  test("setBlockHtml 走和行内格式化同一条校验", () => {
    const ok = toOfficeOp({ op: "setBlockHtml", block: 1, html: "<strong>改</strong>" })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.op).toEqual({ op: "setBlockHtml", block: 1, html: "<strong>改</strong>" })
    expect(toOfficeOp({ op: "setBlockHtml", block: 1 }).ok).toBe(false)
  })
})
