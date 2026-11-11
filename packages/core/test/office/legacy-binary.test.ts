import { describe, expect, test } from "bun:test"
import { readDoc, readDocText, readPptText, readXls } from "../../src/office/legacy/binary"
import { readOle, type OleFile } from "../../src/office/legacy/ole"
import { legacyEngine } from "../../src/office/legacy/engine"

const encoder = new TextEncoder()

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function u16(value: number): Uint8Array {
  const data = new Uint8Array(2)
  new DataView(data.buffer).setUint16(0, value, true)
  return data
}

function u32(value: number): Uint8Array {
  const data = new Uint8Array(4)
  new DataView(data.buffer).setUint32(0, value >>> 0, true)
  return data
}

function utf16(text: string): Uint8Array {
  const data = new Uint8Array(text.length * 2)
  const view = new DataView(data.buffer)
  for (let index = 0; index < text.length; index += 1) view.setUint16(index * 2, text.charCodeAt(index), true)
  return data
}

function oleOf(streams: Record<string, Uint8Array>): OleFile {
  return {
    entries: Object.keys(streams).map((name) => ({ name, type: 2, start: 0, size: streams[name]!.length })),
    streams: new Map(Object.entries(streams)),
  }
}

describe("OLE 复合文档", () => {
  test("读 512 字节扇区的目录与流", () => {
    // 只放一个大到走 FAT 的流，避开 mini FAT 的构造，集中验证主路径。
    const stream = new Uint8Array(4096)
    stream.set(encoder.encode("hello ole"))
    const bytes = buildOle({ Workbook: stream })
    const ole = readOle(bytes)
    expect(ole).toBeDefined()
    expect(ole!.entries.some((entry) => entry.name === "Workbook" && entry.type === 2)).toBe(true)
    expect(new TextDecoder().decode(ole!.streams.get("Workbook")!.subarray(0, 9))).toBe("hello ole")
  })
})

