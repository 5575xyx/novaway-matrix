import { describe, expect, test } from "bun:test"
import JSZip from "jszip"
import {
  columnName,
  excelSerialToDate,
  formatExcelDate,
  formatExcelNumber,
  groupThousands,
  hasTimePart,
  isDateFormatCode,
  parseCellRef,
  parseSheet,
  parseStyles,
  parseWorkbook,
  usesDate1904,
  xlsxToText,
} from "@/knowledge/xlsx"

const STYLES = [
  '<?xml version="1.0"?>',
  "<styleSheet>",
  '<numFmts count="2">',
  '  <numFmt numFmtId="164" formatCode="yyyy&quot;年&quot;m&quot;月&quot;d&quot;日&quot;"/>',
  '  <numFmt numFmtId="165" formatCode="#,##0.00"/>',
  "</numFmts>",
  '<cellXfs count="5">',
  '  <xf numFmtId="0"/>',
  '  <xf numFmtId="14"/>',
  '  <xf numFmtId="164"/>',
  '  <xf numFmtId="10"/>',
  '  <xf numFmtId="165"/>',
  "</cellXfs>",
  "</styleSheet>",
].join("\n")

const sheetXml = (body: string) => '<?xml version="1.0"?><worksheet><sheetData>' + body + "</sheetData></worksheet>"

describe("xlsx refs", () => {
  test("parses A1 refs into zero-based coordinates", () => {
    expect(parseCellRef("A1")).toEqual({ column: 0, row: 0 })
    expect(parseCellRef("B3")).toEqual({ column: 1, row: 2 })
    expect(parseCellRef("AA10")).toEqual({ column: 26, row: 9 })
    expect(parseCellRef("nope")).toBeUndefined()
  })

  test("converts column indexes back to letters", () => {
    expect(columnName(0)).toBe("A")
    expect(columnName(25)).toBe("Z")
    expect(columnName(26)).toBe("AA")
    expect(columnName(27)).toBe("AB")
  })
})

describe("xlsx number formats", () => {
  test("recognises date formats and ignores quoted literals", () => {
    expect(isDateFormatCode("yyyy-mm-dd")).toBe(true)
    expect(isDateFormatCode('yyyy"年"m"月"d"日"')).toBe(true)
    expect(isDateFormatCode("h:mm")).toBe(true)
    expect(isDateFormatCode("0.00")).toBe(false)
    expect(isDateFormatCode('"第"0"项"')).toBe(false)
    expect(isDateFormatCode("m")).toBe(false)
  })

  test("detects time components", () => {
    expect(hasTimePart("yyyy-mm-dd h:mm")).toBe(true)
    expect(hasTimePart("yyyy-mm-dd")).toBe(false)
    expect(hasTimePart("[h]:mm:ss")).toBe(true)
  })

  test("converts Excel serial numbers to dates", () => {
    expect(excelSerialToDate(45123).toISOString().slice(0, 10)).toBe("2023-07-16")
    expect(formatExcelDate(45123, "yyyy-mm-dd")).toBe("2023-07-16")
    expect(formatExcelDate(0.5, "h:mm")).toBe("12:00")
    expect(formatExcelDate(45123.5, "yyyy-mm-dd h:mm")).toBe("2023-07-16 12:00")
  })

  test("honours the 1904 date system", () => {
    expect(formatExcelDate(1000, "yyyy-mm-dd", false)).not.toBe(formatExcelDate(1000, "yyyy-mm-dd", true))
  })

  test("formats percentages, thousands and decimals", () => {
    expect(formatExcelNumber("0.152", "0%")).toBe("15%")
    expect(formatExcelNumber("0.1523", "0.00%")).toBe("15.23%")
    expect(formatExcelNumber("1234.5", "#,##0.00")).toBe("1,234.50")
    expect(formatExcelNumber("1234567", "#,##0")).toBe("1,234,567")
    expect(formatExcelNumber("12.345", "0.00")).toBe("12.35")
  })

  test("groups thousands including negatives", () => {
    expect(groupThousands("1234567")).toBe("1,234,567")
    expect(groupThousands("-1234567.89")).toBe("-1,234,567.89")
    expect(groupThousands("123")).toBe("123")
  })

  test("strips floating point noise without a format", () => {
    expect(formatExcelNumber("0.30000000000000004", undefined)).toBe("0.3")
    expect(formatExcelNumber("42", undefined)).toBe("42")
  })
})

describe("xlsx styles", () => {
  test("maps cellXfs indexes to format codes", () => {
    const styles = parseStyles(STYLES)
    expect(styles.formats[0]).toBeUndefined()
    expect(styles.formats[1]).toBe("yyyy-mm-dd")
    expect(styles.formats[2]).toContain("年")
    expect(styles.formats[3]).toBe("0.00%")
    expect(styles.formats[4]).toBe("#,##0.00")
  })

  test("tolerates missing styles", () => {
    expect(parseStyles(undefined).formats).toEqual([])
  })
})

