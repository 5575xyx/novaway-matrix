import { describe, expect, test } from "bun:test"
import { buildZip } from "../../src/office/pptx-edit"
import { legacyEngine } from "../../src/office/legacy/engine"
import { detectLegacyExtension, readLegacyDocument } from "../../src/office/legacy/read"
import { engineFor, officeFormatOf } from "../../src/office/engine/registry"
import { docxEngine } from "../../src/office/engine/docx"
import { xlsxEngine } from "../../src/office/engine/xlsx"
import { pptxEngine } from "../../src/office/engine/pptx"
import type { OfficeResult } from "../../src/office/engine/contract"

const encoder = new TextEncoder()

function odf(mime: string, content: string) {
  return buildZip([
    { name: "mimetype", data: encoder.encode(mime) },
    { name: "content.xml", data: encoder.encode(content) },
  ])
}

const ODT = `<?xml version="1.0"?><office:document-content
 xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:text>
<text:h text:outline-level="1">标题</text:h>
<text:p>第一段 <text:span>粗体</text:span></text:p>
<text:p>第二段</text:p>
</office:text></office:body></office:document-content>`

const ODS = `<?xml version="1.0"?><office:document-content
 xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:spreadsheet>
<table:table table:name="数据">
<table:table-row><table:table-cell><text:p>项目</text:p></table:table-cell><table:table-cell><text:p>金额</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell><text:p>合计</text:p></table:table-cell><table:table-cell><text:p>120</text:p></table:table-cell></table:table-row>
</table:table>
</office:spreadsheet></office:body></office:document-content>`

const ODP = `<?xml version="1.0"?><office:document-content
 xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:presentation>
<draw:page draw:name="封面"><text:p>季度汇报</text:p><text:p>2026 Q3</text:p></draw:page>
<draw:page draw:name="数据"><text:p>收入增长</text:p></draw:page>
</office:presentation></office:body></office:document-content>`

describe("旧格式只读解析", () => {
  test("registry 把旧格式归到 legacy，而不是纯文本", () => {
    expect(officeFormatOf("a.odt")).toBe("legacy")
    expect(officeFormatOf("a.ods")).toBe("legacy")
    expect(officeFormatOf("a.rtf")).toBe("legacy")
    expect(officeFormatOf("a.doc")).toBe("legacy")
    expect(engineFor("legacy")).toBe(legacyEngine)
  })

  test("ODT：按段落读出文字", async () => {
    const doc = await readLegacyDocument(odf("application/vnd.oasis.opendocument.text", ODT), "odt")
    expect(doc.kind).toBe("document")
    expect(doc.text).toBe("标题\n第一段 粗体\n第二段")
  })

  test("ODS：读出工作表和单元格", async () => {
    const doc = await readLegacyDocument(odf("application/vnd.oasis.opendocument.spreadsheet", ODS), "ods")
    expect(doc.kind).toBe("spreadsheet")
    expect(doc.sheets[0]!.name).toBe("数据")
    expect(doc.sheets[0]!.rows).toEqual([
      ["项目", "金额"],
      ["合计", "120"],
    ])
  })

  test("ODP：逐页读出文字", async () => {
    const doc = await readLegacyDocument(odf("application/vnd.oasis.opendocument.presentation", ODP), "odp")
    expect(doc.kind).toBe("presentation")
    expect(doc.pageCount).toBe(2)
    expect(doc.text).toContain("季度汇报")
    expect(doc.text).toContain("收入增长")
  })

  test("RTF：去掉控制字，保留文字与换行", async () => {
    const rtf = encoder.encode("{\\rtf1\\ansi{\\fonttbl{\\f0 Helvetica;}}\\f0 Hello\\par Second line\\par}")
    const doc = await readLegacyDocument(rtf, "rtf")
    expect(doc.text).toBe("Hello\nSecond line")
  })

  test("RTF 按 ansicpg 声明解码中文，而不是一律 windows-1252", async () => {
    const head = encoder.encode("{\\rtf1\\ansi\\ansicpg936 ")
    // 「季度」的 GBK 字节
    const gbk = new Uint8Array([0xbc, 0xbe, 0xb6, 0xc8])
    const tail = encoder.encode("\\par}")
    const bytes = new Uint8Array([...head, ...gbk, ...tail])
    const doc = await readLegacyDocument(bytes, "rtf")
    expect(doc.text).toBe("季度")
  })

  test("按内容识别具体旧格式", async () => {
    expect(await detectLegacyExtension(odf("application/vnd.oasis.opendocument.spreadsheet", ODS))).toBe("ods")
    expect(await detectLegacyExtension(encoder.encode("{\\rtf1 ...}"))).toBe("rtf")
  })

  test("rtf / binary legacy text can export to docx without entering edit mode", async () => {
    const rtf = encoder.encode("{\\rtf1\\ansi Legacy RTF\\par second paragraph\\par}")
    const opened = await legacyEngine.open(rtf)
    if (!opened.ok) throw new Error(opened.error.message)
    const exported = await legacyEngine.export!(opened.data, "docx", rtf)
    expect(exported.ok).toBe(true)
    if (exported.ok) expect((await docxEngine.open(exported.data)).ok).toBe(true)
    const applied = await legacyEngine.apply(opened.data, [{ op: "setParagraphText", paragraph: 1, text: "nope" }], rtf)
    expect(applied.ok).toBe(false)
  })

  test("二进制 Office 给出另存为的提示", async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    const opened = await legacyEngine.open(ole)
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.error.suggestion).toContain("另存为")
  })

  test("odf 能导出成 md；不认识的 op 明确拒绝", async () => {
    const bytes = odf("application/vnd.oasis.opendocument.spreadsheet", ODS)
    const opened = await legacyEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const applied = await legacyEngine.apply(opened.data, [{ op: "setText", text: "x" }], bytes)
    expect(applied.ok).toBe(false)
    if (!applied.ok) expect(applied.error.suggestion).toContain("docx")
    const exported = await legacyEngine.export!(opened.data, "md", bytes)
    expect(exported.ok).toBe(true)
    if (exported.ok) expect(new TextDecoder().decode(exported.data)).toContain("| 项目 | 金额 |")
  })
})

