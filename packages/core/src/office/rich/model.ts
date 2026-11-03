/**
 * 富文本（HTML）文档模型。
 *
 * 对齐 Weave 的 `crates/rich-editor`：
 *   - HTML 文本本身就是文档，设计视图和源码视图共享同一份文本；
 *   - 没改过的文件保存后一个字节都不变（用会话的字节身份判断保证）；
 *   - 命令只改写「自己认识」的标签。遇到表格、脚本、未知内联标签时明确拒绝，
 *     而不是把不认识的标记序列化时丢一半 —— 那样会悄悄毁掉用户的文件。
 */

import type { RichAlign, RichBlockTag } from "../engine/contract"
import { attribute, decodeXmlText, endOfElement } from "../engine/xml"

export type RunStyle = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  /** #RRGGBB */
  color?: string
  /** #RRGGBB */
  highlight?: string
  /** px */
  size?: number
}

/** 一段连续文字及其来源区间（区间是 HTML 原文里的字符偏移）。 */
export type RichRun = RunStyle & { text: string; start: number; end: number }

export type RichBlock = {
  /** 1 起，和 /body/p[N] 一致。 */
  index: number
  tag: RichBlockTag
  /** 开标签 `<p` 的偏移。 */
  start: number
  /** 开标签 `>` 之后的偏移；合成段落等于 start。 */
  openEnd: number
  /** 闭标签 `>` 之后的偏移。 */
  end: number
  /** 行内内容在原文里的起止。 */
  textStart: number
  textEnd: number
  /** 纯文字（`<br>` 变成 \n）。 */
  text: string
  runs: RichRun[]
  /** 顶层散落文字被当成段落的标记；改写时要补上 <p>。 */
  synthetic: boolean
  list?: "ul" | "ol"
  align?: RichAlign
  /** 倍数，如 1.6。 */
  lineHeight?: number
  /** px */
  indent?: number
  editable: boolean
  /** 不可编辑的原因，直接展示给用户 / 模型。 */
  reason?: string
}

const BLOCK_TAGS = new Set<string>(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li", "pre", "div"])
const LIST_TAGS = new Set<string>(["ul", "ol"])
const UNSUPPORTED_CONTAINERS = new Set<string>(["table", "script", "style", "svg", "canvas", "iframe", "object", "video", "audio"])
const INLINE_STYLE_TAGS = new Map<string, RunStyle>()
INLINE_STYLE_TAGS.set("strong", { bold: true })
INLINE_STYLE_TAGS.set("b", { bold: true })
INLINE_STYLE_TAGS.set("em", { italic: true })
INLINE_STYLE_TAGS.set("i", { italic: true })
INLINE_STYLE_TAGS.set("u", { underline: true })
INLINE_STYLE_TAGS.set("ins", { underline: true })
INLINE_STYLE_TAGS.set("s", { strikethrough: true })
INLINE_STYLE_TAGS.set("strike", { strikethrough: true })
INLINE_STYLE_TAGS.set("del", { strikethrough: true })
INLINE_STYLE_TAGS.set("mark", { highlight: "#fef08a" })

/** 只认识这些内联标签；`a`、`font`、`sub`、`sup` 一律算「不认识」。 */
const KNOWN_INLINE = new Set<string>([
  "strong", "b", "em", "i", "u", "ins", "s", "strike", "del", "mark", "span", "br",
])

type ParsedTag = {
  name: string
  closing: boolean
  selfClosing: boolean
  patch?: RunStyle
}

function parseTagText(tag: string): ParsedTag | undefined {
  const match = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(tag)
  if (!match) return undefined
  const name = match[2]!.toLowerCase()
  const closing = match[1] === "/"
  const selfClosing = /\/>\s*$/.test(tag)
  if (closing) return { name, closing, selfClosing: false }

  if (name === "br") return { name, closing, selfClosing: true }
  if (name === "span") {
    const style = attribute(tag, "style")
    return { name, closing, selfClosing, patch: style ? parseInlineStyle(style) : {} }
  }
  const patch = INLINE_STYLE_TAGS.get(name)
  if (patch) {
    // <mark style="background-color:..."> 用标签上的颜色覆盖默认色。
    const style = attribute(tag, "style")
    return { name, closing, selfClosing, patch: style ? { ...patch, ...parseInlineStyle(style) } : { ...patch } }
  }
  return { name, closing, selfClosing }
}

export function parseColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  const hex = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed)
  if (!hex) return undefined
  const digits = hex[1]!
  const full = digits.length === 3
    ? digits.split("").map((char) => char + char).join("")
    : digits
  return "#" + full.toUpperCase()
}

