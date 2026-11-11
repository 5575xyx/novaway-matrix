/**
 * Office 97-2003 二进制文件的**只读**文本提取。
 *
 * 三种格式共享 OLE 容器（见 ./ole），内容各不相同：
 *
 *   - .doc：WordDocument 流的 FIB + 片段表（Piece Table），UTF-16 / cp1252；
 *   - .xls：Workbook 流的 BIFF8 记录（SST / LABELSST / NUMBER / RK / FORMULA）；
 *   - .ppt：PowerPoint Document 流的记录树，取 TextCharsAtom / TextBytesAtom。
 *
 * 目标不是还原排版，而是让「打开就能看、能导出成 docx/xlsx/pptx」成立。
 * 解析失败会抛出明确错误，由上层提示另存为新格式。
 */
import type { LegacyDocument, LegacySheet } from "./read"
import { readOle, type OleFile } from "./ole"

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function u16(bytes: Uint8Array, offset: number): number {
  return offset + 2 <= bytes.length ? viewOf(bytes).getUint16(offset, true) : 0
}

function u32(bytes: Uint8Array, offset: number): number {
  return offset + 4 <= bytes.length ? viewOf(bytes).getUint32(offset, true) >>> 0 : 0
}

const CP1252 = new TextDecoder("windows-1252")
const UTF16 = new TextDecoder("utf-16le" as never)

