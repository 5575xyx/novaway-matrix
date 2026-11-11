/**
 * CSV 引擎：把 `.csv` 当成「一张只有值的表」来读写。
 *
 * 格式表里 `.csv` 归电子表格：UI 里它是一行行文本，AI 和导出
 * 需要的是 A1 坐标。两种视角共用这一份解析结果，所以不会出现
 * 「AI 改了 B2、面板显示的还是旧值」。
 *
 * 不做的事：样式、公式、合并单元格。CSV 里没有这些结构，
 * 与其伪造，不如让调用方改用 .xlsx（错误信息里会这么说）。
 */

import type { ApplyOutcome, OfficeEngine, OfficeOp, OfficeResult } from "../engine/contract"
import { fail, ok } from "../engine/contract"
import { decodeText, encodeText, looksBinary, type TextFormat } from "../text/format"
import {
  csvToHtml,
  csvToMarkdown,
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  parseCsv,
  serializeCsv,
  setCell,
  sniffDelimiter,
  type CsvCell,
} from "./table"

export type CsvState = {
  /** 唯一的事实来源：文件文本。 */
  text: string
  format: TextFormat
  rows: CsvCell[][]
  delimiter: string
  /** 原文件是否以换行结尾（回写时保持一致）。 */
  finalNewline: boolean
}

export function readCsv(text: string, format: TextFormat, delimiter?: string): CsvState {
  const table = parseCsv(text, delimiter)
  return {
    text,
    format,
    rows: table.rows,
    delimiter: table.delimiter,
    finalNewline: table.finalNewline,
  }
}

const CELL_EDITS = new Set([
  "setCellValue",
  "clearCells",
  "insertRows",
  "deleteRows",
  "insertColumns",
  "deleteColumns",
  "setText",
])

/** 插入/删除行列的公共校验：at 从 1 开始，count 默认 1。 */
function structureTarget(op: { at: number; count?: number }): OfficeResult<{ at: number; count: number }> {
  const count = op.count ?? 1
  if (!Number.isInteger(op.at) || op.at < 1) {
    return fail("invalid_params", "插入/删除位置从 1 开始：" + String(op.at))
  }
  if (!Number.isInteger(count) || count < 1 || count > 10000) {
    return fail("invalid_params", "一次最多改 10000 行/列，且至少 1")
  }
  return ok({ at: op.at - 1, count })
}

/** 值在 CSV 里一律是文本：数字按字符串写，公式写成 `=...` 交给 Excel 自己算。 */
function valueOf(value: string | number | { formula: string }): string {
  if (typeof value === "number") return String(value)
  if (typeof value === "object" && value !== null && "formula" in value) return "=" + String(value.formula)
  return String(value)
}

function applyOne(state: CsvState, op: OfficeOp): OfficeResult<CsvState> {
  switch (op.op) {
    case "setCellValue":
      return ok({ ...state, rows: setCell(state.rows, op.ref.row, op.ref.col, valueOf(op.value)) })
    case "clearCells": {
      // CSV 没有空单元格的概念：清空就是把这些格子写成空字符串。
      const rows = state.rows.map((row) => [...row])
      for (
        let row = Math.min(op.range.start.row, op.range.end.row);
        row <= Math.max(op.range.start.row, op.range.end.row);
        row += 1
      ) {
        for (
          let col = Math.min(op.range.start.col, op.range.end.col);
          col <= Math.max(op.range.start.col, op.range.end.col);
          col += 1
        ) {
          if (!rows[row]?.[col]) continue
          rows[row]![col] = { ...rows[row]![col]!, value: "" }
        }
      }
      return ok({ ...state, rows })
    }
    case "insertRows": {
      const target = structureTarget(op)
      if (!target.ok) return target
      return ok({ ...state, rows: insertRows(state.rows, target.data.at, target.data.count) })
    }
    case "deleteRows": {
      const target = structureTarget(op)
      if (!target.ok) return target
      return ok({ ...state, rows: deleteRows(state.rows, target.data.at, target.data.count) })
    }
    case "insertColumns": {
      const target = structureTarget(op)
      if (!target.ok) return target
      return ok({ ...state, rows: insertColumns(state.rows, target.data.at, target.data.count) })
    }
    case "deleteColumns": {
      const target = structureTarget(op)
      if (!target.ok) return target
      return ok({ ...state, rows: deleteColumns(state.rows, target.data.at, target.data.count) })
    }
    // 源码视图 / 整篇替换：和文本编辑器一样，换行与编码按原文件恢复。
    case "setText": {
      const delimiter = op.text.includes(state.delimiter) ? state.delimiter : sniffDelimiter(op.text)
      const table = parseCsv(op.text, delimiter)
      return ok({
        ...state,
        text: op.text,
        rows: table.rows,
        delimiter,
        finalNewline: table.finalNewline,
      })
    }
    case "setCellStyle":
      return fail("unsupported_format", "CSV 没有单元格格式", "需要字体/填充请改用 .xlsx")
    case "setParagraphStyle":
    case "setParagraphText":
    case "setSpanText":
    case "insertParagraph":
    case "deleteParagraph":
    case "setBlockType":
    case "setBlockHtml":
      return fail("unsupported_format", op.op + " 不适用于 CSV", "CSV 只有值：用 setCellValue 改单元格")
    default:
      return fail("unsupported_format", op.op + " 不适用于 CSV", "支持 setCellValue / 插入删除行列 / setText")
  }
}