function parseInlineStyle(style: string): RunStyle {
  const patch: RunStyle = {}
  for (const part of style.split(";")) {
    const colon = part.indexOf(":")
    if (colon === -1) continue
    const prop = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (prop === "color") {
      const color = parseColor(value)
      if (color) patch.color = color
    } else if (prop === "background-color") {
      const color = parseColor(value)
      if (color) patch.highlight = color
    } else if (prop === "font-size") {
      const size = /^([\d.]+)\s*px$/i.exec(value)
      if (size) patch.size = Number(size[1])
    }
  }
  return patch
}

/** 解析一段行内 HTML。返回 runs 以及「能否安全写回」。 */
export function parseInline(inner: string, base: number): { runs: RichRun[]; editable: boolean; reason?: string } {
  const runs: RichRun[] = []
  const stack: Array<{ tag: string; prev: RunStyle }> = []
  let current: RunStyle = {}
  let buffer = ""
  let bufferStart = base
  let editable = true
  let reason: string | undefined
  let pos = 0

  const flush = (at: number) => {
    if (buffer.length === 0) return
    runs.push({ ...current, text: decodeXmlText(buffer), start: bufferStart, end: at })
    buffer = ""
  }
  const fail = (message: string) => {
    if (editable) {
      editable = false
      reason = message
    }
  }

  while (pos < inner.length) {
    const lt = inner.indexOf("<", pos)
    if (lt === -1) {
      if (buffer.length === 0) bufferStart = base + pos
      buffer += inner.slice(pos)
      break
    }
    if (lt > pos) {
      if (buffer.length === 0) bufferStart = base + pos
      buffer += inner.slice(pos, lt)
    }

    if (inner.startsWith("<!--", lt)) {
      const close = inner.indexOf("-->", lt + 4)
      if (close === -1) {
        fail("HTML 注释没有闭合")
        buffer += inner.slice(lt)
        break
      }
      pos = close + 3
      continue
    }

    const gt = inner.indexOf(">", lt)
    if (gt === -1) {
      fail("行内标签没有闭合")
      if (buffer.length === 0) bufferStart = base + lt
      buffer += inner.slice(lt)
      break
    }

    const tagText = inner.slice(lt, gt + 1)
    const parsed = parseTagText(tagText)
    if (!parsed) {
      fail("看不懂的标记：" + tagText.slice(0, 40))
      pos = gt + 1
      continue
    }

    flush(base + lt)

    if (parsed.closing) {
      const frame = stack.pop()
      if (!frame || frame.tag !== parsed.name) {
        fail("内联标签没有正确配对：</" + parsed.name + ">")
        current = frame ? frame.prev : {}
      } else {
        current = frame.prev
      }
    } else if (parsed.name === "br") {
      runs.push({ ...current, text: "\n", start: base + lt, end: base + gt + 1 })
    } else if (parsed.selfClosing) {
      fail("不支持自闭合标签：<" + parsed.name + ">")
    } else if (KNOWN_INLINE.has(parsed.name)) {
      stack.push({ tag: parsed.name, prev: current })
      current = { ...current, ...(parsed.patch ?? {}) }
    } else {
      fail("不支持的内联标签：<" + parsed.name + ">")
      // 仍然配平标签，保证文字读得出来。
      stack.push({ tag: parsed.name, prev: current })
      current = { ...current }
    }

    pos = gt + 1
  }

  flush(base + inner.length)
  if (stack.length > 0 && editable) fail("有内联标签没有闭合")
  return { runs: mergeRuns(runs), editable, reason }
}

function sameRunStyle(a: RunStyle, b: RunStyle): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    Boolean(a.strikethrough) === Boolean(b.strikethrough) &&
    (a.color ?? "") === (b.color ?? "") &&
    (a.highlight ?? "") === (b.highlight ?? "") &&
    (a.size ?? 0) === (b.size ?? 0)
  )
}

