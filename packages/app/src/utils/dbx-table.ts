/**
 * 解析 dbx 返回的 markdown 表格。
 *
 * 背景：`@dbx-app/mcp-server` 的 `dbx_execute_query` **只返回 markdown 文本**，
 * 没有 JSON 选项；而且它的 `formatCell` 不转义单元格里的 `|` 和换行：
 *
 * ```js
 * formatCell = (v) => v === null ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v)
 * mdTable = (headers, rows) => 行内容 padEnd 对齐后用 " | " join
 * ```
 *
 * 所以常见的 `line.split("|")` 一定会错位（单元格含管道符会多出列）。
 *
 * 这里的做法：**用分隔线的短横线区间定位每一列**。
 * mdTable 是按下标 padEnd 的，表头、分隔线、数据行的列宽完全一致，
 * 因此分隔线上第 i 段 `-` 的 [start, end) 就是第 i 列在所有行里的精确切片区间。
 * 单元格里出现 `|` 也不会影响，因为它不会改变短横线的位置。
 *
 * 仍有无法还原的情况：单元格含**换行**（会被拆成多行，且后续行没有前导 `|`）。
 * 这类行按「续表」处理，拼回上一行的最后一列，至少不丢文本。
 */

export type DbxTable = {
  headers: string[]
  rows: string[][]
  /** 检测到的异常数量（列数对不上、续行等），便于 UI 提示"结果可能不完整"。 */
  issues: number
}

/** dbx 在每段结果后面加的说明行，不参与表格解析。 */
const NOISE = [/^\s*Statement\s+\d+\s*$/i, /^\s*\d+\s+row\(s\)\s*$/i, /^\s*Query executed\./i]

const isSeparator = (line: string) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line)

/** 分隔线上的短横线区间：每一段就是该列的内容区间。 */
export function columnRanges(separator: string) {
  const ranges: Array<[number, number]> = []
  const re = /-+/g
  let match: RegExpExecArray | null
  while ((match = re.exec(separator)) !== null) {
    ranges.push([match.index, match.index + match[0].length])
  }
  return ranges
}

/** 按列区间切片；越界时返回空串而不是 undefined。 */
function slice(line: string, [start, end]: [number, number]) {
  return line.slice(start, end).trim()
}

export function parseDbxTable(text: string): DbxTable {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")

  let headers: string[] = []
  let ranges: Array<[number, number]> = []
  const rows: string[][] = []
  let issues = 0
  // 上一次被当成数据行推入的原始行号：发现它其实是表头时要撤回。
  let lastPushedLine = -1

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]

    // 遇到分隔线：整张表（含多语句输出里的后续表）从这一行重新定列。
    if (isSeparator(line)) {
      const next = columnRanges(line)
      if (next.length === 0) continue
      ranges = next
      const headerLine = index > 0 ? lines[index - 1] : ""
      if (headerLine.startsWith("|")) {
        // 上一行可能已被当成数据行推入（多语句的第二张表），撤回并改作表头。
        if (lastPushedLine === index - 1) rows.pop()
        headers = ranges.map((range) => slice(headerLine, range))
        lastPushedLine = -1
      } else if (headers.length === 0) {
        headers = ranges.map((_, column) => "col" + (column + 1))
      }
      continue
    }

    if (NOISE.some((pattern) => pattern.test(line))) continue
    if (!line.trim()) continue

    if (line.startsWith("|")) {
      // 还没遇到分隔线时无法确定列区间，先跳过（表头行）。
      if (ranges.length === 0) continue
      rows.push(ranges.map((range) => slice(line, range)))
      lastPushedLine = index
      continue
    }

    // 续行：单元格里含换行时 dbx 会把它拆成独立一行，且没有前导 `|`。
    // 拼回上一行的最后一列，避免整段文本丢失。
    const previous = rows[rows.length - 1]
    if (previous && previous.length > 0) {
      const last = previous.length - 1
      previous[last] = previous[last] ? previous[last] + " " + line.trim() : line.trim()
      issues++
    }
  }

  return { headers, rows, issues }
}

/** 只取第一列（连接名 / 库名 / 表名列表场景）。 */
export function firstColumn(text: string) {
  return parseDbxTable(text)
    .rows.map((row) => row[0])
    .filter((value): value is string => !!value)
}
