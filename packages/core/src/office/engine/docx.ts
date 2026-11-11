/**
 * DOCX 引擎：段落级文字与格式的原地修改。
 *
 * 和 PPTX 同一套思路（宿主 + 编辑器适配层）。
 */
import type { ApplyOutcome, OfficeEngine, OfficeOp, OfficeResult, ParagraphStylePatch } from "./contract"
import { fail, ok } from "./contract"
import { attribute, decodeXmlText, encodeXmlText, findAll, findElement, setAttribute } from "./xml"
import { inflateEntry, readZip, rebuildZip, type ZipArchive } from "./zip"
import { editDocxTable, type DocxTableOp } from "./docx-table"
import { paragraphsToHtml, paragraphsToMarkdown, paragraphsToText } from "./export"
import { printToPdf, type PrintImage } from "../pdf/print"

export type DocxAlign = "left" | "center" | "right" | "both"

/** 一段的可编辑视图。index 是 /body/p[N] 里的 N（1 起）。 */
export type DocxParagraph = {
  index: number
  text: string
  /** 段落样式名（w:pStyle w:val），如 Heading1、Title。 */
  style?: string
  align?: DocxAlign
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** 删除线。 */
  strike?: boolean
  /** pt */
  size?: number
  /** RRGGBB */
  color?: string
  /** 文字底纹（高亮），RRGGBB。 */
  highlight?: string
  /** 行距倍数。 */
  lineSpacing?: number
  /** 首行缩进，pt。 */
  firstLineIndent?: number
  /** 左缩进，pt。 */
  indent?: number
  font?: string
  /** 该段落是否在表格里（写回时不影响定位，只用于 UI 提示）。 */
  inTable?: boolean
  /** 在表格里时：第几张表、第几行、第几列（都从 1 起），用于表格结构编辑。 */
  cell?: { table: number; row: number; col: number }
  /** 列表段落（w:numPr）：kind 由 numbering.xml 的 numFmt 决定。 */
  list?: { kind: "bullet" | "number"; level: number }
}

export type DocxState = {
  paragraphs: DocxParagraph[]
  /** 默认页眉的文字（多段用换行连接）；没有页眉时为 undefined。 */
  header?: string
  /** 默认页脚的文字；没有页脚时为 undefined。 */
  footer?: string
  /** 文档当前的页面设置（纸张 / 方向 / 页边距 mm）；没有 sectPr 时为 undefined。 */
  pageSetup?: DocxPageSetup
}

type ParagraphSpan = {
  index: number
  start: number
  end: number
  inTable: boolean
}

const DOCUMENT_ENTRY = "word/document.xml"
const DOCUMENT_RELS = "word/_rels/document.xml.rels"

/** base64 → 字节；不合法返回 undefined（图片推送来的数据不能直接信）。 */
function decodeBase64(value: string): Uint8Array | undefined {
  const body = value.includes(",") && value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value
  try {
    const binary = atob(body.replace(/\s+/g, ""))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return undefined
  }
}

/**
 * 收集所有 w:p，文档顺序、含表格里的段落。
 * 顺序与 docx-preview 渲染出来的 p 顺序一致，UI 才能按下标对上号。
 */
function collectParagraphs(xml: string): ParagraphSpan[] {
  return findAll(xml, "w:p").map((span, position) => ({
    index: position + 1,
    start: span.start,
    end: span.end,
    inTable: insideTable(xml, span.start),
  }))
}

function insideTable(xml: string, position: number): boolean {
  const open = xml.lastIndexOf("<w:tbl>", position)
  const openAttrs = xml.lastIndexOf("<w:tbl ", position)
  const start = Math.max(open, openAttrs)
  if (start === -1) return false
  const close = xml.lastIndexOf("</w:tbl>", position)
  return close < start
}

function paragraphBody(xml: string, span: ParagraphSpan): string {
  const openEnd = xml.indexOf(">", span.start)
  return xml.slice(openEnd + 1, span.end - "</w:p>".length)
}

function paragraphText(body: string): string {
  return findAll(body, "w:t")
    .map((item) => decodeXmlText(body.slice(body.indexOf(">", item.start) + 1, item.end - "</w:t>".length)))
    .join("")
}

function firstRunProps(body: string): string | undefined {
  const run = findElement(body, "w:r")
  if (!run) return undefined
  const inner = body.slice(run.openEnd + 1, run.end)
  const props = findElement(inner, "w:rPr")
  return props ? inner.slice(props.start, props.end) : undefined
}

function readStyle(body: string, paragraphProps: string | undefined): Omit<DocxParagraph, "index" | "text"> {
  const rPr = firstRunProps(body) ?? ""
  const pPr = paragraphProps ?? ""
  const styleMatch = /<w:pStyle\b[^>]*>/.exec(pPr)
  const jcMatch = /<w:jc\b[^>]*>/.exec(pPr)
  const bold = /<w:b\b(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(rPr)
  const italic = /<w:i\b(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(rPr)
  const underline = /<w:u\b[^>]*>/.test(rPr)
  const strike = /<w:strike\b[^>]*>/.test(rPr)
  const size = /<w:sz\b[^>]*\bw:val="(\d+)"/.exec(rPr)
  const color = /<w:color\b[^>]*\bw:val="([0-9A-Fa-f]{6})"/.exec(rPr)
  const highlight = /<w:shd\b[^>]*\bw:fill="([0-9A-Fa-f]{6})"/.exec(rPr)
  const line = /<w:spacing\b[^>]*\bw:line="(\d+)"/.exec(pPr)
  const firstLine = /<w:ind\b[^>]*\bw:firstLine="(\d+)"/.exec(pPr)
  const leftIndent = /<w:ind\b[^>]*\bw:left="(\d+)"/.exec(pPr)
  const fonts = /<w:rFonts\b[^>]*>/.exec(rPr)
  return {
    ...(styleMatch ? { style: attribute(styleMatch[0], "w:val") } : {}),
    ...(jcMatch ? { align: attribute(jcMatch[0], "w:val") as DocxAlign | undefined } : {}),
    ...(bold ? { bold: true } : {}),
    ...(italic ? { italic: true } : {}),
    ...(underline ? { underline: true } : {}),
    ...(strike ? { strike: true } : {}),
    ...(size ? { size: Number(size[1]) / 2 } : {}),
    ...(color ? { color: color[1]!.toUpperCase() } : {}),
    ...(highlight ? { highlight: highlight[1]!.toUpperCase() } : {}),
    ...(line ? { lineSpacing: Number(line[1]) / 240 } : {}),
    ...(firstLine ? { firstLineIndent: Number(firstLine[1]) / 20 } : {}),
    ...(leftIndent ? { indent: Number(leftIndent[1]) / 20 } : {}),
    ...(fonts
      ? {
          font: attribute(fonts[0], "w:eastAsia") ?? attribute(fonts[0], "w:ascii") ?? attribute(fonts[0], "w:hAnsi"),
        }
      : {}),
  }
}

/** numId → 每级的编号格式；由 word/numbering.xml 解析而来。 */
export type DocxNumbering = Map<string, Map<number, "bullet" | "number">>

/**
 * 读 numbering.xml：`numId` 只是别名，真正的格式挂在 `abstractNum` 的每一级上。
 * bullet / none 算项目符号，其余（decimal / upperRoman / lowerLetter…）都算编号。
 */
export function readDocxNumbering(xml: string): DocxNumbering {
  const abstracts = new Map<string, Map<number, "bullet" | "number">>()
  for (const match of xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const levels = new Map<number, "bullet" | "number">()
    for (const lvl of match[2]!.matchAll(/<w:lvl\b([^>]*)>([\s\S]*?)<\/w:lvl>/g)) {
      const level = Number(/w:ilvl="(\d+)"/.exec(lvl[1]!)?.[1] ?? 0)
      const format = /<w:numFmt\b[^>]*w:val="([^"]+)"/.exec(lvl[2]!)?.[1]
      levels.set(level, format === "bullet" || format === "none" ? "bullet" : "number")
    }
    abstracts.set(match[1]!, levels)
  }

  const numbering: DocxNumbering = new Map()
  for (const match of xml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
    const target = /<w:abstractNumId\b[^>]*w:val="(\d+)"/.exec(match[2]!)?.[1]
    const levels = target ? abstracts.get(target) : undefined
    if (levels) numbering.set(match[1]!, levels)
  }
  return numbering
}

/** 段落属性里的 w:numPr → 列表信息；没有 numPr 就是普通段落。 */
function readList(paragraphProps: string, numbering: DocxNumbering | undefined): DocxParagraph["list"] | undefined {
  const numId = /<w:numId\b[^>]*w:val="(\d+)"/.exec(paragraphProps)?.[1]
  if (!numId) return undefined
  const level = Number(/<w:ilvl\b[^>]*w:val="(\d+)"/.exec(paragraphProps)?.[1] ?? 0)
  // 找不到 numbering.xml 时按项目符号展示：总比把列表吞成正文好。
  const kind = numbering?.get(numId)?.get(level) ?? "bullet"
  return { kind, level }
}

/**
 * 段落绝对位置 → 表格坐标。只统计最外层表格；嵌套表格里的段落会落到外层格子里，
 * 这对「选中一段，给这张表加一行」来说已经够用。
 */
function tableCoordinates(xml: string): Map<number, { table: number; row: number; col: number }> {
  const coordinates = new Map<number, { table: number; row: number; col: number }>()
  findAll(xml, "w:tbl").forEach((tableSpan, tableIndex) => {
    const tableXml = xml.slice(tableSpan.start, tableSpan.end)
    findAll(tableXml, "w:tr").forEach((rowSpan, rowIndex) => {
      const rowXml = tableXml.slice(rowSpan.start, rowSpan.end)
      findAll(rowXml, "w:tc").forEach((cellSpan, colIndex) => {
        const cellXml = rowXml.slice(cellSpan.start, cellSpan.end)
        for (const paragraph of findAll(cellXml, "w:p")) {
          coordinates.set(tableSpan.start + rowSpan.start + cellSpan.start + paragraph.start, {
            table: tableIndex + 1,
            row: rowIndex + 1,
            col: colIndex + 1,
          })
        }
      })
    })
  })
  return coordinates
}

