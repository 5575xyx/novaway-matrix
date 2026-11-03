/**
 * XLSX 引擎：单元格级别的读取与改写。
 *
 * 与 DOCX/PPTX 同一套哲学：**不经过 SheetJS 的 `write` 重排整个工作簿**，
 * 只重写被点中的那张 `xl/worksheets/sheetN.xml`（改格式时再加一个 `xl/styles.xml`）。
 * 条件格式、数据验证、图表锚点、透视表缓存、批注这些我们没解析的结构
 * 因此逐字节保留 —— 用 SheetJS 写回去会把它们全部抹掉。
 *
 * 明确不做公式重算：Excel/WPS 打开时会自己算。写入公式时不落缓存值，
 * 避免旧值和新公式对不上。
 */

import type { ApplyOutcome, OfficeEngine, OfficeOp, OfficeResult } from "./contract"
import { fail, ok } from "./contract"
import { decodeXmlText, findAll, findElement } from "./xml"
import { inflateEntry, readZip, rebuildZip, type ZipArchive } from "./zip"
import { cellStyleIndex, parseSheetXml, writeCell, type XlsxSheetGrid, type XlsxCellValue } from "./xlsx-sheet"
import { ensureCellStyle, type XlsxStylePatch } from "./xlsx-styles"

export type XlsxState = { sheets: XlsxSheetGrid[] }

const WORKBOOK_ENTRY = "xl/workbook.xml"
const WORKBOOK_RELS = "xl/_rels/workbook.xml.rels"
const SHARED_STRINGS = "xl/sharedStrings.xml"
const STYLES_ENTRY = "xl/styles.xml"

type WorkbookSheet = { name: string; rId?: string; sheetId?: string }

function readWorkbook(xml: string): WorkbookSheet[] {
  const sheets: WorkbookSheet[] = []
  const holder = findElement(xml, "sheets")
  if (!holder) return sheets
  const inner = xml.slice(holder.openEnd + 1, holder.end - "</sheets>".length)
  for (const span of findAll(inner, "sheet")) {
    const tag = inner.slice(span.start, span.end)
    const name = /(?:^|\s)name="([^"]*)"/.exec(tag)?.[1]
    if (name === undefined) continue
    sheets.push({
      name: decodeXmlText(name),
      rId: /(?:^|\s)r:id="([^"]*)"/.exec(tag)?.[1],
      sheetId: /(?:^|\s)sheetId="([^"]*)"/.exec(tag)?.[1],
    })
  }
  return sheets
}

function readRels(xml: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const span of findAll(xml, "Relationship")) {
    const tag = xml.slice(span.start, span.end)
    const id = /(?:^|\s)Id="([^"]*)"/.exec(tag)?.[1]
    const target = /(?:^|\s)Target="([^"]*)"/.exec(tag)?.[1]
    if (!id || !target) continue
    map.set(id, target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, ""))
  }
  return map
}

function readSharedStrings(xml: string): string[] {
  const out: string[] = []
  for (const span of findAll(xml, "si")) {
    const inner = xml.slice(span.openEnd + 1, span.end - "</si>".length)
    const texts = findAll(inner, "t").map((item) =>
      decodeXmlText(inner.slice(inner.indexOf(">", item.start) + 1, item.end - "</t>".length)),
    )
    out.push(texts.join(""))
  }
  return out
}

