import { describe, expect, test } from "bun:test"
import { PDFArray, PDFDocument, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib"
import { createDocument } from "../../src/office/create"
import { docxEngine } from "../../src/office/engine/docx"
import { xlsxEngine } from "../../src/office/engine/xlsx"
import { pptxEngine } from "../../src/office/engine/pptx"
import { pdfEngine } from "../../src/office/pdf/engine"
import { markdownEngine } from "../../src/office/text/engine"
import { richEngine } from "../../src/office/rich/engine"

/** 把整份 PDF 的内容流拼起来（十六进制字符串按 UTF-16BE 还原成文字）。 */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const chunks: string[] = []
  for (const page of doc.getPages()) {
    const contents = page.node.Contents()
    const streams: Uint8Array[] = []
    const collect = (value: unknown) => {
      if (value instanceof PDFRef) {
        const looked = doc.context.lookup(value)
        if (looked instanceof PDFRawStream) streams.push(decodePDFRawStream(looked).decode())
      } else if (value instanceof PDFRawStream) streams.push(decodePDFRawStream(value).decode())
    }
    if (contents instanceof PDFArray) {
      for (let index = 0; index < contents.size(); index += 1) collect(contents.get(index))
    } else collect(contents)
    const raw = streams.map((item) => new TextDecoder("windows-1252").decode(item)).join("\n")
    const hexes = [...raw.matchAll(/<([0-9A-Fa-f]+)>/g)].flatMap((match) => {
      const clean =
        match[1]!.length % 4 === 0 ? match[1]! : match[1]!.padEnd(match[1]!.length + (4 - (match[1]!.length % 4)), "0")
      let wide = ""
      // UTF-16BE：每个字符 4 个十六进制位。
      for (let index = 0; index + 3 < clean.length; index += 4) {
        wide += String.fromCharCode(Number.parseInt(clean.slice(index, index + 4), 16))
      }
      let latin = ""
      for (let index = 0; index + 1 < clean.length; index += 2) {
        latin += String.fromCharCode(Number.parseInt(clean.slice(index, index + 2), 16))
      }
      return [latin, wide]
    })
    chunks.push(raw, ...hexes)
  }
  return chunks.join("\n")
}

async function openWith<T>(engine: { open: (bytes: Uint8Array) => Promise<any> }, bytes: Uint8Array): Promise<T> {
  const opened = await engine.open(bytes)
  if (!opened.ok) throw new Error(opened.error.message)
  return opened.data as T
}

describe("导出 PDF（引擎级排版）", () => {
  test("docx：标题、正文、页眉页脚都排进纸面", async () => {
    const { bytes } = createDocument("a.docx", { title: "季度汇报", body: "第一段\n第二段" })
    const state = await openWith<any>(docxEngine, bytes)
    const exported = await docxEngine.export!(state, "pdf", bytes)
    if (!exported.ok) throw new Error(exported.error.message)
    expect(new TextDecoder().decode(exported.data.slice(0, 5))).toBe("%PDF-")

    const doc = await PDFDocument.load(exported.data)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1)

    const text = await pdfText(exported.data)
    expect(text).toContain("季度汇报")
    expect(text).toContain("第一段")
    expect(text).toContain("第 1 / 1 页")
  })

  test("markdown：标题、列表、表格、代码块都能出纸", async () => {
    const markdown = [
      "# 项目周报",
      "",
      "## 进展",
      "",
      "- 完成接口联调",
      "- 补充单元测试",
      "",
      "| 项目 | 金额 |",
      "| --- | --- |",
      "| 合计 | 120 |",
      "",
      "```",
      "npm test",
      "```",
    ].join("\n")
    const state = await openWith<any>(markdownEngine, new TextEncoder().encode(markdown))
    const exported = await markdownEngine.export!(state, "pdf", new Uint8Array())
    if (!exported.ok) throw new Error(exported.error.message)
    const text = await pdfText(exported.data)
    expect(text).toContain("项目周报")
    expect(text).toContain("完成接口联调")
    expect(text).toContain("合计")
    expect(text).toContain("npm test")
  })

  test("xlsx：每张工作表一页，页码里带表名", async () => {
    const { bytes } = createDocument("b.xlsx", { title: "台账", body: "姓名\t金额\n小明\t120" })
    const state = await openWith<any>(xlsxEngine, bytes)
    const added = await xlsxEngine.apply(state, [{ op: "addSheet", name: "汇总" }], bytes)
    if (!added.ok) throw new Error(added.error.message)

    const exported = await xlsxEngine.export!(added.data.state, "pdf", added.data.bytes)
    if (!exported.ok) throw new Error(exported.error.message)
    const doc = await PDFDocument.load(exported.data)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2)
    const text = await pdfText(exported.data)
    expect(text).toContain("台账")
    expect(text).toContain("汇总")
  })

  test("pptx：一页一张幻灯片，页面尺寸沿用幻灯片尺寸", async () => {
    const { bytes } = createDocument("c.pptx", { title: "季度汇报", body: "要点一\n要点二" })
    const state = await openWith<any>(pptxEngine, bytes)
    const exported = await pptxEngine.export!(state, "pdf", bytes)
    if (!exported.ok) throw new Error(exported.error.message)
    const doc = await PDFDocument.load(exported.data)
    expect(doc.getPageCount()).toBe(state.slideCount)
    expect(doc.getPage(0).getWidth()).toBeCloseTo(state.size.w, 0)
    expect(doc.getPage(0).getHeight()).toBeCloseTo(state.size.h, 0)
    const text = await pdfText(exported.data)
    expect(text).toContain("要点一")
  })

  test("html（富文本）：标题、列表、引用段落有层级", async () => {
    const html = "<html><body><h1>标题</h1><p>正文</p><ul><li>条目</li></ul><blockquote>引用</blockquote></body></html>"
    const state = await openWith<any>(richEngine, new TextEncoder().encode(html))
    const exported = await richEngine.export!(state, "pdf", new Uint8Array())
    if (!exported.ok) throw new Error(exported.error.message)
    const text = await pdfText(exported.data)
    expect(text).toContain("标题")
    expect(text).toContain("条目")
    expect(text).toContain("引用")
  })

  test("Markdown 也能导出 docx / html（借用文档引擎）", async () => {
    const markdown = "# 标题\n\n正文一段"
    const state = await openWith<any>(markdownEngine, new TextEncoder().encode(markdown))
    const docx = await markdownEngine.export!(state, "docx", new Uint8Array())
    if (!docx.ok) throw new Error(docx.error.message)
    expect(docx.data[0]).toBe(0x50)
    expect(docx.data[1]).toBe(0x4b)
    const opened = await openWith<any>(docxEngine, docx.data)
    expect(opened.paragraphs.map((item: { text: string }) => item.text)).toContain("正文一段")

    const html = await markdownEngine.export!(state, "html", new Uint8Array())
    if (!html.ok) throw new Error(html.error.message)
    expect(new TextDecoder().decode(html.data)).toContain("<h1>标题</h1>")
  })

  test("PDF 另存为 PDF：字节原样复制", async () => {
    const doc = await PDFDocument.create()
    doc.addPage([400, 300])
    const bytes = new Uint8Array(await doc.save())
    const state = await openWith<any>(pdfEngine, bytes)
    const exported = await pdfEngine.export!(state, "pdf", bytes)
    if (!exported.ok) throw new Error(exported.error.message)
    expect(Buffer.compare(Buffer.from(exported.data), Buffer.from(bytes))).toBe(0)

    const other = await pdfEngine.export!(state, "docx", bytes)
    expect(other.ok).toBe(false)
  })
})