/** 空行：导成 JSON 时用来判断这一行有没有内容。 */
const isEmptyRow = (row: readonly CsvCell[]) => row.every((cell) => cell.value.trim().length === 0)

/** 表头 → 唯一列名：同名/空列用 column3 这种兜底，避免 JSON 键被覆盖。 */
function headerNames(header: readonly CsvCell[]): string[] {
  const used = new Set<string>()
  return header.map((cell, index) => {
    const base = cell.value.trim() || "column" + (index + 1)
    let name = base
    let suffix = 2
    while (used.has(name)) name = base + "_" + suffix++
    used.add(name)
    return name
  })
}

export const csvEngine: OfficeEngine<CsvState> = {
  format: "csv",

  async open(bytes) {
    const decoded = decodeText(bytes)
    if (looksBinary(decoded.text)) return fail("open_failed", "这个文件看起来不是文本文件")
    return ok(readCsv(decoded.text, decoded.format))
  },

  async apply(state, ops, bytes) {
    if (ops.length === 0) return fail("invalid_params", "没有要执行的操作")
    const decoded = decodeText(bytes)

    const unsupported = ops.find((op) => !CELL_EDITS.has(op.op))
    if (unsupported) {
      // 交给 applyOne 生成统一口径的错误（含「支持哪些」的提示）。
      const rejected = applyOne(readCsv(decoded.text, decoded.format), unsupported)
      if (!rejected.ok) return rejected
      return fail("unsupported_format", unsupported.op + " 不适用于 CSV")
    }

    let current = readCsv(decoded.text, decoded.format, state.delimiter)
    const applied: Array<{ op: string }> = []
    for (const op of ops) {
      const step = applyOne(current, op)
      if (!step.ok) return step
      current = step.data
      applied.push({ op: op.op })
    }

    // 内存里统一用 \n：换行符由 encodeText 按原文件恢复，
    // 这里再转一次会变成 \r\r\n。
    const text = serializeCsv(current.rows, current.delimiter, "\n", current.finalNewline)
    if (text === decoded.text) {
      const outcome: ApplyOutcome<CsvState> = { state, bytes, changed: [], applied }
      return ok(outcome)
    }

    const next = encodeText(text, decoded.format)
    const reopened = await csvEngine.open(next)
    if (!reopened.ok) return reopened
    return ok({ state: reopened.data, bytes: next, changed: ["csv"], applied })
  },

  /** 导出：csv/tsv 是同一张表的两种分隔符，md/html 给表格，json 按表头转对象数组。 */
  async export(state, target) {
    const kind = target.toLowerCase().replace(/^\./, "")
    const encoder = new TextEncoder()
    const eol = state.format.eol
    if (kind === "csv") {
      return ok(encoder.encode(serializeCsv(state.rows, state.delimiter, eol, state.finalNewline)))
    }
    if (kind === "tsv" || kind === "txt") {
      return ok(encoder.encode(serializeCsv(state.rows, "\t", eol, state.finalNewline)))
    }
    if (kind === "html" || kind === "htm") return ok(encoder.encode(csvToHtml(state.rows)))
    if (kind === "md" || kind === "markdown") return ok(encoder.encode(csvToMarkdown(state.rows)))
    if (kind === "json") {
      const [header, ...body] = state.rows
      if (!header) return ok(encoder.encode("[]"))
      const names = headerNames(header)
      const objects = body
        .filter((row) => !isEmptyRow(row))
        .map((row) => {
          const record: Record<string, string> = {}
          names.forEach((name, index) => {
            record[name] = row[index]?.value ?? ""
          })
          return record
        })
      return ok(encoder.encode(JSON.stringify(objects, null, 2)))
    }
    // PDF / PNG：和表格一样走共享排版器（PNG 在导出层再画成位图）。
    if (kind === "pdf") {
      const { printToPdf } = await import("../pdf/print")
      return ok(await printToPdf("csv", state))
    }
    return fail("unsupported_format", "CSV 不能导出成 " + target, "支持 csv / tsv / md / html / json / pdf / png")
  },
}
