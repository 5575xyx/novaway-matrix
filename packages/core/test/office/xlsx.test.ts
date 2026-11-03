import { describe, expect, test } from "bun:test"
import { DocumentSession } from "../../src/office/engine/session"
import { engineFor, officeFormatOf } from "../../src/office/engine/registry"
import { cellStyleIndex, parseSheetXml, writeCell } from "../../src/office/engine/xlsx-sheet"
import { ensureCellStyle } from "../../src/office/engine/xlsx-styles"
import { xlsxEngine } from "../../src/office/engine/xlsx"

const encoder = new TextEncoder()

/** 只写 stored 条目的最小 ZIP：够我们自己的 readZip 用，不依赖第三方库。 */
function buildZip(files: Record<string, string>): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name)
    const data = encoder.encode(content)
    const local = new Uint8Array(30 + nameBytes.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(8, 0, true) // stored
    view.setUint32(18, data.length, true)
    view.setUint32(22, data.length, true)
    view.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    chunks.push(local, data)

    const record = new Uint8Array(46 + nameBytes.length)
    const rv = new DataView(record.buffer)
    rv.setUint32(0, 0x02014b50, true)
    rv.setUint16(4, 20, true)
    rv.setUint16(6, 20, true)
    rv.setUint16(10, 0, true)
    rv.setUint32(20, data.length, true)
    rv.setUint32(24, data.length, true)
    rv.setUint16(28, nameBytes.length, true)
    rv.setUint32(42, offset, true)
    record.set(nameBytes, 46)
    central.push(record)
    offset += local.length + data.length
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, central.length, true)
  ev.setUint16(10, central.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + centralSize + 22)
  let cursor = 0
  for (const part of [...chunks, ...central, eocd]) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

const SHEET = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" s="1"><v>1</v></c><c r="B2" s="1"><v>2</v></c></row></sheetData>
</worksheet>`

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`

