/**
 * 工作表中单元格的定位与改写。
 *
 * 和 DOCX/PPTX 一样，只改原始 XML 文本：`xl/worksheets/sheetN.xml` 里被点中的
 * 那一个 `<c>` 换掉，行、列、合并、条件格式、数据验证、图表锚点全部原样保留。
 *
 * OOXML 对顺序很挑：`<row>` 必须按行号递增，`<c>` 必须按列号递增。
 * 所以插入新单元格/新行时做有序插入，而不是追加到末尾。
 */

import { parseCellRef } from "./contract"
import { attribute, decodeXmlText, endOfElement, encodeXmlText, findAll } from "./xml"

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
  return { name, path, cells, lastRow, lastCol }
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
  const target = rows.find((span) => rowNumber(body.slice(span.start, body.indexOf(">", span.start) + 1)) === rowNumber1)

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