export function readDocxParagraphs(xml: string, numbering?: DocxNumbering): DocxParagraph[] {
  const coordinates = tableCoordinates(xml)
  return collectParagraphs(xml).map((span) => {
    const body = paragraphBody(xml, span)
    const props = findElement(body, "w:pPr")
    const pPr = props ? body.slice(props.start, props.end) : undefined
    const list = pPr ? readList(pPr, numbering) : undefined
    const cell = coordinates.get(span.start)
    return {
      index: span.index,
      text: paragraphText(body),
      ...(span.inTable ? { inTable: true } : {}),
      ...(cell ? { cell } : {}),
      ...(list ? { list } : {}),
      ...readStyle(body, pPr),
    }
  })
}

// ---------------------------------------------------------------------------
// 写：段落文字 / 段落格式
// ---------------------------------------------------------------------------

type TextEdit = { paragraph: number; text: string }
type StyleEdit = {
  paragraph: number
  /** 只作用于 [start, end) 这段字符（选中文字加粗）；省略就是整段。 */
  range?: { start: number; end: number }
  style?: {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    /** 删除线。 */
    strike?: boolean
    /** pt */
    size?: number
    /** RRGGBB */
    color?: string
    /** 文字底纹（高亮），RRGGBB；空串表示去掉。 */
    highlight?: string
    align?: DocxAlign
    font?: string
    /** 行距倍数。 */
    lineSpacing?: number
    /** 首行缩进，pt。 */
    firstLineIndent?: number
    /** 左缩进，pt。 */
    indent?: number
    /** 清除格式。 */
    clear?: boolean
    /** 段落样式名；给空字符串表示改成正文 */
    paragraphStyle?: string
    /** 列表种类；`none` 表示移除列表。 */
    list?: "bullet" | "number" | "none"
    listLevel?: number
    /** 内部字段：真正写进 w:numPr 的 numId，由 apply 阶段按 numbering.xml 分配。 */
    numId?: number
  }
}

/**
 * 把整段文字塞进第一个 w:t，其余置空。
 * 段落里没有 run 时新建一个带 rPr 的 run，保证格式可继承。
 */
export function rewriteParagraphText(body: string, text: string): string {
  const texts = findAll(body, "w:t")
  if (texts.length === 0) {
    const firstRun = findElement(body, "w:r")
    const run = `<w:r><w:t xml:space="preserve">${encodeXmlText(text)}</w:t></w:r>`
    if (firstRun) return body.slice(0, firstRun.end) + run + body.slice(firstRun.end)
    const propsClose = body.lastIndexOf("</w:pPr>")
    if (propsClose !== -1) return body.slice(0, propsClose + 8) + run + body.slice(propsClose + 8)
    return run + body
  }

  let result = body
  // 从后往前替换，避免偏移失效。
  for (let index = texts.length - 1; index >= 0; index--) {
    const span = texts[index]!
    const openEnd = body.indexOf(">", span.start) + 1
    const value = index === 0 ? text : ""
    const keepSpace = index === 0 && (/^\s|\s$/.test(text) || text.length === 0)
    const openTag = keepSpace
      ? setAttribute(body.slice(span.start, openEnd), "xml:space", "preserve")
      : body.slice(span.start, openEnd)
    result = result.slice(0, span.start) + openTag + encodeXmlText(value) + "</w:t>" + result.slice(span.end)
  }
  return result
}

/** 一段里某个字面量出现的次数（不重叠）。 */
function countOccurrences(text: string, find: string): number {
  if (!find) return 0
  let count = 0
  let index = text.indexOf(find)
  while (index !== -1) {
    count += 1
    index = text.indexOf(find, index + find.length)
  }
  return count
}

/**
 * 段落内替换：优先只改包含目标的那个 `w:t`，行内格式（加粗 / 颜色）原样保留。
 * 目标被拆在两个 run 里（"Hel" + "lo"）时退化成整段重写 —— 会丢这几段的字符级格式，
 * 但至少保证替换成功。
 */
function replaceInParagraph(body: string, find: string, replace: string): { body: string; hits: number } {
  const original = paragraphText(body)
  const expected = countOccurrences(original, find)
  if (expected === 0) return { body, hits: 0 }

  const nodes = findAll(body, "w:t")
  let result = body
  let hits = 0
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const span = nodes[index]!
    const openEnd = result.indexOf(">", span.start) + 1
    const value = decodeXmlText(result.slice(openEnd, span.end - "</w:t>".length))
    if (!value.includes(find)) continue
    const pieces = value.split(find)
    hits += pieces.length - 1
    const nextValue = pieces.join(replace)
    const keepSpace = /^\s|\s$/.test(nextValue) || nextValue.length === 0
    const openTag = keepSpace
      ? setAttribute(result.slice(span.start, openEnd), "xml:space", "preserve")
      : result.slice(span.start, openEnd)
    result = result.slice(0, span.start) + openTag + encodeXmlText(nextValue) + "</w:t>" + result.slice(span.end)
  }
  if (hits === expected) return { body: result, hits }
  // run 之间断开：整段重写（用第一段 run 的格式）。
  return { body: rewriteParagraphText(result, paragraphText(result).split(find).join(replace)), hits: expected }
}

/** 全文档替换（正文段落，含表格单元格里的段落）。 */
export function replaceDocumentText(xml: string, find: string, replace: string): { xml: string; hits: number } {
  if (!find) return { xml, hits: 0 }
  const spans = collectParagraphs(xml)
  let next = xml
  let hits = 0
  // 从后往前改，前面的偏移不受影响。
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index]!
    const openEnd = next.indexOf(">", span.start)
    if (openEnd === -1) continue
    const body = next.slice(openEnd + 1, span.end - "</w:p>".length)
    const replaced = replaceInParagraph(body, find, replace)
    if (replaced.hits === 0) continue
    hits += replaced.hits
    next = next.slice(0, openEnd + 1) + replaced.body + next.slice(span.end - "</w:p>".length)
  }
  return { xml: next, hits }
}

function ensureRunProps(body: string): string {
  const run = findElement(body, "w:r")
  if (!run) return body
  const inner = body.slice(run.openEnd + 1, run.end)
  if (findElement(inner, "w:rPr")) return body
  return body.slice(0, run.openEnd + 1) + "<w:rPr></w:rPr>" + body.slice(run.openEnd + 1)
}

