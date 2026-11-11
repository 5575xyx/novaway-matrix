/**
 * 富文本（HTML）编辑命令。
 *
 * 命令面：段落样式、对齐、行高、缩进，
 * 以及选区上的粗体 / 斜体 / 下划线 / 删除线 / 颜色 / 高亮 / 字号。
 * 和纯文本命令一样，「纯函数 + 原文」：命令只返回新 HTML，不碰文件、不碰状态。
 *
 * 写回策略是外科手术式的：只替换被命令碰到的那一个块的内部；
 * 块外的一切（文档头、样式表、其它段落）逐字节不变。
 */

import type { OfficeResult } from "../engine/contract"
import { fail, ok, type RichAlign, type RichBlockTag, type RichFormatPatch } from "../engine/contract"
import { attribute, setAttribute } from "../engine/xml"
import {
  type RichBlock,
  type RichRun,
  type RunStyle,
  documentRange,
  parseColor,
  parseInline,
  parseRichBlocks,
  safeHref,
  serializePlainText,
  serializeRuns,
} from "./model"

function blockAt(html: string, index: number): RichBlock | undefined {
  return parseRichBlocks(html).find((block) => block.index === index)
}

function missingBlock(index: number): OfficeResult<never> {
  return fail("not_found", "没有第 " + index + " 个段落", "先用富文本视图确认段落序号（从 1 开始）")
}

function lockedBlock(block: RichBlock): OfficeResult<never> {
  return fail(
    "unsupported_format",
    "这一段不能安全地改写：" + (block.reason ?? "包含暂不支持的结构"),
    "可以切到源码视图直接编辑 HTML",
  )
}

function editableAt(html: string, index: number): OfficeResult<RichBlock> {
  const block = blockAt(html, index)
  if (!block) return missingBlock(index) as OfficeResult<never>
  if (!block.editable) return lockedBlock(block) as OfficeResult<never>
  return ok(block)
}

function styleOf(run: RichRun): RunStyle {
  const style: RunStyle = {}
  if (run.bold) style.bold = true
  if (run.italic) style.italic = true
  if (run.underline) style.underline = true
  if (run.strikethrough) style.strikethrough = true
  if (run.color) style.color = run.color
  if (run.highlight) style.highlight = run.highlight
  if (run.size) style.size = run.size
  return style
}

/** 用一个新块内部替换原文；合成段落需要补上 <p> 包裹。 */
function replaceInner(html: string, block: RichBlock, inner: string): string {
  if (block.synthetic) {
    return html.slice(0, block.start) + "<p>" + inner + "</p>" + html.slice(block.end)
  }
  return html.slice(0, block.textStart) + inner + html.slice(block.textEnd)
}

/** 整块替换文字：保留首段的字符格式（和 DOCX 的 rewriteParagraphText 一致）。 */
export function setBlockText(html: string, block: number, text: string): OfficeResult<string> {
  const target = editableAt(html, block)
  if (!target.ok) return target
  const style = target.data.runs[0] ? styleOf(target.data.runs[0]) : {}
  return ok(replaceInner(html, target.data, serializePlainText(text, style)))
}

/**
 * 用一段 HTML 替换整块内容（设计视图保存时用）。
 * 先按行内解析验证一遍：不认识的标签（链接、自定义元素）直接拒绝，
 * 而不是写进文件后让下一次读取变成不可编辑。
 */
export function setBlockHtml(html: string, block: number, inner: string): OfficeResult<string> {
  const target = editableAt(html, block)
  if (!target.ok) return target
  const parsed = parseInline(inner, 0)
  if (!parsed.editable) {
    return fail(
      "unsupported_format",
      "这段内容包含暂不支持的标记：" + (parsed.reason ?? "未知原因"),
      "只支持加粗/斜体/下划线/删除线/颜色/高亮/字号，可以切到源码视图编辑",
    )
  }
  // 统一重写成规范形式（浏览器可能把 <strong> 改成 <b>、style 顺序也可能变），
  // 保证「读出来 → 原样存回」不产生无谓 diff。
  return ok(replaceInner(html, target.data, serializeRuns(parsed.runs)))
}

