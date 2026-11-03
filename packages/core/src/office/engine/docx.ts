
/**
 * DOCX 引擎：段落级文字与格式的原地修改。
 *
 * 和 PPTX 同一套思路（对齐 Weave 的 hosted 适配层）。
 */
import type { ApplyOutcome, OfficeEngine, OfficeOp, OfficeResult } from "./contract"
import { fail, ok } from "./contract"
import { attribute, decodeXmlText, encodeXmlText, findAll, findElement, setAttribute } from "./xml"
import { inflateEntry, readZip, rebuildZip, type ZipArchive } from "./zip"

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
  /** pt */
  size?: number
  /** RRGGBB */
  color?: string
  font?: string
  /** 该段落是否在表格里（写回时不影响定位，只用于 UI 提示）。 */
  inTable?: boolean
}

export type DocxState = {
  paragraphs: DocxParagraph[]
}

type ParagraphSpan = {
  index: number
  start: number
  end: number
  inTable: boolean
}

const DOCUMENT_ENTRY = "word/document.xml"

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
  const size = /<w:sz\b[^>]*\bw:val="(\d+)"/.exec(rPr)
  const color = /<w:color\b[^>]*\bw:val="([0-9A-Fa-f]{6})"/.exec(rPr)
  const fonts = /<w:rFonts\b[^>]*>/.exec(rPr)
  return {
    ...(styleMatch ? { style: attribute(styleMatch[0], "w:val") } : {}),
    ...(jcMatch ? { align: attribute(jcMatch[0], "w:val") as DocxAlign | undefined } : {}),
    ...(bold ? { bold: true } : {}),
    ...(italic ? { italic: true } : {}),
    ...(underline ? { underline: true } : {}),
    ...(size ? { size: Number(size[1]) / 2 } : {}),
    ...(color ? { color: color[1]!.toUpperCase() } : {}),
    ...(fonts
      ? {
          font:
            attribute(fonts[0], "w:eastAsia") ??
            attribute(fonts[0], "w:ascii") ??
            attribute(fonts[0], "w:hAnsi"),
        }
      : {}),
  }
}

