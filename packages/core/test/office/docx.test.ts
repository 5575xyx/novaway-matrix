import { describe, expect, test } from "bun:test"
import { docxEngine, editDocxXml, readDocxParagraphs } from "../../src/office/engine/docx"
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

describe("docx 写入", () => {
  test("改段落文字：保留其他 run 的结构，只把文字放进第一个 w:t", () => {
    const result = editDocxXml(DOCUMENT, { textEdits: [{ paragraph: 2, text: "新的一段" }] })
    expect(result.applied).toEqual([{ paragraph: 2, previous: "第一段混排文字", text: "新的一段" }])
    expect(result.xml).toContain("<w:t>新的一段</w:t>")
    expect(result.xml).toContain("<w:i/>")
    expect(result.xml).toContain("<w:r><w:rPr><w:i/><w:sz w:val=\"24\"/></w:rPr><w:t></w:t></w:r>")
  })

  test("改格式：b/i/sz/color 落到每个 run 的 rPr 上", () => {
    const result = editDocxXml(DOCUMENT, {
      styleEdits: [{ paragraph: 2, style: { bold: true, color: "C00000", size: 16 } }],
    })
    expect(result.xml).toContain("<w:b/>")
    expect(result.xml).toContain("<w:color w:val=\"C00000\"/>")
    expect(result.xml).toContain("<w:sz w:val=\"32\"/>")
    expect(result.xml).toContain("<w:i/>")
  })

  test("取消加粗：删掉 w:b，而不是留一个 false", () => {
    const result = editDocxXml(DOCUMENT, { styleEdits: [{ paragraph: 1, style: { bold: false } }] })
    expect(result.xml).not.toContain("<w:b/>")
  })

  test("改对齐：替换 w:jc，不产生两个", () => {
    const result = editDocxXml(DOCUMENT, { styleEdits: [{ paragraph: 1, style: { align: "right" } }] })
    const matches = result.xml.match(/<w:jc [^>]*>/g) ?? []
    expect(matches).toEqual(["<w:jc w:val=\"right\"/>"])
  })

  test("同一段既有文字又有格式：只替换一次", () => {
    const result = editDocxXml(DOCUMENT, {
      textEdits: [{ paragraph: 2, text: "合并" }],
      styleEdits: [{ paragraph: 2, style: { italic: true } }],
    })
    expect(result.applied).toHaveLength(1)
    expect(result.xml).toContain("<w:t>合并</w:t>")
  })

  test("段落越界时不改任何内容", () => {
    const result = editDocxXml(DOCUMENT, { textEdits: [{ paragraph: 99, text: "x" }] })
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

  test("只有 docx/pptx 有可编辑引擎", () => {
    expect(officeFormatOf("a.docx")).toBe("docx")
    expect(officeFormatOf("a.pptx")).toBe("pptx")
    expect(officeFormatOf("a.xlsx")).toBeUndefined()
  })
})
