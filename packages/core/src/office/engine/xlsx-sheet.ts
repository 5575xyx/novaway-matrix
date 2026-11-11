/**
 * 工作表中单元格的定位与改写。
 *
 * 和 DOCX/PPTX 一样，只改原始 XML 文本：`xl/worksheets/sheetN.xml` 里被点中的
 * 那一个 `<c>` 换掉，行、列、合并、条件格式、数据验证、图表锚点全部原样保留。
 *
 * OOXML 对顺序很挑：`<row>` 必须按行号递增，`<c>` 必须按列号递增。
 * 所以插入新单元格/新行时做有序插入，而不是追加到末尾。
 */

import type { OfficeResult } from "./contract"
import { fail, formatCellRef, indexToColumn, ok, parseCellRef } from "./contract"
import { attribute, decodeXmlText, endOfElement, encodeXmlText, findAll, findElement, setAttribute } from "./xml"

export type XlsxCellValue =
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "formula"; formula: string }
  | { kind: "boolean"; value: boolean }

export type XlsxCell = {
  /** A1 形式 */
  ref: string
  row: number
  col: number
  /** 显示用文字（共享字符串已经解开） */
  text: string
  value?: string | number | boolean
  formula?: string
  /** cellXfs 下标 */
  style: number
  type: "n" | "s" | "inline" | "str" | "b" | "e" | "d" | "empty"
}

export type XlsxSheetGrid = {
  name: string
  /** 包内路径，例如 xl/worksheets/sheet1.xml */
  path: string
  cells: XlsxCell[]
  /** 最大行列（0 起），空表是 -1 */
  lastRow: number
  lastCol: number
  /** 合并区域（A1:B2 形式）；没有合并时为空数组。 */
  merges: string[]
  /** 标签颜色（AARRGGBB）；没设过就是 undefined。 */
  tabColor?: string
}

function cellKind(t: string | undefined, hasFormula: boolean): XlsxCell["type"] {
  if (hasFormula) return t === "str" ? "str" : "n"
  if (t === "s") return "s"
  if (t === "inlineStr") return "inline"
  if (t === "b") return "b"
  if (t === "e") return "e"
  if (t === "d") return "d"
  if (t === "str") return "str"
  return "n"
}

/** 一个 `<c>` 的内部文字：`<v>` 或 `<is>` 里的所有 `<t>`。 */
function cellInnerText(inner: string): string {
  const texts = findAll(inner, "t")
  if (texts.length > 0) {
    return texts
      .map((item) => decodeXmlText(inner.slice(inner.indexOf(">", item.start) + 1, item.end - "</t>".length)))
      .join("")
  }
  return ""
}

/** 工作表标签颜色存在工作表部件里：`<sheetPr><tabColor rgb="FFRRGGBB"/></sheetPr>`。 */
export function readSheetTabColor(xml: string): string | undefined {
  const pr = findElement(xml, "sheetPr")
  if (!pr) return undefined
  const inner = xml.slice(pr.openEnd + 1, pr.end - "</sheetPr>".length)
  const tag = /<tabColor\b[^>]*>/.exec(inner)?.[0]
  return tag === undefined ? undefined : attribute(tag, "rgb")
}

