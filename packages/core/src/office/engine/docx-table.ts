/**
 * DOCX 表格的结构编辑：插/删行列、改单元格文字。
 *
 * 和正文一样只做文本级手术：找到 `<w:tbl>` → `<w:tr>` → `<w:tc>` 的真实区间，
 * 复制现有行的 `<w:trPr>` / 单元格的 `<w:tcPr>` 作为模板，再把文字换成新的。
 * 这样新行新列会继承原表格的边框、底纹、列宽，而不是生成一张「裸」表格。
 */
import { fail, ok, type OfficeResult } from "./contract"
import { rewriteParagraphText } from "./docx"
import { findAll, findElement } from "./xml"

export type DocxTableOp =
  | { op: "deleteTable"; table: number }
  | { op: "insertTableRow"; table: number; at: number; count?: number }
  | { op: "deleteTableRow"; table: number; at: number; count?: number }
  | { op: "insertTableColumn"; table: number; at: number; count?: number }
  | { op: "deleteTableColumn"; table: number; at: number; count?: number }
  | { op: "setTableCellText"; table: number; row: number; col: number; text: string }

type Span = { start: number; end: number; openEnd: number }

function tableAt(xml: string, table: number): Span | undefined {
  return findAll(xml, "w:tbl")[table - 1]
}

/** 单元格去掉内容，保留 `<w:tcPr>`，再放一个空段落。 */
function blankCell(cell: string): string {
  if (cell.endsWith("/>")) {
    const open = cell.replace(/\/>$/, ">")
    return open + "<w:p><w:r><w:t></w:t></w:r></w:p></w:tc>"
  }
  const openEnd = cell.indexOf(">") + 1
  const close = cell.length - "</w:tc>".length
  const inner = cell.slice(openEnd, close)
  const props = findElement(inner, "w:tcPr")
  return (
    cell.slice(0, openEnd) +
    (props ? inner.slice(props.start, props.end) : "") +
    "<w:p><w:r><w:t></w:t></w:r></w:p></w:tc>"
  )
}

/** 复制一行，把每个单元格清空；`w:trPr` 和列宽都留着。 */
function blankRow(row: string): string {
  const cells = findAll(row, "w:tc")
  let out = row
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const cell = cells[index]!
    out = out.slice(0, cell.start) + blankCell(row.slice(cell.start, cell.end)) + out.slice(cell.end)
  }
  return out
}

function countOf(value: number | undefined): number {
  return Math.max(1, Math.min(50, Math.round(value ?? 1)))
}