async function reopen<S>(engine: { open: (input: Uint8Array) => Promise<OfficeResult<S>> }, bytes: Uint8Array) {
  const opened = await engine.open(bytes)
  if (!opened.ok) throw new Error(opened.error.message)
  return opened.data
}

describe("旧格式另存为新格式", () => {
  test("odt 另存为 docx：标题层级和段落都还在", async () => {
    const bytes = odf("application/vnd.oasis.opendocument.text", ODT)
    const opened = await legacyEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const exported = await legacyEngine.export!(opened.data, "docx", bytes)
    if (!exported.ok) throw new Error(exported.error.message)

    const doc = await reopen(docxEngine, exported.data)
    expect(doc.paragraphs.map((item) => item.text)).toEqual(["标题", "第一段 粗体", "第二段"])
  })

  test("ods 另存为 xlsx：工作表名与单元格内容保留", async () => {
    const bytes = odf("application/vnd.oasis.opendocument.spreadsheet", ODS)
    const opened = await legacyEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const exported = await legacyEngine.export!(opened.data, "xlsx", bytes)
    if (!exported.ok) throw new Error(exported.error.message)

    const book = await reopen(xlsxEngine, exported.data)
    expect(book.sheets[0]!.name).toBe("数据")
    expect(book.sheets[0]!.cells.find((cell) => cell.ref === "A1")!.text).toBe("项目")
    expect(book.sheets[0]!.cells.find((cell) => cell.ref === "B2")!.text).toBe("120")
  })

  test("odp 另存为 pptx：每页一张幻灯片，文字保留", async () => {
    const bytes = odf("application/vnd.oasis.opendocument.presentation", ODP)
    const opened = await legacyEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const exported = await legacyEngine.export!(opened.data, "pptx", bytes)
    if (!exported.ok) throw new Error(exported.error.message)

    const deck = await reopen(pptxEngine, exported.data)
    expect(deck.slideCount).toBe(2)
    const text = await pptxEngine.export!(deck, "txt", exported.data)
    if (!text.ok) throw new Error(text.error.message)
    expect(new TextDecoder().decode(text.data)).toContain("季度汇报")
  })

  test("html 导出保留了表格结构", async () => {
    const bytes = odf("application/vnd.oasis.opendocument.spreadsheet", ODS)
    const opened = await legacyEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const exported = await legacyEngine.export!(opened.data, "html", bytes)
    if (!exported.ok) throw new Error(exported.error.message)
    const html = new TextDecoder().decode(exported.data)
    expect(html).toContain("<td>项目</td>")
    expect(html).toContain("<h2>数据</h2>")
  })

  test("不认识的目标格式给出可用列表", async () => {
    const bytes = odf("application/vnd.oasis.opendocument.text", ODT)
    const opened = await legacyEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const exported = await legacyEngine.export!(opened.data, "pages", bytes)
    expect(exported.ok).toBe(false)
    if (!exported.ok) expect(exported.error.suggestion).toContain("docx")
  })
})

