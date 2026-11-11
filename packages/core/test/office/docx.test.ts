import { describe, expect, test } from "bun:test"
import {
  docxEngine,
  editDocxXml,
  readDocxNumbering,
  readDocxParagraphs,
  readPageSetup,
} from "../../src/office/engine/docx"
import { DocumentSession } from "../../src/office/engine/session"
import { defaultExtension, kindOfPath, officeFormatOf } from "../../src/office/engine/registry"

const encoder = new TextEncoder()

function u16(value: number) {
  const data = new Uint8Array(2)
  new DataView(data.buffer).setUint16(0, value, true)
  return data
}

function u32(value: number) {
  const data = new Uint8Array(4)
  new DataView(data.buffer).setUint32(0, value >>> 0, true)
  return data
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

let table: Uint32Array | undefined
function crc32(bytes: Uint8Array) {
  if (!table) {
    table = new Uint32Array(256)
    for (let index = 0; index < 256; index++) {
      let value = index
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      table[index] = value >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function buildZip(entries: Array<{ name: string; data: Uint8Array }>) {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      entry.data,
    ])
    locals.push(local)
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(entry.data.length),
        u32(entry.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    )
    offset += local.length
  }
  const central = concat(centrals)
  return concat([
    ...locals,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
}

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="56"/><w:color w:val="1F2937"/></w:rPr><w:t>测试文档</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>第一段</w:t></w:r><w:r><w:rPr><w:i/><w:sz w:val="24"/></w:rPr><w:t>混排文字</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表头A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>表头B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>末尾</w:t></w:r></w:p>
<sectPr><w:pgSz w:w="11906" w:h="16838"/></sectPr>
</w:body></w:document>`

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"/></w:styles>`

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`

function fixture() {
  return buildZip([
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "word/document.xml", data: encoder.encode(DOCUMENT) },
    { name: "word/styles.xml", data: encoder.encode(STYLES) },
  ])
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array) {
  outer: for (let index = 0; index + needle.length <= haystack.length; index++) {
    for (let jndex = 0; jndex < needle.length; jndex++) {
      if (haystack[index + jndex] !== needle[jndex]) continue outer
    }
    return index
  }
  return -1
}

describe("docx 读取", () => {
  test("按文档顺序列出段落，表格里的段落也包含", () => {
    const paragraphs = readDocxParagraphs(DOCUMENT)
    expect(paragraphs.map((item) => item.text)).toEqual(["测试文档", "第一段混排文字", "表头A", "表头B", "末尾"])
    expect(paragraphs[2]!.inTable).toBe(true)
    expect(paragraphs[2]!.cell).toEqual({ table: 1, row: 1, col: 1 })
    expect(paragraphs[3]!.cell).toEqual({ table: 1, row: 1, col: 2 })
    expect(paragraphs[0]!.style).toBe("Title")
    expect(paragraphs[0]!.align).toBe("center")
    expect(paragraphs[0]!.bold).toBe(true)
    expect(paragraphs[0]!.size).toBe(28)
    expect(paragraphs[0]!.color).toBe("1F2937")
  })

  test("混排段落取第一个 run 的格式作为段落代表", () => {
    const paragraphs = readDocxParagraphs(DOCUMENT)
    expect(paragraphs[1]!.italic).toBeUndefined()
    expect(paragraphs[1]!.size).toBe(12)
  })
})

/** 写回失败在测试里是断言失败，不该被静默吞掉。 */
type EditResult = { xml: string; applied: Array<{ paragraph: number; previous?: string; text?: string }> }

function edit(xml: string, edits: Parameters<typeof editDocxXml>[1]): EditResult {
  const result = editDocxXml(xml, edits)
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

describe("docx 写入", () => {
  test("改段落文字：保留其他 run 的结构，只把文字放进第一个 w:t", () => {
    const result = edit(DOCUMENT, { textEdits: [{ paragraph: 2, text: "新的一段" }] })
    expect(result.applied).toEqual([{ paragraph: 2, previous: "第一段混排文字", text: "新的一段" }])
    expect(result.xml).toContain("<w:t>新的一段</w:t>")
    expect(result.xml).toContain("<w:i/>")
    expect(result.xml).toContain('<w:r><w:rPr><w:i/><w:sz w:val="24"/></w:rPr><w:t></w:t></w:r>')
  })

  test("改格式：b/i/sz/color 落到每个 run 的 rPr 上", () => {
    const result = edit(DOCUMENT, {
      styleEdits: [{ paragraph: 2, style: { bold: true, color: "C00000", size: 16 } }],
    })
    expect(result.xml).toContain("<w:b/>")
    expect(result.xml).toContain('<w:color w:val="C00000"/>')
    expect(result.xml).toContain('<w:sz w:val="32"/>')
    expect(result.xml).toContain("<w:i/>")
  })

  test("取消加粗：删掉 w:b，而不是留一个 false", () => {
    const result = edit(DOCUMENT, { styleEdits: [{ paragraph: 1, style: { bold: false } }] })
    expect(result.xml).not.toContain("<w:b/>")
  })

  test("改对齐：替换 w:jc，不产生两个", () => {
    const result = edit(DOCUMENT, { styleEdits: [{ paragraph: 1, style: { align: "right" } }] })
    const matches = result.xml.match(/<w:jc [^>]*>/g) ?? []
    expect(matches).toEqual(['<w:jc w:val="right"/>'])
  })

  test("删除线 / 高亮 / 行距 / 首行缩进落到 rPr 与 pPr", () => {
    const result = edit(DOCUMENT, {
      styleEdits: [
        {
          paragraph: 2,
          style: { strike: true, highlight: "FFF2A8", lineSpacing: 1.5, firstLineIndent: 24, indent: 36 },
        },
      ],
    })
    expect(result.xml).toContain("<w:strike/>")
    expect(result.xml).toContain('<w:shd w:val="clear" w:color="auto" w:fill="FFF2A8"/>')
    expect(result.xml).toContain('<w:spacing w:line="360" w:lineRule="auto"/>')
    expect(result.xml).toContain('<w:ind w:left="720" w:firstLine="480"/>')
  })

  test("高亮传空串就是去掉底纹", () => {
    const withHighlight = edit(DOCUMENT, { styleEdits: [{ paragraph: 2, style: { highlight: "FFFF00" } }] })
    expect(withHighlight.xml).toContain('w:fill="FFFF00"')
    const cleared = edit(withHighlight.xml, { styleEdits: [{ paragraph: 2, style: { highlight: "" } }] })
    expect(cleared.xml).not.toContain("w:fill=")
  })

  test("清除格式：字符样式和段落缩进一起消失", () => {
    const styled = edit(DOCUMENT, {
      styleEdits: [
        {
          paragraph: 2,
          style: { bold: true, italic: true, underline: true, size: 20, color: "C00000", align: "center" },
        },
      ],
    })
    const cleared = edit(styled.xml, { styleEdits: [{ paragraph: 2, style: { clear: true } }] })
    // 第一段的 Title 样式自带加粗和居中，只检查第二段被清干净。
    expect(cleared.xml.match(/<w:b\/>/g)?.length).toBe(1)
    expect(cleared.xml).not.toContain('<w:sz w:val="40"/>')
    expect(cleared.xml).not.toContain('<w:color w:val="C00000"/>')
    expect(cleared.xml.match(/<w:jc /g)?.length).toBe(1)
  })

  test("写入后重新打开能读回新增的格式", async () => {
    const opened = await docxEngine.open(fixture())
    if (!opened.ok) throw new Error("open failed")
    const applied = await docxEngine.apply(
      opened.data,
      [
        {
          op: "setParagraphStyle",
          paragraph: 2,
          style: { strike: true, highlight: "FFF2A8", lineSpacing: 1.5, firstLineIndent: 24, indent: 36 },
        },
      ],
      fixture(),
    )
    if (!applied.ok) throw new Error("apply failed")
    const reopened = await docxEngine.open(applied.data.bytes)
    if (!reopened.ok) throw new Error("reopen failed")
    const paragraph = reopened.data.paragraphs[1]!
    expect(paragraph.strike).toBe(true)
    expect(paragraph.highlight).toBe("FFF2A8")
    expect(paragraph.lineSpacing).toBe(1.5)
    expect(paragraph.firstLineIndent).toBe(24)
    expect(paragraph.indent).toBe(36)
  })

  test("同一段既有文字又有格式：只替换一次", () => {
    const result = edit(DOCUMENT, {
      textEdits: [{ paragraph: 2, text: "合并" }],
      styleEdits: [{ paragraph: 2, style: { italic: true } }],
    })
    expect(result.applied).toHaveLength(1)
    expect(result.xml).toContain("<w:t>合并</w:t>")
  })

  test("段落越界时不改任何内容", () => {
    const result = edit(DOCUMENT, { textEdits: [{ paragraph: 99, text: "x" }] })
    expect(result.applied).toHaveLength(0)
    expect(result.xml).toBe(DOCUMENT)
  })
})

describe("docxEngine：整份文件", () => {
  test("只重写 document.xml，样式表字节原样", async () => {
    const bytes = fixture()
    const opened = await docxEngine.open(bytes)
    if (!opened.ok) throw new Error("open failed")

    const applied = await docxEngine.apply(
      opened.data,
      [{ op: "setParagraphText", paragraph: 5, text: "结尾改写" }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.changed).toEqual(["word/document.xml"])
    expect(containsBytes(applied.data.bytes, encoder.encode(STYLES))).toBeGreaterThanOrEqual(0)
  })

  test("写回后重新打开，段落文字与格式都是新的", async () => {
    const bytes = fixture()
    const opened = await docxEngine.open(bytes)
    if (!opened.ok) throw new Error("open failed")

    const applied = await docxEngine.apply(
      opened.data,
      [
        { op: "setParagraphText", paragraph: 1, text: "新标题" },
        { op: "setParagraphStyle", paragraph: 1, style: { bold: true, align: "r", size: 20 } },
      ],
      bytes,
    )
    if (!applied.ok) throw new Error("apply failed")

    const reopened = await docxEngine.open(applied.data.bytes)
    if (!reopened.ok) throw new Error("reopen failed")
    const first = reopened.data.paragraphs[0]!
    expect(first.text).toBe("新标题")
    expect(first.align).toBe("right")
    expect(first.size).toBe(20)
  })

  test("unsupported 操作被拒绝，不会偷偷写成半截", async () => {
    const opened = await docxEngine.open(fixture())
    if (!opened.ok) throw new Error("open failed")
    const result = await docxEngine.apply(
      opened.data,
      [{ op: "setCellValue", sheet: "Sheet1", ref: { row: 0, col: 0 }, value: 1 }],
      fixture(),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("unsupported_format")
  })
})

describe("DocumentSession 包裹 docx", () => {
  test("撤销回到原始字节", async () => {
    const bytes = fixture()
    const session = await DocumentSession.open(docxEngine, bytes)
    if (!session.ok) throw new Error("open failed")
    const doc = session.data

    await doc.apply([{ op: "setParagraphText", paragraph: 1, text: "改过" }])
    expect(doc.dirty).toBe(true)
    expect(doc.undo().ok).toBe(true)
    expect(doc.dirty).toBe(false)
    expect(doc.bytes).toBe(bytes)
  })
})

describe("类型识别", () => {
  test("扩展名决定编辑器", () => {
    expect(kindOfPath("a/b/report.DOCX")).toBe("document")
    expect(kindOfPath("notes.md")).toBe("markdown")
    expect(kindOfPath("page.htm")).toBe("richtext")
    expect(kindOfPath("main.ts")).toBe("plaintext")
    expect(kindOfPath("book.xlsx")).toBe("spreadsheet")
    expect(defaultExtension("richtext")).toBe("html")
  })

  test("docx/pptx/xlsx 与文本类文件都有可编辑引擎", () => {
    expect(officeFormatOf("a.docx")).toBe("docx")
    expect(officeFormatOf("a.pptx")).toBe("pptx")
    expect(officeFormatOf("a.xlsx")).toBe("xlsx")
    expect(officeFormatOf("a.html")).toBe("html")
    expect(officeFormatOf("a.txt")).toBe("text")
  })
})

describe("段落插入与删除", () => {
  test("在第 N 段之后插入，继承它的段落属性", () => {
    const result = edit(DOCUMENT, { insertEdits: [{ after: 1, text: "新增段" }] })
    const paragraphs = readDocxParagraphs(result.xml)
    expect(paragraphs.map((paragraph) => paragraph.text)).toEqual([
      "测试文档",
      "新增段",
      "第一段混排文字",
      "表头A",
      "表头B",
      "末尾",
    ])
    // 第 1 段是 Title，新段落要继承它，否则插进标题区会变成正文。
    expect(paragraphs[1]!.style).toBe("Title")
    expect(paragraphs[1]!.align).toBe("center")
  })

  test("after=0 插到文档开头", () => {
    const result = edit(DOCUMENT, { insertEdits: [{ after: 0, text: "开头" }] })
    expect(readDocxParagraphs(result.xml)[0]!.text).toBe("开头")
  })

  test("插入时可以顺带指定格式", () => {
    const result = edit(DOCUMENT, { insertEdits: [{ after: 2, text: "加粗的", style: { bold: true } }] })
    const paragraphs = readDocxParagraphs(result.xml)
    expect(paragraphs[2]!.bold).toBe(true)
  })

  test("删除段落只去掉目标那一段", () => {
    const result = edit(DOCUMENT, { deleteEdits: [2] })
    expect(readDocxParagraphs(result.xml).map((paragraph) => paragraph.text)).toEqual([
      "测试文档",
      "表头A",
      "表头B",
      "末尾",
    ])
  })

  test("表格单元格里的段落可以改字和改格式", () => {
    const text = edit(DOCUMENT, { textEdits: [{ paragraph: 3, text: "新表头" }] })
    expect(readDocxParagraphs(text.xml).map((paragraph) => paragraph.text)).toEqual([
      "测试文档",
      "第一段混排文字",
      "新表头",
      "表头B",
      "末尾",
    ])

    const styled = edit(DOCUMENT, { styleEdits: [{ paragraph: 4, style: { bold: true, color: "FF0000" } }] })
    const cells = readDocxParagraphs(styled.xml)
    expect(cells[3]!.bold).toBe(true)
    expect(cells[3]!.color).toBe("FF0000")
  })

  test("表格里的段落不能删；最后一段也不能删", () => {
    const inTable = editDocxXml(DOCUMENT, { deleteEdits: [3] })
    expect(inTable.ok).toBe(false)
    if (!inTable.ok) expect(inTable.error.code).toBe("unsupported_format")

    const single = editDocxXml("<w:document><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>", {
      deleteEdits: [1],
    })
    expect(single.ok).toBe(false)
  })

  test("同一批里改字 + 删除：下标都以原文为准", () => {
    const result = edit(DOCUMENT, {
      textEdits: [{ paragraph: 5, text: "改过的末尾" }],
      deleteEdits: [2],
    })
    expect(readDocxParagraphs(result.xml).map((paragraph) => paragraph.text)).toEqual([
      "测试文档",
      "表头A",
      "表头B",
      "改过的末尾",
    ])
  })

  test("插入越界时报错，不悄悄追加", () => {
    const result = editDocxXml(DOCUMENT, { insertEdits: [{ after: 99, text: "x" }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("not_found")
  })
})

describe("docx 导出", () => {
  test("md 保留标题层级，表格段落导成列表项", async () => {
    const opened = await docxEngine.open(fixture())
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const md = await docxEngine.export!(opened.data, "md", fixture())
    expect(md.ok).toBe(true)
    if (!md.ok) return
    const text = new TextDecoder().decode(md.data)
    expect(text.startsWith("# 测试文档")).toBe(true)
    expect(text).toContain("- 表头A")
    expect(text).toContain("- 表头B")
  })

  test("txt 一段一行，空段落丢掉", async () => {
    const opened = await docxEngine.open(fixture())
    if (!opened.ok) return
    const txt = await docxEngine.export!(opened.data, "txt", fixture())
    expect(txt.ok).toBe(true)
    if (!txt.ok) return
    expect(new TextDecoder().decode(txt.data).split(String.fromCharCode(10))).toEqual([
      "测试文档",
      "第一段混排文字",
      "表头A",
      "表头B",
      "末尾",
    ])
  })

  test("整篇查找替换：命中处全换，其它段落不动", async () => {
    const { createDocument } = await import("../../src/office/create")
    const { bytes } = await createDocument("r.docx", { title: "报告", body: "营收 25%，目标 25%" })
    const opened = await docxEngine.open(bytes)
    if (!opened.ok) return
    const applied = await docxEngine.apply(
      opened.data,
      [{ op: "replaceDocumentText", find: "25%", replace: "27%" }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const reopened = await docxEngine.open(applied.data.bytes)
    if (!reopened.ok) return
    expect(reopened.data.paragraphs.map((item) => item.text)).toEqual(["报告", "营收 27%，目标 27%"])

    const missing = await docxEngine.apply(opened.data, [{ op: "replaceDocumentText", find: "", replace: "x" }], bytes)
    expect(missing.ok).toBe(false)
  })

  test("不支持的目标格式明确报错", async () => {
    const opened = await docxEngine.open(fixture())
    if (!opened.ok) return
    // pdf 现在由共享排版器支持，用 xlsx 这种确实写不出来的目标验证报错。
    const result = await docxEngine.export!(opened.data, "xlsx", fixture())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.suggestion).toContain("md")
  })
})

describe("docx 结构写入（表格 / 分页 / 图片 / 页面设置）", () => {
  const encoder2 = new TextEncoder()
  const decoder2 = new TextDecoder()
  process.env.TZ ??= "UTC"

  async function freshDocx() {
    const { createDocument } = await import("../../src/office/create")
    return createDocument("report.docx", { title: "标题", body: "第一段\n第二段" }).bytes
  }

  async function apply(bytes: Uint8Array, ops: Parameters<typeof docxEngine.apply>[1]) {
    const opened = await docxEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const result = await docxEngine.apply(opened.data, ops, bytes)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }

  async function documentXml(bytes: Uint8Array) {
    const { readZip, inflateEntry } = await import("../../src/office/engine/zip")
    const zip = await readZip(bytes)
    const entry = zip.entries.find((item) => item.name === "word/document.xml")!
    return decoder2.decode(await inflateEntry(zip, entry))
  }

  test("列表：写 numPr 并自动补 numbering.xml / 关系 / Content_Types", async () => {
    const result = await apply(await freshDocx(), [
      { op: "setParagraphStyle", paragraph: 2, style: { list: "bullet" } },
      { op: "setParagraphStyle", paragraph: 3, style: { list: "number", listLevel: 1 } },
    ])
    const xml = await documentXml(result.bytes)
    expect(xml).toContain('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="9001"/></w:numPr>')
    expect(xml).toContain('<w:numPr><w:ilvl w:val="1"/><w:numId w:val="9002"/></w:numPr>')
    expect(result.state.paragraphs[1]!.list).toEqual({ kind: "bullet", level: 0 })
    expect(result.state.paragraphs[2]!.list).toEqual({ kind: "number", level: 1 })

    const { readZip, inflateEntry } = await import("../../src/office/engine/zip")
    const zip = await readZip(result.bytes)
    const numberingEntry = zip.entries.find((item) => item.name === "word/numbering.xml")!
    expect(numberingEntry).toBeDefined()
    const numbering = decoder2.decode(await inflateEntry(zip, numberingEntry))
    expect(numbering).toContain('w:numFmt w:val="bullet"')
    expect(numbering).toContain('w:numFmt w:val="decimal"')

    const relsEntry = zip.entries.find((item) => item.name === "word/_rels/document.xml.rels")!
    expect(decoder2.decode(await inflateEntry(zip, relsEntry))).toContain("relationships/numbering")
    const contentEntry = zip.entries.find((item) => item.name === "[Content_Types].xml")!
    expect(decoder2.decode(await inflateEntry(zip, contentEntry))).toContain("/word/numbering.xml")
  })

  test("列表：none 移除 numPr；重复写入不重复添加定义", async () => {
    const first = await apply(await freshDocx(), [{ op: "setParagraphStyle", paragraph: 2, style: { list: "number" } }])
    const second = await apply(first.bytes, [{ op: "setParagraphStyle", paragraph: 2, style: { list: "none" } }])
    expect(await documentXml(second.bytes)).not.toContain("<w:numPr>")
    expect(second.state.paragraphs[1]!.list).toBeUndefined()

    const third = await apply(second.bytes, [{ op: "setParagraphStyle", paragraph: 3, style: { list: "number" } }])
    const { readZip, inflateEntry } = await import("../../src/office/engine/zip")
    const zip = await readZip(third.bytes)
    const numbering = decoder2.decode(
      await inflateEntry(zip, zip.entries.find((item) => item.name === "word/numbering.xml")!),
    )
    expect(numbering.match(/<w:num w:numId="9001"/g)?.length ?? 0).toBe(1)
    expect(numbering.match(/<w:num w:numId="9002"/g)?.length ?? 0).toBe(1)
  })

  test("列表：insertParagraph 可以直接带 list 样式", async () => {
    const result = await apply(await freshDocx(), [
      { op: "insertParagraph", after: 3, text: "要点", style: { list: "bullet", listLevel: 0 } },
    ])
    expect(await documentXml(result.bytes)).toContain("要点")
    expect(result.state.paragraphs[3]!.list).toEqual({ kind: "bullet", level: 0 })
  })

  test("图片：WMF / EMF 原样嵌入，媒体、关系与 Content_Types 都登记", async () => {
    const wmf = new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 0x00, 0x00, 0x00, 0x00])
    const result = await apply(await freshDocx(), [
      { op: "addImage", after: 2, dataBase64: Buffer.from(wmf).toString("base64"), mime: "image/x-wmf" },
    ])
    const { readZip, inflateEntry } = await import("../../src/office/engine/zip")
    const zip = await readZip(result.bytes)
    expect(zip.entries.some((entry) => entry.name.endsWith(".wmf"))).toBe(true)
    const contentTypes = decoder2.decode(
      await inflateEntry(zip, zip.entries.find((entry) => entry.name === "[Content_Types].xml")!),
    )
    expect(contentTypes).toContain('Extension="wmf"')
    expect(contentTypes).toContain("image/x-wmf")
  })

  test("图片跟着正文排版成 PDF：PNG 导出才能看到文档里的图", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    const withImage = await apply(await freshDocx(), [
      { op: "addImage", after: 1, dataBase64: png, mime: "image/png", width: 120, height: 80 },
    ])
    const opened = await docxEngine.open(withImage.bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const pdf = await docxEngine.export!(opened.data, "pdf", withImage.bytes)
    if (!pdf.ok) throw new Error(pdf.error.message)

    const { PDFDocument, PDFName, PDFRawStream } = await import("pdf-lib")
    const doc = await PDFDocument.load(pdf.data)
    // 透明 PNG 会额外生成一个 SMask，也算 Image 流；只数正文真正画的那张。
    const images = doc.context
      .enumerateIndirectObjects()
      .filter(
        ([, object]) =>
          object instanceof PDFRawStream &&
          object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") &&
          object.dict.get(PDFName.of("SMask")) === undefined,
      )
    expect(images.length).toBe(1)
  })

  test("addTable 按给定行数插入，表头加粗", async () => {
    const result = await apply(await freshDocx(), [
      {
        op: "addTable",
        after: 3,
        rows: [
          ["项目", "金额"],
          ["合计", "120"],
        ],
      },
    ])
    const xml = await documentXml(result.bytes)
    expect(xml.match(/<w:tbl>/g)?.length).toBe(1)
    expect(xml.match(/<w:tr>/g)?.length).toBe(2)
    expect(xml).toContain("项目")
    expect(xml).toContain("合计")
    // 表头单元格的 run 属性里有加粗
    expect(
      /<w:tr><w:tc><w:tcPr>[^<]*<w:tcW[^>]*\/><\/w:tcPr><w:p><w:r><w:rPr><w:b\/><\/w:rPr><w:t[^>]*>项目/.test(xml),
    ).toBe(true)
    // 表格后面补了空段（Word 要求正文不能以表格结尾）
    expect(xml).toContain("</w:tbl><w:p/>")
  })

  test("addPageBreak 插入分页符", async () => {
    const result = await apply(await freshDocx(), [{ op: "addPageBreak", after: 2 }])
    expect(await documentXml(result.bytes)).toContain('<w:br w:type="page"/>')
  })

  test("setPageSetup：横向 + 页边距（mm → twips）", async () => {
    const result = await apply(await freshDocx(), [
      { op: "setPageSetup", orientation: "landscape", size: "A4", margins: { top: 20, left: 25 } },
    ])
    const xml = await documentXml(result.bytes)
    expect(xml).toContain('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>')
    // 20mm ≈ 1134 twips，25mm ≈ 1417 twips
    expect(xml).toMatch(/<w:pgMar w:top="1134"[^>]*w:left="1417"/)
  })

  test("readPageSetup：把 setPageSetup 写进去的值读回成 mm（面板要用真实值预填）", async () => {
    const result = await apply(await freshDocx(), [
      { op: "setPageSetup", orientation: "landscape", size: "A4", margins: { top: 20, left: 25 } },
    ])
    expect(readPageSetup(await documentXml(result.bytes))).toEqual({
      size: "A4",
      orientation: "landscape",
      margins: { top: 20, right: 25.4, bottom: 25.4, left: 25 },
    })
  })

  test("readPageSetup：没有 sectPr / pgSz 时返回 undefined，让 UI 显示「未设置」", () => {
    expect(readPageSetup("<w:document><w:body/></w:document>")).toBeUndefined()
    expect(readPageSetup('<w:sectPr><w:pgMar w:top="1440"/></w:sectPr>')).toBeUndefined()
  })

  test("addImage 增加媒体条目和关系，正文里出现 drawing", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    const result = await apply(await freshDocx(), [
      { op: "addImage", after: 1, dataBase64: png, mime: "image/png", width: 120, height: 80 },
    ])
    expect(result.changed).toContain("word/document.xml")
    expect(result.changed).toContain("word/_rels/document.xml.rels")

    const { readZip, inflateEntry } = await import("../../src/office/engine/zip")
    const zip = await readZip(result.bytes)
    const media = zip.entries.filter((entry) => entry.name.startsWith("word/media/"))
    expect(media.length).toBe(1)
    const relsEntry = zip.entries.find((entry) => entry.name === "word/_rels/document.xml.rels")!
    expect(decoder2.decode(await inflateEntry(zip, relsEntry))).toContain("relationships/image")

    const xml = await documentXml(result.bytes)
    expect(xml).toContain("<w:drawing>")
    expect(xml).toContain("xmlns:wp=")
    // 120pt × 12700 EMU
    expect(xml).toContain('cx="1524000"')
  })

  test("不支持的图片类型明确报错", async () => {
    const bytes = await freshDocx()
    const opened = await docxEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const result = await docxEngine.apply(
      opened.data,
      [{ op: "addImage", after: 1, dataBase64: encoder2.encode("x").toString?.() ?? "eA==", mime: "image/webp" }],
      bytes,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("unsupported_format")
  })

  test("setHeaderFooter：新建页眉部件、登记关系和 Content_Types", async () => {
    const result = await apply(await freshDocx(), [{ op: "setHeaderFooter", kind: "header", text: "内部资料" }])
    expect(result.changed).toContain("word/document.xml")
    expect(result.changed).toContain("word/_rels/document.xml.rels")
    expect(result.changed).toContain("[Content_Types].xml")
    expect(result.changed.some((name) => name.startsWith("word/header"))).toBe(true)
    expect(result.state.header).toBe("内部资料")

    const xml = await documentXml(result.bytes)
    expect(xml).toContain('<w:headerReference w:type="default" r:id="rId')
  })

  test("setHeaderFooter：已有页脚时只改文字，不重复建部件", async () => {
    const first = await apply(await freshDocx(), [{ op: "setHeaderFooter", kind: "footer", text: "第 1 页" }])
    const second = await apply(first.bytes, [{ op: "setHeaderFooter", kind: "footer", text: "第 2 页" }])
    expect(second.state.footer).toBe("第 2 页")
    const headers = second.changed.filter((name) => name.startsWith("word/footer"))
    expect(headers.length).toBe(1)
    const xml = await documentXml(second.bytes)
    expect(xml.match(/<w:footerReference/g)?.length).toBe(1)
  })

  test("setParagraphStyle 带字符区间：只给选中的字加粗，其余 run 不受影响", async () => {
    const bytes = await freshDocx()
    const opened = await docxEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const paragraph = opened.data.paragraphs[1]!
    const target = paragraph.text
    const start = target.indexOf("第一段")
    const end = start + "第一段".length
    const result = await apply(bytes, [{ op: "setParagraphStyle", paragraph: 2, style: { bold: true }, start, end }])
    expect(result.state.paragraphs[1]!.text).toBe(target)
    const xml = await documentXml(result.bytes)
    // 只有区间内那一段被包上 <w:b/>
    expect((xml.match(/<w:b\/>/g) ?? []).length).toBe(1)
    expect(xml).toMatch(/<w:r><w:rPr><w:b\/><\/w:rPr><w:t[^>]*>第一段<\/w:t><\/w:r>/)
  })

  test("setHeaderFooter 支持多行：一行一段，读回来仍是换行", async () => {
    const first = await apply(await freshDocx(), [
      { op: "setHeaderFooter", kind: "header", text: "内部资料" + String.fromCharCode(10) + "第 1 页" },
    ])
    expect(first.state.header).toBe("内部资料" + String.fromCharCode(10) + "第 1 页")

    const { readZip, inflateEntry } = await import("../../src/office/engine/zip")
    const zip = await readZip(first.bytes)
    const header = zip.entries.find((entry) => /^word\/header\d+\.xml$/.test(entry.name))!
    const xml = decoder2.decode(await inflateEntry(zip, header))
    expect((xml.match(/<w:p>/g) ?? []).length).toBe(2)

    // 改成单行时走保留格式的路径，段落数收敛回一段。
    const second = await apply(first.bytes, [{ op: "setHeaderFooter", kind: "header", text: "只一行" }])
    expect(second.state.header).toBe("只一行")
  })
})

describe("docx 列表（numbering.xml）", () => {
  const LIST_DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>项目一</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>子项</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>第一步</w:t></w:r></w:p>
<w:p><w:r><w:t>正文</w:t></w:r></w:p>
</w:body></w:document>`

  const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0">
<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>
<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="1">
<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`

  function fixtureWithNumbering() {
    return buildZip([
      { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
      { name: "word/document.xml", data: encoder.encode(LIST_DOC) },
      { name: "word/numbering.xml", data: encoder.encode(NUMBERING) },
    ])
  }

  test("numId → 每级格式，bullet 与 decimal 分开", () => {
    const numbering = readDocxNumbering(NUMBERING)
    expect(numbering.get("1")?.get(0)).toBe("bullet")
    expect(numbering.get("1")?.get(1)).toBe("bullet")
    expect(numbering.get("2")?.get(0)).toBe("number")
  })

  test("段落读成 list，层级保留；没有 numPr 的仍是正文", () => {
    const paragraphs = readDocxParagraphs(LIST_DOC, readDocxNumbering(NUMBERING))
    expect(paragraphs.map((item) => item.text)).toEqual(["项目一", "子项", "第一步", "正文"])
    expect(paragraphs[0]!.list).toEqual({ kind: "bullet", level: 0 })
    expect(paragraphs[1]!.list).toEqual({ kind: "bullet", level: 1 })
    expect(paragraphs[2]!.list).toEqual({ kind: "number", level: 0 })
    expect(paragraphs[3]!.list).toBeUndefined()
  })

  test("没有 numbering.xml 时按项目符号兜底，而不是吞掉列表", () => {
    const paragraphs = readDocxParagraphs(LIST_DOC)
    expect(paragraphs[0]!.list).toEqual({ kind: "bullet", level: 0 })
  })

  test("整理文件时读到列表，md 导出带缩进和编号", async () => {
    const opened = await docxEngine.open(fixtureWithNumbering())
    if (!opened.ok) throw new Error(opened.error.message)
    expect(opened.data.paragraphs[0]!.list?.kind).toBe("bullet")

    const md = await docxEngine.export!(opened.data, "md", fixtureWithNumbering())
    if (!md.ok) throw new Error(md.error.message)
    const text = new TextDecoder().decode(md.data)
    expect(text).toContain("- 项目一")
    expect(text).toContain("  - 子项")
    expect(text).toContain("1. 第一步")
  })
})

describe("docx 表格结构编辑", () => {
  async function open() {
    const opened = await docxEngine.open(fixture())
    if (!opened.ok) throw new Error(opened.error.message)
    return opened.data
  }

  async function xmlOf(bytes: Uint8Array) {
    const { readZip, inflateEntry } = await import("../../src/office/engine/zip")
    const zip = await readZip(bytes)
    return new TextDecoder().decode(
      await inflateEntry(zip, zip.entries.find((item) => item.name === "word/document.xml")!),
    )
  }

  test("插入一行：复制单元格属性，新行是空的", async () => {
    const state = await open()
    const applied = await docxEngine.apply(state, [{ op: "insertTableRow", table: 1, at: 2 }], fixture())
    if (!applied.ok) throw new Error(applied.error.message)
    const xml = await xmlOf(applied.data.bytes)
    expect(xml.match(/<w:tr>/g)?.length).toBe(2)
    expect(xml.match(/<w:t><\/w:t>/g)?.length).toBe(2)
  })

  test("插入一列：每行都多一个空单元格", async () => {
    const state = await open()
    const applied = await docxEngine.apply(state, [{ op: "insertTableColumn", table: 1, at: 2 }], fixture())
    if (!applied.ok) throw new Error(applied.error.message)
    const xml = await xmlOf(applied.data.bytes)
    expect(xml.match(/<w:tc>/g)?.length).toBe(3)
  })

  test("改单元格文字：只换目标格，保留其它格", async () => {
    const state = await open()
    const applied = await docxEngine.apply(
      state,
      [{ op: "setTableCellText", table: 1, row: 1, col: 2, text: "新表头" }],
      fixture(),
    )
    if (!applied.ok) throw new Error(applied.error.message)
    const xml = await xmlOf(applied.data.bytes)
    expect(xml).toContain("<w:t>表头A</w:t>")
    expect(xml).toContain("<w:t>新表头</w:t>")
    expect(xml).not.toContain("表头B")
  })

  test("删除行和列：至少保留一列", async () => {
    const state = await open()
    const applied = await docxEngine.apply(
      state,
      [
        { op: "insertTableRow", table: 1, at: 1 },
        { op: "deleteTableRow", table: 1, at: 2 },
        { op: "deleteTableColumn", table: 1, at: 1 },
      ],
      fixture(),
    )
    if (!applied.ok) throw new Error(applied.error.message)
    const xml = await xmlOf(applied.data.bytes)
    expect(xml.match(/<w:tr>/g)?.length).toBe(1)
    expect(xml.match(/<w:tc>/g)?.length).toBe(1)
  })

  test("删除整张表：表格和里面的段落一起去掉", async () => {
    const state = await open()
    const before = state.paragraphs.length
    const applied = await docxEngine.apply(state, [{ op: "deleteTable", table: 1 }], fixture())
    if (!applied.ok) throw new Error(applied.error.message)
    const xml = await xmlOf(applied.data.bytes)
    expect(xml).not.toContain("<w:tbl>")
    expect(xml).not.toContain("表头A")
    expect(applied.data.state.paragraphs.length).toBe(before - 2)

    const missing = await docxEngine.apply(state, [{ op: "deleteTable", table: 9 }], fixture())
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe("not_found")
  })

  test("表格或行列越界时整批失败", async () => {
    const state = await open()
    const missingTable = await docxEngine.apply(state, [{ op: "insertTableRow", table: 9, at: 1 }], fixture())
    expect(missingTable.ok).toBe(false)
    if (!missingTable.ok) expect(missingTable.error.code).toBe("not_found")
    const missingRow = await docxEngine.apply(
      state,
      [{ op: "setTableCellText", table: 1, row: 9, col: 1, text: "x" }],
      fixture(),
    )
    expect(missingRow.ok).toBe(false)
    if (!missingRow.ok) expect(missingRow.error.code).toBe("not_found")
  })
})