function workbook(): Uint8Array {
  return buildZip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": SHEET,
    "xl/styles.xml": STYLES,
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>名称</t></si><si><t>数量</t></si></sst>`,
  })
}

describe("XLSX 读取", () => {
  test("注册表把 .xlsx 交给表格引擎", () => {
    expect(officeFormatOf("data/report.xlsx")).toBe("xlsx")
    expect(engineFor("xlsx")).toBe(xlsxEngine)
  })

  test("共享字符串、数字与样式下标都读出来", async () => {
    const opened = await xlsxEngine.open(workbook())
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const sheet = opened.data.sheets[0]!
    expect(sheet.name).toBe("Sheet1")
    expect(sheet.path).toBe("xl/worksheets/sheet1.xml")
    expect(sheet.cells.map((cell) => [cell.ref, cell.text])).toEqual([
      ["A1", "名称"],
      ["B1", "数量"],
      ["A2", "1"],
      ["B2", "2"],
    ])
    expect(sheet.cells[2]!.style).toBe(1)
    expect(sheet.lastRow).toBe(1)
    expect(sheet.lastCol).toBe(1)
  })
})

describe("XLSX 单元格写入", () => {
  test("文本写成 inlineStr，公式不落缓存值", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const applied = await xlsxEngine.apply(
      opened.data,
      [
        { op: "setCellValue", sheet: "Sheet1", ref: { row: 0, col: 0 }, value: "新名称" },
        { op: "setCellValue", sheet: "Sheet1", ref: { row: 2, col: 1 }, value: { formula: "SUM(B2:B2)" } },
      ],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.changed).toEqual(["xl/worksheets/sheet1.xml"])
    const sheet = applied.data.state.sheets[0]!
    expect(sheet.cells.find((cell) => cell.ref === "A1")!.text).toBe("新名称")
    const formula = sheet.cells.find((cell) => cell.ref === "B3")!
    expect(formula.formula).toBe("SUM(B2:B2)")
    expect(formula.text).toBe("=SUM(B2:B2)")
  })

  test("改值保留原有样式；插入的新单元格按列序排好", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const applied = await xlsxEngine.apply(
      opened.data,
      [
        { op: "setCellValue", sheet: "Sheet1", ref: { row: 1, col: 0 }, value: 42 },
        { op: "setCellValue", sheet: "Sheet1", ref: { row: 1, col: 1 }, value: "中间" },
      ],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const sheet = applied.data.state.sheets[0]!
    expect(sheet.cells.find((cell) => cell.ref === "A2")!.style).toBe(1)
    expect(sheet.cells.map((cell) => cell.ref)).toEqual(["A1", "B1", "A2", "B2"])
  })

  test("新行插在正确的行号位置", async () => {
    const xml = `<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="5"><c r="A5"><v>5</v></c></row></sheetData></worksheet>`
    const next = writeCell(xml, "A3", { value: { kind: "number", value: 3 } })
    expect(next.indexOf('r="1"')).toBeLessThan(next.indexOf('r="3"'))
    expect(next.indexOf('r="3"')).toBeLessThan(next.indexOf('r="5"'))
  })

  test("不存在的行会整行建出来", async () => {
    const xml = `<worksheet><sheetData/></worksheet>`
    const next = writeCell(xml, "C7", { value: { kind: "text", value: "x" } })
    expect(next).toContain('<row r="7">')
    expect(next).toContain('r="C7"')
  })
})

describe("XLSX 单元格格式", () => {
  test("加粗会新增 font + xf，单元格指向新下标", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const applied = await xlsxEngine.apply(
      opened.data,
      [{ op: "setCellStyle", sheet: "Sheet1", range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } }, style: { bold: true } }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.changed.sort()).toEqual(["xl/styles.xml", "xl/worksheets/sheet1.xml"])
    const cell = applied.data.state.sheets[0]!.cells.find((item) => item.ref === "A1")!
    // 原文件里已经有一条粗体 xf（下标 1），能复用就不该再塞一条。
    expect(cell.style).toBe(1)
  })

  test("颜色 + 填充 + 对齐写进新的 xf", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const applied = await xlsxEngine.apply(
      opened.data,
      [
        {
          op: "setCellStyle",
          sheet: "Sheet1",
          range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
          style: { color: "FF0000", fill: "FFF2CC", align: "ctr", wrap: true },
        },
      ],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const cell = applied.data.state.sheets[0]!.cells.find((item) => item.ref === "A1")!
    expect(cell.style).toBe(2)
  })

  test("同样的格式改两次不会让 cellXfs 继续膨胀", () => {
    const first = ensureCellStyle(STYLES, 0, { bold: true })
    expect(first).toBeDefined()
    if (!first) return
    const second = ensureCellStyle(first.xml, first.index, { bold: true })
    expect(second).toBeDefined()
    if (!second) return
    expect(second.index).toBe(first.index)
    expect(second.xml).toBe(first.xml)
  })

  test("整块区域一起改格式", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const applied = await xlsxEngine.apply(
      opened.data,
      [
        {
          op: "setCellStyle",
          sheet: "Sheet1",
          range: { start: { row: 0, col: 0 }, end: { row: 1, col: 1 } },
          style: { italic: true },
        },
      ],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const sheet = applied.data.state.sheets[0]!
    expect(new Set(sheet.cells.map((cell) => cell.style)).size).toBe(1)
  })

  test("不支持的操作与未知工作表都明确报错", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const unsupported = await xlsxEngine.apply(
      opened.data,
      [{ op: "setParagraphText", paragraph: 1, text: "x" }],
      bytes,
    )
    expect(unsupported.ok).toBe(false)
    const missing = await xlsxEngine.apply(
      opened.data,
      [{ op: "setCellValue", sheet: "Sheet9", ref: { row: 0, col: 0 }, value: 1 }],
      bytes,
    )
    expect(missing.ok).toBe(false)
  })

  test("读取样式下标与写入的一致性", () => {
    const xml = `<worksheet><sheetData><row r="2"><c r="B2" s="4"/></row></sheetData></worksheet>`
    expect(cellStyleIndex(xml, "B2")).toBe(4)
    expect(cellStyleIndex(xml, "C2")).toBe(0)
    const grid = parseSheetXml(xml, "xl/worksheets/sheet1.xml", "Sheet1", [])
    expect(grid.cells[0]!.style).toBe(4)
  })
})

describe("XLSX 会话", () => {
  test("撤销回到原字节后重新变成干净文件", async () => {
    const bytes = workbook()
    const session = await DocumentSession.open(xlsxEngine, bytes)
    expect(session.ok).toBe(true)
    if (!session.ok) return
    const applied = await session.data.apply(
      [{ op: "setCellValue", sheet: "Sheet1", ref: { row: 0, col: 0 }, value: "改" }],
      "改单元格",
    )
    expect(applied.ok).toBe(true)
    expect(session.data.dirty).toBe(true)
    expect(session.data.undo().ok).toBe(true)
    expect(session.data.dirty).toBe(false)
    expect(session.data.bytes).toBe(bytes)
  })
})
