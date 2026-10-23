/**
 * XLSX 正文抽取。
 *
 * 只依赖 JSZip 解压，不引入 SheetJS（体积 + 原生依赖都不划算）。
 * 相比最初「直接读 <v> 拼接」的实现，这里补齐了四件影响可用性的事：
 *
 * 1. 数字格式：日期在 xlsx 里是自 1899-12-30 起的天数（1904 系统另算），
 *    之前会原样输出 45123；现在按 styles.xml 的 numFmt 还原成日期。
 * 2. 百分比 / 千分位 / 货币：按格式串还原，而不是把 0.152 当字符串。
 * 3. 合并单元格：把值铺满整个合并区域，行不再错位。
 * 4. 真实工作表名：从 workbook.xml 取，而不是 Sheet 1/2/3。
 *
 * 单元格类型（t 属性）也补齐了：共享字符串、内联字符串、布尔、错误、
 * 公式字符串结果。公式本身不展开（xlsx 里只存缓存值）。
 */
import type JSZip from "jszip"

const MAX_ROWS_PER_SHEET = 20_000

/** 内置日期格式编号（ECMA-376 附录 A）。 */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

export type SheetCell = {
  ref: string
  column: number
  row: number
  text: string
}

function decodeEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, String.fromCharCode(39))
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_all, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

function xmlText(value: string | undefined) {
  if (!value) return ""
  return decodeEntities(value.replace(/<[^>]+>/g, "")).trim()
}

/** 把 A1 引用解析成 0-based 行列。 */
export function parseCellRef(ref: string): { column: number; row: number } | undefined {
  const match = /^([A-Z]+)(\d+)$/.exec(ref.trim().toUpperCase())
  if (!match) return undefined
  let column = 0
  for (const char of match[1]) column = column * 26 + (char.charCodeAt(0) - 64)
  return { column: column - 1, row: Number(match[2]) - 1 }
}

/** 列序号转列字母（0 → A）。 */
export function columnName(index: number) {
  let value = index + 1
  let out = ""
  while (value > 0) {
    const rest = (value - 1) % 26
    out = String.fromCharCode(65 + rest) + out
    value = Math.floor((value - 1) / 26)
  }
  return out
}

/**
 * 判断格式串是否是日期/时间。
 *
 * 先把引号里的字面量、反斜杠转义、方括号里的颜色/条件都剥掉，
 * 否则 "年"m"月" 里的 m 会被误判。m 单独出现既可能是月份也可能是分钟，
 * 只有同时出现 y / d / h / s 或方括号时间时才认为是日期。
 */
export function isDateFormatCode(code: string) {
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .toLowerCase()
  if (/[ydhs]/.test(stripped)) return true
  return /\[(h|m|s)+\]/.test(code.toLowerCase())
}

/** 是否有时间部分（决定输出日期还是日期+时间）。 */
export function hasTimePart(code: string) {
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .toLowerCase()
  return /[hs]/.test(stripped) || /\[(h|m|s)+\]/.test(code.toLowerCase())
}

export function hasSecondsPart(code: string) {
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .toLowerCase()
  return /s/.test(stripped)
}

const pad = (value: number) => String(value).padStart(2, "0")

/**
 * Excel 序列号转日期。
 *
 * 1900 系统的起点是 1899-12-30（Excel 把 1900 当作闰年，历史遗留），
 * 1904 系统（Mac 旧版）起点是 1904-01-01。
 */
export function excelSerialToDate(serial: number, date1904 = false) {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const days = Math.floor(serial)
  const fraction = serial - days
  return new Date(epoch + days * 86_400_000 + Math.round(fraction * 86_400_000))
}