function decodeEntry(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

async function readSheetGrids(zip: ZipArchive): Promise<XlsxState> {
  const entry = zip.entries.find((item) => item.name === WORKBOOK_ENTRY)
  if (!entry) return { sheets: [] }
  const workbook = readWorkbook(decodeEntry(await inflateEntry(zip, entry)))

  const relsEntry = zip.entries.find((item) => item.name === WORKBOOK_RELS)
  const rels = relsEntry ? readRels(decodeEntry(await inflateEntry(zip, relsEntry))) : new Map<string, string>()

  const sharedEntry = zip.entries.find((item) => item.name === SHARED_STRINGS)
  const shared = sharedEntry ? readSharedStrings(decodeEntry(await inflateEntry(zip, sharedEntry))) : []

  const sheets: XlsxSheetGrid[] = []
  for (const [index, sheet] of workbook.entries()) {
    const path = sheet.rId ? rels.get(sheet.rId) : undefined
    const resolved = path ?? `xl/worksheets/sheet${index + 1}.xml`
    const target = zip.entries.find((item) => item.name === resolved)
    if (!target) continue
    sheets.push(parseSheetXml(decodeEntry(await inflateEntry(zip, target)), resolved, sheet.name, shared))
  }
  return { sheets }
}

export async function readXlsxDocument(bytes: Uint8Array): Promise<XlsxState> {
  return readSheetGrids(await readZip(bytes))
}

function toValue(value: string | number | { formula: string }): XlsxCellValue {
  if (typeof value === "number") return { kind: "number", value }
  if (typeof value === "object" && value !== null && "formula" in value) {
    return { kind: "formula", formula: String(value.formula) }
  }
  // 纯数字字符串仍然按文本写：用户可能就是要保留 "007" 或编号。
  return { kind: "text", value: String(value) }
}

function formatRef(ref: { row: number; col: number }): string {
  return `${columnLabel(ref.col)}${ref.row + 1}`
}

function columnLabel(index: number): string {
  let value = index
  let label = ""
  do {
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return label
}

type SheetPatch = { xml: string; stylesXml?: string; applied: unknown[] }

function patchSheet(
  sheetXml: string,
  stylesXml: string | undefined,
  ops: readonly OfficeOp[],
): OfficeResult<SheetPatch> {
  let xml = sheetXml
  let styles = stylesXml
  const applied: unknown[] = []

  for (const op of ops) {
    if (op.op === "setCellValue") {
      const ref = formatRef(op.ref)
      xml = writeCell(xml, ref, { value: toValue(op.value) })
      applied.push({ cell: ref, value: op.value })
      continue
    }

    if (op.op === "setCellStyle") {
      if (!styles) return fail("engine", "这个工作簿没有 xl/styles.xml，无法改单元格格式")
      const from = {
        row: Math.min(op.range.start.row, op.range.end.row),
        col: Math.min(op.range.start.col, op.range.end.col),
      }
      const to = {
        row: Math.max(op.range.start.row, op.range.end.row),
        col: Math.max(op.range.start.col, op.range.end.col),
      }
      if ((to.row - from.row + 1) * (to.col - from.col + 1) > 5000) {
        return fail("invalid_params", "一次最多改 5000 个单元格的格式")
      }
      const cells: string[] = []
      for (let row = from.row; row <= to.row; row++) {
        for (let col = from.col; col <= to.col; col++) {
          const ref = formatRef({ row, col })
          const base = cellStyleIndex(xml, ref)
          const result = ensureCellStyle(styles, base, op.style as XlsxStylePatch)
          if (!result) return fail("engine", "无法解析 xl/styles.xml 的 cellXfs")
          styles = result.xml
          xml = writeCell(xml, ref, { style: result.index })
          cells.push(ref)
        }
      }
      applied.push({ cells, style: op.style })
      continue
    }

    return fail("unsupported_format", `${op.op} 不适用于 XLSX`)
  }

  return ok({ xml, ...(styles !== stylesXml ? { stylesXml: styles } : {}), applied })
}

export const xlsxEngine: OfficeEngine<XlsxState> = {
  format: "xlsx",

  async open(bytes) {
    try {
      const zip = await readZip(bytes)
      const state = await readSheetGrids(zip)
      if (state.sheets.length === 0) return fail("open_failed", "XLSX 缺少工作簿或工作表")
      return ok(state)
    } catch (error) {
      return fail("open_failed", error instanceof Error ? error.message : "无法解析 XLSX")
    }
  },

  async apply(state, ops, bytes) {
    if (ops.length === 0) return fail("invalid_params", "没有要执行的操作")
    if (state.sheets.length === 0) return fail("not_found", "工作簿里没有可编辑的工作表")

    const unsupported = ops.find((op) => op.op !== "setCellValue" && op.op !== "setCellStyle")
    if (unsupported) return fail("unsupported_format", `${unsupported.op} 不适用于 XLSX`)

    try {
      const zip = await readZip(bytes)
      const replacements = new Map<string, Uint8Array>()
      let stylesBytes: Uint8Array | undefined
      const stylesEntry = zip.entries.find((item) => item.name === STYLES_ENTRY)
      if (stylesEntry) stylesBytes = await inflateEntry(zip, stylesEntry)
      let stylesXml = stylesBytes ? decodeEntry(stylesBytes) : undefined

      const applied: unknown[] = []
      for (const sheet of state.sheets) {
        const sheetOps = ops.filter(
          (op) => (op.op === "setCellValue" || op.op === "setCellStyle") && op.sheet === sheet.name,
        )
        if (sheetOps.length === 0) continue
        const entry = zip.entries.find((item) => item.name === sheet.path)
        if (!entry) return fail("not_found", `找不到工作表 ${sheet.name} 的包内条目`)
        const current = decodeEntry(await inflateEntry(zip, entry))
        const patched = patchSheet(current, stylesXml, sheetOps)
        if (!patched.ok) return patched
        stylesXml = patched.data.stylesXml ?? stylesXml
        replacements.set(sheet.path, new TextEncoder().encode(patched.data.xml))
        applied.push(...patched.data.applied)
      }

      if (applied.length === 0) return fail("not_found", "没有找到要修改的单元格", "先用 /Sheet1/A1 确认工作表名")

      if (stylesXml !== undefined && stylesBytes && decodeEntry(stylesBytes) !== stylesXml) {
        replacements.set(STYLES_ENTRY, new TextEncoder().encode(stylesXml))
      }

      const nextZip = rebuildZip(zip, replacements)
      const reopened = await xlsxEngine.open(nextZip)
      if (!reopened.ok) return reopened
      const outcome: ApplyOutcome<XlsxState> = {
        state: reopened.data,
        bytes: nextZip,
        changed: [...replacements.keys()],
        applied,
      }
      return ok(outcome)
    } catch (error) {
      return fail("engine", error instanceof Error ? error.message : "XLSX 写入失败")
    }
  },
}
