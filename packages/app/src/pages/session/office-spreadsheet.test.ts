import { describe, expect, test } from "bun:test"
import JSZip from "jszip"
import { csvFromRows, xlsxFromRows } from "./office-spreadsheet"

describe("office spreadsheet helpers", () => {
  test("escapes CSV values with commas and quotes", () => {
    expect(
      csvFromRows([
        ["产品", "收入"],
        ['"AI" 助手', "1,200"],
      ]),
    ).toBe('产品,收入\r\n"""AI"" 助手","1,200"')
  })

  test("builds a valid xlsx package with worksheet content", async () => {
    const bytes = await xlsxFromRows([
      ["产品", "收入"],
      ["AI", 1200],
    ])
    const zip = await JSZip.loadAsync(bytes)
    expect(zip.file("xl/workbook.xml")).toBeDefined()
    const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string")
    expect(sheet).toContain("<worksheet")
    expect(sheet).toContain("AI")
  })
})
