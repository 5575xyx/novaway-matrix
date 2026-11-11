import { describe, expect, test } from "bun:test"
import { csvEngine } from "../../src/office/csv/engine"
import { decodeText, encodeText, type TextFormat } from "../../src/office/text/format"

const formats: TextFormat[] = [
  { encoding: "utf-16le", bom: true, eol: "\r\n" },
  { encoding: "gbk", bom: false, eol: "\r\n" },
]

describe("CSV engine encoding round-trip", () => {
  for (const format of formats) {
    test(`edits and preserves ${format.encoding}, BOM, and CRLF`, async () => {
      const bytes = encodeText("姓名;金额\n张三;12\n", format)
      const opened = await csvEngine.open(bytes)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return

      expect(opened.data.rows.map((row) => row.map((cell) => cell.value))).toEqual([
        ["姓名", "金额"],
        ["张三", "12"],
      ])
      expect(opened.data.delimiter).toBe(";")

      const applied = await csvEngine.apply(
        opened.data,
        [{ op: "setCellValue", sheet: "Sheet1", ref: { row: 1, col: 1 }, value: "新值" }],
        bytes,
      )
      expect(applied.ok).toBe(true)
      if (!applied.ok) return

      const decoded = decodeText(applied.data.bytes)
      expect(decoded.format).toEqual(format)
      expect(decoded.text).toBe("姓名;金额\n张三;新值\n")
    })
  }
})