/** 换段落类型：p / h1-h6 / blockquote / li / pre / div。属性原样保留。 */
export function setBlockType(html: string, block: number, tag: RichBlockTag): OfficeResult<string> {
  const target = editableAt(html, block)
  if (!target.ok) return target
  const value = target.data
  if (value.tag === tag && !value.synthetic) return ok(html)

  if (value.synthetic) {
    const inner = html.slice(value.textStart, value.textEnd)
    return ok(html.slice(0, value.start) + "<" + tag + ">" + inner + "</" + tag + ">" + html.slice(value.end))
  }

  const openTag = html.slice(value.start, value.openEnd)
  const nextOpen = openTag.replace(/^<[a-zA-Z0-9-]+/, "<" + tag)
  const closeLength = ("</" + value.tag + ">").length
  return ok(
    html.slice(0, value.start) +
      nextOpen +
      html.slice(value.openEnd, value.end - closeLength) +
      "</" +
      tag +
      ">" +
      html.slice(value.end),
  )
}

// ---------------------------------------------------------------------------
// style 属性
// ---------------------------------------------------------------------------

type StyleEntry = [string, string]

function styleEntries(tag: string): StyleEntry[] {
  const style = attribute(tag, "style")
  if (!style) return []
  const entries: StyleEntry[] = []
  for (const part of style.split(";")) {
    const colon = part.indexOf(":")
    if (colon === -1) continue
    const name = part.slice(0, colon).trim()
    if (!name) continue
    entries.push([name.toLowerCase(), part.slice(colon + 1).trim()])
  }
  return entries
}

function writeStyle(tag: string, entries: StyleEntry[]): string {
  if (entries.length === 0) return setAttribute(tag, "style", undefined)
  return setAttribute(tag, "style", entries.map(([name, value]) => name + ":" + value).join(";"))
}

function withStyle(tag: string, name: string, value: string | undefined): string {
  const entries = styleEntries(tag).filter(([existing]) => existing !== name)
  if (value !== undefined) entries.push([name, value])
  return writeStyle(tag, entries)
}

/** 改写块的开标签；合成段落顺便包成 <p>。 */
function editOpenTag(html: string, block: RichBlock, transform: (openTag: string) => string): string {
  if (block.synthetic) {
    const openTag = transform("<p>")
    if (openTag === "<p>") return html
    const name = /^<([a-zA-Z0-9-]+)/.exec(openTag)?.[1] ?? "p"
    return (
      html.slice(0, block.start) +
      openTag +
      html.slice(block.textStart, block.textEnd) +
      "</" +
      name +
      ">" +
      html.slice(block.end)
    )
  }
  const openTag = html.slice(block.start, block.openEnd)
  const next = transform(openTag)
  if (next === openTag) return html
  return html.slice(0, block.start) + next + html.slice(block.openEnd)
}

export function setBlockAlign(html: string, block: number, align: RichAlign): OfficeResult<string> {
  const target = editableAt(html, block)
  if (!target.ok) return target
  return ok(editOpenTag(html, target.data, (openTag) => withStyle(openTag, "text-align", align)))
}

/** 行高按倍数设置；传 0 表示恢复默认。 */
export function setBlockLineHeight(html: string, block: number, value: number): OfficeResult<string> {
  const target = editableAt(html, block)
  if (!target.ok) return target
  if (!Number.isFinite(value) || value < 0) return fail("invalid_params", "行高必须是正数")
  const declaration = value === 0 ? undefined : String(value)
  return ok(editOpenTag(html, target.data, (openTag) => withStyle(openTag, "line-height", declaration)))
}

/** 左缩进，单位 px；传 0 表示去掉缩进。 */
export function setBlockIndent(html: string, block: number, value: number): OfficeResult<string> {
  const target = editableAt(html, block)
  if (!target.ok) return target
  if (!Number.isFinite(value) || value < 0) return fail("invalid_params", "缩进必须是非负像素值")
  const declaration = value === 0 ? undefined : Math.round(value) + "px"
  return ok(editOpenTag(html, target.data, (openTag) => withStyle(openTag, "padding-left", declaration)))
}

