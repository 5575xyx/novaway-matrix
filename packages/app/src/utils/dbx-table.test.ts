import { describe, expect, test } from "bun:test"
import { columnRanges, firstColumn, parseDbxTable } from "./dbx-table"

/** 与 dbx 的 mdTable 完全一致：按列宽 padEnd 再用 " | " join。 */
function mdTable(headers: string[], rows: string[][]) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] || "").length), 3))
  const header = `| ${headers.map((h, i) => h.padEnd(widths[i])).join(" | ")} |`
  const sep = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`
  const body = rows.map((row) => `| ${row.map((cell, i) => (cell || "").padEnd(widths[i])).join(" | ")} |`).join("\n")
  return body ? `${header}\n${sep}\n${body}` : `${header}\n${sep}`
}

describe("dbx table parsing", () => {
  test("parses a plain table", () => {
    const text =
      mdTable(
        ["Name", "Type"],
        [
          ["local", "mysql"],
          ["prod", "postgres"],
        ],
      ) + "\n\n2 row(s)"
    const table = parseDbxTable(text)
    expect(table.headers).toEqual(["Name", "Type"])
    expect(table.rows).toEqual([
      ["local", "mysql"],
      ["prod", "postgres"],
    ])
    expect(table.issues).toBe(0)
  })

  test("keeps cells that contain a pipe character", () => {
    // dbx 不转义 |，旧实现 split("|") 会多切出一列。
    const text = mdTable(["expr", "note"], [["a|b", "ok"]])
    const table = parseDbxTable(text)
    expect(table.rows[0]).toEqual(["a|b", "ok"])
  })

  test("keeps empty cells", () => {
    const text = mdTable(["a", "b", "c"], [["1", "", "3"]])
    expect(parseDbxTable(text).rows[0]).toEqual(["1", "", "3"])
  })

  test("ignores dbx noise lines", () => {
    const text = mdTable(["t"], [["users"]]) + "\n\n1 row(s)"
    expect(parseDbxTable(text).rows).toHaveLength(1)
  })

  test("parses multi-statement output with Statement prefixes", () => {
    const text = mdTable(["a"], [["1"]]) + "\n\n1 row(s)\n\nStatement 2\n" + mdTable(["a"], [["2"]]) + "\n\n1 row(s)"
    const table = parseDbxTable(text)
    expect(table.headers).toEqual(["a"])
    expect(table.rows).toEqual([["1"], ["2"]])
  })

  test("joins wrapped lines back into the last cell", () => {
    // 单元格含换行时，dbx 会把后半段拆到独立一行且没有前导 |。
    const broken = "| col      |\n| -------- |\n| line one |\nline two"
    const table = parseDbxTable(broken)
    expect(table.rows[0][0]).toContain("line one")
    expect(table.rows[0][0]).toContain("line two")
    expect(table.issues).toBeGreaterThan(0)
  })

  test("returns empty for non-table text", () => {
    expect(parseDbxTable("Query executed. 3 row(s) affected.")).toEqual({ headers: [], rows: [], issues: 0 })
  })

  test("computes column ranges from the separator", () => {
    expect(columnRanges("| --- | ----- |")).toEqual([
      [2, 5],
      [8, 13],
    ])
  })

  test("firstColumn extracts names", () => {
    const text = mdTable(
      ["Table", "Type"],
      [
        ["users", "BASE TABLE"],
        ["orders", "BASE TABLE"],
      ],
    )
    expect(firstColumn(text)).toEqual(["users", "orders"])
  })
})