export function readDocxParagraphs(xml: string): DocxParagraph[] {
  return collectParagraphs(xml).map((span) => {
    const body = paragraphBody(xml, span)
    const props = findElement(body, "w:pPr")
    const pPr = props ? body.slice(props.start, props.end) : undefined
    return {
      index: span.index,
      text: paragraphText(body),
      ...(span.inTable ? { inTable: true } : {}),
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
  style?: {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    /** pt */
    size?: number
    /** RRGGBB */
    color?: string
    align?: DocxAlign
    font?: string
    /** 段落样式名；给空字符串表示改成正文 */
    paragraphStyle?: string
  }
}

/**
 * 把整段文字塞进第一个 w:t，其余置空。
 * 段落里没有 run 时新建一个带 rPr 的 run，保证格式可继承。
 */
function rewriteParagraphText(body: string, text: string): string {
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
  if (style.font !== undefined) {
    next = removeChild(next, "w:rPr", "w:rFonts")
    const name = encodeXmlText(style.font)
    next = insertChild(next, "w:rPr", `<w:rFonts w:ascii="${name}" w:eastAsia="${name}" w:hAnsi="${name}"/>`)
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
    return xml.slice(0, selfClose) + `<${container}>${child}</${container}>` + xml.slice(selfClose + container.length + 3)
  }
  return xml.slice(0, close) + child + xml.slice(close)
}

function applyParagraphStyle(body: string, style: NonNullable<StyleEdit["style"]>): string {
  let next = ensureRunProps(body)

  const runLevel =
    style.bold !== undefined ||
    style.italic !== undefined ||
    style.underline !== undefined ||
    style.size !== undefined ||
    style.color !== undefined ||
    style.font !== undefined

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

  if (style.align !== undefined || style.paragraphStyle !== undefined) {
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
      next = next.slice(0, props.start) + pPr + next.slice(props.end)
    } else if (style.align !== undefined || style.paragraphStyle) {
      const openEnd = next.indexOf(">", next.indexOf("<w:p")) + 1
      const children = [
        style.paragraphStyle ? `<w:pStyle w:val="${encodeXmlText(style.paragraphStyle)}"/>` : "",
        style.align ? `<w:jc w:val="${style.align}"/>` : "",
      ].join("")
      next = next.slice(0, openEnd) + `<w:pPr>${children}</w:pPr>` + next.slice(openEnd)
    }
  }

  return next
}

/** w:pPr 里 pStyle 必须在最前面；其余元素插在末尾前即可。 */
function insertPPrStyle(pPr: string, name: string): string {
  const openEnd = pPr.indexOf(">") + 1
  return pPr.slice(0, openEnd) + `<w:pStyle w:val="${encodeXmlText(name)}"/>` + pPr.slice(openEnd)
}

export function editDocxXml(
  xml: string,
  edits: { textEdits?: readonly TextEdit[]; styleEdits?: readonly StyleEdit[] },
): { xml: string; applied: Array<{ paragraph: number; previous?: string; text?: string }> } {
  const byIndex = new Map(collectParagraphs(xml).map((span) => [span.index, span]))
  const applied: Array<{ paragraph: number; previous?: string; text?: string }> = []

  // 同一段可能既有文字又有格式：合并成一次替换，避免偏移错乱。
  const grouped = new Map<number, { text?: string; style?: NonNullable<StyleEdit["style"]> }>()
  for (const edit of edits.textEdits ?? []) {
    const entry = grouped.get(edit.paragraph) ?? {}
    entry.text = edit.text
    grouped.set(edit.paragraph, entry)
  }
  for (const edit of edits.styleEdits ?? []) {
    if (!edit.style) continue
    const entry = grouped.get(edit.paragraph) ?? {}
    entry.style = edit.style
    grouped.set(edit.paragraph, entry)
  }

  const targets = [...grouped.entries()]
    .map(([paragraph, change]) => ({ paragraph, change, span: byIndex.get(paragraph) }))
    .filter((item) => item.span)
    .sort((a, b) => b.span!.start - a.span!.start)

  if (targets.length === 0) return { xml, applied }

  let next = xml
  for (const { paragraph, change, span } of targets) {
    const target = span!
    const openEnd = next.indexOf(">", target.start)
    const body = next.slice(openEnd + 1, target.end - "</w:p>".length)
    const previous = paragraphText(body)
    let updated = body
    if (change.style) updated = applyParagraphStyle(updated, change.style)
    if (change.text !== undefined) updated = rewriteParagraphText(updated, change.text)
    next = next.slice(0, openEnd + 1) + updated + next.slice(target.end - "</w:p>".length)
    applied.push({ paragraph, previous, ...(change.text !== undefined ? { text: change.text } : {}) })
  }

  return { xml: next, applied: applied.reverse() }
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
      const xml = new TextDecoder().decode(await inflateEntry(zip, entry))
      return ok({ paragraphs: readDocxParagraphs(xml) })
    } catch (error) {
      return fail("open_failed", error instanceof Error ? error.message : "无法解析 DOCX")
    }
  },

  async apply(state, ops, bytes) {
    const textEdits: TextEdit[] = []
    const styleEdits: StyleEdit[] = []
    for (const op of ops) {
      if (op.op === "setParagraphText" || op.op === "setSpanText") {
        textEdits.push({ paragraph: op.paragraph, text: op.text })
      } else if (op.op === "setParagraphStyle") {
        const { align, ...rest } = op.style
        styleEdits.push({
          paragraph: op.paragraph,
          style: { ...rest, ...(align ? { align: mapAlign(align) } : {}) },
        })
      } else {
        return fail("unsupported_format", `${op.op} 不适用于 DOCX`)
      }
    }
    if (textEdits.length === 0 && styleEdits.length === 0) return fail("invalid_params", "没有要执行的文档操作")
    if (state.paragraphs.length === 0) return fail("not_found", "文档里没有可编辑的段落")

    try {
      const zip = await readZip(bytes)
      const entry = zip.entries.find((item) => item.name === DOCUMENT_ENTRY)
      if (!entry) return fail("open_failed", "DOCX 缺少 word/document.xml")
      const xml = new TextDecoder().decode(await inflateEntry(zip, entry))
      const result = editDocxXml(xml, { textEdits, styleEdits })
      if (result.applied.length === 0) {
        return fail("not_found", "没有找到要修改的段落", "先用 /body/p[N] 列一遍段落")
      }

      const nextZip = rebuildZip(zip, new Map([[DOCUMENT_ENTRY, new TextEncoder().encode(result.xml)]]))
      const reopened = await docxEngine.open(nextZip)
      if (!reopened.ok) return reopened
      return ok({ state: reopened.data, bytes: nextZip, changed: [DOCUMENT_ENTRY], applied: result.applied })
    } catch (error) {
      return fail("engine", error instanceof Error ? error.message : "DOCX 写入失败")
    }
  },
}

function mapAlign(align: "l" | "ctr" | "r" | "just"): DocxAlign {
  if (align === "ctr") return "center"
  if (align === "r") return "right"
  if (align === "just") return "both"
  return "left"
}