function mergeRuns(runs: RichRun[]): RichRun[] {
  const out: RichRun[] = []
  for (const run of runs) {
    if (run.text.length === 0) continue
    const last = out.at(-1)
    if (last && sameRunStyle(last, run) && last.end === run.start) {
      last.text += run.text
      last.end = run.end
      continue
    }
    out.push({ ...run })
  }
  return out
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** 把 runs 序列化成规范的内联 HTML（只用于被命令改过的块）。 */
export function serializeRuns(runs: readonly RichRun[]): string {
  return runs
    .filter((run) => run.text.length > 0)
    .map((run) => {
      let out = escapeHtml(run.text).replace(/\n/g, "<br>")
      if (run.bold) out = "<strong>" + out + "</strong>"
      if (run.italic) out = "<em>" + out + "</em>"
      if (run.underline) out = "<u>" + out + "</u>"
      if (run.strikethrough) out = "<s>" + out + "</s>"
      const style: string[] = []
      if (run.color) style.push("color:" + run.color)
      if (run.highlight) style.push("background-color:" + run.highlight)
      if (run.size) style.push("font-size:" + run.size + "px")
      if (style.length > 0) out = '<span style="' + style.join(";") + '">' + out + "</span>"
      return out
    })
    .join("")
}

/** 用一段纯文字替换整块内容，保留首段的字符格式（和 DOCX 的写法一致）。 */
export function serializePlainText(text: string, style: RunStyle = {}): string {
  return serializeRuns([{ ...style, text, start: 0, end: 0 }])
}

function parseBlockAttrs(openTag: string): Pick<RichBlock, "align" | "lineHeight" | "indent"> {
  const style = attribute(openTag, "style") ?? ""
  const result: Pick<RichBlock, "align" | "lineHeight" | "indent"> = {}

  const align = /(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)/i.exec(style)
  const legacyAlign = attribute(openTag, "align")
  if (align) result.align = align[1]!.toLowerCase() as RichAlign
  else if (legacyAlign === "left" || legacyAlign === "center" || legacyAlign === "right" || legacyAlign === "justify") {
    result.align = legacyAlign
  }

  const lineHeight = /(?:^|;)\s*line-height\s*:\s*([\d.]+)/i.exec(style)
  if (lineHeight) result.lineHeight = Number(lineHeight[1])

  const indent = /(?:^|;)\s*(?:padding-left|margin-left|text-indent)\s*:\s*(\d+)px/i.exec(style)
  if (indent) result.indent = Number(indent[1])

  return result
}

function plainTextOf(fragment: string): string {
  return decodeXmlText(fragment.replace(/<[^>]*>/g, ""))
}

export function parseRichBlocks(html: string): RichBlock[] {
  const blocks: RichBlock[] = []
  const range = documentRange(html)
  collectBlocks(html, range.innerStart, range.innerEnd, undefined, blocks)
  blocks.forEach((block, position) => {
    block.index = position + 1
  })
  return blocks
}

function documentRange(html: string): { innerStart: number; innerEnd: number } {
  const body = /<body\b[^>]*>/i.exec(html)
  if (body) {
    const start = body.index + body[0].length
    const close = html.toLowerCase().lastIndexOf("</body>")
    return { innerStart: start, innerEnd: close > start ? close : html.length }
  }
  const head = /<head\b[^>]*>[\s\S]*?<\/head>/i.exec(html)
  if (head) return { innerStart: head.index + head[0].length, innerEnd: html.length }
  return { innerStart: 0, innerEnd: html.length }
}

function collectBlocks(
  html: string,
  from: number,
  to: number,
  list: "ul" | "ol" | undefined,
  blocks: RichBlock[],
): void {
  let cursor = from
  while (cursor < to) {
    const lt = html.indexOf("<", cursor)
    if (lt === -1 || lt >= to) {
      addSyntheticBlock(html, cursor, to, list, blocks)
      break
    }
    if (html.startsWith("<!--", lt)) {
      const close = html.indexOf("-->", lt + 4)
      cursor = close === -1 || close >= to ? to : close + 3
      continue
    }
    if (html[lt + 1] === "/") {
      cursor = lt + 2
      continue
    }
    const gt = html.indexOf(">", lt)
    if (gt === -1 || gt >= to) {
      addSyntheticBlock(html, cursor, to, list, blocks)
      break
    }
    const match = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, gt + 1))
    if (!match) {
      cursor = gt + 1
      continue
    }
    const name = match[1]!.toLowerCase()

    if (LIST_TAGS.has(name)) {
      const end = endOfElement(html, lt, name)
      const closeLength = ("</" + name + ">").length
      if (end === -1 || end > to) {
        addUnsupportedBlock(html, name, lt, gt + 1, to, list, blocks, "列表标签没有闭合")
        break
      }
      collectBlocks(html, gt + 1, end - closeLength, name as "ul" | "ol", blocks)
      cursor = end
      continue
    }

    if (BLOCK_TAGS.has(name)) {
      const end = endOfElement(html, lt, name)
      const closeLength = ("</" + name + ">").length
      const closed = end !== -1 && end <= to && html.slice(end - closeLength, end).toLowerCase() === "</" + name + ">"
      const blockEnd = end === -1 || end > to ? to : end
      const textEnd = closed ? blockEnd - closeLength : gt + 1
      blocks.push(makeBlock(html, name as RichBlockTag, lt, gt + 1, blockEnd, textEnd, list, !closed))
      cursor = blockEnd
      continue
    }

    if (UNSUPPORTED_CONTAINERS.has(name)) {
      const end = endOfElement(html, lt, name)
      const blockEnd = end === -1 || end > to ? to : end
      addUnsupportedBlock(html, name, lt, gt + 1, blockEnd, list, blocks, "不支持编辑 <" + name + "> 里的内容")
      cursor = blockEnd
      continue
    }

    const next = nextBlockTag(html, lt + 1, to)
    addSyntheticBlock(html, lt, next, list, blocks)
    cursor = next
  }
}