export function formatExcelDate(serial: number, code: string, date1904 = false) {
  const date = excelSerialToDate(serial, date1904)
  const timeOnly = serial < 1
  const datePart = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  const timePart =
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` +
    (hasSecondsPart(code) ? ":" + pad(date.getUTCSeconds()) : "")
  if (timeOnly) return timePart
  return hasTimePart(code) ? datePart + " " + timePart : datePart
}

/** 千分位分组（只处理整数部分）。 */
export function groupThousands(value: string) {
  const [integer, decimal] = value.split(".")
  const sign = integer.startsWith("-") ? "-" : ""
  const digits = sign ? integer.slice(1) : integer
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return sign + grouped + (decimal !== undefined ? "." + decimal : "")
}

/**
 * 按 numFmt 格式化一个数字单元格。
 *
 * 只覆盖实际会遇到的主要形态：日期/时间、百分比、千分位、固定小数、货币符号。
 * 其余退回原始数字（去掉浮点噪声），不假装能还原任意格式串。
 */
export function formatExcelNumber(raw: string, code: string | undefined, date1904 = false) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return raw.trim()

  if (code) {
    if (isDateFormatCode(code)) return formatExcelDate(value, code, date1904)
    if (code.includes("%")) {
      const decimals = /\.(0+)/.exec(code)?.[1]?.length ?? 0
      return (value * 100).toFixed(decimals) + "%"
    }
    const decimalDigits = /\.(0+)/.exec(code)?.[1]?.length
    if (decimalDigits !== undefined) {
      const text = value.toFixed(decimalDigits)
      return code.includes("#,##") ? groupThousands(text) : text
    }
    if (code.includes("#,##")) return groupThousands(String(Math.round(value)))
    const currency = /[¥$€£]/.exec(code)?.[0]
    if (currency) return currency + String(value)
  }

  return String(Number(value.toPrecision(15)))
}

export type Styles = {
  /** cellXfs 下标 → 格式串（内置格式映射成等价格式串）。 */
  formats: Array<string | undefined>
}

const BUILTIN_CODES: Record<number, string> = {
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  14: "yyyy-mm-dd",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "yyyy-mm-dd h:mm",
  37: "#,##0",
  38: "#,##0",
  39: "#,##0.00",
  40: "#,##0.00",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mm:ss",
}

export function parseStyles(xml: string | undefined): Styles {
  if (!xml) return { formats: [] }
  const custom = new Map<number, string>()
  for (const match of xml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    custom.set(Number(match[1]), decodeEntities(match[2]))
  }
  for (const match of xml.matchAll(/<numFmt[^>]*formatCode="([^"]*)"[^>]*numFmtId="(\d+)"/g)) {
    if (!custom.has(Number(match[2]))) custom.set(Number(match[2]), decodeEntities(match[1]))
  }

  const section = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? ""
  const formats: Array<string | undefined> = []
  for (const match of section.matchAll(/<xf\b([^>]*)\/?>/g)) {
    const attrs = match[1]
    const id = Number(/numFmtId="(\d+)"/.exec(attrs)?.[1] ?? 0)
    const apply = /applyNumberFormat="(0|1|false|true)"/.exec(attrs)?.[1]
    if (apply === "0" || apply === "false") {
      formats.push(undefined)
      continue
    }
    formats.push(custom.get(id) ?? BUILTIN_CODES[id])
  }
  return { formats }
}

export type SheetData = {
  name: string
  /** 行 → 列 → 显示文本（已按合并单元格铺开）。 */
  rows: string[][]
  truncated: boolean
}

/** 解析单个工作表 XML。 */
export function parseSheet(input: {
  xml: string
  name: string
  shared: readonly string[]
  styles: Styles
  date1904?: boolean
}): SheetData {
  const { xml, name, shared, styles } = input
  const date1904 = input.date1904 ?? false

  // 合并单元格：记录左上角与覆盖范围，最后把值铺满整个区域。
  const merges: Array<{ row: number; column: number; rows: number; columns: number }> = []
  for (const match of xml.matchAll(/<mergeCell ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
    const from = parseCellRef(match[1])
    const to = parseCellRef(match[2])
    if (!from || !to) continue
    merges.push({
      row: Math.min(from.row, to.row),
      column: Math.min(from.column, to.column),
      rows: Math.abs(to.row - from.row) + 1,
      columns: Math.abs(to.column - from.column) + 1,
    })
  }

  const grid: string[][] = []
  let truncated = false
  let rowsSeen = 0

  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    rowsSeen++
    if (rowsSeen > MAX_ROWS_PER_SHEET) {
      truncated = true
      break
    }
    const rowIndex = Number(/ r="(\d+)"/.exec(rowMatch[1])?.[1] ?? rowsSeen) - 1
    const cells: string[] = []

    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? ""
      const body = cellMatch[2] ?? ""
      const ref = / r="([A-Z]+\d+)"/.exec(attrs)?.[1]
      const position = ref ? parseCellRef(ref) : undefined
      const column = position?.column ?? cells.length

      const type = / t="([^"]+)"/.exec(attrs)?.[1]
      const styleIndex = Number(/ s="(\d+)"/.exec(attrs)?.[1] ?? -1)
      const code = styleIndex >= 0 ? styles.formats[styleIndex] : undefined

      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      let text = ""
      if (type === "inlineStr") {
        const inline = /<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? ""
        text = Array.from(inline.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
          .map((item) => decodeEntities(item[1]))
          .join("")
      } else if (type === "s") {
        text = shared[Number(value ?? -1)] ?? ""
      } else if (type === "b") {
        text = value === "1" ? "TRUE" : value === "0" ? "FALSE" : ""
      } else if (type === "e" || type === "str") {
        text = xmlText(value)
      } else if (value !== undefined) {
        text = formatExcelNumber(value, code, date1904)
      }

      while (cells.length < column) cells.push("")
      cells[column] = text
    }

    while (grid.length < rowIndex) grid.push([])
    grid[rowIndex] = cells
  }

  // 合并单元格的值铺满整个区域：每行都是一条完整记录，检索与阅读都更稳。
  for (const merge of merges) {
    const source = grid[merge.row]?.[merge.column] ?? ""
    if (!source) continue
    for (let row = merge.row; row < merge.row + merge.rows; row++) {
      while (grid.length <= row) grid.push([])
      const line = grid[row]
      for (let column = merge.column; column < merge.column + merge.columns; column++) {
        while (line.length < column) line.push("")
        if (line[column]) continue
        line[column] = source
      }
    }
  }

  const rows = grid.filter((row) => row.some(Boolean))
  return { name, rows, truncated }
}

/** 工作表名 + 实际文件名的映射（workbook.xml + rels）。 */
export function parseWorkbook(xml: string | undefined, rels: string | undefined) {
  const result: Array<{ name: string; file: string }> = []
  const relMap = new Map<string, string>()
  if (rels) {
    for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = /Id="([^"]+)"/.exec(match[1])?.[1]
      const target = /Target="([^"]+)"/.exec(match[1])?.[1]
      if (!id || !target) continue
      relMap.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""))
    }
  }
  if (!xml) return result
  for (const match of xml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = /name="([^"]*)"/.exec(match[1])?.[1]
    const rid = /r:id="([^"]+)"/.exec(match[1])?.[1]
    if (!name || !rid) continue
    const target = relMap.get(rid)
    if (!target) continue
    result.push({ name: decodeEntities(name), file: "xl/" + target })
  }
  return result
}

/** 是否使用 1904 日期系统。 */
export function usesDate1904(workbookXml: string | undefined) {
  if (!workbookXml) return false
  return /<workbookPr[^>]*date1904="(1|true)"/.test(workbookXml)
}

/** 抽取全部工作表正文（tab 分隔，保留行列关系）。 */
export async function xlsxToText(zip: JSZip): Promise<string> {
  const sharedFile = zip.file("xl/sharedStrings.xml")
  const shared: string[] = []
  if (sharedFile) {
    const xml = await sharedFile.async("text")
    for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const runs = Array.from(match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
      shared.push(decodeEntities(runs.map((item) => item[1]).join("")))
    }
  }

  const styles = parseStyles(await zip.file("xl/styles.xml")?.async("text"))
  const workbookXml = await zip.file("xl/workbook.xml")?.async("text")
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text")
  const date1904 = usesDate1904(workbookXml)

  const listed = parseWorkbook(workbookXml, relsXml)
  const fallback = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)/.exec(a)?.[1] ?? 0) - Number(/(\d+)/.exec(b)?.[1] ?? 0))
    .map((file, index) => ({ name: "Sheet " + (index + 1), file }))
  const sheets = listed.length > 0 ? listed : fallback

  const parts: string[] = []
  for (const [index, sheet] of sheets.entries()) {
    const xml = await zip.file(sheet.file)?.async("text")
    if (!xml) continue
    const data = parseSheet({
      xml,
      name: sheet.name || "Sheet " + (index + 1),
      shared,
      styles,
      date1904,
    })
    if (data.rows.length === 0) continue
    const body = data.rows.map((row) => row.join("\t").replace(/\t+$/, "")).join(String.fromCharCode(10))
    parts.push(
      "## " +
        data.name +
        String.fromCharCode(10, 10) +
        body +
        (data.truncated ? String.fromCharCode(10) + "（仅显示前 " + MAX_ROWS_PER_SHEET + " 行）" : ""),
    )
  }
  return parts.join(String.fromCharCode(10, 10))
}

export const XLSX_MAX_ROWS = MAX_ROWS_PER_SHEET