/** `RRGGBB` / `AARRGGBB` / `#RRGGBB` → `FFRRGGBB`；空串表示去掉颜色。 */
export function normalizeTabColor(input: string | undefined): OfficeResult<string | undefined> {
  if (input === undefined) return ok(undefined)
  const raw = input.trim().replace(/^#/, "")
  if (raw === "") return ok(undefined)
  if (!/^[0-9a-fA-F]{6}$/.test(raw) && !/^[0-9a-fA-F]{8}$/.test(raw)) {
    return fail("invalid_params", "标签颜色要写成 RRGGBB 或 AARRGGBB：" + input, "例如 tabColor=4472C4")
  }
  return ok((raw.length === 6 ? "FF" + raw : raw).toUpperCase())
}

/**
 * 设置 / 清除工作表标签颜色。
 *
 * `<sheetPr>` 必须是 `<worksheet>` 的第一个子元素，`<tabColor>` 又必须是
 * `<sheetPr>` 的第一个子元素 —— 顺序错了 Excel 会拒绝打开，所以插入位置不能随便挑。
 */
export function setSheetTabColor(xml: string, input: string | undefined): OfficeResult<string> {
  const normalized = normalizeTabColor(input)
  if (!normalized.ok) return normalized
  const color = normalized.data

  const pr = findElement(xml, "sheetPr")
  if (!pr) {
    if (color === undefined) return ok(xml)
    const worksheet = findElement(xml, "worksheet")
    if (!worksheet) return fail("engine", "工作表的 XML 里没有 <worksheet>")
    const insertAt = worksheet.openEnd + 1
    return ok(xml.slice(0, insertAt) + `<sheetPr><tabColor rgb="${color}"/></sheetPr>` + xml.slice(insertAt))
  }

  // 自闭合的 <sheetPr/> 要展开才能装下子元素。
  if (xml[pr.openEnd - 1] === "/") {
    if (color === undefined) return ok(xml)
    const open = xml.slice(pr.start, pr.openEnd - 1).trimEnd() + ">"
    return ok(xml.slice(0, pr.start) + open + `<tabColor rgb="${color}"/></sheetPr>` + xml.slice(pr.end))
  }

  const innerStart = pr.openEnd + 1
  const innerEnd = pr.end - "</sheetPr>".length
  const inner = xml.slice(innerStart, innerEnd)
  const found = /<tabColor\b[^>]*>/.exec(inner)

  let nextInner: string
  if (!found) {
    if (color === undefined) return ok(xml)
    nextInner = `<tabColor rgb="${color}"/>` + inner
  } else if (color === undefined) {
    nextInner = inner.slice(0, found.index) + inner.slice(found.index + found[0].length)
  } else {
    // 设成 rgb 时要把 theme / indexed 去掉，否则 Excel 仍按主题色显示。
    const tag = setAttribute(found[0], "theme", undefined).replace(/\sindexed="[^"]*"/, "")
    const replaced = setAttribute(tag, "rgb", color)
    nextInner = inner.slice(0, found.index) + replaced + inner.slice(found.index + found[0].length)
  }
  return ok(xml.slice(0, innerStart) + nextInner + xml.slice(innerEnd))
}

export function parseSheetXml(xml: string, path: string, name: string, shared: readonly string[]): XlsxSheetGrid {
  const cells: XlsxCell[] = []
  let lastRow = -1
  let lastCol = -1

  for (const rowSpan of findAll(xml, "row")) {
    const rowTag = xml.slice(rowSpan.start, xml.indexOf(">", rowSpan.start) + 1)
    const rowAttr = Number(attribute(rowTag, "r"))
    if (!Number.isFinite(rowAttr)) continue
    const rowEnd = rowSpan.end - "</row>".length
    const inner = xml.slice(rowSpan.openEnd + 1, rowEnd)
    for (const cellSpan of findAll(inner, "c")) {
      const openTag = inner.slice(cellSpan.start, cellSpan.openEnd + 1)
      const ref = attribute(openTag, "r")
      if (!ref) continue
      const parsed = parseCellRef(ref)
      if (!parsed) continue
      const body = inner.slice(cellSpan.openEnd + 1, cellSpan.end - "</c>".length)
      const t = attribute(openTag, "t")
      const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1]
      const rawValue = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1]
      const type = cellKind(t, formula !== undefined && rawValue === undefined)
      const decodedFormula = formula === undefined ? undefined : decodeXmlText(formula)
      const style = Number(attribute(openTag, "s") ?? "0")
      let text = ""
      let value: XlsxCell["value"]

      if (t === "s") {
        const index = Number(rawValue ?? "-1")
        text = shared[index] ?? ""
        value = text
      } else if (t === "inlineStr") {
        text = cellInnerText(body)
        value = text
      } else if (t === "b") {
        value = rawValue === "1"
        text = value ? "TRUE" : "FALSE"
      } else if (t === "d") {
        text = decodeXmlText(rawValue ?? "")
        value = text
      } else if (rawValue !== undefined) {
        const decoded = decodeXmlText(rawValue)
        const numeric = Number(decoded)
        value = Number.isFinite(numeric) && decoded.trim() !== "" ? numeric : decoded
        text = decoded
      }

      if (decodedFormula !== undefined && rawValue === undefined) text = "=" + decodedFormula
      cells.push({
        ref,
        row: parsed.row,
        col: parsed.col,
        text,
        ...(value !== undefined ? { value } : {}),
        ...(decodedFormula !== undefined ? { formula: decodedFormula } : {}),
        style: Number.isFinite(style) ? style : 0,
        type,
      })
      lastRow = Math.max(lastRow, parsed.row)
      lastCol = Math.max(lastCol, parsed.col)
    }
  }

  cells.sort((a, b) => a.row - b.row || a.col - b.col)
  // 合并区域读出来给 UI / 模型看：谁和谁是一块，改值/删行时都要用到。
  const merges: string[] = []
  const mergeContainer = findAll(xml, "mergeCells")[0]
  if (mergeContainer) {
    const mergeInner = xml.slice(mergeContainer.openEnd + 1, mergeContainer.end - "</mergeCells>".length)
    for (const span of findAll(mergeInner, "mergeCell")) {
      const ref = attribute(mergeInner.slice(span.start, span.openEnd + 1), "ref")
      if (ref) merges.push(ref)
    }
  }
  const tabColor = readSheetTabColor(xml)
  return { name, path, cells, lastRow, lastCol, merges, ...(tabColor ? { tabColor } : {}) }
}

