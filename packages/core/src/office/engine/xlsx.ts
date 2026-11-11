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
import {
  cellStyleIndex,
  clearRange,
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  mergeRange,
  parseSheetXml,
  setSheetTabColor,
  unmergeRange,
  writeCell,
  type XlsxSheetGrid,
  type XlsxCellValue,
} from "./xlsx-sheet"
import { ensureCellStyle, type XlsxStylePatch } from "./xlsx-styles"
import { addSheet, deleteSheet, renameSheet } from "./xlsx-workbook"
import { evaluateFormulas } from "./xlsx-formula"
import { sheetToDelimited, sheetToHtmlTable, workbookToDelimited } from "./export"
import { printToPdf } from "../pdf/print"

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
  // 公式单元格在文件里通常没有缓存值；补一份只读的求值结果给预览和 Agent。
  evaluateFormulas(sheets)
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

const XLSX_OPS = new Set<string>([
  "setCellValue",
  "setCellStyle",
  "clearCells",
  "insertRows",
  "deleteRows",
  "insertColumns",
  "deleteColumns",
  "setSheetTabColor",
])

/** 工作簿级操作：改的是 workbook.xml / rels / Content_Types。
    单元格级操作：改的是某个 sheet 部件。 */
const WORKBOOK_OPS = new Set<string>(["addSheet", "renameSheet", "deleteSheet"])

type SheetPatch = { xml: string; stylesXml?: string; applied: unknown[] }

const CONTENT_TYPES_ENTRY = "[Content_Types].xml"

/**
 * 工作簿级操作：改 workbook.xml / rels / [Content_Types].xml，必要时新增一张工作表部件。
 *
 * 和单元格写入一样「只重写必要的那几个文件」：其余包内条目（样式、共享字符串、
 * 图表、数据验证）连本地头一起原样拷贝。
 */