/** 首行缩进，单位 px；传 0 表示不缩进。中文排版里通常是两个字的宽度。 */
export function setBlockFirstLineIndent(html: string, block: number, value: number): OfficeResult<string> {
  const target = editableAt(html, block)
  if (!target.ok) return target
  if (!Number.isFinite(value) || value < 0) return fail("invalid_params", "首行缩进必须是非负像素值")
  const declaration = value === 0 ? undefined : Math.round(value) + "px"
  return ok(editOpenTag(html, target.data, (openTag) => withStyle(openTag, "text-indent", declaration)))
}

// ---------------------------------------------------------------------------
// 行内格式
// ---------------------------------------------------------------------------

function hasPatch(patch: RichFormatPatch): boolean {
  return (
    patch.clear === true ||
    patch.bold !== undefined ||
    patch.italic !== undefined ||
    patch.underline !== undefined ||
    patch.strikethrough !== undefined ||
    patch.color !== undefined ||
    patch.highlight !== undefined ||
    patch.size !== undefined ||
    patch.link !== undefined
  )
}

function normalizeColor(value: string | undefined, label: string): OfficeResult<string | undefined> {
  if (value === undefined) return ok(undefined)
  const color = parseColor(value)
  if (!color) return fail("invalid_params", label + "必须是 #RRGGBB 或 #RGB：" + value)
  return ok(color)
}

function applyPatch(
  style: RunStyle,
  patch: RichFormatPatch,
  color: string | undefined,
  highlight: string | undefined,
  link: string | undefined,
): RunStyle {
  // 「清除格式」只清字体层面的东西，链接保留 —— 和 Word / 大多数编辑器一致。
  if (patch.clear) return style.href ? { href: style.href } : {}
  const next: RunStyle = { ...style }
  if (patch.bold !== undefined) {
    if (patch.bold) next.bold = true
    else delete next.bold
  }
  if (patch.italic !== undefined) {
    if (patch.italic) next.italic = true
    else delete next.italic
  }
  if (patch.underline !== undefined) {
    if (patch.underline) next.underline = true
    else delete next.underline
  }
  if (patch.strikethrough !== undefined) {
    if (patch.strikethrough) next.strikethrough = true
    else delete next.strikethrough
  }
  if (color !== undefined) next.color = color
  if (highlight !== undefined) next.highlight = highlight
  if (patch.size !== undefined) {
    if (patch.size > 0) next.size = patch.size
    else delete next.size
  }
  if (link !== undefined) {
    if (link.length > 0) next.href = link
    else delete next.href
  }
  return next
}

/**
 * 给块内 [start, end) 这段纯文字加/去格式；不传区间表示整块。
 * 区间按块内纯文字计数（`<br>` 算一个字符）。
 */
export function formatRange(
  html: string,
  block: number,
  start: number | undefined,
  end: number | undefined,
  patch: RichFormatPatch,
): OfficeResult<string> {
  const target = editableAt(html, block)
  if (!target.ok) return target
  if (!hasPatch(patch)) return fail("invalid_params", "没有指定要修改的格式")

  const value = target.data
  const hasRange = start !== undefined || end !== undefined
  const from = start ?? 0
  const to = end ?? value.text.length
  if (!Number.isInteger(from) || !Number.isInteger(to)) return fail("invalid_params", "格式区间必须是整数")
  if (from < 0 || to > value.text.length || from > to) {
    return fail("invalid_params", "格式区间越界：0.." + value.text.length)
  }
  if (hasRange && from === to) return fail("invalid_params", "选区为空，没有可格式化的文字")

  const color = normalizeColor(patch.color, "文字颜色")
  if (!color.ok) return color
  const highlight = normalizeColor(patch.highlight, "高亮颜色")
  if (!highlight.ok) return highlight
  // 传空串 = 去掉链接；非空就必须是安全协议（javascript: 之类直接拒绝）。
  let link: string | undefined
  if (patch.link !== undefined) {
    if (patch.link.trim().length === 0) link = ""
    else {
      const safe = safeHref(patch.link)
      if (!safe)
        return fail("invalid_params", "不支持的链接协议：" + patch.link, "用 http(s) / mailto / tel / 相对路径")
      link = safe
    }
  }
  if (patch.size !== undefined && (!Number.isFinite(patch.size) || patch.size < 0)) {
    return fail("invalid_params", "字号必须是非负像素值")
  }

  const runs: RichRun[] = []
  let cursor = 0
  for (const run of value.runs) {
    // 图片没有文字偏移：整段格式化时原样保留，绝不参与拆分。
    if (run.image) {
      runs.push({ ...run })
      continue
    }
    const runStart = cursor
    const runEnd = cursor + run.text.length
    cursor = runEnd
    if (runEnd <= from || runStart >= to) {
      runs.push({ ...run })
      continue
    }
    const left = Math.max(from, runStart) - runStart
    const right = Math.min(to, runEnd) - runStart
    if (left > 0) runs.push({ ...run, text: run.text.slice(0, left), start: 0, end: 0 })
    const middle = applyPatch(styleOf(run), patch, color.data, highlight.data, link)
    runs.push({ ...middle, text: run.text.slice(left, right), start: 0, end: 0 })
    if (right < run.text.length) runs.push({ ...run, text: run.text.slice(right), start: 0, end: 0 })
  }

  return ok(replaceInner(html, value, serializeRuns(runs)))
}

