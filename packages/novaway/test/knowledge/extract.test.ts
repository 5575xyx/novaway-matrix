import { describe, expect, test } from "bun:test"
import JSZip from "jszip"
import { htmlToText, extractText, extensionOf, isSupportedFile } from "@/knowledge/extract"

describe("knowledge.extract", () => {
  test("extensions and support detection", () => {
    expect(extensionOf("a/b/c.PDF")).toBe("pdf")
    expect(isSupportedFile("notes.md")).toBe(true)
    expect(isSupportedFile("photo.png")).toBe(true)
    expect(isSupportedFile("archive.zip")).toBe(false)
  })

  test("html becomes readable text", () => {
    const text = htmlToText("<h1>Title</h1><p>Hello <b>world</b></p><script>x()</script>")
    expect(text).toContain("Title")
    expect(text).toContain("Hello world")
    expect(text).not.toContain("x()")
  })

  test("docx text is extracted from the zip", async () => {
    const zip = new JSZip()
    zip.file(
      "word/document.xml",
      "<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:p><w:r><w:t>World</w:t></w:r></w:p></w:body></w:document>",
    )
    const data = await zip.generateAsync({ type: "nodebuffer" })
    const result = await extractText({ name: "doc.docx", data })
    expect(result.text).toBe("Hello\nWorld")
  })

  test("pptx slides are concatenated in order", async () => {
    const zip = new JSZip()
    zip.file("ppt/slides/slide2.xml", "<a:p><a:t>Second</a:t></a:p>")
    zip.file("ppt/slides/slide1.xml", "<a:p><a:t>First</a:t></a:p>")
    const data = await zip.generateAsync({ type: "nodebuffer" })
    const result = await extractText({ name: "deck.pptx", data })
    expect(result.text.indexOf("First")).toBeLessThan(result.text.indexOf("Second"))
  })

  test("plain text passes through", async () => {
    const result = await extractText({ name: "a.txt", data: Buffer.from("plain text") })
    expect(result.text).toBe("plain text")
  })
})

describe("pdf unicode decoding", () => {
  test("parses bfchar and bfrange maps", async () => {
    const { parseToUnicodeCMaps, decodeWithCMap } = await import("@/knowledge/extract")
    const cmap = parseToUnicodeCMaps([
      "beginbfchar\n<0001> <4E2D>\n<0002> <6587>\nendbfchar",
      "beginbfrange\n<0010> <0012> <0041>\nendbfrange",
    ])
    expect(cmap.get(1)).toBe("中")
    expect(cmap.get(2)).toBe("文")
    expect(cmap.get(0x10)).toBe("A")
    expect(cmap.get(0x12)).toBe("C")
    const bytes = String.fromCharCode(0, 1, 0, 2)
    expect(decodeWithCMap(bytes, cmap)).toBe("中文")
  })

  test("falls back to raw bytes without a map", async () => {
    const { decodeWithCMap } = await import("@/knowledge/extract")
    expect(decodeWithCMap("plain", new Map())).toBe("plain")
  })
})

describe("binary guard", () => {
  test("detects zip/docx magic bytes", async () => {
    const { looksLikeBinaryText } = await import("@/knowledge/store")
    const docx = String.fromCharCode(0x50, 0x4b, 0x03, 0x04) + "word/document.xml"
    expect(looksLikeBinaryText(docx)).toBe(true)
  })

  test("detects pdf and png signatures", async () => {
    const { looksLikeBinaryText } = await import("@/knowledge/store")
    expect(looksLikeBinaryText("%PDF-1.7 ...")).toBe(true)
    expect(looksLikeBinaryText(String.fromCharCode(0x89) + "PNG ...")).toBe(true)
  })

  test("lets normal text through", async () => {
    const { looksLikeBinaryText } = await import("@/knowledge/store")
    expect(looksLikeBinaryText("# 标题\n这是一段正常的中文正文。")).toBe(false)
    expect(looksLikeBinaryText("const a = 1\n\nexport default a\n")).toBe(false)
  })

  test("rejects control-character soup", async () => {
    const { looksLikeBinaryText } = await import("@/knowledge/store")
    const soup = String.fromCharCode(...Array.from({ length: 200 }, () => 1))
    expect(looksLikeBinaryText(soup)).toBe(true)
  })
})

describe("docx tables", () => {
  test("converts table rows into a markdown table", async () => {
    const { docxTableToMarkdown } = await import("@/knowledge/extract")
    const table =
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>数量</w:t></w:r></w:p></w:tc></w:tr>" +
      "<w:tr><w:tc><w:p><w:r><w:t>苹果</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
    const markdown = docxTableToMarkdown(table)
    const lines = markdown.split("\n")
    expect(lines[0]).toBe("| 名称 | 数量 |")
    expect(lines[1]).toBe("| --- | --- |")
    expect(lines[2]).toBe("| 苹果 | 3 |")
  })

  test("escapes pipes inside cells", async () => {
    const { docxTableToMarkdown } = await import("@/knowledge/extract")
    const table = "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a|b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
    expect(docxTableToMarkdown(table)).toContain("a\|b")
  })

  test("keeps table structure inside a docx extraction", async () => {
    const JSZip = (await import("jszip")).default
    const { extractText } = await import("@/knowledge/extract")
    const zip = new JSZip()
    const table =
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>项目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>金额</w:t></w:r></w:p></w:tc></w:tr>" +
      "<w:tr><w:tc><w:p><w:r><w:t>服务器</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1200</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
    zip.file(
      "word/document.xml",
      "<w:document><w:body><w:p><w:r><w:t>预算表</w:t></w:r></w:p>" + table + "</w:body></w:document>",
    )
    const data = await zip.generateAsync({ type: "nodebuffer" })
    const result = await extractText({ name: "budget.docx", data: Buffer.from(data) })
    expect(result.text).toContain("预算表")
    expect(result.text).toContain("| 项目 | 金额 |")
    expect(result.text).toContain("| 服务器 | 1200 |")
  })
})
