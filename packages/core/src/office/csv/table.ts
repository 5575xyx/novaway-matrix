/**
 * CSV / TSV 的解析与回写。
 *
 * `.csv` 归到电子表格一类：这里把它当「一张只有值的表」，
 * 单元格可以按 A1 坐标读写。CSV 没有样式、没有公式、没有合并，所以只做
 * 值的结构操作（改单元格、插删行列）。
 *
 * 往返的底线和文本编辑器一样：**没改动的单元格按原始写法输出**。
 * 解析时把每个字段的原文（含引号）留在 `raw` 里，回写时只要值没变就原样吐回，
 * 因此「只改 B2」不会把整张表的加引号风格、空格和换行符重排一遍。
 */

/** 一个字段：解码后的值 + 它在原文里的写法。 */
export type CsvCell = { value: string; raw: string }

export type CsvTable = {
  rows: CsvCell[][]
  /** 识别出的分隔符：`,` / `\t` / `;` / `|`。 */
  delimiter: string
  /** 原文是否以换行结尾。POSIX 工具都按「有结尾换行」工作，回写时必须保留。 */
  finalNewline: boolean
}

const CANDIDATES = [",", "\t", ";", "|"] as const

/** 数一行里引号外出现了多少次分隔符。 */
function countOutsideQuotes(line: string, delimiter: string): number {
  let quoted = false
  let count = 0
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        index++
        continue
      }
      quoted = !quoted
      continue
    }
    if (!quoted && char === delimiter) count++
  }
  return count
}

/**
 * 猜分隔符：看前几行里哪个候选出现得最多。
 *
 * 只有一种候选出现过才算数；都出现（或都没出现）时按逗号处理 ——
 * 这是 CSV 的本义，也避免把正文里的分号误判成分隔符。
 */