/** 最小 CFB：1 个 FAT 扇区 + 1 个目录扇区 + 数据扇区。 */
function buildOle(streams: Record<string, Uint8Array>): Uint8Array {
  const entries = Object.entries(streams).map(([name, data]) => ({ name, data }))
  // 每个流补齐到扇区的整数倍。
  const padded = entries.map((entry) => {
    const sectors = Math.max(1, Math.ceil(entry.data.length / 512))
    const data = new Uint8Array(sectors * 512)
    data.set(entry.data)
    return { name: entry.name, size: entry.data.length, data, sectors }
  })
  const sectorCount = padded.reduce((sum, entry) => sum + entry.sectors, 0)
  const fatSectors = Math.max(1, Math.ceil((sectorCount + 2) / 128))
  const dataStart = fatSectors + 1

  const header = new Uint8Array(512)
  const view = new DataView(header.buffer)
  ;[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((value, index) => {
    header[index] = value
  })
  view.setUint16(0x1e, 9, true)
  view.setUint16(0x20, 6, true)
  view.setUint32(0x2c, fatSectors, true)
  view.setUint32(0x30, fatSectors, true)
  view.setUint32(0x38, 4096, true)
  view.setUint32(0x3c, 0xfffffffe, true)
  view.setUint32(0x44, 0xfffffffe, true)
  view.setUint32(0x48, 0, true)
  for (let index = 0; index < 109; index += 1) view.setUint32(0x4c + index * 4, 0xffffffff, true)
  for (let index = 0; index < fatSectors; index += 1) view.setUint32(0x4c + index * 4, index, true)

  const fat = new Uint8Array(fatSectors * 512)
  const fatView = new DataView(fat.buffer)
  for (let index = 0; index < fatView.byteLength / 4; index += 1) fatView.setUint32(index * 4, 0xffffffff, true)
  // FAT 扇区自身
  for (let index = 0; index < fatSectors; index += 1) fatView.setUint32(index * 4, 0xfffffffe, true)
  fatView.setUint32(fatSectors * 4, 0xfffffffe, true) // 目录扇区
  let sector = dataStart
  for (const entry of padded) {
    for (let index = 0; index < entry.sectors; index += 1) {
      const current = sector + index
      fatView.setUint32(current * 4, index === entry.sectors - 1 ? 0xfffffffe : current + 1, true)
    }
    sector += entry.sectors
  }

  const dir = new Uint8Array(512)
  const dirView = new DataView(dir.buffer)
  const writeEntry = (index: number, name: string, type: number, start: number, size: number) => {
    const offset = index * 128
    const nameBytes = utf16(name + String.fromCharCode(0))
    dir.set(nameBytes.subarray(0, 64), offset)
    dirView.setUint16(offset + 64, Math.min(nameBytes.length, 64), true)
    dirView.setUint8(offset + 66, type)
    dirView.setUint32(offset + 116, start, true)
    dirView.setUint32(offset + 120, size, true)
  }
  writeEntry(0, "Root Entry", 5, 0xfffffffe, 0)
  let start = dataStart
  padded.forEach((entry, index) => {
    writeEntry(index + 1, entry.name, 2, start, entry.size)
    start += entry.sectors
  })

  return concat([header, fat, dir, ...padded.map((entry) => entry.data)])
}

function docFixture(text: string, wide: boolean): { word: Uint8Array; table: Uint8Array } {
  const word = new Uint8Array(4096)
  const wordView = new DataView(word.buffer)
  wordView.setUint16(0x000a, 0x0200, true) // 用 1Table
  wordView.setUint32(0x004c, text.length, true) // ccpText
  const dataAt = 0x0200
  if (wide) word.set(utf16(text), dataAt)
  else word.set(encoder.encode(text), dataAt)

  const table = new Uint8Array(512)
  const tableView = new DataView(table.buffer)
  const base = 0x0100
  const pieces = 1
  const length = 4 + (pieces + 1) * 4 + pieces * 8
  table[base] = 0x02
  tableView.setUint32(base + 1, length, true)
  tableView.setUint32(base + 5, 0, true)
  tableView.setUint32(base + 9, text.length, true)
  tableView.setUint32(base + 13 + 2, wide ? dataAt : 0x40000000 | (dataAt * 2), true)
  wordView.setUint32(0x01a2, base, true)
  wordView.setUint32(0x01a6, length + 5, true)
  return { word, table }
}

describe("Word 97-2003 文本", () => {
  test("片段表：压缩（cp1252）与 UTF-16 都能读", () => {
    const latin = docFixture("Hello Word", false)
    expect(readDocText(latin.word, latin.table)).toBe("Hello Word")
    const chinese = docFixture("季度总结", true)
    expect(readDocText(chinese.word, chinese.table)).toBe("季度总结")
  })

  test("readDoc 走 OLE 流并给出段落", () => {
    const fixture = docFixture("First" + String.fromCharCode(13) + "Second", false)
    const doc = readDoc(oleOf({ WordDocument: fixture.word, "1Table": fixture.table }))
    expect(doc.kind).toBe("document")
    expect(doc.text).toBe("First" + String.fromCharCode(10) + "Second")
    expect(doc.paragraphs).toEqual(["First", "Second"])
  })
})

function biff(id: number, data: Uint8Array): Uint8Array {
  return concat([u16(id), u16(data.length), data])
}

function biffString(text: string): Uint8Array {
  return concat([u16(text.length), new Uint8Array([0x01]), utf16(text)])
}

describe("旧格式引擎接上二进制解析", () => {
  test("从 OLE 流名识别 .doc，打开后能直接导出 docx", async () => {
    const fixture = docFixture("季度报告", true)
    const table = new Uint8Array(4096)
    table.set(fixture.table)
    const bytes = buildOle({ WordDocument: fixture.word, "1Table": table })

    const opened = await legacyEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    expect(opened.data.kind).toBe("document")
    expect(opened.data.text).toContain("季度报告")

    const exported = await legacyEngine.export!(opened.data, "docx", bytes)
    if (!exported.ok) throw new Error(exported.error.message)
    const { docxEngine } = await import("../../src/office/engine/docx")
    const doc = await docxEngine.open(exported.data)
    if (!doc.ok) throw new Error(doc.error.message)
    expect(doc.data.paragraphs.map((item) => item.text)).toContain("季度报告")
  })

  test("二进制文件仍然拒绝原地编辑，但给出另存为的去向", async () => {
    const fixture = docFixture("只读", true)
    const table = new Uint8Array(4096)
    table.set(fixture.table)
    const bytes = buildOle({ WordDocument: fixture.word, "1Table": table })
    const opened = await legacyEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const applied = await legacyEngine.apply(opened.data, [{ op: "setParagraphText", paragraph: 1, text: "x" }], bytes)
    expect(applied.ok).toBe(false)
    if (!applied.ok) expect(applied.error.suggestion).toContain("另存为")
  })
})

describe("Excel 97-2003 单元格", () => {
  test("SST / LABELSST / NUMBER 都能读成工作表", () => {
    const sst = biff(0x00fc, concat([u32(1), u32(1), biffString("名称")]))
    const makeBounds = (start: number) =>
      biff(0x0085, concat([u32(start), new Uint8Array([0, 0]), new Uint8Array([2, 1]), utf16("数据")]))
    const globalsLength = sst.length + makeBounds(0).length
    const sheetStart = globalsLength
    const nameIndex = new Uint8Array(4)
    new DataView(nameIndex.buffer).setUint32(0, 0, true)
    const label = biff(0x00fd, concat([u16(0), u16(0), u16(0), nameIndex]))
    const number = biff(0x0203, concat([u16(1), u16(1), u16(0), new Uint8Array(8)]))
    new DataView(number.buffer).setFloat64(10, 120, true)
    const worksheet = concat([biff(0x0809, new Uint8Array(16)), label, number, biff(0x000a, new Uint8Array(0))])
    const stream = concat([sst, makeBounds(sheetStart), worksheet])

    const book = readXls(oleOf({ Workbook: stream }))
    expect(book.kind).toBe("spreadsheet")
    expect(book.sheets[0]!.name).toBe("数据")
    expect(book.sheets[0]!.rows[0]).toEqual(["名称"])
    expect(book.sheets[0]!.rows[1]).toEqual(["", "120"])
  })
})

function pptRecord(type: number, body: Uint8Array): Uint8Array {
  return concat([u16(0), u16(type), u32(body.length), body])
}

describe("PowerPoint 97-2003 文本", () => {
  test("按 Slide 容器分组 TextCharsAtom", () => {
    const first = pptRecord(0x03ee, pptRecord(0x0fa0, utf16("季度汇报")))
    const second = pptRecord(0x03ee, pptRecord(0x0fa0, utf16("收入增长")))
    const stream = pptRecord(0x03e8, concat([first, second]))
    const result = readPptText(stream)
    expect(result.pages).toEqual([["季度汇报"], ["收入增长"]])
  })
})