describe("xlsx sheet parsing", () => {
  test("formats date cells using the cell style", () => {
    const xml = sheetXml(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>45123</v></c></row>',
    )
    const data = parseSheet({ xml, name: "预算", shared: ["名称", "日期", "服务器"], styles: parseStyles(STYLES) })
    expect(data.rows[0]).toEqual(["名称", "日期"])
    expect(data.rows[1]).toEqual(["服务器", "2023-07-16"])
  })

  test("keeps column positions for sparse rows", () => {
    const xml = sheetXml(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="C1" t="inlineStr"><is><t>c</t></is></c></row>',
    )
    const data = parseSheet({ xml, name: "S", shared: [], styles: parseStyles(undefined) })
    expect(data.rows[0]).toEqual(["a", "", "c"])
  })

  test("fills merged regions with the top-left value", () => {
    const xml =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>季度</t></is></c></row>' +
      '<row r="2"><c r="B2" t="inlineStr"><is><t>Q1</t></is></c></row>' +
      '</sheetData><mergeCells count="1"><mergeCell ref="A1:A2"/></mergeCells></worksheet>'
    const data = parseSheet({ xml, name: "S", shared: [], styles: parseStyles(undefined) })
    expect(data.rows[0][0]).toBe("季度")
    expect(data.rows[1][0]).toBe("季度")
    expect(data.rows[1][1]).toBe("Q1")
  })

  test("renders booleans and errors", () => {
    const xml = sheetXml(
      '<row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c><c r="C1" t="e"><v>#DIV/0!</v></c></row>',
    )
    const data = parseSheet({ xml, name: "S", shared: [], styles: parseStyles(undefined) })
    expect(data.rows[0]).toEqual(["TRUE", "FALSE", "#DIV/0!"])
  })

  test("drops fully empty rows", () => {
    const xml = sheetXml(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row>' +
        '<row r="2"/>' +
        '<row r="3"><c r="A3" t="inlineStr"><is><t>y</t></is></c></row>',
    )
    const data = parseSheet({ xml, name: "S", shared: [], styles: parseStyles(undefined) })
    expect(data.rows).toEqual([["x"], ["y"]])
  })
})

describe("xlsx workbook", () => {
  const workbook =
    '<?xml version="1.0"?><workbook><sheets><sheet name="预算表" sheetId="1" r:id="rId1"/></sheets></workbook>'
  const rels =
    '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'

  test("maps sheet names to worksheet files", () => {
    expect(parseWorkbook(workbook, rels)).toEqual([{ name: "预算表", file: "xl/worksheets/sheet1.xml" }])
  })

  test("treats absolute targets correctly", () => {
    const absolute = rels.replace('"worksheets/sheet1.xml"', '"/xl/worksheets/sheet1.xml"')
    expect(parseWorkbook(workbook, absolute)[0].file).toBe("xl/worksheets/sheet1.xml")
  })

  test("detects the 1904 date system", () => {
    expect(usesDate1904('<workbook><workbookPr date1904="1"/></workbook>')).toBe(true)
    expect(usesDate1904("<workbook><workbookPr/></workbook>")).toBe(false)
  })
})

describe("xlsxToText end to end", () => {
  test("uses real sheet names and formats dates", async () => {
    const zip = new JSZip()
    zip.file(
      "xl/workbook.xml",
      '<?xml version="1.0"?><workbook><sheets><sheet name="预算表" sheetId="1" r:id="rId1"/></sheets></workbook>',
    )
    zip.file(
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    )
    zip.file("xl/styles.xml", STYLES)
    zip.file(
      "xl/sharedStrings.xml",
      '<?xml version="1.0"?><sst><si><t>项目</t></si><si><t>金额</t></si><si><t>日期</t></si><si><t>服务器</t></si></sst>',
    )
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<?xml version="1.0"?><worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" s="4"><v>1234.5</v></c><c r="C2" s="1"><v>45123</v></c></row>' +
        "</sheetData></worksheet>",
    )
    const text = await xlsxToText(zip)
    expect(text).toContain("## 预算表")
    expect(text).toContain("项目\t金额\t日期")
    expect(text).toContain("服务器\t1,234.50\t2023-07-16")
  })

  test("falls back to sheetN files when workbook.xml is missing", async () => {
    const zip = new JSZip()
    zip.file("xl/worksheets/sheet1.xml", sheetXml('<row r="1"><c r="A1" t="inlineStr"><is><t>hello</t></is></c></row>'))
    const text = await xlsxToText(zip)
    expect(text).toContain("## Sheet 1")
    expect(text).toContain("hello")
  })
})