/** Word 的控制字符 → 可读文本；表格标记保留成制表符。 */
function cleanWordText(text: string): string {
  let out = ""
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (char === "\r") out += "\n"
    else if (char === "\u000b" || char === "\u000c") out += "\n"
    else if (char === "\u0007") out += "\t"
    else if (code < 0x20 && char !== "\n" && char !== "\t") continue
    else out += char
  }
  return out
    .split("\n")
    .map((line) => line.replace(/\t+$/, "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function identifyOle(ole: OleFile): "doc" | "xls" | "ppt" | undefined {
  if (ole.streams.has("WordDocument")) return "doc"
  if (ole.streams.has("Workbook") || ole.streams.has("Book")) return "xls"
  if (ole.streams.has("PowerPoint Document")) return "ppt"
  return undefined
}

// ---------------------------------------------------------------------------
// .doc：FIB + 片段表
// ---------------------------------------------------------------------------

export function readDocText(word: Uint8Array, table: Uint8Array | undefined): string {
  const fcClx = u32(word, 0x01a2)
  const lcbClx = u32(word, 0x01a6)
  if (table && fcClx > 0 && lcbClx > 0 && fcClx + lcbClx <= table.length) {
    let offset = fcClx
    const end = fcClx + lcbClx
    // CLX 前面可能有若干 Prc（0x01 + cbGrpprl），真正的内容是 0x02 + length。
    while (offset < end && table[offset] === 0x01) offset += 3 + u16(table, offset + 1)
    if (offset < end && table[offset] === 0x02) {
      const length = u32(table, offset + 1)
      const start = offset + 5
      const pieces = Math.floor((length - 4) / 12)
      if (pieces > 0 && start + length <= table.length + 4) {
        const ccpText = u32(word, 0x004c)
        let out = ""
        for (let index = 0; index < pieces; index += 1) {
          const cpStart = u32(table, start + index * 4)
          const cpEnd = u32(table, start + (index + 1) * 4)
          const pcd = start + (pieces + 1) * 4 + index * 8
          const raw = u32(table, pcd + 2)
          const compressed = (raw & 0x40000000) !== 0
          const chars = cpEnd - cpStart
          if (chars <= 0) continue
          const at = compressed ? (raw & 0x3fffffff) / 2 : raw & 0x3fffffff
          // 文字本身在 WordDocument 流里；表格流只存片段表。
          if (compressed) {
            out += CP1252.decode(word.subarray(at, at + chars))
          } else {
            out += UTF16.decode(word.subarray(at, at + chars * 2))
          }
          if (ccpText > 0 && cpEnd >= ccpText) break
        }
        const cleaned = cleanWordText(out)
        if (cleaned !== "") return cleaned
      }
    }
  }
  // 极老的 Word（6/95）没有片段表：正文在 fcMin..fcMac 之间。
  const fcMin = u32(word, 0x0018)
  const fcMac = u32(word, 0x001c)
  if (fcMac > fcMin && fcMac <= word.length) {
    const cleaned = cleanWordText(CP1252.decode(word.subarray(fcMin, fcMac)))
    if (cleaned !== "") return cleaned
  }
  throw new Error("Word 文档里没有可读的文字")
}

export function readDoc(ole: OleFile): LegacyDocument {
  const word = ole.streams.get("WordDocument")
  if (!word) throw new Error("这不是有效的 Word 97-2003 文档")
  const flags = u16(word, 0x000a)
  const tableName = flags & 0x0200 ? "1Table" : "0Table"
  const table = ole.streams.get(tableName) ?? ole.streams.get("1Table") ?? ole.streams.get("0Table")
  const text = readDocText(word, table)
  const paragraphs = text.split(String.fromCharCode(10)).filter((line) => line.trim() !== "")
  return { kind: "document", text, paragraphs, sheets: [], pageCount: 0 }
}

// ---------------------------------------------------------------------------
// .xls：BIFF8 记录
// ---------------------------------------------------------------------------

type BiffRecord = { offset: number; id: number; data: Uint8Array }

function biffRecords(stream: Uint8Array): BiffRecord[] {
  const records: BiffRecord[] = []
  let offset = 0
  while (offset + 4 <= stream.length) {
    const id = u16(stream, offset)
    const length = u16(stream, offset + 2)
    if (length === 0xffff) break
    const end = Math.min(offset + 4 + length, stream.length)
    records.push({ offset, id, data: stream.subarray(offset + 4, end) })
    offset = end
    if (records.length > 200000) break
  }
  return records
}

/** BIFF8 XLUnicodeString（cch 2 字节、flags 1 字节、可选 rich/ext）。 */
function biffString(data: Uint8Array, offset: number): { text: string; end: number } {
  if (offset + 3 > data.length) return { text: "", end: data.length }
  const chars = u16(data, offset)
  const flags = data[offset + 2]!
  let position = offset + 3
  let runs = 0
  let ext = 0
  if (flags & 0x08) {
    runs = u16(data, position)
    position += 2
  }
  if (flags & 0x04) {
    ext = u32(data, position)
    position += 4
  }
  const wide = (flags & 0x01) !== 0
  const bytes = chars * (wide ? 2 : 1)
  const slice = data.subarray(position, Math.min(position + bytes, data.length))
  const text = wide ? UTF16.decode(slice) : CP1252.decode(slice)
  return { text, end: position + bytes + runs * 4 + ext }
}

/** BOUNDSHEET 里的短字符串：cch 1 字节 + flags 1 字节。 */
function biffShortString(data: Uint8Array, offset: number): string {
  if (offset + 2 > data.length) return ""
  const chars = data[offset]!
  const flags = data[offset + 1]!
  const wide = (flags & 0x01) !== 0
  const slice = data.subarray(offset + 2, Math.min(offset + 2 + chars * (wide ? 2 : 1), data.length))
  return wide ? UTF16.decode(slice) : CP1252.decode(slice)
}

function decodeRk(value: number): number {
  const multiplied = (value & 0x01) !== 0
  const integer = (value & 0x02) !== 0
  let result: number
  if (integer) {
    result = value >> 2
  } else {
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    view.setUint32(4, (value & 0xfffffffc) >>> 0, true)
    result = view.getFloat64(0, true)
  }
  return multiplied ? result / 100 : result
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) return ""
  const rounded = Math.round(value * 1e10) / 1e10
  return String(rounded)
}

function parseSst(records: BiffRecord[], start: number): string[] {
  const first = records[start]
  if (!first) return []
  const chunks: Uint8Array[] = [first.data]
  for (let index = start + 1; index < records.length && records[index]!.id === 0x003c; index += 1) {
    chunks.push(records[index]!.data)
  }
  const total = chunks.reduce((sum, part) => sum + part.length, 0)
  const data = new Uint8Array(total)
  let cursor = 0
  for (const part of chunks) {
    data.set(part, cursor)
    cursor += part.length
  }
  const unique = u32(data, 4)
  const out: string[] = []
  let offset = 8
  for (let index = 0; index < unique && offset < data.length; index += 1) {
    const parsed = biffString(data, offset)
    out.push(parsed.text)
    offset = parsed.end
    if (offset <= 0 || offset > data.length) break
  }
  return out
}