export function sniffDelimiter(text: string): string {
  const sample = text.split("\n", 8).join("\n")
  let best: string = ","
  let bestCount = 0
  for (const delimiter of CANDIDATES) {
    const count = sample.split("\n").reduce((sum, line) => sum + countOutsideQuotes(line, delimiter), 0)
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return best
}

/** 原文写法 → 值（只处理成对双引号的转义）。 */
export function rawValue(raw: string): string {
  if (!raw.startsWith('"')) return raw
  const end = raw.lastIndexOf('"')
  if (end <= 0) return raw.slice(1)
  return raw.slice(1, end).replace(/""/g, '"')
}

/** 解析。换行已经由 decodeText 归一成 \n。 */
export function parseCsv(text: string, delimiter?: string): CsvTable {
  const sep = delimiter ?? sniffDelimiter(text)
  const rows: CsvCell[][] = []
  let row: CsvCell[] = []
  let value = ""
  let raw = ""
  let quoted = false
  let index = 0

  const endCell = () => {
    row.push({ value, raw })
    value = ""
    raw = ""
  }
  const endRow = () => {
    endCell()
    rows.push(row)
    row = []
  }

  while (index < text.length) {
    const char = text[index]!
    if (quoted) {
      raw += char
      if (char === '"') {
        if (text[index + 1] === '"') {
          raw += '"'
          value += '"'
          index += 2
          continue
        }
        quoted = false
        index++
        continue
      }
      value += char
      index++
      continue
    }
    if (char === '"' && value.length === 0 && raw.length === 0) {
      quoted = true
      raw += char
      index++
      continue
    }
    if (char === sep) {
      endCell()
      index++
      continue
    }
    if (char === "\n") {
      endRow()
      index++
      continue
    }
    raw += char
    value += char
    index++
  }

  // 末尾没有换行时补上最后一行；以换行结尾则不再多造一行空行。
  if (raw.length > 0 || value.length > 0 || row.length > 0) endRow()
  return { rows, delimiter: sep, finalNewline: text.endsWith("\n") }
}

/** 一个值需要加引号吗。 */
export function needsQuote(value: string, delimiter: string): boolean {
  return value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r")
}

/** 值 → 字段文本；值没变就沿用原文，保证未改动的单元格逐字节不变。 */
export function formatCell(cell: CsvCell, delimiter: string): string {
  if (rawValue(cell.raw) === cell.value) return cell.raw
  if (!needsQuote(cell.value, delimiter)) return cell.value
  return '"' + cell.value.replace(/"/g, '""') + '"'
}

export function serializeCsv(rows: readonly CsvCell[][], delimiter: string, eol = "\n", finalNewline = true): string {
  const body = rows.map((row) => row.map((cell) => formatCell(cell, delimiter)).join(delimiter)).join(eol)
  if (!finalNewline || body.length === 0) return body
  return body + eol
}

/** 表里最宽的一行有多少列。 */
export function tableWidth(rows: readonly CsvCell[][]): number {
  return rows.reduce((width, row) => Math.max(width, row.length), 0)
}

export const blankCell = (): CsvCell => ({ value: "", raw: "" })

export function cellValue(rows: readonly CsvCell[][], row: number, col: number): string {
  return rows[row]?.[col]?.value ?? ""
}

/** 把值写进单元格，必要时补行补列。 */
export function setCell(rows: CsvCell[][], row: number, col: number, value: string): CsvCell[][] {
  const next = rows.map((line) => line.slice())
  while (next.length <= row) next.push([])
  const line = next[row]!
  while (line.length <= col) line.push(blankCell())
  line[col] = { value, raw: line[col]!.raw }
  return next
}

/** 插入/删除行列；at 从 0 开始的索引，count 至少 1。 */
export function insertRows(rows: CsvCell[][], at: number, count: number): CsvCell[][] {
  const width = tableWidth(rows)
  const blank = () => Array.from({ length: width }, blankCell)
  const next = rows.map((line) => line.slice())
  next.splice(at, 0, ...Array.from({ length: count }, blank))
  return next
}

export function deleteRows(rows: CsvCell[][], at: number, count: number): CsvCell[][] {
  return rows.map((line) => line.slice()).filter((_, index) => index < at || index >= at + count)
}

export function insertColumns(rows: CsvCell[][], at: number, count: number): CsvCell[][] {
  return rows.map((line) => {
    const next = line.slice()
    next.splice(at, 0, ...Array.from({ length: count }, blankCell))
    return next
  })
}

export function deleteColumns(rows: CsvCell[][], at: number, count: number): CsvCell[][] {
  return rows.map((line) => line.filter((_, index) => index < at || index >= at + count))
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** 导出 HTML 表格；第一行按表头处理（CSV 里它本来就是表头）。 */
export function csvToHtml(rows: readonly CsvCell[][], title = "CSV"): string {
  const body = rows
    .map(
      (row, index) =>
        "<tr>" +
        row
          .map((cell) => (index === 0 ? "<th>" : "<td>") + escapeHtml(cell.value) + (index === 0 ? "</th>" : "</td>"))
          .join("") +
        "</tr>",
    )
    .join("\n")
  return (
    '<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>' +
    escapeHtml(title) +
    '</title></head>\n<body>\n<table border="1">\n' +
    body +
    "\n</table>\n</body>\n</html>\n"
  )
}

/** 导出 Markdown 表格；`|` 在单元格里必须转义，否则列会错位。 */
export function csvToMarkdown(rows: readonly CsvCell[][]): string {
  if (rows.length === 0) return ""
  const width = tableWidth(rows)
  const line = (row: readonly CsvCell[]) =>
    "| " +
    Array.from({ length: width }, (_, col) => (row[col]?.value ?? "").replace(/\|/g, "\|").replace(/\n/g, " ")).join(
      " | ",
    ) +
    " |"
  const [head, ...rest] = rows
  const divider = "| " + Array.from({ length: width }, () => "---").join(" | ") + " |"
  return [line(head!), divider, ...rest.map(line)].join("\n")
}
