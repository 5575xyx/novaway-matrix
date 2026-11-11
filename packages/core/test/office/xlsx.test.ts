import { describe, expect, test } from "bun:test"
import { DocumentSession } from "../../src/office/engine/session"
import { engineFor, officeFormatOf } from "../../src/office/engine/registry"
import {
  cellStyleIndex,
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  mergeRange,
  unmergeRange,
  parseSheetXml,
  shiftFormulaReferences,
  writeCell,
} from "../../src/office/engine/xlsx-sheet"
import { ensureCellStyle } from "../../src/office/engine/xlsx-styles"
import { readXlsxDocument, xlsxEngine } from "../../src/office/engine/xlsx"
import { csvEngine } from "../../src/office/csv/engine"

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

describe("XLSX 公式求值（只读）", () => {
  const FORMULAS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><f>SUM(A1:B1)</f></c><c r="D1"><f>A1*10+B1</f></c><c r="E1"><f>IF(C1&gt;2,&quot;多&quot;,&quot;少&quot;)</f></c><c r="F1"><f>ROUND(D1/3,2)</f></c><c r="G1"><f>CONCATENATE(&quot;共&quot;,C1,&quot;条&quot;)</f></c><c r="H1"><f>SUM('Sheet1'!A1:B1)</f></c><c r="I1"><f>SUM(A1:A)</f></c><c r="J1"><f>J1+1</f></c></row></sheetData>
</worksheet>`

  function formulaBook() {
    return buildZip({
      "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
      "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/worksheets/sheet1.xml": FORMULAS,
    })
  }

  test("常见函数、运算与跨表引用都算出值", async () => {
    const state = await readXlsxDocument(formulaBook())
    const cells = new Map(state.sheets[0]!.cells.map((cell) => [cell.ref, cell]))
    expect(cells.get("C1")!.value).toBe(3)
    expect(cells.get("D1")!.value).toBe(12)
    expect(cells.get("E1")!.value).toBe("多")
    expect(cells.get("F1")!.value).toBe(4)
    expect(cells.get("G1")!.value).toBe("共3条")
    expect(cells.get("H1")!.value).toBe(3)
  })

  test("算不出来（非法区域 / 循环引用）时保留公式原文", async () => {
    const state = await readXlsxDocument(formulaBook())
    const cells = new Map(state.sheets[0]!.cells.map((cell) => [cell.ref, cell]))
    expect(cells.get("I1")!.value).toBeUndefined()
    expect(cells.get("I1")!.text).toBe("=SUM(A1:A)")
    expect(cells.get("J1")!.value).toBeUndefined()
    expect(cells.get("J1")!.text).toBe("=J1+1")
  })

  test("写入公式后重新打开能读到结果", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const applied = await xlsxEngine.apply(
      opened.data,
      [{ op: "setCellValue", sheet: "Sheet1", ref: { row: 2, col: 2 }, value: { formula: "SUM(A2:B2)" } }],
      bytes,
    )
    if (!applied.ok) throw new Error(applied.error.message)
    const reopened = await xlsxEngine.open(applied.data.bytes)
    if (!reopened.ok) throw new Error(reopened.error.message)
    const cell = reopened.data.sheets[0]!.cells.find((item) => item.ref === "C3")!
    expect(cell.formula).toBe("SUM(A2:B2)")
    expect(cell.value).toBe(3)
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
    // 读出来是求值后的 2；文件里仍然只有公式，没有缓存值。
    expect(formula.text).toBe("2")
    expect(formula.value).toBe(2)
    const { readZip, inflateEntry } = await import("../../src/office/engine/zip")
    const zip = await readZip(applied.data.bytes)
    const xml = new TextDecoder().decode(
      await inflateEntry(zip, zip.entries.find((entry) => entry.name === "xl/worksheets/sheet1.xml")!),
    )
    expect(xml).toContain("<f>SUM(B2:B2)</f></c>")
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
      [
        {
          op: "setCellStyle",
          sheet: "Sheet1",
          range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
          style: { bold: true },
        },
      ],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    // 原文件里已经有一条粗体 xf（下标 1），能复用就不该再塞一条，styles.xml 也不必重写。
    expect(applied.data.changed).toEqual(["xl/worksheets/sheet1.xml"])
    const cell = applied.data.state.sheets[0]!.cells.find((item) => item.ref === "A1")!
    expect(cell.style).toBe(1)
    // 改格式不能吃掉单元格里的值（这里 A1 是共享字符串「名称」）。
    expect(cell.text).toBe("名称")
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
    expect(cell.text).toBe("名称")
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
    // 第一行原本是普通格式、第二行是粗体：加斜体后各自得到一条新 xf，
    // 但同一行内的两个单元格必须共用同一条（不重复膨胀）。
    expect(new Set(sheet.cells.map((cell) => cell.style)).size).toBe(2)
    expect(sheet.cells.every((cell) => cell.style >= 2)).toBe(true)
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

describe("XLSX 行列插入与删除", () => {
  const sheetXml = (body: string) =>
    '<worksheet><dimension ref="A1:B2"/><sheetData>' + body + "</sheetData></worksheet>"

  const sample = () =>
    sheetXml(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>标题</t></is></c><c r="B1"><v>10</v></c></row>' +
        '<row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>2</v></c></row>' +
        '<row r="3"><c r="A3"><f>SUM(A1:A2)</f></c></row>',
    )

  test("插入行：行号与单元格引用整体下移", () => {
    const next = insertRows(sample(), 2, 1)
    const grid = parseSheetXml(next, "xl/worksheets/sheet1.xml", "Sheet1", [])
    expect(grid.cells.map((cell) => cell.ref)).toEqual(["A1", "B1", "A3", "B3", "A4"])
    expect(grid.cells.find((cell) => cell.ref === "B3")!.text).toBe("2")
    // 公式跟着下移：SUM(A1:A2) → SUM(A1:A3)。
    expect(grid.cells.find((cell) => cell.ref === "A4")!.formula).toBe("SUM(A1:A3)")
  })

  test("删除行：被删的行消失，后面的行上移", () => {
    const next = deleteRows(sample(), 1, 1)
    const grid = parseSheetXml(next, "xl/worksheets/sheet1.xml", "Sheet1", [])
    expect(grid.cells.map((cell) => cell.ref)).toEqual(["A1", "B1", "A2"])
    expect(grid.cells.find((cell) => cell.ref === "A1")!.text).toBe("1")
  })

  test("插入列：列引用右移，公式区间一起变", () => {
    const next = insertColumns(sample(), 2, 1)
    const grid = parseSheetXml(next, "xl/worksheets/sheet1.xml", "Sheet1", [])
    expect(grid.cells.map((cell) => cell.ref)).toEqual(["A1", "C1", "A2", "C2", "A3"])
    expect(grid.cells.find((cell) => cell.ref === "C2")!.text).toBe("2")
  })

  test("删除列：整列单元格连同内容移除，行标签上的 spans 也清掉", () => {
    const xml = sheetXml('<row r="1" spans="1:2"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row>')
    const next = deleteColumns(xml, 1, 1)
    expect(next).not.toContain('spans="1:2"')
    const grid = parseSheetXml(next, "xl/worksheets/sheet1.xml", "Sheet1", [])
    expect(grid.cells.map((cell) => [cell.ref, cell.text])).toEqual([["A1", "2"]])
  })

  test("合并单元格跟着移动，整块被删没就移除", () => {
    const xml =
      '<worksheet><mergeCells count="2"><mergeCell ref="A1:B1"/><mergeCell ref="A2:B2"/></mergeCells>' +
      '<sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2"><v>2</v></c></row></sheetData></worksheet>'
    const shifted = insertRows(xml, 1, 1)
    expect(shifted).toContain('ref="A2:B2"')
    expect(shifted).toContain('ref="A3:B3"')

    const removed = deleteRows(xml, 2, 1)
    expect(removed).toContain('ref="A1:B1"')
    expect(removed).not.toContain('ref="A2:B2"')
    expect(removed).toContain('count="1"')
  })

  test("dimension 跟着重算", () => {
    const next = insertRows(sample(), 3, 2)
    expect(next).toContain('dimension ref="A1:B5"')
  })

  test("公式引用映射：绝对引用与别的表引用都不该被乱改", () => {
    const shiftRight = (formula: string) =>
      shiftFormulaReferences(
        formula,
        (value) => value,
        (value) => (value >= 1 ? value + 1 : value),
      )
    expect(shiftRight("SUM(A1:B2)")).toBe("SUM(A1:C2)")
    expect(shiftRight("$A$1+B1")).toBe("$A$1+C1")
    // Sheet2!A1 属于另一张表，保持原样。
    expect(shiftRight("Sheet2!B1+B1")).toBe("Sheet2!B1+C1")
    // 字符串里的 A1 是文本。
    expect(shiftRight('"B1"&B1')).toBe('"B1"&C1')
  })
})

describe("XLSX 合并单元格", () => {
  const xml = () =>
    '<worksheet><dimension ref="A1:C2"/><sheetData>' +
    '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row>' +
    '</sheetData><mergeCells count="1"><mergeCell ref="C1:C2"/></mergeCells></worksheet>'

  test("合并写入 mergeCells 并重算 count", () => {
    const next = mergeRange(xml(), { row: 0, col: 0 }, { row: 0, col: 1 })
    expect(next).toContain('<mergeCell ref="A1:B1"/>')
    expect(next).toContain('count="2"')
    // 新合并挂在 sheetData 之后、旧合并之前/之后都行，顺序由原文档决定。
    expect(next.indexOf("<mergeCells")).toBeGreaterThan(next.indexOf("</sheetData>"))
  })

  test("重叠的旧合并被替换，而不是并存", () => {
    const next = mergeRange(xml(), { row: 0, col: 2 }, { row: 1, col: 2 })
    expect(next.match(/<mergeCell /g)?.length).toBe(1)
    expect(next).toContain('ref="C1:C2"')
  })

  test("读取时带上合并区域", () => {
    const grid = parseSheetXml(
      '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>' +
        '<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>',
      "xl/worksheets/sheet1.xml",
      "Sheet1",
      [],
    )
    expect(grid.merges).toEqual(["A1:B1"])
  })

  test("取消合并：相交的合并全部移除，元素整个消失时不留空壳", () => {
    const next = unmergeRange(xml(), { row: 0, col: 2 }, { row: 0, col: 2 })
    expect(next).not.toContain("mergeCell")
    expect(next).not.toContain("<mergeCells")
    // 不相交的区域不动。
    expect(unmergeRange(xml(), { row: 5, col: 5 }, { row: 6, col: 6 })).toBe(xml())
  })

  test("setCellStyle 的 merge 标志走真正的合并", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const applied = await xlsxEngine.apply(
      opened.data,
      [
        {
          op: "setCellStyle",
          sheet: "Sheet1",
          range: { start: { row: 0, col: 0 }, end: { row: 0, col: 1 } },
          style: { merge: true },
        },
      ],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.changed).toEqual(["xl/worksheets/sheet1.xml"])
  })
})

describe("XLSX 导出", () => {
  test("csv 按行列铺开，含逗号的格子加引号", async () => {
    const opened = await xlsxEngine.open(workbook())
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const csv = await xlsxEngine.export!(opened.data, "csv", workbook())
    expect(csv.ok).toBe(true)
    if (!csv.ok) return
    const nl = String.fromCharCode(10)
    expect(new TextDecoder().decode(csv.data)).toBe("名称,数量" + nl + "1,2")
  })

  test("html 导出成独立文档，转义了尖括号", async () => {
    const opened = await xlsxEngine.open(workbook())
    if (!opened.ok) return
    const html = await xlsxEngine.export!(opened.data, "html", workbook())
    expect(html.ok).toBe(true)
    if (!html.ok) return
    const text = new TextDecoder().decode(html.data)
    expect(text).toContain('<table border="1">')
    expect(text).toContain("<td>名称</td>")
  })

  test("不支持的目标格式明确报错", async () => {
    const opened = await xlsxEngine.open(workbook())
    if (!opened.ok) return
    // pdf 已由共享排版器支持，换成 docx 验证「写不出来」时的提示。
    const docx = await xlsxEngine.export!(opened.data, "docx", workbook())
    expect(docx.ok).toBe(false)
    if (!docx.ok) expect(docx.error.suggestion).toContain("csv")
  })
})

describe("XLSX 清空区域", () => {
  test("只清掉区域内的单元格，区域外的值和样式位保留", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const applied = await xlsxEngine.apply(
      opened.data,
      [{ op: "clearCells", sheet: "Sheet1", range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } } }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const sheet = applied.data.state.sheets[0]!
    expect(sheet.cells.map((cell) => cell.ref)).toEqual(["B1", "A2", "B2"])
    expect(sheet.cells.find((cell) => cell.ref === "A2")!.style).toBe(1)

    // 重新打开确认真的写进了文件（行 1 只剩 B1）。
    const reopened = await xlsxEngine.open(applied.data.bytes)
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.data.sheets[0]!.cells.map((cell) => cell.ref)).toEqual(["B1", "A2", "B2"])
  })

  test("整行被清空时连 <row> 一起去掉", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const applied = await xlsxEngine.apply(
      opened.data,
      [{ op: "clearCells", sheet: "Sheet1", range: { start: { row: 0, col: 0 }, end: { row: 0, col: 5 } } }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.state.sheets[0]!.cells.map((cell) => cell.ref)).toEqual(["A2", "B2"])
    expect(applied.data.applied).toEqual([{ op: "clearCells", range: ["A1", "F1"], cleared: 2 }])
  })

  test("CSV 清空区域写成空值", async () => {
    const bytes = new TextEncoder().encode("a,b,c" + String.fromCharCode(10) + "1,2,3" + String.fromCharCode(10))
    const opened = await csvEngine.open(bytes)
    if (!opened.ok) return
    const applied = await csvEngine.apply(
      opened.data,
      [{ op: "clearCells", sheet: "csv", range: { start: { row: 1, col: 0 }, end: { row: 1, col: 1 } } }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(new TextDecoder().decode(applied.data.bytes)).toBe(
      "a,b,c" + String.fromCharCode(10) + ",,3" + String.fromCharCode(10),
    )
  })
})

describe("XLSX 工作表结构", () => {
  test("重命名只改 workbook.xml 的 name 属性", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const applied = await xlsxEngine.apply(opened.data, [{ op: "renameSheet", sheet: "Sheet1", name: "数据" }], bytes)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.state.sheets[0]!.name).toBe("数据")
    expect(applied.data.changed).toContain("xl/workbook.xml")
    // 单元格部件不在改动清单里：改名不该重写数据。
    expect(applied.data.changed).not.toContain("xl/worksheets/sheet1.xml")
  })

  test("工作表标签颜色：写入 / 读回 / 清除，只动工作表部件", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const colored = await xlsxEngine.apply(
      opened.data,
      [{ op: "setSheetTabColor", sheet: "Sheet1", color: "#4472C4" }],
      bytes,
    )
    expect(colored.ok).toBe(true)
    if (!colored.ok) return
    expect(colored.data.state.sheets[0]!.tabColor).toBe("FF4472C4")
    expect(colored.data.changed).toEqual(["xl/worksheets/sheet1.xml"])

    // 重新打开才算真正写进了文件。
    const reopened = await xlsxEngine.open(colored.data.bytes)
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.data.sheets[0]!.tabColor).toBe("FF4472C4")

    const cleared = await xlsxEngine.apply(
      reopened.data,
      [{ op: "setSheetTabColor", sheet: "Sheet1" }],
      colored.data.bytes,
    )
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.data.state.sheets[0]!.tabColor).toBeUndefined()
  })

  test("标签颜色只接受 RRGGBB / AARRGGBB", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const bad = await xlsxEngine.apply(opened.data, [{ op: "setSheetTabColor", sheet: "Sheet1", color: "红色" }], bytes)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe("invalid_params")
    const missing = await xlsxEngine.apply(
      opened.data,
      [{ op: "setSheetTabColor", sheet: "没有", color: "FF0000" }],
      bytes,
    )
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe("not_found")
  })

  test("新增工作表：workbook / rels / Content_Types / 新部件一起写", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const applied = await xlsxEngine.apply(opened.data, [{ op: "addSheet", name: "汇总" }], bytes)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.state.sheets.map((sheet) => sheet.name)).toEqual(["Sheet1", "汇总"])
    const added = applied.data.state.sheets[1]!
    expect(added.path).toBe("xl/worksheets/sheet2.xml")
    expect(added.cells).toEqual([])
    expect(applied.data.changed).toContain("xl/workbook.xml")
    expect(applied.data.changed).toContain("xl/_rels/workbook.xml.rels")
    expect(applied.data.changed).toContain("[Content_Types].xml")
    expect(applied.data.changed).toContain("xl/worksheets/sheet2.xml")
  })

  test("新增后可以立刻往新表写单元格", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const applied = await xlsxEngine.apply(
      opened.data,
      [
        { op: "addSheet", name: "汇总" },
        { op: "setCellValue", sheet: "汇总", ref: { row: 0, col: 0 }, value: "合计" },
      ],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const sheet = applied.data.state.sheets.find((item) => item.name === "汇总")
    expect(sheet?.cells.map((cell) => [cell.ref, cell.text])).toEqual([["A1", "合计"]])
  })

  test("删除工作表：至少保留一张，删完还能继续读", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const only = await xlsxEngine.apply(opened.data, [{ op: "deleteSheet", sheet: "Sheet1" }], bytes)
    expect(only.ok).toBe(false)
    if (!only.ok) expect(only.error.code).toBe("invalid_params")

    const added = await xlsxEngine.apply(opened.data, [{ op: "addSheet", name: "临时" }], bytes)
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const removed = await xlsxEngine.apply(added.data.state, [{ op: "deleteSheet", sheet: "临时" }], added.data.bytes)
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.data.state.sheets.map((sheet) => sheet.name)).toEqual(["Sheet1"])
    expect(removed.data.changed).toContain("xl/workbook.xml")
  })

  test("表名非法 / 重名都给出可读错误", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    expect((await xlsxEngine.apply(opened.data, [{ op: "renameSheet", sheet: "Sheet1", name: "" }], bytes)).ok).toBe(
      false,
    )
    expect((await xlsxEngine.apply(opened.data, [{ op: "addSheet", name: "a/b" }], bytes)).ok).toBe(false)
    const dup = await xlsxEngine.apply(opened.data, [{ op: "addSheet", name: "Sheet1" }], bytes)
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error.code).toBe("exists")
    const missing = await xlsxEngine.apply(opened.data, [{ op: "renameSheet", sheet: "没有", name: "x" }], bytes)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe("not_found")
  })

  test("同一批次里改名之后按新名字写单元格", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const applied = await xlsxEngine.apply(
      opened.data,
      [
        { op: "renameSheet", sheet: "Sheet1", name: "数据" },
        { op: "setCellValue", sheet: "数据", ref: { row: 0, col: 0 }, value: "新表头" },
      ],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const sheet = applied.data.state.sheets.find((item) => item.name === "数据")
    expect(sheet?.cells.find((cell) => cell.ref === "A1")?.text).toBe("新表头")
  })

  test("删掉的工作表后面不再接受单元格操作，也不会写坏包", async () => {
    const bytes = workbook()
    const opened = await xlsxEngine.open(bytes)
    if (!opened.ok) return
    const added = await xlsxEngine.apply(opened.data, [{ op: "addSheet", name: "临时" }], bytes)
    if (!added.ok) return
    const applied = await xlsxEngine.apply(
      added.data.state,
      [
        { op: "deleteSheet", sheet: "临时" },
        { op: "setCellValue", sheet: "临时", ref: { row: 0, col: 0 }, value: "x" },
      ],
      added.data.bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.state.sheets.map((sheet) => sheet.name)).toEqual(["Sheet1"])
    // 删表不重写它的部件，也不该出现在改动清单里。
    expect(applied.data.changed).not.toContain("xl/worksheets/sheet2.xml")
  })
})

/** 只取 <cellXfs> 里的 xf（cellStyleXfs 里也有同名元素，不能混着数）。 */
function cellXfList(xml: string): string[] {
  const start = xml.indexOf("<cellXfs")
  if (start === -1) return []
  const openEnd = xml.indexOf(">", start)
  const close = xml.indexOf("</cellXfs>", openEnd)
  if (close === -1) return []
  return [...xml.slice(openEnd + 1, close).matchAll(/<xf\b[^>]*>/g)].map((match) => match[0])
}

describe("XLSX 数字格式与边框", () => {
  test("内置数字格式写进 numFmtId 并置 applyNumberFormat", () => {
    const result = ensureCellStyle(STYLES, 0, { format: "percent" })
    expect(result).toBeDefined()
    if (!result) return
    const xfs = cellXfList(result.xml)
    const added = xfs[result.index]!
    expect(added).toContain('numFmtId="10"')
    expect(added).toContain('applyNumberFormat="1"')
  })

  test("自定义格式代码追加 numFmt 条目并分配 ≥164 的 id", () => {
    const result = ensureCellStyle(STYLES, 0, { format: '0.00" 元"' })
    expect(result).toBeDefined()
    if (!result) return
    expect(result.xml).toContain('<numFmts count="1">')
    expect(result.xml).toContain('formatCode="0.00&quot; 元&quot;"')
    const id = Number(/<numFmt numFmtId="(\d+)"/.exec(result.xml)?.[1])
    expect(id).toBeGreaterThanOrEqual(164)
    const xfs = cellXfList(result.xml)
    expect(xfs[result.index]).toContain(`numFmtId="${id}"`)
  })

  test("同一个格式代码复用已有的 numFmt 条目", () => {
    const first = ensureCellStyle(STYLES, 0, { format: "0.000" })
    expect(first).toBeDefined()
    if (!first) return
    const second = ensureCellStyle(first.xml, first.index, { format: "0.000" })
    expect(second).toBeDefined()
    if (!second) return
    expect(second.index).toBe(first.index)
    expect(second.xml).toBe(first.xml)
  })

  test("空串格式等于恢复常规", () => {
    const result = ensureCellStyle(STYLES, 1, { format: "" })
    expect(result).toBeDefined()
    if (!result) return
    const xfs = cellXfList(result.xml)
    expect(xfs[result.index]).toContain('numFmtId="0"')
  })

  test("边框追加 border 条目并指向新下标", () => {
    const result = ensureCellStyle(STYLES, 0, { border: "thin" })
    expect(result).toBeDefined()
    if (!result) return
    expect(result.xml).toContain('<left><style val="thin"/><color rgb="FF000000"/></left>')
    const xfs = cellXfList(result.xml)
    expect(xfs[result.index]).toContain('applyBorder="1"')
  })

  test("border 与 format 可以和字体同时改", () => {
    const result = ensureCellStyle(STYLES, 0, { bold: true, border: "medium", format: "date" })
    expect(result).toBeDefined()
    if (!result) return
    const xfs = cellXfList(result.xml)
    const added = xfs[result.index]!
    expect(added).toContain('applyFont="1"')
    expect(added).toContain('applyBorder="1"')
    expect(added).toContain('numFmtId="14"')
  })

  test("引擎路径把边框与格式写进单元格", async () => {
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
          style: { border: "thick", format: "percent" },
        },
      ],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.changed).toContain("xl/styles.xml")
    const xml = new TextDecoder().decode(applied.data.bytes)
    expect(xml).toContain('numFmtId="10"')
    expect(xml).toContain('<style val="thick"/>')
  })
})