export function readXls(ole: OleFile): LegacyDocument {
  const stream = ole.streams.get("Workbook") ?? ole.streams.get("Book")
  if (!stream) throw new Error("这不是有效的 Excel 97-2003 工作簿")
  const records = biffRecords(stream)

  const sheets: LegacySheet[] = []
  const bounds = records
    .filter((record) => record.id === 0x0085)
    .map((record) => ({ name: biffShortString(record.data, 6) || "Sheet", start: u32(record.data, 0) }))
    .sort((a, b) => a.start - b.start)
  const sheetIndexAt = (offset: number): number => {
    let index = -1
    for (let cursor = 0; cursor < bounds.length; cursor += 1) {
      if (bounds[cursor]!.start <= offset) index = cursor
      else break
    }
    return index
  }
  const grids = new Map<number, Map<string, string>>()
  let sst: string[] = []

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!
    if (record.id === 0x00fc) {
      sst = parseSst(records, index)
      continue
    }
    const sheetIndex = sheetIndexAt(record.offset)
    if (sheetIndex < 0) continue
    const grid = grids.get(sheetIndex) ?? new Map<string, string>()
    const put = (row: number, col: number, text: string) => {
      if (text === "") return
      grid.set(row + ":" + col, text)
    }
    if (record.id === 0x00fd) {
      const row = u16(record.data, 0)
      const col = u16(record.data, 2)
      put(row, col, sst[u32(record.data, 6)] ?? "")
    } else if (record.id === 0x0204) {
      const row = u16(record.data, 0)
      const col = u16(record.data, 2)
      put(row, col, biffString(record.data, 6).text)
    } else if (record.id === 0x0203) {
      const row = u16(record.data, 0)
      const col = u16(record.data, 2)
      const value = viewOf(record.data).getFloat64(6, true)
      put(row, col, numberText(value))
    } else if (record.id === 0x027e) {
      const row = u16(record.data, 0)
      const col = u16(record.data, 2)
      put(row, col, numberText(decodeRk(u32(record.data, 6))))
    } else if (record.id === 0x00bd) {
      const row = u16(record.data, 0)
      const first = u16(record.data, 2)
      const count = Math.max(0, (record.data.length - 6) / 6)
      for (let item = 0; item < count; item += 1) {
        put(row, first + item, numberText(decodeRk(u32(record.data, 4 + item * 6 + 2))))
      }
    } else if (record.id === 0x0006) {
      const row = u16(record.data, 0)
      const col = u16(record.data, 2)
      const special = record.data[6] === 0xff && record.data[7] === 0xff
      if (!special) put(row, col, numberText(viewOf(record.data).getFloat64(6, true)))
    } else if (record.id === 0x0205) {
      const row = u16(record.data, 0)
      const col = u16(record.data, 2)
      const value = record.data[6]!
      const isError = record.data[7] === 1
      put(row, col, isError ? "#ERR" : value ? "TRUE" : "FALSE")
    }
    grids.set(sheetIndex, grid)
  }

  bounds.forEach((bound, index) => {
    const grid = grids.get(index)
    const rows: string[][] = []
    if (grid) {
      const parsed = [...grid.entries()].map(([key, text]) => {
        const [row, col] = key.split(":").map(Number)
        return { row: row!, col: col!, text }
      })
      const maxRow = Math.max(...parsed.map((cell) => cell.row))
      const maxCol = Math.max(...parsed.map((cell) => cell.col))
      for (let row = 0; row <= maxRow; row += 1) {
        const cells: string[] = []
        for (let col = 0; col <= maxCol; col += 1) {
          cells.push(parsed.find((cell) => cell.row === row && cell.col === col)?.text ?? "")
        }
        while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop()
        if (cells.length > 0) rows.push(cells)
      }
    }
    sheets.push({ name: bound.name, rows })
  })

  const text = sheets
    .map(
      (sheet) =>
        "## " +
        sheet.name +
        String.fromCharCode(10) +
        sheet.rows.map((row) => row.join("\t")).join(String.fromCharCode(10)),
    )
    .join(String.fromCharCode(10) + String.fromCharCode(10))
  return { kind: "spreadsheet", text, paragraphs: [], sheets, pageCount: 0 }
}