function applyRunStyle(rPr: string, style: NonNullable<StyleEdit["style"]>): string {
  let next = /^<w:rPr\s*\/>$/.test(rPr) ? "<w:rPr></w:rPr>" : rPr

  if (style.bold !== undefined) next = toggleChild(next, "w:rPr", "w:b", style.bold, "<w:b/>")
  if (style.italic !== undefined) next = toggleChild(next, "w:rPr", "w:i", style.italic, "<w:i/>")
  if (style.underline !== undefined) {
    next = toggleChild(next, "w:rPr", "w:u", style.underline, '<w:u w:val="single"/>')
  }
  if (style.strike !== undefined) next = toggleChild(next, "w:rPr", "w:strike", style.strike, "<w:strike/>")
  if (style.size !== undefined) {
    next = removeChild(next, "w:rPr", "w:sz")
    next = removeChild(next, "w:rPr", "w:szCs")
    const half = Math.round(style.size * 2)
    next = insertChild(next, "w:rPr", `<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`)
  }
  if (style.color !== undefined) {
    next = removeChild(next, "w:rPr", "w:color")
    next = insertChild(next, "w:rPr", `<w:color w:val="${style.color.replace(/^#/, "").toUpperCase()}"/>`)
  }
  if (style.highlight !== undefined) {
    // Word 的高亮没有 RRGGBB 版本；用底纹（w:shd）写十六进制底色，兼容性一样好。
    next = removeChild(next, "w:rPr", "w:shd")
    const fill = style.highlight.replace(/^#/, "").toUpperCase()
    if (fill) next = insertChild(next, "w:rPr", `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`)
  }
  if (style.font !== undefined) {
    next = removeChild(next, "w:rPr", "w:rFonts")
    const name = encodeXmlText(style.font)
    next = insertChild(next, "w:rPr", `<w:rFonts w:ascii="${name}" w:eastAsia="${name}" w:hAnsi="${name}"/>`)
  }
  if (style.clear) {
    // 清除格式最后做，保证前面的开关不会留下残余。
    for (const tag of ["w:b", "w:i", "w:u", "w:strike", "w:sz", "w:szCs", "w:color", "w:rFonts", "w:shd"]) {
      next = removeChild(next, "w:rPr", tag)
    }
  }
  return next
}

function toggleChild(xml: string, container: string, tag: string, value: boolean, template: string): string {
  const pattern = new RegExp("<" + tag + "\\b[^>]*/>", "g")
  if (value) return pattern.test(xml) ? xml : insertChild(xml, container, template)
  return xml.replace(pattern, "")
}

function removeChild(xml: string, container: string, tag: string): string {
  return xml
    .replace(new RegExp("<" + tag + "\\b[^>]*/>", "g"), "")
    .replace(new RegExp("<" + tag + "\\b[^>]*>[\\s\\S]*?</" + tag + ">", "g"), "")
}

/** 在容器的闭标签前插入子元素；容器自闭合时先展开。 */
function insertChild(xml: string, container: string, child: string): string {
  const close = xml.lastIndexOf(`</${container}>`)
  if (close === -1) {
    const selfClose = xml.lastIndexOf(`<${container}/>`)
    if (selfClose === -1) return xml
    return (
      xml.slice(0, selfClose) + `<${container}>${child}</${container}>` + xml.slice(selfClose + container.length + 3)
    )
  }
  return xml.slice(0, close) + child + xml.slice(close)
}

function applyParagraphStyle(body: string, style: NonNullable<StyleEdit["style"]>): string {
  let next = ensureRunProps(body)

  const runLevel =
    style.bold !== undefined ||
    style.italic !== undefined ||
    style.underline !== undefined ||
    style.strike !== undefined ||
    style.size !== undefined ||
    style.color !== undefined ||
    style.highlight !== undefined ||
    style.font !== undefined ||
    style.clear === true

  if (runLevel) {
    const runs = findAll(next, "w:r")
    for (let index = runs.length - 1; index >= 0; index--) {
      const run = runs[index]!
      const inner = next.slice(run.openEnd + 1, run.end)
      const props = findElement(inner, "w:rPr")
      if (!props) continue
      const updated = applyRunStyle(inner.slice(props.start, props.end), style)
      next =
        next.slice(0, run.openEnd + 1) +
        inner.slice(0, props.start) +
        updated +
        inner.slice(props.end) +
        next.slice(run.end)
    }
  }

  if (
    style.align !== undefined ||
    style.paragraphStyle !== undefined ||
    style.lineSpacing !== undefined ||
    style.firstLineIndent !== undefined ||
    style.indent !== undefined ||
    style.clear === true ||
    (style.list !== undefined && (style.list === "none" || style.numId !== undefined))
  ) {
    const props = findElement(next, "w:pPr")
    if (props) {
      let pPr = next.slice(props.start, props.end)
      if (style.align !== undefined) {
        pPr = removeChild(pPr, "w:pPr", "w:jc")
        pPr = insertChild(pPr, "w:pPr", `<w:jc w:val="${style.align}"/>`)
      }
      if (style.paragraphStyle !== undefined) {
        pPr = removeChild(pPr, "w:pPr", "w:pStyle")
        if (style.paragraphStyle) pPr = insertPPrStyle(pPr, style.paragraphStyle)
      }
      if (style.lineSpacing !== undefined) {
        pPr = removeChild(pPr, "w:pPr", "w:spacing")
        const line = Math.max(1, Math.round(style.lineSpacing * 240))
        pPr = insertChild(pPr, "w:pPr", `<w:spacing w:line="${line}" w:lineRule="auto"/>`)
      }
      if (style.firstLineIndent !== undefined || style.indent !== undefined) {
        const existing = /<w:ind\b[^>]*\/>/.exec(pPr)?.[0]
        const left =
          style.indent !== undefined ? Math.round(style.indent * 20) : /w:left="(\d+)"/.exec(existing ?? "")?.[1]
        const first =
          style.firstLineIndent !== undefined
            ? Math.round(style.firstLineIndent * 20)
            : /w:firstLine="(\d+)"/.exec(existing ?? "")?.[1]
        pPr = removeChild(pPr, "w:pPr", "w:ind")
        const attrs =
          (left !== undefined ? ` w:left="${left}"` : "") + (first !== undefined ? ` w:firstLine="${first}"` : "")
        if (attrs) pPr = insertChild(pPr, "w:pPr", `<w:ind${attrs}/>`)
      }
      if (style.list !== undefined && (style.list === "none" || style.numId !== undefined)) {
        pPr = removeChild(pPr, "w:pPr", "w:numPr")
        if (style.list !== "none" && style.numId !== undefined) {
          pPr = insertPPrNumPr(pPr, style.numId, style.listLevel ?? 0)
        }
      }
      if (style.clear) {
        for (const tag of ["w:pStyle", "w:jc", "w:ind", "w:spacing", "w:numPr"]) {
          pPr = removeChild(pPr, "w:pPr", tag)
        }
      }
      next = next.slice(0, props.start) + pPr + next.slice(props.end)
    } else if (
      style.align !== undefined ||
      style.paragraphStyle ||
      style.lineSpacing !== undefined ||
      style.firstLineIndent !== undefined ||
      style.indent !== undefined ||
      (style.list !== undefined && style.list !== "none")
    ) {
      const openEnd = next.indexOf(">", next.indexOf("<w:p")) + 1
      const indAttrs =
        (style.indent !== undefined ? ` w:left="${Math.round(style.indent * 20)}"` : "") +
        (style.firstLineIndent !== undefined ? ` w:firstLine="${Math.round(style.firstLineIndent * 20)}"` : "")
      const children = [
        style.paragraphStyle ? `<w:pStyle w:val="${encodeXmlText(style.paragraphStyle)}"/>` : "",
        style.list !== undefined && style.list !== "none" && style.numId !== undefined
          ? numPrXml(style.numId, style.listLevel ?? 0)
          : "",
        style.align ? `<w:jc w:val="${style.align}"/>` : "",
        style.lineSpacing !== undefined
          ? `<w:spacing w:line="${Math.max(1, Math.round(style.lineSpacing * 240))}" w:lineRule="auto"/>`
          : "",
        indAttrs ? `<w:ind${indAttrs}/>` : "",
      ].join("")
      next = next.slice(0, openEnd) + `<w:pPr>${children}</w:pPr>` + next.slice(openEnd)
    }
  }

  return next
}

function numPrXml(numId: number, level: number): string {
  return (
    '<w:numPr><w:ilvl w:val="' +
    Math.max(0, Math.min(8, Math.round(level))) +
    '"/><w:numId w:val="' +
    numId +
    '"/></w:numPr>'
  )
}

/** numPr 必须排在 pStyle 之后、jc 之前；插在 pStyle 后面最省事。 */
function insertPPrNumPr(pPr: string, numId: number, level: number): string {
  const child = numPrXml(numId, level)
  const style = findElement(pPr, "w:pStyle")
  if (style) return pPr.slice(0, style.end) + child + pPr.slice(style.end)
  const openEnd = pPr.indexOf(">") + 1
  return pPr.slice(0, openEnd) + child + pPr.slice(openEnd)
}

/** w:pPr 里 pStyle 必须在最前面；其余元素插在末尾前即可。 */
function insertPPrStyle(pPr: string, name: string): string {
  const openEnd = pPr.indexOf(">") + 1
  return pPr.slice(0, openEnd) + `<w:pStyle w:val="${encodeXmlText(name)}"/>` + pPr.slice(openEnd)
}

// ---------------------------------------------------------------------------
// 写：插入 / 删除段落
// ---------------------------------------------------------------------------

type StructuralEdit =
  | { op: "insert"; after: number; text: string; style?: NonNullable<StyleEdit["style"]> }
  | { op: "delete"; paragraph: number }

/**
 * 克隆第 N 段的段落属性，换上新文字，插到它后面。
 * 这样新段落继承标题级别、缩进、行距 —— 和 Word 里「回车新起一段」一致。
 */
export function insertParagraph(
  xml: string,
  after: number,
  text: string,
  style?: NonNullable<StyleEdit["style"]>,
): OfficeResult<{ xml: string; index: number }> {
  const spans = collectParagraphs(xml)
  if (after < 0 || after > spans.length) {
    return fail("not_found", "没有第 " + after + " 段", "先用 /body/p[N] 确认段落序号")
  }
  const anchor = after > 0 ? spans[after - 1] : undefined
  const pPr = anchor
    ? (() => {
        const body = paragraphBody(xml, anchor)
        const props = findElement(body, "w:pPr")
        return props ? body.slice(props.start, props.end) : ""
      })()
    : (() => {
        const bodyStart = xml.indexOf("<w:body>")
        const first = spans[0] ? paragraphBody(xml, spans[0]) : ""
        const props = first ? findElement(first, "w:pPr") : undefined
        return props ? first.slice(props.start, props.end) : ""
      })()

  let inner = pPr + `<w:r><w:t xml:space="preserve">${encodeXmlText(text)}</w:t></w:r>`
  if (style) inner = applyParagraphStyle(inner, style)

  const at = anchor ? anchor.end : xml.indexOf("<w:body>") + "<w:body>".length
  const next = xml.slice(0, at) + "<w:p>" + inner + "</w:p>" + xml.slice(at)
  return ok({ xml: next, index: after + 1 })
}

export function deleteParagraph(xml: string, paragraph: number): OfficeResult<string> {
  const spans = collectParagraphs(xml)
  const target = spans[paragraph - 1]
  if (!target) return fail("not_found", "没有第 " + paragraph + " 段")
  if (spans.length === 1) return fail("invalid_params", "文档至少要保留一段")
  // 单元格必须至少有一个段落，删掉它 Word 会判定文件损坏。
  if (target.inTable) {
    return fail("unsupported_format", "表格里的段落不能单独删除", "请删除整行或整列，或先把段落移出表格")
  }
  return ok(xml.slice(0, target.start) + xml.slice(target.end))
}

export function editDocxXml(
  xml: string,
  edits: {
    textEdits?: readonly TextEdit[]
    styleEdits?: readonly StyleEdit[]
    insertEdits?: readonly { after: number; text: string; style?: NonNullable<StyleEdit["style"]> }[]
    deleteEdits?: readonly number[]
  },
): OfficeResult<{ xml: string; applied: Array<{ paragraph: number; previous?: string; text?: string }> }> {
  const byIndex = new Map(collectParagraphs(xml).map((span) => [span.index, span]))
  const applied: Array<{ paragraph: number; previous?: string; text?: string }> = []

  // 同一段可能既有文字又有格式：合并成一次替换，避免偏移错乱。
  const grouped = new Map<
    number,
    { text?: string; style?: NonNullable<StyleEdit["style"]>; range?: { start: number; end: number } }
  >()
  for (const edit of edits.textEdits ?? []) {
    const entry = grouped.get(edit.paragraph) ?? {}
    entry.text = edit.text
    grouped.set(edit.paragraph, entry)
  }
  for (const edit of edits.styleEdits ?? []) {
    if (!edit.style) continue
    const entry = grouped.get(edit.paragraph) ?? {}
    entry.style = edit.style
    if (edit.range) entry.range = edit.range
    grouped.set(edit.paragraph, entry)
  }

  const targets = [...grouped.entries()]
    .map(([paragraph, change]) => ({ paragraph, change, span: byIndex.get(paragraph) }))
    .filter((item) => item.span)
    .sort((a, b) => b.span!.start - a.span!.start)

  if (targets.length === 0 && (edits.insertEdits ?? []).length === 0 && (edits.deleteEdits ?? []).length === 0) {
    return ok({ xml, applied })
  }

  let next = xml
  for (const { paragraph, change, span } of targets) {
    const target = span!
    const openEnd = next.indexOf(">", target.start)
    const body = next.slice(openEnd + 1, target.end - "</w:p>".length)
    const previous = paragraphText(body)
    let updated = body
    // 先换字，再套格式：range 的偏移按「改完之后的文字」算，和 UI 的选区语义一致。
    if (change.text !== undefined) updated = rewriteParagraphText(updated, change.text)
    if (change.style) {
      if (change.range) {
        const { align, paragraphStyle, ...run } = change.style
        if (Object.keys(run).length > 0) {
          updated = applyRunStyleRange(updated, change.range.start, change.range.end, run)
        }
        if (align !== undefined || paragraphStyle !== undefined) {
          updated = applyParagraphStyle(updated, {
            ...(align !== undefined ? { align } : {}),
            ...(paragraphStyle !== undefined ? { paragraphStyle } : {}),
          })
        }
      } else {
        updated = applyParagraphStyle(updated, change.style)
      }
    }
    next = next.slice(0, openEnd + 1) + updated + next.slice(target.end - "</w:p>".length)
    applied.push({ paragraph, previous, ...(change.text !== undefined ? { text: change.text } : {}) })
  }

  // 结构编辑放在文字/格式之后，并且从后往前做：
  // 这样批量里的下标都以「原始文档」为准，不会被前面的插入/删除带偏。
  const structural: StructuralEdit[] = [
    ...(edits.insertEdits ?? []).map((edit) => ({ op: "insert" as const, ...edit })),
    ...(edits.deleteEdits ?? []).map((paragraph) => ({ op: "delete" as const, paragraph })),
  ].sort((a, b) => {
    const left = a.op === "insert" ? a.after : a.paragraph
    const right = b.op === "insert" ? b.after : b.paragraph
    return right - left
  })

  for (const edit of structural) {
    if (edit.op === "delete") {
      const removed = deleteParagraph(next, edit.paragraph)
      if (!removed.ok) return removed
      next = removed.data
      applied.push({ paragraph: edit.paragraph, previous: "（整段）" })
      continue
    }
    const inserted = insertParagraph(next, edit.after, edit.text, edit.style)
    if (!inserted.ok) return inserted
    next = inserted.data.xml
    applied.push({ paragraph: inserted.data.index, text: edit.text })
  }

  return ok({ xml: next, applied: applied.reverse() })
}

// ---------------------------------------------------------------------------
// 引擎适配
// ---------------------------------------------------------------------------

export const docxEngine: OfficeEngine<DocxState> = {
  format: "docx",

  async open(bytes) {
    try {
      const zip = await readZip(bytes)
      const entry = zip.entries.find((item) => item.name === DOCUMENT_ENTRY)
      if (!entry) return fail("open_failed", "DOCX 缺少 word/document.xml")
      const decoder = new TextDecoder()
      const xml = decoder.decode(await inflateEntry(zip, entry))
      const relsEntry = zip.entries.find((item) => item.name === DOCUMENT_RELS)
      const rels = relsEntry ? decoder.decode(await inflateEntry(zip, relsEntry)) : ""
      const parts = new Map<string, string>()
      for (const item of zip.entries) {
        if (!/^word\/(?:header|footer)\d+\.xml$/.test(item.name)) continue
        parts.set(item.name, decoder.decode(await inflateEntry(zip, item)))
      }
      const numberingEntry = zip.entries.find((item) => item.name === "word/numbering.xml")
      const numbering = numberingEntry
        ? readDocxNumbering(decoder.decode(await inflateEntry(zip, numberingEntry)))
        : undefined
      const header = readHeaderFooter(xml, rels, parts, "header")
      const footer = readHeaderFooter(xml, rels, parts, "footer")
      const pageSetup = readPageSetup(xml)
      return ok({
        paragraphs: readDocxParagraphs(xml, numbering),
        ...(header !== undefined ? { header } : {}),
        ...(footer !== undefined ? { footer } : {}),
        ...(pageSetup ? { pageSetup } : {}),
      })
    } catch (error) {
      return fail("open_failed", error instanceof Error ? error.message : "无法解析 DOCX")
    }
  },

  async apply(state, ops, bytes) {
    const textEdits: TextEdit[] = []
    const styleEdits: StyleEdit[] = []
    const insertEdits: Array<{ after: number; text: string; style?: NonNullable<StyleEdit["style"]> }> = []
    const deleteEdits: number[] = []
    const blocks: Array<{ after: number; xml: string; seq: number; label: string }> = []
    const images: Array<{ after: number; data: Uint8Array; mime: string; width: number; height: number }> = []
    let pageSetup: DocxPageSetup | undefined
    const headerFooterEdits: Array<{ kind: HeaderFooterKind; text: string }> = []
    const tableOps: DocxTableOp[] = []
    const replaceEdits: Array<{ find: string; replace: string }> = []
    let sequence = 0

    for (const op of ops) {
      if (op.op === "setParagraphText" || op.op === "setSpanText") {
        textEdits.push({ paragraph: op.paragraph, text: op.text })
      } else if (op.op === "setParagraphStyle") {
        const { align, ...rest } = op.style
        styleEdits.push({
          paragraph: op.paragraph,
          style: { ...rest, ...(align ? { align: mapAlign(align) } : {}) },
          ...(op.start !== undefined && op.end !== undefined ? { range: { start: op.start, end: op.end } } : {}),
        })
      } else if (op.op === "insertParagraph") {
        insertEdits.push({ after: op.after, text: op.text, style: mapStylePatch(op.style) })
      } else if (op.op === "deleteParagraph") {
        deleteEdits.push(op.paragraph)
      } else if (op.op === "addTable") {
        if (op.rows.length === 0) return fail("invalid_params", "表格至少要有 1 行")
        blocks.push({ after: op.after, xml: tableXml(op.rows, op.header ?? true), seq: sequence++, label: "表格" })
      } else if (op.op === "addPageBreak") {
        blocks.push({ after: op.after, xml: pageBreakXml(), seq: sequence++, label: "分页符" })
      } else if (op.op === "addImage") {
        const data = decodeBase64(op.dataBase64)
        if (!data || data.length === 0) return fail("invalid_params", "图片数据不是合法的 base64")
        images.push({
          after: op.after,
          data,
          mime: op.mime,
          width: op.width ?? 240,
          height: op.height ?? 160,
        })
      } else if (
        op.op === "deleteTable" ||
        op.op === "insertTableRow" ||
        op.op === "deleteTableRow" ||
        op.op === "insertTableColumn" ||
        op.op === "deleteTableColumn" ||
        op.op === "setTableCellText"
      ) {
        tableOps.push(op)
      } else if (op.op === "setHeaderFooter") {
        headerFooterEdits.push({ kind: op.kind, text: op.text })
      } else if (op.op === "replaceDocumentText") {
        replaceEdits.push({ find: op.find, replace: op.replace })
      } else if (op.op === "setPageSetup") {
        pageSetup = {
          ...(op.size ? { size: op.size } : {}),
          ...(op.orientation ? { orientation: op.orientation } : {}),
          ...(op.margins ? { margins: op.margins } : {}),
        }
      } else {
        return fail("unsupported_format", `${op.op} 不适用于 DOCX`)
      }
    }
    if (
      textEdits.length === 0 &&
      styleEdits.length === 0 &&
      insertEdits.length === 0 &&
      deleteEdits.length === 0 &&
      blocks.length === 0 &&
      images.length === 0 &&
      headerFooterEdits.length === 0 &&
      tableOps.length === 0 &&
      replaceEdits.length === 0 &&
      pageSetup === undefined
    ) {
      return fail("invalid_params", "没有要执行的文档操作")
    }
    if (
      state.paragraphs.length === 0 &&
      textEdits.length + styleEdits.length + insertEdits.length + deleteEdits.length > 0
    ) {
      return fail("not_found", "文档里没有可编辑的段落")
    }

    try {
      const zip = await readZip(bytes)
      const entry = zip.entries.find((item) => item.name === DOCUMENT_ENTRY)
      if (!entry) return fail("open_failed", "DOCX 缺少 word/document.xml")
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let document = decoder.decode(await inflateEntry(zip, entry))
      const applied: Array<{ paragraph: number; previous?: string; text?: string }> = []

      const replacements = new Map<string, Uint8Array>()
      const additions = new Map<string, Uint8Array>()

      // 关系 / Content_Types 是正文之外的两张表：图片、页眉页脚和编号定义都要往里登记，
      // 所以统一在这里读写一次，改完再一起落盘。
      const relsEntry = zip.entries.find((item) => item.name === DOCUMENT_RELS)
      let rels = relsEntry
        ? decoder.decode(await inflateEntry(zip, relsEntry))
        : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          "</Relationships>"
      const contentEntry = zip.entries.find((item) => item.name === "[Content_Types].xml")
      let contentTypes = contentEntry ? decoder.decode(await inflateEntry(zip, contentEntry)) : undefined
      let relsChanged = false
      let contentChanged = false
      let maxId = 0
      for (const match of rels.matchAll(/Id="rId(\d+)"/g)) maxId = Math.max(maxId, Number(match[1]))

      // 列表：先保证 word/numbering.xml 里有项目符号 / 编号两套定义，
      // 再把 numId 绑到带 list 的段落上 —— 正文和编号定义一次落盘。
      const listStyles = [...styleEdits, ...insertEdits].flatMap((edit) => (edit.style?.list ? [edit.style] : []))
      if (listStyles.some((style) => style.list !== "none")) {
        const numberingEntry = zip.entries.find((item) => item.name === "word/numbering.xml")
        const existing = numberingEntry ? decoder.decode(await inflateEntry(zip, numberingEntry)) : undefined
        const numbered = ensureListNumbering(existing)
        for (const style of listStyles) {
          if (style.list === "none") continue
          style.numId = style.list === "bullet" ? numbered.bullet : numbered.number
        }
        if (numbered.changed) {
          if (numberingEntry) replacements.set("word/numbering.xml", encoder.encode(numbered.xml))
          else {
            additions.set("word/numbering.xml", encoder.encode(numbered.xml))
            // 新建部件必须同时登记关系和 Content_Types，否则 Word 会报文件损坏。
            rels = rels.replace(
              "</Relationships>",
              `<Relationship Id="rId${++maxId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`,
            )
            relsChanged = true
            if (contentTypes && !contentTypes.includes("/word/numbering.xml")) {
              contentTypes = contentTypes.replace(
                "</Types>",
                '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>',
              )
              contentChanged = true
            }
          }
        }
      }

      // 全文档替换先做：它作用于原始段落，后面的结构调整按替换后的文档继续。
      for (const edit of replaceEdits) {
        if (!edit.find) return fail("invalid_params", "要替换的文字不能为空")
        const replaced = replaceDocumentText(document, edit.find, edit.replace)
        document = replaced.xml
        applied.push({ paragraph: 0, text: `全文档替换 ${replaced.hits} 处「${edit.find}」→「${edit.replace}」` })
      }

      // 表格结构先做：插入/删除行列会改变段落顺序，后面的段落下标按新结构算。
      for (const op of tableOps) {
        const result = editDocxTable(document, op)
        if (!result.ok) return result
        document = result.data
      }

      const edited = editDocxXml(document, { textEdits, styleEdits, insertEdits, deleteEdits })
      if (!edited.ok) return edited
      document = edited.data.xml
      applied.push(...edited.data.applied)

      // 图片要先安排包内条目（媒体 + 关系），再把 drawing XML 拼进正文。
      if (images.length > 0) {
        const relsBefore = rels
        const contentBefore = contentTypes
        for (const [index, image] of images.entries()) {
          const kind = imageExtension(image.mime)
          if (!kind)
            return fail(
              "unsupported_format",
              "DOCX 只支持 PNG / JPEG / GIF / WMF / EMF 图片",
              "网页里最稳的是 png / jpeg；wmf / emf 只能原样嵌入，浏览器预览会显示占位",
            )
          const id = maxId + index + 1
          const media = `word/media/novaway-image-${Date.now()}-${index}.${kind.ext}`
          additions.set(media, image.data)
          rels = rels.replace(
            "</Relationships>",
            `<Relationship Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${media.slice("word/".length)}"/>` +
              "</Relationships>",
          )
          if (contentTypes && !new RegExp(`Extension="${kind.ext}"`, "i").test(contentTypes)) {
            contentTypes = contentTypes.replace(
              "</Types>",
              `<Default Extension="${kind.ext}" ContentType="${kind.contentType}"/></Types>`,
            )
          }
          blocks.push({
            after: image.after,
            xml: imageXml({ rId: "rId" + id, width: image.width, height: image.height, name: `Picture ${id}`, id }),
            seq: sequence++,
            label: "图片",
          })
        }
        document = ensureDocumentNamespaces(document)
        if (rels !== relsBefore) relsChanged = true
        if (contentTypes !== contentBefore) contentChanged = true
      }

      // 结构块从后往前插：锚点序号以原始文档为准，互不影响。
      // 同一个锚点上的多个操作按调用顺序落位（后插入的先执行，最后顺序才正确）。
      for (const block of [...blocks].sort((a, b) => b.after - a.after || b.seq - a.seq)) {
        const inserted = insertBlockAfter(document, block.after, block.xml)
        if (!inserted.ok) return inserted
        document = inserted.data
        applied.push({ paragraph: block.after, text: block.label })
      }

      if (pageSetup) {
        const setup = applyPageSetup(document, pageSetup)
        if (!setup.ok) return setup
        document = setup.data
        applied.push({ paragraph: 0, text: "页面设置" })
      }

      // 页眉页脚：改引用里的部件，或新建部件 + 关系 + Content_Types。
      if (headerFooterEdits.length > 0) {
        const parts = new Map<string, string>()
        for (const item of zip.entries) {
          if (!/^word\/(?:header|footer)\d+\.xml$/.test(item.name)) continue
          parts.set(item.name, decoder.decode(await inflateEntry(zip, item)))
        }
        for (const [name, xml] of additions) {
          if (/^word\/(?:header|footer)\d+\.xml$/.test(name)) parts.set(name, decoder.decode(xml))
        }
        const relsBefore = rels
        const contentBefore = contentTypes
        for (const edit of headerFooterEdits) {
          const result = setHeaderFooter({ document, rels, contentTypes, parts }, edit.kind, edit.text)
          if (!result.ok) return result
          document = result.data.document
          rels = result.data.rels
          contentTypes = result.data.contentTypes
          for (const [name, xml] of result.data.additions) {
            additions.set(name, encoder.encode(xml))
            parts.set(name, xml)
          }
          for (const [name, xml] of result.data.replacements) {
            replacements.set(name, encoder.encode(xml))
            parts.set(name, xml)
          }
          applied.push({ paragraph: 0, text: edit.kind === "header" ? "页眉" : "页脚" })
        }
        if (rels !== relsBefore) relsChanged = true
        if (contentTypes !== contentBefore) contentChanged = true
      }

      if (relsChanged) {
        if (relsEntry) replacements.set(DOCUMENT_RELS, encoder.encode(rels))
        else additions.set(DOCUMENT_RELS, encoder.encode(rels))
      }
      if (contentTypes && contentChanged) replacements.set("[Content_Types].xml", encoder.encode(contentTypes))

      replacements.set(DOCUMENT_ENTRY, encoder.encode(document))
      const nextZip = rebuildZip(zip, replacements, additions)
      const reopened = await docxEngine.open(nextZip)
      if (!reopened.ok) return reopened
      return ok({
        state: reopened.data,
        bytes: nextZip,
        // 新增的部件（页眉页脚、媒体）也算「改了这个包」的一部分。
        changed: [...new Set([...replacements.keys(), ...additions.keys()])],
        applied,
      })
    } catch (error) {
      return fail("engine", error instanceof Error ? error.message : "DOCX 写入失败")
    }
  },

  /**
   * 导出成文本：md 保留标题层级与表格标记，txt 每段一行。
   * 只读，不动原文件。
   */
  async export(state, target, bytes) {
    const kind = target.toLowerCase().replace(/^\./, "")
    const encoder = new TextEncoder()
    const plain = state.paragraphs.map((paragraph) => ({
      text: paragraph.text,
      heading: headingLevel(paragraph.style),
      inTable: paragraph.inTable,
      ...(paragraph.list ? { list: paragraph.list } : {}),
    }))
    if (kind === "md" || kind === "markdown") return ok(encoder.encode(paragraphsToMarkdown(plain)))
    if (kind === "txt" || kind === "text") return ok(encoder.encode(paragraphsToText(plain)))
    if (kind === "html" || kind === "htm") return ok(encoder.encode(paragraphsToHtml(state.paragraphs)))
    if (kind === "pdf") {
      // 图片要跟着正文一起排版：rel 里指向 word/media 的字节读出来交给排版器。
      const images = bytes ? await docxPrintImages(bytes) : []
      return ok(await printToPdf("docx", state, images.length > 0 ? { images } : {}))
    }
    return fail("unsupported_format", "DOCX 不能导出成 " + target, "支持 pdf / md / txt / html")
  },
}

// ---------------------------------------------------------------------------
// 列表：numbering.xml
//
// 固定用 9001 / 9002 两个 numId 当作「项目符号 / 编号」。这样重复编辑是幂等的，
// 不会每改一次就往包里塞一套新的定义；Word 对这些 id 没有特殊含义。
// ---------------------------------------------------------------------------

const LIST_BULLET_NUM = 9001
const LIST_NUMBER_NUM = 9002
const NUMBERING_HEAD =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'

function listAbstractXml(abstractId: number, kind: "bullet" | "number"): string {
  const levels: string[] = []
  for (let level = 0; level < 9; level += 1) {
    const format = kind === "bullet" ? "bullet" : "decimal"
    const text = kind === "bullet" ? "•" : "%" + (level + 1) + "."
    levels.push(
      '<w:lvl w:ilvl="' +
        level +
        '"><w:start w:val="1"/><w:numFmt w:val="' +
        format +
        '"/><w:lvlText w:val="' +
        text +
        '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' +
        720 * (level + 1) +
        '" w:hanging="360"/></w:pPr>' +
        (kind === "bullet" ? '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:hint="default"/></w:rPr>' : "") +
        "</w:lvl>",
    )
  }
  return (
    '<w:abstractNum w:abstractNumId="' +
    abstractId +
    '"><w:multiLevelType w:val="hybridMultilevel"/>' +
    levels.join("") +
    "</w:abstractNum>"
  )
}

/**
 * 保证 numbering.xml 里有列表的两套定义。
 * 已有（我们上次写的）就原样复用，不重复添加；返回的 xml 只在 changed 时有意义。
 */
function ensureListNumbering(xml: string | undefined): {
  xml: string
  bullet: number
  number: number
  changed: boolean
} {
  const bullet = LIST_BULLET_NUM
  const number = LIST_NUMBER_NUM
  if (!xml) {
    return {
      xml:
        NUMBERING_HEAD +
        listAbstractXml(bullet, "bullet") +
        listAbstractXml(number, "number") +
        '<w:num w:numId="' +
        bullet +
        '"><w:abstractNumId w:val="' +
        bullet +
        '"/></w:num>' +
        '<w:num w:numId="' +
        number +
        '"><w:abstractNumId w:val="' +
        number +
        '"/></w:num>' +
        "</w:numbering>",
      bullet,
      number,
      changed: true,
    }
  }

  let next = xml
  let changed = false
  const hasNum = (id: number) => new RegExp('<w:num\b[^>]*w:numId="' + id + '"')
  // abstractNum 必须排在所有 w:num 之前，所以插在第一个 w:num 前面。
  if (!hasNum(bullet)) {
    const abstracts = listAbstractXml(bullet, "bullet") + listAbstractXml(number, "number")
    const firstNum = next.search(/<w:num\b/)
    next =
      firstNum === -1
        ? next.replace("</w:numbering>", abstracts + "</w:numbering>")
        : next.slice(0, firstNum) + abstracts + next.slice(firstNum)
    changed = true
  }
  if (!hasNum(number)) {
    next = next.replace(
      "</w:numbering>",
      '<w:num w:numId="' + number + '"><w:abstractNumId w:val="' + number + '"/></w:num></w:numbering>',
    )
    changed = true
  }
  return { xml: next, bullet, number, changed }
}

/** Word 的内置样式名 → Markdown 标题层级；认不出来就是正文。 */
function headingLevel(style: string | undefined): number | undefined {
  if (!style) return undefined
  const match = /^(?:Heading|标题)\s*([1-6])$/i.exec(style)
  if (match) return Number(match[1])
  if (/^Title$/i.test(style)) return 1
  return undefined
}

function mapStylePatch(style: ParagraphStylePatch | undefined): NonNullable<StyleEdit["style"]> | undefined {
  if (!style) return undefined
  const { align, ...rest } = style
  return { ...rest, ...(align ? { align: mapAlign(align) } : {}) }
}

function mapAlign(align: "l" | "ctr" | "r" | "just"): DocxAlign {
  if (align === "ctr") return "center"
  if (align === "r") return "right"
  if (align === "just") return "both"
  return "left"
}

// ---------------------------------------------------------------------------
// 结构写入：表格 / 分页 / 图片 / 页面设置
//
// 和改字一样是外科手术：只在锚点段落后面插入一段新 XML（或改 sectPr 的
// 几个属性），文档其余部分逐字节不动。AI 工具和右侧面板共用这几个函数。
// ---------------------------------------------------------------------------

export type DocxPageMargins = {
  /** 单位 mm；四边都传就四边都改。 */
  top?: number
  right?: number
  bottom?: number
  left?: number
}

export type DocxPageSetup = {
  size?: "A4" | "A3" | "Letter"
  orientation?: "portrait" | "landscape"
  margins?: DocxPageMargins
}

const PAGE_SIZES: Record<NonNullable<DocxPageSetup["size"]>, [number, number]> = {
  A4: [11906, 16838],
  A3: [16838, 23811],
  Letter: [12240, 15840],
}

/** mm → twips（1/1440 英寸）。 */
const mmToTwips = (value: number) => Math.round((value * 1440) / 25.4)

/** 在第 N 段之后插入一段任意 XML；`after: 0` 表示插到正文最前面。 */
export function insertBlockAfter(xml: string, after: number, block: string): OfficeResult<string> {
  const spans = collectParagraphs(xml)
  if (after < 0 || after > spans.length) {
    return fail("not_found", "没有第 " + after + " 段", "先用 office_document_read 确认段落序号")
  }
  const anchor = after > 0 ? spans[after - 1] : undefined
  if (anchor?.inTable) {
    return fail("invalid_params", "不能插在表格里的段落后面", "选一个表格外的段落后重试")
  }
  const at = anchor ? anchor.end : xml.indexOf("<w:body>") + "<w:body>".length
  return ok(xml.slice(0, at) + block + xml.slice(at))
}

function tableCellXml(text: string, width: number, bold: boolean): string {
  const runProps = bold ? "<w:rPr><w:b/></w:rPr>" : ""
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>` +
    `<w:p><w:r>${runProps}<w:t xml:space="preserve">${encodeXmlText(text)}</w:t></w:r></w:p></w:tc>`
  )
}

/** 按行数组生成一张带边框的表格；表头行加粗。 */
export function tableXml(rows: readonly (readonly string[])[], header = true): string {
  const columns = Math.max(1, ...rows.map((row) => row.length))
  const width = Math.max(600, Math.floor(9000 / columns))
  const grid = `<w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`
  const body = rows
    .map((row, rowIndex) => {
      const cells = Array.from({ length: columns }, (_, columnIndex) =>
        tableCellXml(row[columnIndex] ?? "", width, header && rowIndex === 0),
      ).join("")
      return `<w:tr>${cells}</w:tr>`
    })
    .join("")
  return (
    "<w:tbl><w:tblPr>" +
    '<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>' +
    '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders>' +
    "</w:tblPr>" +
    grid +
    body +
    "</w:tbl>" +
    // 表格后面补一个空段：Word 要求正文最后不能是表格。
    "<w:p/>"
  )
}

export function pageBreakXml(): string {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
}

const DRAWING_NS = {
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
} as const

/** 文档根上缺哪个命名空间就补哪个（插入图片要用到 wp / a / pic / r）。 */
export function ensureDocumentNamespaces(xml: string): string {
  const open = xml.indexOf("<w:document")
  if (open === -1) return xml
  const end = xml.indexOf(">", open)
  if (end === -1) return xml
  let tag = xml.slice(open, end + 1)
  for (const [prefix, uri] of Object.entries(DRAWING_NS)) {
    if (tag.includes("xmlns:" + prefix + "=")) continue
    tag = tag.replace(/>$/, ` xmlns:${prefix}="${uri}">`)
  }
  return xml.slice(0, open) + tag + xml.slice(end + 1)
}

/** 一张内嵌图片的段落 XML（自动按图片实际尺寸等比缩放）。 */
export function imageXml(input: { rId: string; width: number; height: number; name: string; id: number }): string {
  // 1pt = 12700 EMU。
  const cx = Math.max(1, Math.round(input.width * 12700))
  const cy = Math.max(1, Math.round(input.height * 12700))
  return (
    '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${input.id}" name="${encodeXmlText(input.name)}"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${input.id}" name="${encodeXmlText(input.name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${input.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"
  )
}

/** 图片的扩展名 / MIME（只支持预览器能显示的几种）。 */
export function imageExtension(mime: string): { ext: string; contentType: string } | undefined {
  const value = mime.toLowerCase()
  if (value === "image/png") return { ext: "png", contentType: "image/png" }
  if (value === "image/jpeg" || value === "image/jpg") return { ext: "jpeg", contentType: "image/jpeg" }
  if (value === "image/gif") return { ext: "gif", contentType: "image/gif" }
  // WMF / EMF 是 Word 里的矢量图（图表、公式常以它们嵌入）。浏览器不能渲染，
  // 但原样嵌回 DOCX 是合法的，Word / LibreOffice 打开都正常。
  if (value === "image/x-wmf" || value === "image/wmf") return { ext: "wmf", contentType: "image/x-wmf" }
  if (value === "image/x-emf" || value === "image/emf") return { ext: "emf", contentType: "image/x-emf" }
  return undefined
}

/** twips → mm，保留一位小数（页边距在面板里按 mm 显示）。 */
const twipsToMm = (value: number) => Math.round(((value * 25.4) / 1440) * 10) / 10

/**
 * 读出当前页面设置：最后一个 `w:sectPr` 里的 pgSz / pgMar。
 *
 * 面板要先显示文档的真实值，改起来才放心；读不到（没有 sectPr / pgSz）就返回 undefined，
 * 让 UI 显示「未设置」而不是假装是 A4。
 */
export function readPageSetup(xml: string): DocxPageSetup | undefined {
  const start = xml.lastIndexOf("<w:sectPr")
  if (start === -1) return undefined
  const section = xml.slice(start)
  const size = /<w:pgSz\b[^>]*\bw:w="(\d+)"[^>]*\bw:h="(\d+)"/.exec(section)
  if (!size) return undefined
  const width = Number(size[1])
  const height = Number(size[2])
  const short = Math.min(width, height)
  const long = Math.max(width, height)
  const named = (Object.keys(PAGE_SIZES) as Array<keyof typeof PAGE_SIZES>).find((key) => {
    const [a, b] = PAGE_SIZES[key]
    return Math.min(a, b) === short && Math.max(a, b) === long
  })
  const raw = /<w:pgMar\b[^>]*\/>/.exec(section)?.[0] ?? ""
  const margin = (name: string) => {
    const match = new RegExp("w:" + name + '="(\\d+)"').exec(raw)
    return match ? twipsToMm(Number(match[1])) : undefined
  }
  const margins = { top: margin("top"), right: margin("right"), bottom: margin("bottom"), left: margin("left") }
  return {
    ...(named ? { size: named } : {}),
    orientation: width > height ? "landscape" : "portrait",
    ...(Object.values(margins).some((value) => value !== undefined) ? { margins } : {}),
  }
}

/**
 * 页面设置：改正文最后一个 `w:sectPr`。
 *
 * 尺寸单位是 twips，输入用 mm（面板和模型都更好理解）；
 * 横向就是把长宽对调并写上 `w:orient="landscape"`。
 */
export function applyPageSetup(xml: string, setup: DocxPageSetup): OfficeResult<string> {
  const start = xml.lastIndexOf("<w:sectPr")
  if (start === -1) return fail("not_found", "文档里没有页面设置（sectPr）")
  const end = xml.indexOf("</w:sectPr>", start)
  const selfClose = xml.indexOf("/>", start)
  const isSelfClose = selfClose !== -1 && (end === -1 || selfClose < end)
  const close = isSelfClose ? selfClose + 2 : end + "</w:sectPr>".length
  if (end === -1 && !isSelfClose) return fail("engine", "sectPr 结构不完整")

  const openEnd = xml.indexOf(">", start) + 1
  // 自闭合的 <w:sectPr/> 要展开成成对标签才能往里写子元素。
  const head = isSelfClose ? xml.slice(start, openEnd).replace(/\/>$/, ">") : xml.slice(start, openEnd)
  const sectionBody = isSelfClose || end === -1 ? "" : xml.slice(openEnd, end)
  let body = sectionBody

  let size = PAGE_SIZES.A4
  const existing = /<w:pgSz\b[^>]*\bw:w="(\d+)"[^>]*\bw:h="(\d+)"/.exec(body)
  if (existing) size = [Number(existing[1]), Number(existing[2])]
  if (setup.size) size = PAGE_SIZES[setup.size]
  const landscape = setup.orientation ? setup.orientation === "landscape" : size[0] > size[1]
  const width = landscape ? Math.max(size[0], size[1]) : Math.min(size[0], size[1])
  const height = landscape ? Math.min(size[0], size[1]) : Math.max(size[0], size[1])

  body = body.replace(/<w:pgSz\b[^>]*\/>/g, "").replace(/<w:pgMar\b[^>]*\/>/g, "")
  const pgSize = `<w:pgSz w:w="${width}" w:h="${height}"${landscape ? ' w:orient="landscape"' : ""}/>`
  const margins = setup.margins
  // 已经有页边距就沿用，只改传进来的那几边。
  const current = /<w:pgMar\b[^>]*\/>/.exec(sectionBody)?.[0] ?? ""
  const marginValue = (name: string, fallback: number) => {
    const match = new RegExp("w:" + name + '="(\d+)"').exec(current)
    return match ? Number(match[1]) : fallback
  }
  const pgMar =
    `<w:pgMar w:top="${margins?.top !== undefined ? mmToTwips(margins.top) : marginValue("top", 1440)}"` +
    ` w:right="${margins?.right !== undefined ? mmToTwips(margins.right) : marginValue("right", 1440)}"` +
    ` w:bottom="${margins?.bottom !== undefined ? mmToTwips(margins.bottom) : marginValue("bottom", 1440)}"` +
    ` w:left="${margins?.left !== undefined ? mmToTwips(margins.left) : marginValue("left", 1440)}"` +
    ` w:header="${marginValue("header", 851)}" w:footer="${marginValue("footer", 992)}"` +
    ` w:gutter="${marginValue("gutter", 0)}"/>`

  const type = /<w:type\b[^>]*\/>/.exec(body)
  if (type) {
    const at = type.index + type[0].length
    body = body.slice(0, at) + pgSize + pgMar + body.slice(at)
  } else {
    body = pgSize + pgMar + body
  }

  const next =
    xml.slice(0, start) + head + body + (isSelfClose ? "</w:sectPr>" : xml.slice(end, close)) + xml.slice(close)
  return ok(next)
}

// ---------------------------------------------------------------------------
// 页眉 / 页脚
//
// 页眉页脚不是正文的一部分：sectPr 里用 headerReference / footerReference
// 指向 word/headerN.xml / word/footerN.xml。所以「改页眉」= 找到引用 →
// 改那个部件的文字；没有引用就新建一个部件并登记关系，正文一个字节不动。
// ---------------------------------------------------------------------------

export type HeaderFooterKind = "header" | "footer"

const HEADER_FOOTER_REL: Record<HeaderFooterKind, string> = {
  header: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
  footer: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
}

const HEADER_FOOTER_CONTENT_TYPE: Record<HeaderFooterKind, string> = {
  header: "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
  footer: "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
}

const HEADER_FOOTER_TAG: Record<HeaderFooterKind, string> = { header: "w:hdr", footer: "w:ftr" }

const HEADER_FOOTER_NAMESPACES =
  ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
  ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
  ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
  ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'

/** 从 rels 里找 Id 对应的包内路径；Target 相对于 word/。 */
function resolveRelationship(rels: string, id: string): string | undefined {
  const match = new RegExp('<Relationship\\b[^>]*\\bId="' + id + '"[^>]*>', "i").exec(rels)
  if (!match) return undefined
  const target = attribute(match[0], "Target")
  if (!target) return undefined
  if (target.startsWith("/")) return target.slice(1)
  return "word/" + target.replace(/^\.\//, "")
}

// ---------------------------------------------------------------------------
// 正文插图：文档里的 w:drawing / w:pict → 排版器能画的块
//
// 和页眉页脚一样只读 rels，不碰正文：图片就是 word/media 里的原始字节，
// 尺寸优先取 wp:extent（EMU），老式 VML 图退回 style="width:...pt"。
// ---------------------------------------------------------------------------

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  wmf: "image/x-wmf",
  emf: "image/x-emf",
}

/** VML 的 style="width:120pt;height:60pt"：只认长度单位，其它当没有。 */
function styleLength(style: string | undefined, key: "width" | "height"): number | undefined {
  if (!style) return undefined
  const match = new RegExp("(?:^|;)\s*" + key + ":\s*([0-9.]+)\s*(pt|in|cm|mm|px)").exec(style)
  if (!match) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return undefined
  const unit = match[2]
  if (unit === "in") return value * 72
  if (unit === "cm") return value * 28.35
  if (unit === "mm") return value * 2.835
  if (unit === "px") return value * 0.75
  return value
}

/** 每张图：挂在第几段后面（段落下标，1 起）、包内路径、显示尺寸（pt）。 */
function readDocxImageAnchors(
  document: string,
  rels: string,
): Array<{ after: number; target: string; width?: number; height?: number }> {
  const anchors: Array<{ after: number; target: string; width?: number; height?: number }> = []
  for (const span of collectParagraphs(document)) {
    const body = paragraphBody(document, span)
    // 一张图一个图形容器；按出现顺序切段，尺寸只在所属那段里找。
    const starts: number[] = []
    for (const pattern of [/<w:drawing\b/g, /<w:pict\b/g]) {
      for (const match of body.matchAll(pattern)) starts.push(match.index ?? 0)
    }
    if (starts.length === 0) continue
    starts.sort((left, right) => left - right)
    for (const [position, start] of starts.entries()) {
      const segment = body.slice(start, starts[position + 1] ?? body.length)
      const embed = /\br:(?:embed|id)="([^"]+)"/i.exec(segment)
      if (!embed?.[1]) continue
      const target = resolveRelationship(rels, embed[1])
      if (!target) continue
      // EMU（1/360000 cm）→ pt：除以 12700。
      const extent = /<wp:extent\b[^>]*>/i.exec(segment)
      const emuX = extent ? Number(attribute(extent[0], "cx")) : Number.NaN
      const emuY = extent ? Number(attribute(extent[0], "cy")) : Number.NaN
      const style = /\bstyle="([^"]*)"/i.exec(segment)
      const width = Number.isFinite(emuX) && emuX > 0 ? emuX / 12700 : styleLength(style?.[1], "width")
      const height = Number.isFinite(emuY) && emuY > 0 ? emuY / 12700 : styleLength(style?.[1], "height")
      anchors.push({
        after: span.index,
        target,
        ...(width !== undefined && width > 0 ? { width } : {}),
        ...(height !== undefined && height > 0 ? { height } : {}),
      })
    }
  }
  return anchors
}

/** 把 docx 里的图片读成排版器输入；读不出来就当没有图，导出照常。 */
async function docxPrintImages(bytes: Uint8Array): Promise<PrintImage[]> {
  try {
    const zip = await readZip(bytes)
    const entry = zip.entries.find((item) => item.name === DOCUMENT_ENTRY)
    const relsEntry = zip.entries.find((item) => item.name === DOCUMENT_RELS)
    if (!entry || !relsEntry) return []
    const decoder = new TextDecoder()
    const document = decoder.decode(await inflateEntry(zip, entry))
    const rels = decoder.decode(await inflateEntry(zip, relsEntry))
    const images: PrintImage[] = []
    for (const anchor of readDocxImageAnchors(document, rels)) {
      const media = zip.entries.find((item) => item.name === anchor.target)
      if (!media) continue
      const ext = anchor.target.slice(anchor.target.lastIndexOf(".") + 1).toLowerCase()
      const mime = IMAGE_MIME[ext]
      if (!mime) continue
      images.push({
        after: anchor.after,
        data: await inflateEntry(zip, media),
        mime,
        ...(anchor.width === undefined ? {} : { width: anchor.width }),
        ...(anchor.height === undefined ? {} : { height: anchor.height }),
      })
    }
    return images
  } catch {
    return []
  }
}

/** sectPr 里默认页眉/页脚的引用 id。 */
function findHeaderFooterReference(document: string, kind: HeaderFooterKind): string | undefined {
  const tag = kind === "header" ? "w:headerReference" : "w:footerReference"
  const pattern = new RegExp("<" + tag + '\\b[^>]*w:type="default"[^>]*>', "i")
  const match = pattern.exec(document)
  if (match) return attribute(match[0], "r:id")
  const any = new RegExp("<" + tag + "\\b[^>]*>", "i").exec(document)
  return any ? attribute(any[0], "r:id") : undefined
}

/** 把一段文字写进页眉/页脚部件；保留原有的图片、表格和格式。 */
export function writeHeaderFooterText(xml: string, text: string): string {
  const spans = collectParagraphs(xml)
  if (spans.length > 0 && text.includes(String.fromCharCode(10))) {
    // 多行页眉：整块换成对应的段落数（单行才走下面保留格式的路径）。
    const first = spans[0]!
    const last = spans[spans.length - 1]!
    return xml.slice(0, first.start) + headerFooterParagraphs(text) + xml.slice(last.end)
  }
  if (spans.length > 0) {
    const edited = editDocxXml(xml, { textEdits: [{ paragraph: 1, text }] })
    if (edited.ok) {
      // 原来是多段、现在改回一行：把后面多余的段落收掉，否则旧内容会留在页眉里。
      const next = collectParagraphs(edited.data.xml)
      if (next.length > 1) {
        return edited.data.xml.slice(0, next[1]!.start) + edited.data.xml.slice(next[next.length - 1]!.end)
      }
      return edited.data.xml
    }
  }
  const close = xml.includes("</w:ftr>") ? xml.lastIndexOf("</w:ftr>") : xml.lastIndexOf("</w:hdr>")
  if (close === -1) return xml
  const paragraph = '<w:p><w:r><w:t xml:space="preserve">' + encodeXmlText(text) + "</w:t></w:r></w:p>"
  return xml.slice(0, close) + paragraph + xml.slice(close)
}

/** 新建一个空的页眉/页脚部件（只含一段文字）。 */
export function headerFooterXml(kind: HeaderFooterKind, text: string): string {
  const tag = HEADER_FOOTER_TAG[kind]
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    "<" +
    tag +
    HEADER_FOOTER_NAMESPACES +
    ">" +
    headerFooterParagraphs(text) +
    "</" +
    tag +
    ">"
  )
}

/** 页眉/页脚文字 → 段落 XML：一行一段（空行也保留，用户可能用空行做间隔）。 */
function headerFooterParagraphs(text: string): string {
  return text
    .split(String.fromCharCode(10))
    .map(
      (line) =>
        '<w:p><w:r><w:t xml:space="preserve">' +
        encodeXmlText(line.replace(String.fromCharCode(13), "")) +
        "</w:t></w:r></w:p>",
    )
    .join("")
}

/** 在 sectPr 开头插入默认引用（schema 要求引用排在 pgSz/pgMar 之前）。 */
function addHeaderFooterReference(document: string, kind: HeaderFooterKind, id: string): OfficeResult<string> {
  const start = document.lastIndexOf("<w:sectPr")
  if (start === -1) return fail("not_found", "文档里没有页面设置（sectPr），无法添加页眉页脚")
  const openEnd = document.indexOf(">", start)
  const selfClose = document[openEnd - 1] === "/"
  const tag = kind === "header" ? "w:headerReference" : "w:footerReference"
  const reference = "<" + tag + ' w:type="default" r:id="' + id + '"/>'
  if (selfClose) {
    const head = document.slice(start, openEnd).replace(/\/>$/, ">")
    return ok(document.slice(0, start) + head + reference + "</w:sectPr>" + document.slice(openEnd + 1))
  }
  return ok(document.slice(0, openEnd + 1) + reference + document.slice(openEnd + 1))
}

/** 读出页眉/页脚的纯文字（多段用换行连接）；没有就返回 undefined。 */
export function readHeaderFooter(
  document: string,
  rels: string,
  parts: Map<string, string>,
  kind: HeaderFooterKind,
): string | undefined {
  const id = findHeaderFooterReference(document, kind)
  if (!id) return undefined
  const part = resolveRelationship(rels, id)
  const xml = part ? parts.get(part) : undefined
  if (!xml) return undefined
  return collectParagraphs(xml)
    .map((span) => paragraphText(paragraphBody(xml, span)))
    .join("\n")
}

/** 页眉/页脚读写需要的包内上下文。 */
export type HeaderFooterContext = {
  document: string
  rels: string
  contentTypes?: string
  /** 包里已有的部件文本（xml），键是包内路径。 */
  parts: Map<string, string>
}

/**
 * 设置页眉或页脚文字，返回新的 XML 与新增/改写的包内条目。
 *
 * 已有的引用直接改对应部件的第一个段落；没有引用就新建部件、登记关系、
 * 补 Content_Types，再把 headerReference 插进 sectPr。
 */
export function setHeaderFooter(
  context: HeaderFooterContext,
  kind: HeaderFooterKind,
  text: string,
): OfficeResult<{
  document: string
  rels: string
  contentTypes?: string
  additions: Map<string, string>
  replacements: Map<string, string>
}> {
  const id = findHeaderFooterReference(context.document, kind)
  const additions = new Map<string, string>()
  const replacements = new Map<string, string>()

  if (id) {
    const part = resolveRelationship(context.rels, id)
    if (!part) return fail("engine", "页眉页脚的关系指向了不存在的部件")
    const current = context.parts.get(part)
    if (!current) return fail("not_found", "找不到页眉页脚部件：" + part)
    replacements.set(part, writeHeaderFooterText(current, text))
    return ok({
      document: context.document,
      rels: context.rels,
      contentTypes: context.contentTypes,
      additions,
      replacements,
    })
  }

  // 新建部件：名字取现有编号的下一个，避免覆盖别人的页眉。
  let next = 1
  for (const name of context.parts.keys()) {
    const match = new RegExp("^word/" + kind + "(\\d+)\\.xml$").exec(name)
    if (match) next = Math.max(next, Number(match[1]) + 1)
  }
  const part = "word/" + kind + next + ".xml"

  let maxId = 0
  for (const match of context.rels.matchAll(/Id="rId(\d+)"/g)) maxId = Math.max(maxId, Number(match[1]))
  const relationshipId = "rId" + (maxId + 1)

  const rels = context.rels.replace(
    "</Relationships>",
    '<Relationship Id="' +
      relationshipId +
      '" Type="' +
      HEADER_FOOTER_REL[kind] +
      '" Target="' +
      kind +
      next +
      '.xml"/></Relationships>',
  )
  if (rels === context.rels) return fail("engine", "document.xml.rels 结构不完整")

  let document = ensureDocumentNamespaces(context.document)
  const added = addHeaderFooterReference(document, kind, relationshipId)
  if (!added.ok) return added
  document = added.data

  let contentTypes = context.contentTypes
  if (contentTypes && !contentTypes.includes("/" + part)) {
    contentTypes = contentTypes.replace(
      "</Types>",
      '<Override PartName="/' + part + '" ContentType="' + HEADER_FOOTER_CONTENT_TYPE[kind] + '"/></Types>',
    )
  }

  additions.set(part, headerFooterXml(kind, text))
  return ok({ document, rels, contentTypes, additions, replacements })
}

/**
 * 按字符区间给一段文字加格式（选中一部分加粗 / 改字号）。
 *
 * 只在 run 边界处切分：完全落在区间里的 run 直接改；跨边界的 run 拆成
 * 「前 / 中 / 后」三个 run，中间那个带上新格式。这样同一段里其余文字的
 * 字体、颜色、上下标都不受影响。
 */
export function applyRunStyleRange(
  body: string,
  start: number,
  end: number,
  style: NonNullable<StyleEdit["style"]>,
): string {
  const runs = findAll(body, "w:r")
  if (runs.length === 0 || end <= start) return body

  // 先算出每个 run 覆盖的文字区间。
  const spans: Array<{ start: number; end: number; text: string; from: number; to: number }> = []
  let cursor = 0
  for (const run of runs) {
    const inner = body.slice(run.openEnd + 1, run.end)
    const text = findAll(inner, "w:t")
      .map((item) => decodeXmlText(inner.slice(inner.indexOf(">", item.start) + 1, item.end - "</w:t>".length)))
      .join("")
    if (text.length > 0) {
      spans.push({ start: run.start, end: run.end, text, from: cursor, to: cursor + text.length })
      cursor += text.length
    }
  }
  if (spans.length === 0) return body

  let next = body
  // 从后往前替换，前面的偏移才不会失效。
  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index]!
    const from = Math.max(start, span.from)
    const to = Math.min(end, span.to)
    if (to <= from) continue
    const openEnd = next.indexOf(">", span.start) + 1
    const runInner = next.slice(openEnd, span.end - "</w:r>".length)
    const props = findElement(runInner, "w:rPr")
    const rPr = props ? runInner.slice(props.start, props.end) : "<w:rPr></w:rPr>"
    const styled = applyRunStyle(rPr, style)
    const whole = from === span.from && to === span.to

    // 非文字内容（图片、换行）不拆开，整段套格式。
    const leftovers = runInner
      .replace(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/g, "")
      .replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, "")
    if (whole || leftovers.replace(/\s+/g, "").length > 0) {
      const rest = props ? runInner.slice(0, props.start) + styled + runInner.slice(props.end) : styled + runInner
      next = next.slice(0, openEnd) + rest + next.slice(span.end - "</w:r>".length)
      continue
    }

    const localFrom = from - span.from
    const localTo = to - span.from
    const before = span.text.slice(0, localFrom)
    const middle = span.text.slice(localFrom, localTo)
    const after = span.text.slice(localTo)
    const piece = (propsXml: string, value: string) =>
      value.length === 0
        ? ""
        : "<w:r>" + propsXml + '<w:t xml:space="preserve">' + encodeXmlText(value) + "</w:t></w:r>"
    next =
      next.slice(0, span.start) + piece(rPr, before) + piece(styled, middle) + piece(rPr, after) + next.slice(span.end)
  }
  return next
}