function nextBlockTag(html: string, from: number, to: number): number {
  const pattern = /<(?:\/)?(?:p|h[1-6]|blockquote|li|pre|div|ul|ol|table|script|style|svg)\b/gi
  pattern.lastIndex = from
  const match = pattern.exec(html)
  return match && match.index < to ? match.index : to
}

function makeBlock(
  html: string,
  tag: RichBlockTag,
  start: number,
  openEnd: number,
  end: number,
  textEnd: number,
  list: "ul" | "ol" | undefined,
  unclosed: boolean,
): RichBlock {
  const openTag = html.slice(start, openEnd)
  const inner = html.slice(openEnd, textEnd)
  const parsed = parseInline(inner, openEnd)
  const attrs = parseBlockAttrs(openTag)
  const reason = unclosed ? "块标签没有闭合" : parsed.reason
  return {
    index: 0,
    tag,
    start,
    openEnd,
    end,
    textStart: openEnd,
    textEnd,
    text: parsed.runs.map((run) => run.text).join(""),
    runs: parsed.runs,
    synthetic: false,
    ...(list ? { list } : {}),
    ...attrs,
    editable: parsed.editable && !unclosed,
    ...(reason ? { reason } : {}),
  }
}

function addSyntheticBlock(
  html: string,
  from: number,
  to: number,
  list: "ul" | "ol" | undefined,
  blocks: RichBlock[],
): void {
  const raw = html.slice(from, to)
  const trimmed = raw.trim()
  if (trimmed.length === 0) return
  const shift = raw.length - raw.trimStart().length
  from += shift
  to = from + trimmed.length
  const fragment = html.slice(from, to)
  const parsed = parseInline(fragment, from)
  blocks.push({
    index: 0,
    tag: "p",
    start: from,
    openEnd: from,
    end: to,
    textStart: from,
    textEnd: to,
    text: parsed.runs.map((run) => run.text).join(""),
    runs: parsed.runs,
    synthetic: true,
    ...(list ? { list } : {}),
    editable: parsed.editable,
    ...(parsed.reason ? { reason: parsed.reason } : {}),
  })
}

function addUnsupportedBlock(
  html: string,
  name: string,
  start: number,
  openEnd: number,
  end: number,
  list: "ul" | "ol" | undefined,
  blocks: RichBlock[],
  reason: string,
): void {
  const closeLength = ("</" + name + ">").length
  const textEnd = Math.max(openEnd, end - closeLength)
  const text = plainTextOf(html.slice(openEnd, textEnd))
  blocks.push({
    index: 0,
    tag: "div",
    start,
    openEnd,
    end,
    textStart: openEnd,
    textEnd,
    text,
    runs: [{ text, start: openEnd, end: textEnd }],
    synthetic: false,
    ...(list ? { list } : {}),
    editable: false,
    reason,
  })
}