// ---------------------------------------------------------------------------
// .ppt：记录树里的文本
// ---------------------------------------------------------------------------

const PPT_CONTAINERS = new Set([0x03e8, 0x03ee, 0x0ff0, 0x03f0, 0x03f8, 0x0ff1])
const PPT_SLIDE = 0x03ee
const PPT_TEXT_CHARS = 0x0fa0
const PPT_TEXT_BYTES = 0x0fa8

function cleanPptText(text: string): string {
  let out = ""
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (char === "\r" || char === "\u000b") out += "\n"
    else if (code === 0x0d || code === 0x0e) out += "\n"
    else if (code < 0x20 && char !== "\n" && char !== "\t") continue
    else out += char
  }
  return out.trim()
}

export function readPptText(stream: Uint8Array): { pages: string[][]; fallback: string[] } {
  const pages: string[][] = []
  const fallback: string[] = []
  let depth = 0

  const walk = (start: number, end: number, inSlide: boolean) => {
    if (depth > 12) return
    depth += 1
    let offset = start
    while (offset + 8 <= end) {
      const type = u16(stream, offset + 2)
      const length = u32(stream, offset + 4)
      const bodyStart = offset + 8
      const bodyEnd = Math.min(bodyStart + length, end)
      if (type === PPT_SLIDE) {
        pages.push([])
        walk(bodyStart, bodyEnd, true)
      } else if (PPT_CONTAINERS.has(type)) {
        walk(bodyStart, bodyEnd, inSlide)
      } else if (type === PPT_TEXT_CHARS || type === PPT_TEXT_BYTES) {
        const raw =
          type === PPT_TEXT_CHARS
            ? UTF16.decode(stream.subarray(bodyStart, bodyEnd))
            : CP1252.decode(stream.subarray(bodyStart, bodyEnd))
        const text = cleanPptText(raw)
        if (text !== "") {
          if (inSlide && pages.length > 0) pages[pages.length - 1]!.push(text)
          else fallback.push(text)
        }
      }
      if (bodyEnd <= offset) break
      offset = bodyEnd
    }
    depth -= 1
  }

  walk(0, stream.length, false)
  return { pages: pages.filter((page) => page.length > 0), fallback }
}

export function readPpt(ole: OleFile): LegacyDocument {
  const stream = ole.streams.get("PowerPoint Document")
  if (!stream) throw new Error("这不是有效的 PowerPoint 97-2003 演示文稿")
  const { pages, fallback } = readPptText(stream)
  const source = pages.length > 0 ? pages : fallback.length > 0 ? [fallback] : []
  const paragraphs = source.flat()
  const text = source
    .map((page, index) => "## 第 " + (index + 1) + " 页" + String.fromCharCode(10) + page.join(String.fromCharCode(10)))
    .join(String.fromCharCode(10) + String.fromCharCode(10))
  return {
    kind: "presentation",
    text,
    paragraphs,
    sheets: [],
    pageCount: source.length,
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/** 从 OLE 容器里的流名判断是 doc / xls / ppt。 */
export function detectOleKind(bytes: Uint8Array): "doc" | "xls" | "ppt" | undefined {
  const ole = readOle(bytes)
  return ole ? identifyOle(ole) : undefined
}

export function readLegacyBinary(bytes: Uint8Array, extension: string): LegacyDocument {
  const ole = readOle(bytes)
  if (!ole) throw new Error("这不是有效的 Office 97-2003 二进制文件")
  const kind = identifyOle(ole) ?? (extension as "doc" | "xls" | "ppt")
  if (kind === "doc") return readDoc(ole)
  if (kind === "xls") return readXls(ole)
  if (kind === "ppt") return readPpt(ole)
  throw new Error("OLE 文件里没有 Word / Excel / PowerPoint 的内容流")
}
