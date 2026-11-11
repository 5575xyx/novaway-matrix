/**
 * 旧格式的写入：ODF（odt / ods / odp）的就地编辑。
 *
 * 和 docx / pptx 一样是外科手术：只改 `content.xml` 里被点中的那几个
 * `<text:p>` / `<text:table-cell>`，包内其它条目逐字节原样保留。
 * 改完仍是原格式，不需要「另存为」。
 *
 * 支持的粒度刻意保守：
 *   - 文档 / 演示：段落文字、插入、删除、段落对齐与行内粗体/斜体/下划线/字号/颜色；
 *   - 表格：单元格的值（文本或数字）；
 *   - 写不了的（整份重排、图表、公式、图片）明确拒绝，不猜。
 *
 * 样式不是直接改用户原有的样式，而是新建 `Nw*` 自动样式再引用 ——
 * 这样不会改到模板里同名样式的其它段落。
 */
import type { ApplyOutcome, OfficeOp, OfficeResult } from "../engine/contract"
import { fail, ok } from "../engine/contract"
import { inflateEntry, rebuildZip, readZip, type ZipArchive } from "../engine/zip"
import { readLegacyDocument, type LegacyDocument } from "./read"

const CONTENT_ENTRY = "content.xml"

type ParagraphSpan = {
  start: number
  openEnd: number
  end: number
  tag: string
  attrs: string
  selfClosing: boolean
}

function escapeOdfText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function escapeOdfAttribute(value: string): string {
  return escapeOdfText(value).replace(/"/g, "&quot;")
}

/** 空格必须写成 `<text:s>`，否则连续的 / 行首行尾的空格会被阅读器吞掉。 */
function odfInline(text: string): string {
  const parts: string[] = []
  for (const segment of text.split("\n")) {
    if (parts.length > 0) parts.push("<text:line-break/>")
    for (const piece of segment.match(/[ ]+|[^ ]+/g) ?? []) {
      if (piece[0] === " ") {
        parts.push(piece.length > 1 ? '<text:s text:c="' + piece.length + '"/>' : "<text:s/>")
        continue
      }
      parts.push(escapeOdfText(piece))
    }
  }
  return parts.join("")
}

/** 按文档顺序列出所有 text:h / text:p；表格单元格里的段落也在内。 */
function paragraphSpans(xml: string): ParagraphSpan[] {
  const spans: ParagraphSpan[] = []
  const pattern = /<text:(h|p)\b([^>]*?)(\/?)>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) {
    const tag = "text:" + match[1]
    const selfClosing = match[3] === "/"
    const openEnd = match.index + match[0].length
    if (selfClosing) {
      spans.push({ start: match.index, openEnd, end: openEnd, tag, attrs: match[2] ?? "", selfClosing })
      continue
    }
    const close = xml.indexOf("</" + tag + ">", openEnd)
    if (close === -1) continue
    spans.push({
      start: match.index,
      openEnd,
      end: close + ("</" + tag + ">").length,
      tag,
      attrs: match[2] ?? "",
      selfClosing,
    })
    pattern.lastIndex = openEnd
  }
  return spans
}