export function editDocxTable(xml: string, op: DocxTableOp): OfficeResult<string> {
  const tableSpan = tableAt(xml, op.table)
  if (!tableSpan) {
    return fail("not_found", `没有第 ${op.table} 张表格`, "用 view 看一下 /body/table[N] 的序号，表格从 1 开始")
  }
  const table = xml.slice(tableSpan.start, tableSpan.end)

  if (op.op === "deleteTable") {
    // 整张表删掉：连它里面的段落一起消失，后面的表格序号前移。
    return ok(xml.slice(0, tableSpan.start) + xml.slice(tableSpan.end))
  }

  if (op.op === "insertTableRow") {
    const rows = findAll(table, "w:tr")
    const count = countOf(op.count)
    if (op.at < 1 || op.at > rows.length + 1) {
      return fail("not_found", `表格只有 ${rows.length} 行，插不到第 ${op.at} 行`, `at 取 1 到 ${rows.length + 1}`)
    }
    const template = rows[Math.min(op.at, rows.length) - 1]
    const rowXml = template
      ? blankRow(table.slice(template.start, template.end))
      : "<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t></w:t></w:r></w:p></w:tc></w:tr>"
    const anchor = op.at <= rows.length ? rows[op.at - 1]!.start : rows[rows.length - 1]!.end
    const next = table.slice(0, anchor) + rowXml.repeat(count) + table.slice(anchor)
    return ok(xml.slice(0, tableSpan.start) + next + xml.slice(tableSpan.end))
  }

  if (op.op === "deleteTableRow") {
    const rows = findAll(table, "w:tr")
    const count = Math.min(countOf(op.count), rows.length)
    if (op.at < 1 || op.at > rows.length) {
      return fail("not_found", `表格没有第 ${op.at} 行`, `at 取 1 到 ${rows.length}`)
    }
    if (rows.length - count < 1) {
      return fail(
        "invalid_params",
        "表格至少要保留一行",
        "整张表不要了可以用 deleteParagraph 删表格段落，或直接改单元格",
      )
    }
    const first = rows[op.at - 1]!
    const last = rows[Math.min(op.at - 1 + count, rows.length) - 1]!
    const next = table.slice(0, first.start) + table.slice(last.end)
    return ok(xml.slice(0, tableSpan.start) + next + xml.slice(tableSpan.end))
  }

  if (op.op === "insertTableColumn") {
    const rows = findAll(table, "w:tr")
    const count = countOf(op.count)
    let out = table
    // 从后往前改，前面行的偏移量才不会失效。
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const rowSpan = rows[index]!
      const row = out.slice(rowSpan.start, rowSpan.end)
      const cells = findAll(row, "w:tc")
      if (cells.length === 0) continue
      if (op.at < 1 || op.at > cells.length + 1) continue
      const template = cells[Math.min(op.at, cells.length) - 1]!
      const cellXml = blankCell(row.slice(template.start, template.end)).repeat(count)
      const anchor = op.at <= cells.length ? cells[op.at - 1]!.start : cells[cells.length - 1]!.end
      const nextRow = row.slice(0, anchor) + cellXml + row.slice(anchor)
      out = out.slice(0, rowSpan.start) + nextRow + out.slice(rowSpan.end)
    }
    return ok(xml.slice(0, tableSpan.start) + out + xml.slice(tableSpan.end))
  }

  if (op.op === "deleteTableColumn") {
    const rows = findAll(table, "w:tr")
    let out = table
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const rowSpan = rows[index]!
      const row = out.slice(rowSpan.start, rowSpan.end)
      const cells = findAll(row, "w:tc")
      const cell = cells[op.at - 1]
      if (!cell) continue
      if (cells.length <= 1) continue
      const nextRow = row.slice(0, cell.start) + row.slice(cell.end)
      out = out.slice(0, rowSpan.start) + nextRow + out.slice(rowSpan.end)
    }
    return ok(xml.slice(0, tableSpan.start) + out + xml.slice(tableSpan.end))
  }

  // setTableCellText
  const row = findAll(table, "w:tr")[op.row - 1]
  if (!row) return fail("not_found", `表格没有第 ${op.row} 行`, "row 从 1 开始")
  const rowXml = table.slice(row.start, row.end)
  const cell = findAll(rowXml, "w:tc")[op.col - 1]
  if (!cell) return fail("not_found", `这一行没有第 ${op.col} 列`, "col 从 1 开始")
  const cellXml = rowXml.slice(cell.start, cell.end)
  const paragraph = findElement(cellXml, "w:p")
  let nextCell: string
  if (paragraph) {
    const body = cellXml.slice(paragraph.openEnd + 1, paragraph.end - "</w:p>".length)
    nextCell =
      cellXml.slice(0, paragraph.openEnd + 1) +
      rewriteParagraphText(body, op.text) +
      cellXml.slice(paragraph.end - "</w:p>".length)
  } else if (cellXml.endsWith("/>")) {
    nextCell = cellXml.slice(0, -2) + "><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>"
  } else {
    const closeAt = cellXml.lastIndexOf("</w:tc>")
    nextCell = cellXml.slice(0, closeAt) + "<w:p><w:r><w:t></w:t></w:r></w:p>" + cellXml.slice(closeAt)
  }
  const nextRow = rowXml.slice(0, cell.start) + nextCell + rowXml.slice(cell.end)
  const nextTable = table.slice(0, row.start) + nextRow + table.slice(row.end)
  return ok(xml.slice(0, tableSpan.start) + nextTable + xml.slice(tableSpan.end))
}