// ---------------------------------------------------------------------------
// 写：改单元格
// ---------------------------------------------------------------------------

function buildCell(ref: string, style: number, value: XlsxCellValue | undefined): string {
  const styleAttr = style > 0 ? ` s="${style}"` : ""
  if (!value) return `<c r="${ref}"${styleAttr}/>`
  if (value.kind === "formula") {
    // 不写缓存值：让 Excel/WPS 打开时重算，避免旧值和新公式对不上。
    return `<c r="${ref}"${styleAttr}><f>${encodeXmlText(value.formula.replace(/^=/, ""))}</f></c>`
  }
  if (value.kind === "text") {
    const text = value.value
    const space = /^\s|\s$/.test(text) || text.includes("\n") ? ' xml:space="preserve"' : ""
    return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t${space}>${encodeXmlText(text)}</t></is></c>`
  }
  if (value.kind === "boolean") {
    return `<c r="${ref}"${styleAttr} t="b"><v>${value.value ? 1 : 0}</v></c>`
  }
  return `<c r="${ref}"${styleAttr}><v>${value.value}</v></c>`
}

function rowTagOf(xml: string, start: number): { start: number; openEnd: number; end: number } | undefined {
  const end = endOfElement(xml, start, "row")
  if (end === -1) return undefined
  return { start, openEnd: xml.indexOf(">", start), end }
}

function rowNumber(tag: string): number | undefined {
  const value = Number(attribute(tag, "r"))
  return Number.isFinite(value) ? value : undefined
}

/**
 * 把某个单元格写进 sheetData。
 * `value === undefined` 表示只改样式；`removed === true` 表示删掉这个单元格。
 */
export function writeCell(
  xml: string,
  ref: string,
  options: { value?: XlsxCellValue; style?: number; remove?: boolean },
): string {
  const parsed = parseCellRef(ref)
  if (!parsed) return xml
  const rowNumber1 = parsed.row + 1

  const sheetData = /<sheetData\s*\/>/.test(xml)
    ? { start: xml.indexOf("<sheetData"), end: xml.indexOf("<sheetData") + "<sheetData/>".length, empty: true }
    : (() => {
        const start = xml.indexOf("<sheetData")
        if (start === -1) return undefined
        const end = endOfElement(xml, start, "sheetData")
        return end === -1 ? undefined : { start, end, empty: false }
      })()
  if (!sheetData) return xml

  const bodyStart = sheetData.empty ? sheetData.end : xml.indexOf(">", sheetData.start) + 1
  const bodyEnd = sheetData.empty ? sheetData.end : sheetData.end - "</sheetData>".length
  const body = sheetData.empty ? "" : xml.slice(bodyStart, bodyEnd)

  // 找目标行（按行号，不按文档顺序猜）。
  const rows = findAll(body, "row")
  const target = rows.find(
    (span) => rowNumber(body.slice(span.start, body.indexOf(">", span.start) + 1)) === rowNumber1,
  )

  let nextBody: string
  if (!target) {
    const rowXml = `<row r="${rowNumber1}">${buildCell(ref, options.style ?? 0, options.value)}</row>`
    const insertAt = rows.findIndex((span) => {
      const number = rowNumber(body.slice(span.start, body.indexOf(">", span.start) + 1))
      return number !== undefined && number > rowNumber1
    })
    if (insertAt === -1) nextBody = body + rowXml
    else nextBody = body.slice(0, rows[insertAt]!.start) + rowXml + body.slice(rows[insertAt]!.start)
  } else {
    nextBody = writeCellInRow(body, target, parsed.col, ref, options)
  }

  if (sheetData.empty) {
    return xml.slice(0, sheetData.start) + `<sheetData>${nextBody}</sheetData>` + xml.slice(sheetData.end)
  }
  return xml.slice(0, bodyStart) + nextBody + xml.slice(bodyEnd)
}

function writeCellInRow(
  body: string,
  rowSpan: { start: number; openEnd: number; end: number },
  col: number,
  ref: string,
  options: { value?: XlsxCellValue; style?: number; remove?: boolean },
): string {
  const openTag = body.slice(rowSpan.start, rowSpan.openEnd + 1)
  const inner = body.slice(rowSpan.openEnd + 1, rowSpan.end - "</row>".length)
  const cells = findAll(inner, "c")

  const index = cells.findIndex((span) => {
    const name = attribute(inner.slice(span.start, span.openEnd + 1), "r")
    const parsed = name ? parseCellRef(name) : undefined
    return parsed?.col === col
  })

  let nextInner: string
  if (index >= 0) {
    const span = cells[index]!
    if (options.remove) {
      nextInner = inner.slice(0, span.start) + inner.slice(span.end)
    } else if (options.value === undefined) {
      // 只改样式：原地换 `s` 属性，单元格里的值 / 公式 / 富文本一个字都不能动。
      const previous = inner.slice(span.start, span.openEnd + 1)
      const style = options.style ?? Number(attribute(previous, "s") ?? "0")
      const nextOpen = setAttribute(previous, "s", style > 0 ? String(style) : undefined)
      nextInner = inner.slice(0, span.start) + nextOpen + inner.slice(span.openEnd + 1)
    } else {
      const previous = inner.slice(span.start, span.openEnd + 1)
      const style = options.style ?? Number(attribute(previous, "s") ?? "0")
      nextInner = inner.slice(0, span.start) + buildCell(ref, style, options.value) + inner.slice(span.end)
    }
  } else {
    if (options.remove) return body
    const cell = buildCell(ref, options.style ?? 0, options.value)
    const insertAt = cells.findIndex((span) => {
      const name = attribute(inner.slice(span.start, span.openEnd + 1), "r")
      const parsed = name ? parseCellRef(name) : undefined
      return parsed !== undefined && parsed.col > col
    })
    if (insertAt === -1) nextInner = inner + cell
    else nextInner = inner.slice(0, cells[insertAt]!.start) + cell + inner.slice(cells[insertAt]!.start)
  }

  // 整行被删空了就一并去掉这一行，避免留下 `<row r="9"></row>`。
  if (nextInner.trim().length === 0 && options.remove) {
    return body.slice(0, rowSpan.start) + body.slice(rowSpan.end)
  }
  return body.slice(0, rowSpan.openEnd + 1) + nextInner + body.slice(rowSpan.end - "</row>".length)
}

/** 读取某个单元格当前的样式下标；不存在时返回 0。 */
export function cellStyleIndex(xml: string, ref: string): number {
  const parsed = parseCellRef(ref)
  if (!parsed) return 0
  const rows = findAll(xml, "row")
  for (const rowSpan of rows) {
    const tag = xml.slice(rowSpan.start, xml.indexOf(">", rowSpan.start) + 1)
    if (Number(attribute(tag, "r")) !== parsed.row + 1) continue
    const inner = xml.slice(rowSpan.openEnd + 1, rowSpan.end - "</row>".length)
    for (const cellSpan of findAll(inner, "c")) {
      const cellTag = inner.slice(cellSpan.start, cellSpan.openEnd + 1)
      if (attribute(cellTag, "r") !== ref.toUpperCase()) continue
      const style = Number(attribute(cellTag, "s") ?? "0")
      return Number.isFinite(style) ? style : 0
    }
  }
  return 0
}

// ---------------------------------------------------------------------------
// 行 / 列的插入与删除
// ---------------------------------------------------------------------------

export type InsertMode = "insert" | "delete"

/**
 * 行列变换时被引用单元格的映射：
 * `undefined` 表示这个位置被删掉了，调用方应当把整段内容丢掉。
 */
type IndexMap = (value: number) => number | undefined

function indexMap(mode: InsertMode, at: number, count: number): IndexMap {
  const end = at + count
  return (value) => {
    if (mode === "insert") return value >= at ? value + count : value
    if (value >= end) return value - count
    if (value >= at) return undefined
    return value
  }
}

/** 一条区间（合并单元格、列宽）在插入/删除后的新位置。 */
function mapRange(
  start: number,
  end: number,
  mode: InsertMode,
  at: number,
  count: number,
): { start: number; end: number } | undefined {
  const bandEnd = at + count
  if (mode === "insert") {
    // 插在区间内部时区间变长（Excel 会拆开，但那会让用户已有的合并凭空消失）。
    if (start >= at) return { start: start + count, end: end + count }
    if (end >= at) return { start, end: end + count }
    return { start, end }
  }
  if (start >= bandEnd) return { start: start - count, end: end - count }
  if (end < at) return { start, end }
  const overlap = Math.min(end, bandEnd - 1) - Math.max(start, at) + 1
  const nextEnd = end - overlap
  if (nextEnd < start) return undefined
  return { start, end: nextEnd }
}

type RowSpan = { start: number; openEnd: number; end: number; number: number }

function parseRows(body: string): RowSpan[] {
  return findAll(body, "row").map((span) => ({
    ...span,
    number: Number(attribute(body.slice(span.start, span.openEnd + 1), "r")),
  }))
}

/**
 * 重写一个 `<row>`：行号、单元格引用都按映射更新；
 * 被删掉的单元格直接去掉，整行空了就返回 undefined。
 */
function rewriteRow(body: string, span: RowSpan, mapRow: IndexMap, mapCol: IndexMap): string | undefined {
  const nextRow = mapRow(span.number)
  if (nextRow === undefined) return undefined
  const inner = body.slice(span.openEnd + 1, span.end - "</row>".length)
  const cells: string[] = []
  let colChanged = false

  for (const cellSpan of findAll(inner, "c")) {
    const tag = inner.slice(cellSpan.start, cellSpan.openEnd + 1)
    const ref = attribute(tag, "r")
    const parsed = ref ? parseCellRef(ref) : undefined
    if (!parsed) {
      cells.push(inner.slice(cellSpan.start, cellSpan.end))
      continue
    }
    const nextCol = mapCol(parsed.col)
    if (nextCol === undefined) {
      // 整列被删：这个单元格连同内容一起消失。
      colChanged = true
      continue
    }
    if (nextCol !== parsed.col) colChanged = true
    const innerXml = inner.slice(cellSpan.openEnd + 1, cellSpan.end - "</c>".length)
    // 空单元格常写成自闭合 `<c r="A1"/>`；重写时展开成开闭标签，风格统一。
    const openTag = tag.endsWith("/>") ? tag.slice(0, -2) + ">" : tag
    const open = setAttribute(openTag, "r", formatCellRef({ row: nextRow - 1, col: nextCol }))
    cells.push(open + innerXml + "</c>")
  }

  let open = setAttribute(body.slice(span.start, span.openEnd + 1), "r", String(nextRow))
  // spans 是列区间的提示值，列一变就会过期；删掉比留着错的更安全。
  if (colChanged) open = setAttribute(open, "spans", undefined)
  return open + cells.join("") + "</row>"
}

/** 重建 `<sheetData>`；行顺序按原文档顺序保留（编号单调，删行不会打乱）。 */
function rewriteSheetData(
  xml: string,
  transform: (body: string) => string | undefined,
): { xml: string; touched: boolean } {
  const span = findAll(xml, "sheetData")[0]
  if (!span) return { xml, touched: false }
  if (xml.slice(span.start, span.openEnd + 1).endsWith("/>")) return { xml, touched: false }
  const bodyStart = span.openEnd + 1
  const bodyEnd = span.end - "</sheetData>".length
  const next = transform(xml.slice(bodyStart, bodyEnd))
  if (next === undefined) return { xml, touched: false }
  return { xml: xml.slice(0, bodyStart) + next + xml.slice(bodyEnd), touched: true }
}

/** 合并单元格跟着行列移动；被删没的区间直接移除。 */
function rewriteMerges(xml: string, axis: "rows" | "cols", mode: InsertMode, at: number, count: number): string {
  const container = findAll(xml, "mergeCells")[0]
  if (!container) return xml
  const inner = xml.slice(container.openEnd + 1, container.end - "</mergeCells>".length)
  const kept: string[] = []

  for (const span of findAll(inner, "mergeCell")) {
    const tag = inner.slice(span.start, span.openEnd + 1)
    const [startText, endText] = (attribute(tag, "ref") ?? "").split(":")
    const from = parseCellRef(startText ?? "")
    const to = parseCellRef(endText ?? "")
    if (!from || !to) {
      kept.push(inner.slice(span.start, span.end))
      continue
    }
    const range =
      axis === "rows"
        ? mapRange(from.row + 1, to.row + 1, mode, at, count)
        : mapRange(from.col + 1, to.col + 1, mode, at, count)
    if (!range) continue
    const next =
      axis === "rows"
        ? formatCellRef({ row: range.start - 1, col: from.col }) +
          ":" +
          formatCellRef({ row: range.end - 1, col: to.col })
        : formatCellRef({ row: from.row, col: range.start - 1 }) +
          ":" +
          formatCellRef({ row: to.row, col: range.end - 1 })
    kept.push(setAttribute(tag, "ref", next))
  }

  if (kept.length === 0) return xml.slice(0, container.start) + xml.slice(container.end)
  const open = setAttribute(xml.slice(container.start, container.openEnd + 1), "count", String(kept.length))
  return xml.slice(0, container.start) + open + kept.join("") + xml.slice(container.end)
}

/** `<cols>` 里的列宽跟着插入/删除移动。 */
function rewriteCols(xml: string, mode: InsertMode, at: number, count: number): string {
  const container = findAll(xml, "cols")[0]
  if (!container) return xml
  const inner = xml.slice(container.openEnd + 1, container.end - "</cols>".length)
  const kept: string[] = []

  for (const span of findAll(inner, "col")) {
    const tag = inner.slice(span.start, span.openEnd + 1)
    const min = Number(attribute(tag, "min"))
    const max = Number(attribute(tag, "max"))
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      kept.push(tag)
      continue
    }
    const range = mapRange(min, max, mode, at, count)
    if (!range) continue
    let next = setAttribute(tag, "min", String(range.start))
    next = setAttribute(next, "max", String(range.end))
    kept.push(next)
  }

  if (kept.length === 0) return xml.slice(0, container.start) + xml.slice(container.end)
  return xml.slice(0, container.openEnd + 1) + kept.join("") + xml.slice(container.end - "</cols>".length)
}

/**
 * 公式里的 A1 引用跟着移动。
 *
 * - 只处理 `A1` / `$A$1` 这种单表引用；`Sheet2!A1` 属于别的表，不动；
 * - 引号里的字符串不碰（`"A1"` 是文本，不是引用）；
 * - 映射到已删除位置的引用保持原样：删掉整行后公式本来就算错，
 *   但至少有迹可循，比写一个乱码引用好。
 */
export function shiftFormulaReferences(formula: string, mapRow: IndexMap, mapCol: IndexMap): string {
  let out = ""
  let index = 0
  while (index < formula.length) {
    const char = formula[index]!
    if (char === '"') {
      const close = formula.indexOf('"', index + 1)
      const end = close === -1 ? formula.length : close + 1
      out += formula.slice(index, end)
      index = end
      continue
    }
    const match = /^(\$?)([A-Z]{1,3})(\$?)(\d+)/.exec(formula.slice(index))
    if (match) {
      const previous = index === 0 ? "" : formula[index - 1]!
      const parsed = previous === "!" ? undefined : parseCellRef(match[2]! + match[4]!)
      const nextCol = parsed ? mapCol(parsed.col) : undefined
      const nextRow = parsed ? mapRow(parsed.row + 1) : undefined
      if (!parsed || nextCol === undefined || nextRow === undefined) {
        out += match[0]
      } else {
        out += match[1] + indexToColumn(nextCol) + match[3] + nextRow
      }
      index += match[0].length
      continue
    }
    out += char
    index += 1
  }
  return out
}

/** 公式节点里的引用跟着行列变化走：只重写变化的那一侧。 */
function rewriteFormulas(inner: string, mapRow: IndexMap, mapCol: IndexMap, axis: "rows" | "cols"): string {
  let out = ""
  let cursor = 0
  for (const span of findAll(inner, "f")) {
    out += inner.slice(cursor, span.openEnd + 1)
    const body = inner.slice(span.openEnd + 1, span.end - "</f>".length)
    out +=
      axis === "rows"
        ? shiftFormulaReferences(body, mapRow, (value) => value)
        : shiftFormulaReferences(body, (value) => value, mapCol)
    cursor = span.end - "</f>".length
  }
  return out + inner.slice(cursor)
}

/**
 * 插入 / 删除行。
 * `at` 是 1 起的行号：insert 表示「在第 at 行之前插入」，delete 从第 at 行开始删。
 */
export function insertRows(xml: string, at: number, count: number): string {
  return transformAxis(xml, "rows", "insert", at, count)
}

export function deleteRows(xml: string, at: number, count: number): string {
  return transformAxis(xml, "rows", "delete", at, count)
}

/** 列序号 1 起（A=1）。语义同行：insert 在 at 列之前插入。 */
export function insertColumns(xml: string, at: number, count: number): string {
  return transformAxis(xml, "cols", "insert", at, count)
}

export function deleteColumns(xml: string, at: number, count: number): string {
  return transformAxis(xml, "cols", "delete", at, count)
}

function transformAxis(xml: string, axis: "rows" | "cols", mode: InsertMode, at: number, count: number): string {
  // 行号是 1 起，单元格里存的列下标是 0 起 —— 只有列要减 1。
  const map = indexMap(mode, axis === "rows" ? at : at - 1, count)
  const identity: IndexMap = (value) => value
  const result = rewriteSheetData(xml, (body) => {
    const rows = parseRows(body)
    const out: string[] = []
    for (const row of rows) {
      const next = rewriteRow(body, row, axis === "rows" ? map : identity, axis === "cols" ? map : identity)
      if (next === undefined) continue
      out.push(rewriteFormulas(next, axis === "rows" ? map : identity, axis === "cols" ? map : identity, axis))
    }
    const joined = out.join("")
    return joined === body ? undefined : joined
  })
  if (!result.touched) return xml
  let next = result.xml
  next = rewriteMerges(next, axis, mode, at, count)
  if (axis === "cols") next = rewriteCols(next, mode, at, count)
  return updateDimension(next)
}

/**
 * `<dimension ref="A1:D10"/>` 是缓存值，行列一变就该重算；
 * 算不出来就写 A1，Excel/WPS 打开时会自己补全。
 */
function updateDimension(xml: string): string {
  const span = findAll(xml, "dimension")[0]
  if (!span) return xml
  const body = findAll(xml, "sheetData")[0]
  if (!body) return xml
  const inner = xml.slice(body.openEnd + 1, body.end - "</sheetData>".length)
  let maxRow = 0
  let maxCol = 0
  let found = false
  for (const rowSpan of findAll(inner, "row")) {
    const innerRow = inner.slice(rowSpan.openEnd + 1, rowSpan.end - "</row>".length)
    for (const cell of findAll(innerRow, "c")) {
      const ref = attribute(innerRow.slice(cell.start, cell.openEnd + 1), "r")
      const parsed = ref ? parseCellRef(ref) : undefined
      if (!parsed) continue
      found = true
      maxRow = Math.max(maxRow, parsed.row)
      maxCol = Math.max(maxCol, parsed.col)
    }
  }
  const open = xml.slice(span.start, span.openEnd + 1)
  const next = setAttribute(open, "ref", found ? "A1:" + formatCellRef({ row: maxRow, col: maxCol }) : "A1")
  return xml.slice(0, span.start) + next + xml.slice(span.openEnd + 1)
}

// ---------------------------------------------------------------------------
// 合并单元格
// ---------------------------------------------------------------------------

type CellBox = { row: number; col: number }

function normalizeBox(from: CellBox, to: CellBox): { start: CellBox; end: CellBox } {
  return {
    start: { row: Math.min(from.row, to.row), col: Math.min(from.col, to.col) },
    end: { row: Math.max(from.row, to.row), col: Math.max(from.col, to.col) },
  }
}

/** 把 `<mergeCells>` 里的每一段读成单元格框。 */
function readMerges(xml: string): Array<{ span: { start: number; end: number }; from: CellBox; to: CellBox }> {
  const container = findAll(xml, "mergeCells")[0]
  if (!container) return []
  const inner = xml.slice(container.openEnd + 1, container.end - "</mergeCells>".length)
  const out: Array<{ span: { start: number; end: number }; from: CellBox; to: CellBox }> = []
  for (const span of findAll(inner, "mergeCell")) {
    const [startText, endText] = (attribute(inner.slice(span.start, span.openEnd + 1), "ref") ?? "").split(":")
    const from = parseCellRef(startText ?? "")
    const to = parseCellRef(endText ?? "")
    if (!from || !to) continue
    const box = normalizeBox(from, to)
    out.push({ span: { start: span.start, end: span.end }, from: box.start, to: box.end })
  }
  return out
}

function intersects(a: { from: CellBox; to: CellBox }, b: { start: CellBox; end: CellBox }): boolean {
  return a.from.row <= b.end.row && a.to.row >= b.start.row && a.from.col <= b.end.col && a.to.col >= b.start.col
}

/**
 * 合并一块区域。
 *
 * 和 Excel 一样：与目标区域重叠的旧合并先去掉，否则 Excel 会判定文件损坏。
 * 只有左上角单元格的值会显示，其它单元格的值保留（取消合并后能再看到）。
 */
export function mergeRange(xml: string, from: CellBox, to: CellBox): string {
  const box = normalizeBox(from, to)
  if (box.start.row === box.end.row && box.start.col === box.end.col) return xml
  const next = unmergeRange(xml, box.start, box.end)
  const container = findAll(next, "mergeCells")[0]
  const ref = formatCellRef(box.start) + ":" + formatCellRef(box.end)
  const entry = '<mergeCell ref="' + ref + '"/>'

  if (!container) {
    const sheetData = findAll(next, "sheetData")[0]
    if (!sheetData) return next
    // schema 顺序：mergeCells 紧跟在 sheetData 之后。
    return next.slice(0, sheetData.end) + '<mergeCells count="1">' + entry + "</mergeCells>" + next.slice(sheetData.end)
  }

  const inner = next.slice(container.openEnd + 1, container.end - "</mergeCells>".length)
  const count = readMerges(next).length + 1
  const open = setAttribute(next.slice(container.start, container.openEnd + 1), "count", String(count))
  return next.slice(0, container.start) + open + inner + entry + next.slice(container.end)
}

/** 取消一块区域上的合并：与区域相交的合并全部去掉（和编辑器的直觉一致）。 */
export function unmergeRange(xml: string, from: CellBox, to: CellBox): string {
  const box = normalizeBox(from, to)
  const container = findAll(xml, "mergeCells")[0]
  if (!container) return xml
  const inner = xml.slice(container.openEnd + 1, container.end - "</mergeCells>".length)
  const merges = readMerges(xml)
  if (merges.every((merge) => !intersects(merge, box))) return xml

  const kept: string[] = []
  for (const merge of merges) {
    if (intersects(merge, box)) continue
    kept.push(inner.slice(merge.span.start, merge.span.end))
  }
  if (kept.length === 0) return xml.slice(0, container.start) + xml.slice(container.end)
  const open = setAttribute(xml.slice(container.start, container.openEnd + 1), "count", String(kept.length))
  return xml.slice(0, container.start) + open + kept.join("") + xml.slice(container.end)
}

/**
 * 清空一块区域：删掉范围内的 `<c>`，行删空就整行去掉。
 *
 * 这是 `remove /Sheet1/A1:B2` 的实现（remove 区域定义为「清空单元格」）。
 * 一次扫描 body，从后往前改 span，大区域也不会退化成逐格重扫。
 */
export function clearRange(xml: string, from: CellBox, to: CellBox): { xml: string; cleared: number } {
  const box = normalizeBox(from, to)
  const sheetData = findElement(xml, "sheetData")
  if (!sheetData) return { xml, cleared: 0 }

  const bodyStart = sheetData.openEnd + 1
  const bodyEnd = sheetData.end - "</sheetData>".length
  const body = xml.slice(bodyStart, bodyEnd)
  const rows = findAll(body, "row")
  let cleared = 0
  const edits: Array<{ start: number; end: number; replace?: string }> = []

  for (const rowSpan of rows) {
    const rowTag = body.slice(rowSpan.start, rowSpan.openEnd + 1)
    const rowNumber = Number(attribute(rowTag, "r")) - 1
    if (!Number.isFinite(rowNumber) || rowNumber < box.start.row || rowNumber > box.end.row) continue

    const innerStart = rowSpan.openEnd + 1
    const innerEnd = rowSpan.end - "</row>".length
    const inner = body.slice(innerStart, innerEnd)
    const cells = findAll(inner, "c")
    const hits = cells.filter((cell) => {
      const ref = attribute(inner.slice(cell.start, cell.openEnd + 1), "r")
      const parsed = ref ? parseCellRef(ref) : undefined
      return (
        parsed !== undefined &&
        parsed.row >= box.start.row &&
        parsed.row <= box.end.row &&
        parsed.col >= box.start.col &&
        parsed.col <= box.end.col
      )
    })
    if (hits.length === 0) continue
    cleared += hits.length

    if (hits.length === cells.length) {
      edits.push({ start: rowSpan.start, end: rowSpan.end })
      continue
    }
    let nextInner = inner
    for (let index = hits.length - 1; index >= 0; index -= 1) {
      const span = hits[index]!
      nextInner = nextInner.slice(0, span.start) + nextInner.slice(span.end)
    }
    edits.push({ start: innerStart, end: innerEnd, replace: nextInner })
  }

  // 从后往前替换：前面的 span 坐标不受后面删改影响。
  let nextBody = body
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index]!
    nextBody = nextBody.slice(0, edit.start) + (edit.replace ?? "") + nextBody.slice(edit.end)
  }
  return { xml: xml.slice(0, bodyStart) + nextBody + xml.slice(bodyEnd), cleared }
}