// ---------------------------------------------------------------------------
// 结构：插入 / 删除整块
// ---------------------------------------------------------------------------

/**
 * 在第 N 块之后插入一个新块（0 = 文档开头）。
 *
 * 内容先按行内 HTML 校验并规范化，和 `setBlockHtml` 用同一套规则：
 * 解析不出安全结构就整体拒绝，不往文件里写半个块。
 */
export function insertBlock(
  html: string,
  after: number,
  input: { html?: string; text?: string; tag?: RichBlockTag },
): OfficeResult<string> {
  if (!Number.isInteger(after) || after < 0) return fail("invalid_params", "插入位置从 0 开始")
  if (input.html === undefined && input.text === undefined) return fail("invalid_params", "新段落需要 html 或 text")
  const blocks = parseRichBlocks(html)
  if (after > blocks.length) return fail("not_found", "没有第 " + after + " 个段落")
  const anchor = after === 0 ? undefined : blocks[after - 1]
  // 列表项后面插入列表项，否则会插出一个非法的 <p> 直接挂在 <ul> 下。
  const tag: RichBlockTag = input.tag ?? (anchor?.tag === "li" ? "li" : "p")

  let inner = ""
  if (input.html !== undefined) {
    const parsed = parseInline(input.html, 0)
    if (!parsed.editable) {
      return fail(
        "unsupported_format",
        "新段落包含暂不支持的标记：" + (parsed.reason ?? "未知原因"),
        "只支持加粗/斜体/下划线/删除线/颜色/高亮/字号，可以切到源码视图编辑",
      )
    }
    inner = serializeRuns(parsed.runs)
  } else if (input.text !== undefined) {
    inner = serializePlainText(input.text)
  }

  // after = 0 时插到正文容器的开头（有 <body> 就在 body 里，没有就在文档开头）。
  const at = anchor ? anchor.end : documentRange(html).innerStart
  const block = "<" + tag + ">" + inner + "</" + tag + ">"
  return ok(html.slice(0, at) + block + html.slice(at))
}

/** 删除第 N 块；不可编辑的块（表格/脚本容器）拒绝删除。 */
export function deleteBlock(html: string, block: number): OfficeResult<string> {
  const target = editableAt(html, block)
  if (!target.ok) return target
  const value = target.data
  // 合成段落没有自己的标签，删掉它的文字即可。
  if (value.synthetic) {
    if (value.text.length === 0) return ok(html)
    return ok(html.slice(0, value.start) + html.slice(value.end))
  }
  return ok(html.slice(0, value.start) + html.slice(value.end))
}

// ---------------------------------------------------------------------------
// 列表：无序 / 有序 / 取消
//
// 富文本里的列表是「容器 + 条目」两层结构，所以不能只把 <p> 改名成 <li>：
// 1. 段落不在列表里 → 包一层 <ul>/<ol>；
// 2. 换列表类型 → 整个容器换标签（条目一个都不动）；
// 3. 取消 → 把这一条从容器里摘出来变回 <p>；容器里还有别的条目时，
//    就在原位置前后各留一个列表，保证 HTML 始终是合法的。
// ---------------------------------------------------------------------------

