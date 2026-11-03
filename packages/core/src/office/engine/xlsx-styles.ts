/**
 * xl/styles.xml 的增删改。
 *
 * 单元格格式不是「就地改属性」：Excel 的 `<c s="3">` 指向 `<cellXfs>` 里的第 4 个
 * `<xf>`，而粗体/颜色/填充又各自指向 `<fonts>` / `<fills>` 的下标。所以改格式 =
 * 「克隆当前的 xf → 按补丁改 font/fill/alignment → 追加成新条目 → 单元格指向新下标」。
 *
 * 已有条目能复用就复用（逐字比较），否则每改一次颜色都往 styles.xml 里塞一条。
 * 其它条目的字节保持不变。
 */

import { attribute, findAll, setAttribute } from "./xml"

export type XlsxStylePatch = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** RRGGBB 或 AARRGGBB */
  color?: string
  /** RRGGBB 或 AARRGGBB；`""` 表示去掉填充 */
  fill?: string
  /** pt */
  size?: number
  format?: string
  align?: "l" | "ctr" | "r"
  wrap?: boolean
}

type Section = { start: number; innerStart: number; innerEnd: number; end: number; inner: string }

function section(xml: string, tag: string): Section | undefined {
  const start = xml.indexOf(`<${tag}`)
  if (start === -1) return undefined
  const openEnd = xml.indexOf(">", start)
  if (openEnd === -1) return undefined
  const close = xml.lastIndexOf(`</${tag}>`)
  if (close < openEnd) return undefined
  return { start, innerStart: openEnd + 1, innerEnd: close, end: close + tag.length + 3, inner: xml.slice(openEnd + 1, close) }
}

function elements(inner: string, tag: string): string[] {
  return findAll(inner, tag).map((span) => inner.slice(span.start, span.end))
}

function replaceSection(xml: string, tag: string, items: string[], count: boolean): string {
  const target = section(xml, tag)
  if (!target) return xml
  const tagText = xml.slice(target.start, target.innerStart)
  const nextOpen = count ? setAttribute(tagText, "count", String(items.length)) : tagText
  return xml.slice(0, target.start) + nextOpen + items.join("") + `</${tag}>` + xml.slice(target.end)
}

