import { describe, expect, test } from "bun:test"
import { createDocument } from "../../src/office/create"
import { docxEngine } from "../../src/office/engine/docx"
import { pptxEngine } from "../../src/office/engine/pptx"
import { xlsxEngine } from "../../src/office/engine/xlsx"

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe("新建文档", () => {
  test("docx：带标题和正文段落，能被自己的引擎读回来", async () => {
    const { bytes } = createDocument("report.docx", { title: "周报", body: "# 进展\n完成对齐" })
    const opened = await docxEngine.open(bytes)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const paragraphs = opened.data.paragraphs.map((paragraph) => paragraph.text)
    expect(paragraphs).toEqual(["周报", "进展", "完成对齐"])
    expect(opened.data.paragraphs[0]?.style).toBe("Title")
    expect(opened.data.paragraphs[1]?.style).toBe("Heading1")
    // 样式定义也要在包里，否则 Word 打开标题就是普通文字。
    expect(text(bytes)).toContain("Heading1")
  })

  test("docx：新建后可以直接编辑", async () => {
    const { bytes } = createDocument("report.docx", { title: "标题" })
    const opened = await docxEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const applied = await docxEngine.apply(
      opened.data,
      [{ op: "setParagraphText", paragraph: 1, text: "改过的标题" }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const reopened = await docxEngine.open(applied.data.bytes)
    if (!reopened.ok) throw new Error(reopened.error.message)
    expect(reopened.data.paragraphs[0]?.text).toBe("改过的标题")
  })

  test("xlsx：标题进 A1，正文按制表符 / 逗号分列", async () => {
    const { bytes } = createDocument("data.xlsx", { title: "台账", body: "姓名\t金额\n小明,120" })
    const opened = await xlsxEngine.open(bytes)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const cells = opened.data.sheets[0]!.cells.map((cell) => [cell.ref, cell.text])
    expect(cells).toEqual([
      ["A1", "台账"],
      ["A2", "姓名"],
      ["B2", "金额"],
      ["A3", "小明"],
      ["B3", "120"],
    ])
  })

  test("pptx：第一页带标题，能被自己的引擎读回来", async () => {
    const { bytes } = createDocument("deck.pptx", { title: "季度汇报", body: "- 收入\n- 成本" })
    const opened = await pptxEngine.open(bytes)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.data.slideCount).toBe(1)
    const paragraphs = opened.data.nodes.flatMap((node) => node.paragraphs)
    expect(paragraphs).toEqual(["季度汇报", "收入", "成本"])
  })

  test("markdown：带属性区和一级标题", () => {
    const { bytes } = createDocument("note.md", { title: "想法", body: "正文" })
    expect(text(bytes)).toBe("---\ntitle: 想法\n---\n\n# 想法\n\n正文")
  })

  test("html：有合法外壳", () => {
    const { bytes } = createDocument("page.html", { title: "页面", body: "内容" })
    const html = text(bytes)
    expect(html).toContain("<title>页面</title>")
    expect(html).toContain("<h1>页面</h1>")
    expect(html).toContain("<p>内容</p>")
  })

  test("还不支持写入的旧格式明确报错", () => {
    expect(() => createDocument("old.odt")).toThrow("暂时不能新建")
  })
})

describe("PDF 新建", () => {
  test("createDocumentAsync 生成真正的 PDF（不是改了后缀的文本）", async () => {
    const { createDocumentAsync } = await import("../../src/office/create")
    const { PDFDocument } = await import("pdf-lib")
    const created = await createDocumentAsync("report.pdf", { title: "Quarterly Report" })
    expect(new TextDecoder().decode(created.bytes.slice(0, 5))).toBe("%PDF-")
    const doc = await PDFDocument.load(created.bytes)
    expect(doc.getPageCount()).toBe(1)
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595)
  })

  test("中文标题走预定义 CID 字体，仍是合法 PDF", async () => {
    const { createDocumentAsync } = await import("../../src/office/create")
    const { PDFDict, PDFDocument, PDFName } = await import("pdf-lib")
    const created = await createDocumentAsync("周报.pdf", { title: "周报", body: "收入增长 12%" })
    const doc = await PDFDocument.load(created.bytes)
    expect(doc.getPageCount()).toBe(1)
    const resources = doc.getPage(0).node.Resources()
    expect(resources).toBeDefined()
    const fonts = doc.context.lookup(resources!.get(PDFName.of("Font")))
    expect(fonts).toBeInstanceOf(PDFDict)
    const dict = fonts as unknown as { keys: () => Array<{ toString(): string }> }
    const names = dict.keys().map((key) => key.toString())
    expect(names.join(" ")).toContain("STSong-Light")
  })
})