function fnv(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

type AutoStyle = {
  family: "text" | "paragraph"
  /** `<style:text-properties …/>` 里的属性串。 */
  properties: string
  /** 段落样式可以挂一个父样式，继承原有字号、字体。 */
  parent?: string
}

/**
 * 新建（或复用）一条自动样式，返回样式名。
 * 找不到 `<office:automatic-styles>` 时按 ODF 的元素顺序补在 `<office:body>` 之前。
 */
function ensureAutoStyle(xml: string, style: AutoStyle): { xml: string; name: string } {
  const name =
    "Nw" +
    (style.family === "text" ? "T" : "P") +
    fnv(style.family + "|" + style.properties + "|" + (style.parent ?? ""))
  if (xml.includes('style:name="' + name + '"')) return { xml, name }
  const block =
    '<style:style style:name="' +
    name +
    '" style:family="' +
    style.family +
    '"' +
    (style.parent ? ' style:parent-style-name="' + escapeOdfAttribute(style.parent) + '"' : "") +
    "><style:" +
    style.family +
    "-properties " +
    style.properties +
    "/></style:style>"

  const close = xml.indexOf("</office:automatic-styles>")
  if (close !== -1) return { xml: xml.slice(0, close) + block + xml.slice(close), name }
  const body = xml.indexOf("<office:body")
  if (body === -1) return { xml, name }
  return {
    xml: xml.slice(0, body) + "<office:automatic-styles>" + block + "</office:automatic-styles>" + xml.slice(body),
    name,
  }
}

type SpanEdit = { paragraph: number; text: string }
type StyleEdit = { paragraph: number; style: NonNullable<Extract<OfficeOp, { op: "setParagraphStyle" }>["style"]> }
type InsertEdit = { after: number; text: string }

function styleProperties(style: StyleEdit["style"]): string {
  const props: string[] = []
  if (style.bold !== undefined) props.push('fo:font-weight="' + (style.bold ? "bold" : "normal") + '"')
  if (style.italic !== undefined) props.push('fo:font-style="' + (style.italic ? "italic" : "normal") + '"')
  if (style.underline !== undefined)
    props.push('style:text-underline-style="' + (style.underline ? "solid" : "none") + '"')
  if (style.size !== undefined) props.push('fo:font-size="' + style.size + 'pt"')
  if (style.color !== undefined) props.push('fo:color="#' + style.color.replace(/^#/, "") + '"')
  if (style.font !== undefined) props.push('style:font-name="' + escapeOdfAttribute(style.font) + '"')
  return props.join(" ")
}

const ALIGN_BY_CODE: Record<string, string> = {
  l: "start",
  ctr: "center",
  r: "end",
  just: "justify",
}

function existingAttribute(attrs: string, name: string): string | undefined {
  return new RegExp("\b" + name + '="([^"]*)"').exec(attrs)?.[1]
}

/** attrs 是不带尖括号的属性串；value 为 undefined 表示删掉这个属性。 */
function setAttribute(attrs: string, name: string, value: string | undefined): string {
  const pattern = new RegExp("\s*" + name + '="[^"]*"')
  const without = attrs.replace(pattern, "")
  if (value === undefined || value === "") return without
  return without + " " + name + '="' + escapeOdfAttribute(value) + '"'
}

/** 段落级别的属性：对齐 / 命名样式。 */
function applyParagraphStyle(xml: string, span: ParagraphSpan, style: StyleEdit["style"]): string {
  let attrs = span.attrs
  let next = xml
  let target = span
  if (style.paragraphStyle !== undefined) {
    attrs = setAttribute(attrs, "text:style-name", style.paragraphStyle || undefined)
  }
  if (style.align !== undefined) {
    const prepared = ensureAutoStyle(next, {
      family: "paragraph",
      properties: 'fo:text-align="' + (ALIGN_BY_CODE[style.align] ?? "start") + '"',
      parent: existingAttribute(attrs, "text:style-name"),
    })
    next = prepared.xml
    attrs = setAttribute(attrs, "text:style-name", prepared.name)
  }
  if (attrs === span.attrs) return next
  // 自动样式插在 body 之前，段落偏移要跟着后移。
  const shift = next.length - xml.length
  target = { ...span, start: span.start + shift, openEnd: span.openEnd + shift, end: span.end + shift }
  const head = "<" + target.tag + attrs + (target.selfClosing ? "/>" : ">")
  return next.slice(0, target.start) + head + next.slice(target.openEnd)
}

/** 行内格式：把段落内容包进一个带自动样式的 text:span。 */
function applyRunStyle(xml: string, span: ParagraphSpan, style: StyleEdit["style"]): string {
  const properties = styleProperties(style)
  if (!properties) return xml
  const prepared = ensureAutoStyle(xml, { family: "text", properties })
  // 自动样式插在 body 之前，段落偏移要跟着后移。
  const shift = prepared.xml.length - xml.length
  const target: ParagraphSpan = {
    ...span,
    start: span.start + shift,
    openEnd: span.openEnd + shift,
    end: span.end + shift,
  }
  const close = "</" + target.tag + ">"
  const inner = target.selfClosing ? "" : prepared.xml.slice(target.openEnd, target.end)
  const withoutClose = inner.endsWith(close) ? inner.slice(0, -close.length) : inner
  const wrapped = '<text:span text:style-name="' + prepared.name + '">' + withoutClose + "</text:span>"
  const head = "<" + target.tag + target.attrs + ">"
  return prepared.xml.slice(0, target.start) + head + wrapped + close + prepared.xml.slice(target.end)
}

// ---------------------------------------------------------------------------
// 表格：ODS 的单元格
// ---------------------------------------------------------------------------

type CellSpan = { start: number; end: number; attrs: string; inner: string; selfClosing: boolean; repeat: number }

function rowSpans(xml: string, from: number, to: number): Array<{ start: number; end: number }> {
  const rows: Array<{ start: number; end: number }> = []
  const pattern = /<table:table-row\b([^>]*?)(\/?)>/g
  pattern.lastIndex = from
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null && match.index < to) {
    const openEnd = match.index + match[0].length
    if (match[2] === "/") {
      rows.push({ start: match.index, end: openEnd })
      continue
    }
    const close = xml.indexOf("</table:table-row>", openEnd)
    if (close === -1) break
    rows.push({ start: match.index, end: close + "</table:table-row>".length })
    pattern.lastIndex = openEnd
  }
  return rows
}

function cellSpans(xml: string, row: { start: number; end: number }): CellSpan[] {
  const cells: CellSpan[] = []
  const pattern = /<table:(table-cell|covered-table-cell)\b([^>]*?)(\/?)>/g
  pattern.lastIndex = row.start
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null && match.index < row.end) {
    const attrs = match[2] ?? ""
    const openEnd = match.index + match[0].length
    const repeat = Math.max(1, Number(/table:number-columns-repeated="(\d+)"/.exec(attrs)?.[1] ?? 1))
    const close = "</table:" + match[1] + ">"
    if (match[3] === "/") {
      cells.push({ start: match.index, end: openEnd, attrs, inner: "", selfClosing: true, repeat })
      continue
    }
    const closeAt = xml.indexOf(close, openEnd)
    if (closeAt === -1) break
    cells.push({
      start: match.index,
      end: closeAt + close.length,
      attrs,
      inner: xml.slice(openEnd, closeAt),
      selfClosing: false,
      repeat,
    })
    pattern.lastIndex = openEnd
  }
  return cells
}

function cellXml(attrs: string, inner: string | undefined): string {
  const cleaned = setAttribute(attrs, "table:number-columns-repeated", undefined)
  if (inner === undefined) return "<table:table-cell" + cleaned + "/>"
  return "<table:table-cell" + cleaned + ">" + inner + "</table:table-cell>"
}

function withCellValue(attrs: string, value: string | number): { attrs: string; inner: string } {
  const numeric = typeof value === "number" && Number.isFinite(value)
  let next = setAttribute(attrs, "office:value-type", numeric ? "float" : "string")
  next = setAttribute(next, "office:value", numeric ? String(value) : undefined)
  return { attrs: next, inner: "<text:p>" + odfInline(String(value)) + "</text:p>" }
}

/** 找到工作表 → 行 → 列，只替换那一个单元格；重复列会被展开。 */
function setCellValue(
  xml: string,
  sheet: string,
  row: number,
  col: number,
  value: string | number,
): OfficeResult<string> {
  const special = ".*+?^$()|[]" + String.fromCharCode(92)
  const name = [...sheet].map((char) => (special.includes(char) ? String.fromCharCode(92) + char : char)).join("")
  const tableOpen = new RegExp('<table:table\\b[^>]*table:name="' + name + '"[^>]*>').exec(xml)
  if (!tableOpen) return fail("not_found", "找不到工作表：" + sheet)
  const openEnd = tableOpen.index + tableOpen[0].length
  const close = xml.indexOf("</table:table>", openEnd)
  if (close === -1) return fail("open_failed", "工作表没有闭合：" + sheet)

  const rows = rowSpans(xml, openEnd, close)
  const target = rows[row]
  if (!target) return fail("not_found", "没有第 " + (row + 1) + " 行")

  const cells = cellSpans(xml, target)
  let cursor = 0
  let hit: CellSpan | undefined
  let offset = 0
  for (const cell of cells) {
    if (col >= cursor && col < cursor + cell.repeat) {
      hit = cell
      offset = col - cursor
      break
    }
    cursor += cell.repeat
  }
  if (!hit) {
    if (col < cursor) return fail("not_found", "这一行没有第 " + (col + 1) + " 列（只有 " + cursor + " 列）")
    // 写到了行尾之外：补空单元格。用户就是想在空表格里填一个值，不该报「没有这一列」。
    const valueXml = withCellValue("", value)
    const filler = "<table:table-cell/>".repeat(col - cursor)
    const cell = cellXml(valueXml.attrs, valueXml.inner)
    const rowClose = xml.lastIndexOf("</table:table-row>", target.end)
    if (rowClose === -1 || rowClose < target.start) {
      // 自闭合行：先展开成成对标签。
      const open = xml.slice(target.start, target.end - 1) + ">"
      const block = open + filler + cell + "</table:table-row>"
      return ok(xml.slice(0, target.start) + block + xml.slice(target.end))
    }
    return ok(xml.slice(0, rowClose) + filler + cell + xml.slice(rowClose))
  }

  const valueXml = withCellValue(hit.attrs, value)
  const replaced =
    hit.repeat === 1
      ? cellXml(valueXml.attrs, valueXml.inner)
      : Array.from({ length: hit.repeat }, (_item, index) =>
          index === offset ? cellXml(valueXml.attrs, valueXml.inner) : cellXml(hit!.attrs, undefined),
        ).join("")

  return ok(xml.slice(0, hit.start) + replaced + xml.slice(hit.end))
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 应用一批操作到 ODF。任何一步失败都不返回新字节（全有或全无）。
 * 下标以**原文**为准：先假设所有段落都还在，最后再统一做插入 / 删除。
 */
export async function editOdf(
  bytes: Uint8Array,
  ops: readonly OfficeOp[],
): Promise<OfficeResult<ApplyOutcome<LegacyDocument>>> {
  const zip: ZipArchive = await readZip(bytes)
  const entry = zip.entries.find((item) => item.name === CONTENT_ENTRY)
  if (!entry) return fail("open_failed", "这不是有效的 OpenDocument 文件（缺少 content.xml）")

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let xml = decoder.decode(await inflateEntry(zip, entry))

  const textEdits: SpanEdit[] = []
  const styleEdits: StyleEdit[] = []
  const insertEdits: InsertEdit[] = []
  const deleteEdits: number[] = []
  const cellEdits: Array<{ sheet: string; row: number; col: number; value: string | number }> = []
  const applied: unknown[] = []

  for (const op of ops) {
    if (op.op === "setParagraphText" || op.op === "setSpanText") {
      textEdits.push({ paragraph: op.paragraph, text: op.text })
      applied.push(op)
      continue
    }
    if (op.op === "setParagraphStyle") {
      styleEdits.push({ paragraph: op.paragraph, style: op.style })
      applied.push(op)
      continue
    }
    if (op.op === "insertParagraph") {
      insertEdits.push({ after: op.after, text: op.text })
      applied.push(op)
      continue
    }
    if (op.op === "deleteParagraph") {
      deleteEdits.push(op.paragraph)
      applied.push(op)
      continue
    }
    if (op.op === "setCellValue") {
      if (typeof op.value === "object") {
        return fail("unsupported_format", "旧格式暂不支持写公式", "请另存为 xlsx 后再写公式；旧格式可以写文本和数字")
      }
      cellEdits.push({ sheet: op.sheet, row: op.ref.row, col: op.ref.col, value: op.value })
      applied.push(op)
      continue
    }
    return fail(
      "unsupported_format",
      op.op + " 暂不支持旧格式",
      "旧格式目前能改：段落文字、段落格式、插入/删除段落、单元格值；其它请另存为 docx / xlsx / pptx",
    )
  }

  const spans = paragraphSpans(xml)
  for (const edit of textEdits) {
    if (!spans[edit.paragraph - 1]) {
      return fail("not_found", "没有第 " + edit.paragraph + " 段（共 " + spans.length + " 段）")
    }
  }
  for (const edit of styleEdits) {
    if (!spans[edit.paragraph - 1]) {
      return fail("not_found", "没有第 " + edit.paragraph + " 段（共 " + spans.length + " 段）")
    }
  }
  for (const index of deleteEdits) {
    if (!spans[index - 1]) return fail("not_found", "没有第 " + index + " 段（共 " + spans.length + " 段）")
  }
  if (deleteEdits.length > 0 && deleteEdits.length >= spans.length) {
    return fail("unsupported_format", "最后一段不能删：文档至少保留一个段落")
  }
  for (const edit of insertEdits) {
    if (!Number.isInteger(edit.after) || edit.after < 0 || edit.after > spans.length) {
      return fail("not_found", "插入位置超出范围：0 到 " + spans.length)
    }
  }

  // 1) 文字：从后往前，避免前面的修改让后面的偏移失效。
  const byText = [...textEdits].sort((a, b) => b.paragraph - a.paragraph)
  for (const edit of byText) {
    const span = spans[edit.paragraph - 1]!
    const close = "</" + span.tag + ">"
    const inner = span.selfClosing ? odfInline(edit.text) : odfInline(edit.text)
    const head = span.selfClosing ? "<" + span.tag + span.attrs + ">" : xml.slice(span.start, span.openEnd)
    xml = xml.slice(0, span.start) + head + inner + close + xml.slice(span.end)
  }

  // 2) 格式：同样是段落级别，逆序稳妥。
  const byStyle = [...styleEdits].sort((a, b) => b.paragraph - a.paragraph)
  for (const edit of byStyle) {
    const span = spans[edit.paragraph - 1]!
    if (edit.style.align !== undefined || edit.style.paragraphStyle !== undefined) {
      const current = paragraphSpans(xml).find((item) => item.start === span.start) ?? span
      xml = applyParagraphStyle(xml, current, edit.style)
    }
    if (styleProperties(edit.style)) {
      const current = paragraphSpans(xml).find((item) => item.start === span.start) ?? span
      xml = applyRunStyle(xml, current, edit.style)
    }
  }

  // 3) 结构：插入 / 删除按位置从后往前，避免偏移失效。
  type Structural = { at: number; end?: number; text?: string; tag: string; attrs: string }
  const structural: Structural[] = []
  for (const index of deleteEdits) {
    const span = spans[index - 1]!
    structural.push({ at: span.start, end: span.end, tag: span.tag, attrs: span.attrs })
  }
  for (const edit of insertEdits) {
    if (edit.after === 0) {
      const first = spans[0]
      const at = first ? first.start : xml.indexOf("<office:body")
      if (at === -1) return fail("open_failed", "文档没有正文（office:body）")
      structural.push({ at, text: edit.text, tag: first?.tag ?? "text:p", attrs: first?.attrs ?? "" })
      continue
    }
    const anchor = spans[edit.after - 1]!
    structural.push({ at: anchor.end, text: edit.text, tag: anchor.tag, attrs: anchor.attrs })
  }
  structural.sort((a, b) => b.at - a.at)
  for (const item of structural) {
    if (item.end !== undefined) {
      xml = xml.slice(0, item.at) + xml.slice(item.end)
      continue
    }
    const paragraph = "<" + item.tag + item.attrs + ">" + odfInline(item.text ?? "") + "</" + item.tag + ">"
    xml = xml.slice(0, item.at) + paragraph + xml.slice(item.at)
  }

  // 4) 单元格：和段落互不影响，最后做。
  for (const edit of cellEdits) {
    const result = setCellValue(xml, edit.sheet, edit.row, edit.col, edit.value)
    if (!result.ok) return result
    xml = result.data
  }

  const nextBytes = await rebuildZip(zip, new Map([[CONTENT_ENTRY, encoder.encode(xml)]]))
  const nextState = await readLegacyDocument(nextBytes, odfExtensionOf(xml))
  return ok({ state: nextState, bytes: nextBytes, changed: [CONTENT_ENTRY], applied })
}

/** 从 content.xml 的顶层元素判断具体是 odt / ods / odp。 */
function odfExtensionOf(xml: string): string {
  if (xml.includes("<office:presentation")) return "odp"
  if (xml.includes("<office:spreadsheet")) return "ods"
  return "odt"
}