function normalizeColor(value: string): string | undefined {
  const hex = value.replace(/^#/, "").toUpperCase()
  if (/^[0-9A-F]{6}$/.test(hex)) return "FF" + hex
  if (/^[0-9A-F]{8}$/.test(hex)) return hex
  return undefined
}

function toggleInline(font: string, tag: string, enabled: boolean): string {
  const pattern = new RegExp("<" + tag + "\\b[^>]*/>", "g")
  if (enabled) return pattern.test(font) ? font : font.replace(/<\/font>$/, `<${tag}/></font>`)
  return font.replace(pattern, "")
}

function patchFont(font: string, patch: XlsxStylePatch): string {
  let next = font
  if (patch.bold !== undefined) next = toggleInline(next, "b", patch.bold)
  if (patch.italic !== undefined) next = toggleInline(next, "i", patch.italic)
  if (patch.underline !== undefined) next = toggleInline(next, "u", patch.underline)

  if (patch.color !== undefined) {
    const rgb = normalizeColor(patch.color)
    if (rgb) {
      const withColor = /<color\b[^>]*\/>/.test(next)
        ? next.replace(/<color\b[^>]*\/>/, `<color rgb="${rgb}"/>`)
        : next.replace(/<\/font>$/, `<color rgb="${rgb}"/></font>`)
      next = withColor
    }
  }

  if (patch.size !== undefined && patch.size > 0) {
    next = /<sz\b[^>]*\/>/.test(next)
      ? next.replace(/<sz\b[^>]*\/>/, `<sz val="${patch.size}"/>`)
      : next.replace(/<\/font>$/, `<sz val="${patch.size}"/></font>`)
  }

  return next
}

function fillXml(color: string | undefined): string {
  if (!color) return '<fill><patternFill patternType="none"/></fill>'
  const rgb = normalizeColor(color)
  if (!rgb) return '<fill><patternFill patternType="none"/></fill>'
  return `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`
}

function patchAlignment(xf: string, patch: XlsxStylePatch): string {
  if (patch.align === undefined && patch.wrap === undefined) return xf

  const horizontal = patch.align === "l" ? "left" : patch.align === "ctr" ? "center" : patch.align === "r" ? "right" : undefined
  const wrap = patch.wrap === undefined ? undefined : patch.wrap ? "1" : undefined

  const existing = /<alignment\b[^>]*\/?>/.exec(xf)?.[0]
  let alignment = existing ?? "<alignment/>"
  if (horizontal !== undefined) alignment = setAttribute(alignment, "horizontal", horizontal)
  if (patch.wrap !== undefined) alignment = setAttribute(alignment, "wrapText", patch.wrap ? "1" : undefined)

  if (existing) {
    let next = xf.replace(existing, alignment)
    if (!/\bapplyAlignment=/.test(next)) next = setAttribute(next.slice(0, next.indexOf(">") + 1), "applyAlignment", "1") + next.slice(next.indexOf(">") + 1)
    return next
  }
  // xf 没有 alignment 时插到末尾（自闭合要先展开）。
  if (/\/>\s*$/.test(xf)) {
    const open = setAttribute(xf.replace(/\/>\s*$/, ">"), "applyAlignment", "1")
    return open + alignment + "</xf>"
  }
  const close = xf.lastIndexOf("</xf>")
  const open = setAttribute(xf.slice(0, xf.indexOf(">") + 1), "applyAlignment", "1")
  return open + xf.slice(xf.indexOf(">") + 1, close) + alignment + "</xf>"
}

/** xf 的比较也要忽略属性顺序，否则「先加 fontId 再加 applyFont」就配不上已有条目。 */
function canonicalXf(xml: string): string {
  const open = xml.slice(0, xml.indexOf(">") + 1)
  const attrs = [...open.matchAll(/([\w:.-]+)="([^"]*)"/g)]
    .map((match) => match[1] + "=" + match[2])
    .sort()
  const rest = xml.slice(open.length)
  return "<xf " + attrs.join(" ") + (open.endsWith("/>") ? "/>" : ">") + rest
}

/**
 * 字体条目的比较要忽略子元素顺序：Excel 写的是 `<b/><sz/><name/>`，
 * 我们改出来的是 `<sz/><name/><b/>`，逐字比较会误判成新字体。
 */
function canonicalFont(xml: string): string {
  const open = /^<font\b[^>]*>/.exec(xml)?.[0] ?? "<font>"
  const inner = xml.slice(open.length, xml.length - "</font>".length)
  const children = inner.match(/<[a-zA-Z][\w:.-]*\b[^>]*\/>/g) ?? []
  return open + children.slice().sort().join("") + "</font>"
}

function ensureFont(inner: string, item: string): { inner: string; index: number } {
  const items = elements(inner, "font")
  const key = canonicalFont(item)
  const found = items.findIndex((existing) => canonicalFont(existing) === key)
  if (found >= 0) return { inner, index: found }
  const next = items.concat(item)
  return { inner: next.join(""), index: next.length - 1 }
}

function ensureItem(inner: string, tag: string, item: string): { inner: string; index: number } {
  const items = elements(inner, tag)
  const found = items.indexOf(item)
  if (found >= 0) return { inner, index: found }
  const next = items.concat(item)
  return { inner: next.join(""), index: next.length - 1 }
}

/**
 * 在 styles.xml 上追加一个 xf 并返回新下标。
 * 返回 undefined 表示这份样式表结构不认识（缺 cellXfs / fonts / fills），调用方应放弃改格式。
 */
export function ensureCellStyle(
  stylesXml: string,
  baseIndex: number,
  patch: XlsxStylePatch,
): { xml: string; index: number } | undefined {
  const cellXfs = section(stylesXml, "cellXfs")
  const fonts = section(stylesXml, "fonts")
  const fills = section(stylesXml, "fills")
  if (!cellXfs || !fonts || !fills) return undefined

  const xfs = elements(cellXfs.inner, "xf")
  const base = xfs[baseIndex] ?? xfs[0] ?? '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'

  let fontInner = fonts.inner
  let fillInner = fills.inner
  let next = base

  if (
    patch.bold !== undefined ||
    patch.italic !== undefined ||
    patch.underline !== undefined ||
    patch.color !== undefined ||
    patch.size !== undefined
  ) {
    const fontId = Number(attribute(base.slice(0, base.indexOf(">") + 1), "fontId") ?? "0")
    const baseFont = elements(fonts.inner, "font")[fontId] ?? "<font><sz val=\"11\"/><name val=\"Calibri\"/></font>"
    const font = ensureFont(fontInner, patchFont(baseFont, patch))
    fontInner = font.inner
    next = setAttribute(next.slice(0, next.indexOf(">") + 1), "fontId", String(font.index)) + next.slice(next.indexOf(">") + 1)
    next = setAttribute(next.slice(0, next.indexOf(">") + 1), "applyFont", "1") + next.slice(next.indexOf(">") + 1)
  }

  if (patch.fill !== undefined) {
    const fill = ensureItem(fillInner, "fill", fillXml(patch.fill))
    fillInner = fill.inner
    next = setAttribute(next.slice(0, next.indexOf(">") + 1), "fillId", String(fill.index)) + next.slice(next.indexOf(">") + 1)
    next = setAttribute(next.slice(0, next.indexOf(">") + 1), "applyFill", "1") + next.slice(next.indexOf(">") + 1)
  }

  next = patchAlignment(next, patch)

  const existing = xfs.findIndex((candidate) => canonicalXf(candidate) === canonicalXf(next))
  if (existing >= 0) return { xml: stylesXml, index: existing }

  const updatedXfs = xfs.concat(next)
  let xml = replaceSection(stylesXml, "cellXfs", updatedXfs, true)
  xml = replaceSection(xml, "fonts", elements(fontInner, "font"), true)
  xml = replaceSection(xml, "fills", elements(fillInner, "fill"), true)
  return { xml, index: updatedXfs.length - 1 }
}