describe("ODF 就地编辑", () => {
  async function open(bytes: Uint8Array) {
    const opened = await legacyEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    return opened.data
  }

  test("odt：改段落文字，重新打开读到的是新内容", async () => {
    const bytes = odf("application/vnd.oasis.opendocument.text", ODT)
    const state = await open(bytes)
    const applied = await legacyEngine.apply(
      state,
      [{ op: "setParagraphText", paragraph: 2, text: "改过的段落" }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.changed).toEqual(["content.xml"])
    expect(applied.data.state.text).toBe(
      "标题" + String.fromCharCode(10) + "改过的段落" + String.fromCharCode(10) + "第二段",
    )
    // 包内其它条目原样：只重写了 content.xml。
    const { readZip } = await import("../../src/office/engine/zip")
    expect((await readZip(applied.data.bytes)).entries.map((entry) => entry.name).sort()).toEqual(
      (await readZip(bytes)).entries.map((entry) => entry.name).sort(),
    )
  })

  test("odt：插入 / 删除段落，下标以原文为准", async () => {
    const bytes = odf("application/vnd.oasis.opendocument.text", ODT)
    const state = await open(bytes)
    const applied = await legacyEngine.apply(
      state,
      [
        { op: "insertParagraph", after: 1, text: "新增" },
        { op: "deleteParagraph", paragraph: 3 },
      ],
      bytes,
    )
    if (!applied.ok) throw new Error(applied.error.message)
    expect(applied.data.state.text).toBe(
      "标题" + String.fromCharCode(10) + "新增" + String.fromCharCode(10) + "第一段 粗体",
    )
  })

  test("odt：加粗 + 居中对齐落到自动样式和 text:span 上", async () => {
    const bytes = odf("application/vnd.oasis.opendocument.text", ODT)
    const state = await open(bytes)
    const applied = await legacyEngine.apply(
      state,
      [{ op: "setParagraphStyle", paragraph: 2, style: { bold: true, align: "ctr" } }],
      bytes,
    )
    if (!applied.ok) throw new Error(applied.error.message)
    const { readZip, inflateEntry } = await import("../../src/office/engine/zip")
    const zip = await readZip(applied.data.bytes)
    const entry = zip.entries.find((item) => item.name === "content.xml")!
    const xml = new TextDecoder().decode(await inflateEntry(zip, entry))
    expect(xml).toContain("office:automatic-styles")
    expect(xml).toContain('fo:font-weight="bold"')
    expect(xml).toContain('fo:text-align="center"')
    expect(xml).toContain("<text:span text:style-name=")
  })

  test("ods：改单元格的值，数字带上 office:value", async () => {
    const bytes = odf("application/vnd.oasis.opendocument.spreadsheet", ODS)
    const state = await open(bytes)
    const applied = await legacyEngine.apply(
      state,
      [{ op: "setCellValue", sheet: "数据", ref: { row: 1, col: 1 }, value: 256 }],
      bytes,
    )
    if (!applied.ok) throw new Error(applied.error.message)
    expect(applied.data.state.sheets[0]!.rows[1]).toEqual(["合计", "256"])
    const { readZip, inflateEntry } = await import("../../src/office/engine/zip")
    const zip = await readZip(applied.data.bytes)
    const xml = new TextDecoder().decode(
      await inflateEntry(zip, zip.entries.find((item) => item.name === "content.xml")!),
    )
    expect(xml).toContain('office:value-type="float"')
    expect(xml).toContain('office:value="256"')
  })

  test("odp：改某一页的文字", async () => {
    const bytes = odf("application/vnd.oasis.opendocument.presentation", ODP)
    const state = await open(bytes)
    const applied = await legacyEngine.apply(state, [{ op: "setParagraphText", paragraph: 1, text: "年度汇报" }], bytes)
    if (!applied.ok) throw new Error(applied.error.message)
    expect(applied.data.state.text).toContain("年度汇报")
    expect(applied.data.state.pageCount).toBe(2)
  })

  test("越界整批失败，不返回新字节", async () => {
    const bytes = odf("application/vnd.oasis.opendocument.text", ODT)
    const state = await open(bytes)
    const applied = await legacyEngine.apply(
      state,
      [
        { op: "setParagraphText", paragraph: 1, text: "改" },
        { op: "setParagraphText", paragraph: 99, text: "越界" },
      ],
      bytes,
    )
    expect(applied.ok).toBe(false)
    if (!applied.ok) expect(applied.error.code).toBe("not_found")
  })

  test("rtf 仍然只读，但给出明确的去向", async () => {
    const rtf = new TextEncoder().encode(String.raw`{\rtf1\ansi Hello\par}`)
    const state = await open(rtf)
    const applied = await legacyEngine.apply(state, [{ op: "setParagraphText", paragraph: 1, text: "x" }], rtf)
    expect(applied.ok).toBe(false)
    if (!applied.ok) expect(applied.error.suggestion).toContain("docx")
  })
})