async function patchWorkbook(
  zip: ZipArchive,
  replacements: Map<string, Uint8Array>,
  additions: Map<string, Uint8Array>,
  ops: readonly OfficeOp[],
  sheets: ReadonlyArray<{ name: string; path: string }>,
): Promise<OfficeResult<{ applied: unknown[]; sheets: Array<{ name: string; path: string }> }>> {
  const encoder = new TextEncoder()
  const read = async (name: string) => {
    const entry = zip.entries.find((item) => item.name === name)
    return entry ? decodeEntry(await inflateEntry(zip, entry)) : undefined
  }

  let workbook = await read(WORKBOOK_ENTRY)
  if (workbook === undefined) return fail("engine", "这个工作簿没有 xl/workbook.xml")
  let rels = await read(WORKBOOK_RELS)
  if (rels === undefined) return fail("engine", "这个工作簿没有 xl/_rels/workbook.xml.rels")
  let types = await read(CONTENT_TYPES_ENTRY)
  if (types === undefined) return fail("engine", "这个工作簿没有 [Content_Types].xml")

  const applied: unknown[] = []
  // 工作表清单跟着一起走：新增/改名/删表之后，同一批次里后续的单元格操作要能
  // 找到「刚建出来的那张表」，而不是按调用前的旧清单找，从而把操作静默丢掉。
  let roster = sheets.map((sheet) => ({ name: sheet.name, path: sheet.path }))

  for (const op of ops) {
    if (op.op === "addSheet") {
      const result = addSheet(
        workbook,
        rels,
        types,
        op.name,
        roster.map((sheet) => sheet.path),
      )
      if (!result.ok) return result
      workbook = result.data.workbook
      rels = result.data.rels
      types = result.data.types
      additions.set(result.data.path, encoder.encode(result.data.content))
      roster.push({ name: op.name, path: result.data.path })
      applied.push({ op: op.op, sheet: op.name, path: result.data.path })
      continue
    }
    if (op.op === "renameSheet") {
      const result = renameSheet(workbook, op.sheet, op.name)
      if (!result.ok) return result
      workbook = result.data
      roster = roster.map((sheet) => (sheet.name === op.sheet ? { name: op.name, path: sheet.path } : sheet))
      applied.push({ op: op.op, from: op.sheet, to: op.name })
      continue
    }
    if (op.op === "deleteSheet") {
      const result = deleteSheet(workbook, rels, op.sheet)
      if (!result.ok) return result
      workbook = result.data.workbook
      rels = result.data.rels
      roster = roster.filter((sheet) => sheet.name !== op.sheet)
      applied.push({ op: op.op, sheet: op.sheet })
      continue
    }
  }

  replacements.set(WORKBOOK_ENTRY, encoder.encode(workbook))
  replacements.set(WORKBOOK_RELS, encoder.encode(rels))
  replacements.set(CONTENT_TYPES_ENTRY, encoder.encode(types))
  return ok({ applied, sheets: roster })
}

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
      // merge 不是单元格样式，而是对整块区域的结构操作：
      // true = 合并这块，false = 取消这块上的合并。
      if (op.style.merge !== undefined) {
        const start = { row: from.row, col: from.col }
        const end = { row: to.row, col: to.col }
        xml = op.style.merge ? mergeRange(xml, start, end) : unmergeRange(xml, start, end)
        applied.push({ op: op.style.merge ? "mergeCells" : "unmergeCells", range: [formatRef(start), formatRef(end)] })
      }
      applied.push({ cells, style: op.style })
      continue
    }

    if (op.op === "clearCells") {
      const from = {
        row: Math.min(op.range.start.row, op.range.end.row),
        col: Math.min(op.range.start.col, op.range.end.col),
      }
      const to = {
        row: Math.max(op.range.start.row, op.range.end.row),
        col: Math.max(op.range.start.col, op.range.end.col),
      }
      if ((to.row - from.row + 1) * (to.col - from.col + 1) > 100000) {
        return fail("invalid_params", "一次最多清空 100000 个单元格")
      }
      const cleared = clearRange(xml, from, to)
      xml = cleared.xml
      applied.push({ op: op.op, range: [formatRef(from), formatRef(to)], cleared: cleared.cleared })
      continue
    }

    if (op.op === "insertRows" || op.op === "deleteRows" || op.op === "insertColumns" || op.op === "deleteColumns") {
      const count = op.count ?? 1
      if (!Number.isInteger(op.at) || op.at < 1) {
        return fail("invalid_params", "插入/删除位置从 1 开始：" + String(op.at))
      }
      if (!Number.isInteger(count) || count < 1 || count > 10000) {
        return fail("invalid_params", "一次最多改 10000 行/列，且至少 1")
      }
      xml =
        op.op === "insertRows"
          ? insertRows(xml, op.at, count)
          : op.op === "deleteRows"
            ? deleteRows(xml, op.at, count)
            : op.op === "insertColumns"
              ? insertColumns(xml, op.at, count)
              : deleteColumns(xml, op.at, count)
      applied.push({ op: op.op, at: op.at, count })
      continue
    }

    if (op.op === "setSheetTabColor") {
      const result = setSheetTabColor(xml, op.color)
      if (!result.ok) return result
      xml = result.data
      applied.push({ op: op.op, color: op.color ?? null })
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

    const unsupported = ops.find((op) => !XLSX_OPS.has(op.op) && !WORKBOOK_OPS.has(op.op))
    if (unsupported) return fail("unsupported_format", `${unsupported.op} 不适用于 XLSX`)

    try {
      const zip = await readZip(bytes)
      const replacements = new Map<string, Uint8Array>()
      const additions = new Map<string, Uint8Array>()
      let stylesBytes: Uint8Array | undefined
      const stylesEntry = zip.entries.find((item) => item.name === STYLES_ENTRY)
      if (stylesEntry) stylesBytes = await inflateEntry(zip, stylesEntry)
      let stylesXml = stylesBytes ? decodeEntry(stylesBytes) : undefined

      const applied: unknown[] = []

      // 工作簿级操作先做：新增/改名/删表之后再往物理部件里写单元格，
      // 这样同一个批次里「新建表 + 往新表写 A1」也是成立的。
      let roster = state.sheets.map((sheet) => ({ name: sheet.name, path: sheet.path }))
      const workbookOps = ops.filter((op) => WORKBOOK_OPS.has(op.op))
      if (workbookOps.length > 0) {
        const patched = await patchWorkbook(zip, replacements, additions, workbookOps, roster)
        if (!patched.ok) return patched
        applied.push(...patched.data.applied)
        roster = patched.data.sheets
      }

      for (const sheet of roster) {
        const sheetOps = ops.filter((op) => XLSX_OPS.has(op.op) && (op as { sheet?: string }).sheet === sheet.name)
        if (sheetOps.length === 0) continue
        // 刚新增的工作表还不在这份 zip 里，它的 XML 在 additions 里；
        // 没有这个分支，往新表写单元格的操作会被静默丢掉。
        const added = additions.get(sheet.path)
        const entry = zip.entries.find((item) => item.name === sheet.path)
        if (added === undefined && !entry) return fail("not_found", `找不到工作表 ${sheet.name} 的包内条目`)
        const current = decodeEntry(added ?? (await inflateEntry(zip, entry!)))
        const patched = patchSheet(current, stylesXml, sheetOps)
        if (!patched.ok) return patched
        stylesXml = patched.data.stylesXml ?? stylesXml
        if (added !== undefined) additions.set(sheet.path, new TextEncoder().encode(patched.data.xml))
        else replacements.set(sheet.path, new TextEncoder().encode(patched.data.xml))
        applied.push(...patched.data.applied)
      }

      if (applied.length === 0) return fail("not_found", "没有找到要修改的单元格", "先用 /Sheet1/A1 确认工作表名")

      if (stylesXml !== undefined && stylesBytes && decodeEntry(stylesBytes) !== stylesXml) {
        replacements.set(STYLES_ENTRY, new TextEncoder().encode(stylesXml))
      }

      const nextZip = rebuildZip(zip, replacements, additions)
      const reopened = await xlsxEngine.open(nextZip)
      if (!reopened.ok) return reopened
      const outcome: ApplyOutcome<XlsxState> = {
        state: reopened.data,
        bytes: nextZip,
        changed: [...replacements.keys(), ...additions.keys()],
        applied,
      }
      return ok(outcome)
    } catch (error) {
      return fail("engine", error instanceof Error ? error.message : "XLSX 写入失败")
    }
  },

  /**
   * 导出成文本格式：csv / tsv 导出整本工作簿，html 导出全部 sheet 的表格。
   * 只读操作，原文件与会话状态都不动。
   */
  async export(state, target) {
    const kind = target.toLowerCase().replace(/^\./, "")
    const encoder = new TextEncoder()
    if (kind === "csv") return ok(encoder.encode(workbookToDelimited(state.sheets, ",")))
    if (kind === "tsv" || kind === "txt") return ok(encoder.encode(workbookToDelimited(state.sheets, "\t")))
    if (kind === "html" || kind === "htm") {
      return ok(encoder.encode(state.sheets.map((sheet) => sheetToHtmlTable(sheet)).join("\n")))
    }
    if (kind === "pdf") return ok(await printToPdf("xlsx", state))
    return fail("unsupported_format", "XLSX 不能导出成 " + target, "支持 pdf / csv / tsv / html / txt")
  },
}