export type RichListKind = "ul" | "ol"

/** 找到包住这个块的列表容器（最内层、同名的那个）。 */
function enclosingList(
  html: string,
  block: RichBlock,
  tag: RichListKind,
): { start: number; openEnd: number; closeStart: number; end: number } | undefined {
  const open = new RegExp("<" + tag + "\\b", "gi")
  let start = -1
  for (const match of html.matchAll(open)) {
    if (match.index >= block.start) break
    start = match.index
  }
  if (start === -1) return undefined

  const tokens = new RegExp("<" + tag + "\\b|</" + tag + ">", "gi")
  tokens.lastIndex = start
  let depth = 0
  for (let match = tokens.exec(html); match; match = tokens.exec(html)) {
    if (match[0].startsWith("</")) {
      depth -= 1
      if (depth === 0) {
        if (match.index < block.end) return undefined
        return {
          start,
          openEnd: html.indexOf(">", start) + 1,
          closeStart: match.index,
          end: match.index + match[0].length,
        }
      }
      continue
    }
    depth += 1
  }
  return undefined
}

/** 把块的标签换成 li（合成段落没有标签，直接包一层）。 */
function asListItem(html: string, block: RichBlock): string {
  if (block.synthetic) return "<li>" + html.slice(block.textStart, block.textEnd) + "</li>"
  const open = html.slice(block.start, block.openEnd).replace(/^<[a-zA-Z0-9-]+/, "<li")
  return open + html.slice(block.openEnd, block.end - ("</" + block.tag + ">").length) + "</li>"
}

/** 把列表项变回普通段落。 */
function asParagraph(html: string, block: RichBlock): string {
  if (block.synthetic) return "<p>" + html.slice(block.textStart, block.textEnd) + "</p>"
  if (block.tag !== "li") return html.slice(block.start, block.end)
  const open = html.slice(block.start, block.openEnd).replace(/^<li\b/, "<p")
  return open + html.slice(block.openEnd, block.end - "</li>".length) + "</p>"
}

/**
 * 列表开关。
 *
 * `kind` 是目标类型；传 "none" 表示取消列表。
 * 当前块已经在同类列表里时，UI 会传 "none"（按钮当开关用）。
 */
export function setBlockList(html: string, block: number, kind: RichListKind | "none"): OfficeResult<string> {
  const target = editableAt(html, block)
  if (!target.ok) return target
  const value = target.data
  const current = value.list

  if (kind === "none") {
    if (!current) return ok(html)
    const list = enclosingList(html, value, current)
    // 找不到容器就退回「只改标签」：至少不会把文档弄坏。
    if (!list) return setBlockType(html, block, "p")

    const openTag = html.slice(list.start, list.openEnd)
    const closeTag = "</" + current + ">"
    const before = html.slice(list.start, value.start)
    const after = html.slice(value.end, list.closeStart)
    const left = before.trim() === openTag.trim() ? "" : before + closeTag
    const right = after.trim().length === 0 ? "" : openTag + after + closeTag
    return ok(html.slice(0, list.start) + left + asParagraph(html, value) + right + html.slice(list.end))
  }

  // 换类型：容器换标签，条目原样保留。
  if (current && current !== kind) {
    const list = enclosingList(html, value, current)
    if (!list) return ok(html)
    const open = html.slice(list.start, list.openEnd).replace(/^<[a-zA-Z0-9-]+/, "<" + kind)
    return ok(
      html.slice(0, list.start) +
        open +
        html.slice(list.openEnd, list.closeStart) +
        "</" +
        kind +
        ">" +
        html.slice(list.end),
    )
  }

  // 已经是目标类型：不动。
  if (current === kind) return ok(html)

  // 不在列表里：包一层。
  const wrapped = "<" + kind + ">" + asListItem(html, value) + "</" + kind + ">"
  return ok(html.slice(0, value.start) + wrapped + html.slice(value.end))
}
