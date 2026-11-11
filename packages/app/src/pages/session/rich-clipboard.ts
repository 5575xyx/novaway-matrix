/**
 * 富文本设计视图的粘贴归一化。
 *
 * 粘贴策略：**保留行内样式，丢掉脚本**。
 *
 * 剪贴板里的 HTML（从网页、Word、其它编辑器复制出来的）几乎不可能直接写进文件：
 * 里面通常有 `<meta>`、`<div>`、`class=MsoNormal`、`onclick`、`javascript:` 链接，
 * 而我们的编辑器只认识一组行内标签（strong/em/u/s/mark/span/a/br/img）。
 * 不归一化的话，粘贴内容会在保存时被 `setBlockHtml` 整体拒绝 ——
 * 用户看到的是「粘完就保存失败」。
 *
 * 所以这里用浏览器的 DOM 解析器做一次白名单整理：
 * - 脚本、样式、嵌入对象整体丢弃；
 * - 块级容器拍平成行（块与块之间一个 `<br>`），因为一块就是一个 contenteditable；
 * - 行内标签映射到本编辑器的规范写法，颜色 / 高亮 / 字号转成内联 style；
 * - 链接只留安全协议，不安全的只保留文字；
 * - 图片只留 data:/http(s)/相对地址。
 *
 * 最后用 core 的 `parseInline` 复核一遍：复核不过就返回空串，
 * 调用方退回纯文本粘贴，宁可丢格式也不把不可编辑的结构写进文件。
 */

import { parseColor, parseInline, safeHref } from "@novaway/core/office/rich/model"

/** 整棵子树都不要的元素：脚本、样式、以及浏览器会自己去加载的东西。 */
const SKIP = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "meta",
  "link",
  "head",
  "title",
  "iframe",
  "object",
  "embed",
  "svg",
  "canvas",
  "video",
  "audio",
])

/** 块级容器：内容保留，但块与块之间用 `<br>` 分行。 */
const BLOCK_LIKE = new Set([
  "p",
  "div",
  "li",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "pre",
  "hr",
])

/** 行内标签映射到本编辑器认识的规范标签。 */
const INLINE_TAG: Record<string, string> = {
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  cite: "em",
  dfn: "em",
  u: "u",
  ins: "u",
  s: "s",
  strike: "s",
  del: "s",
  mark: "mark",
}

export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** 从元素上取出「这一圈文字」该带的行内样式（只认颜色 / 高亮 / 字号）。 */
function inlineStyleOf(element: Element): string {
  const style = (element as HTMLElement).style
  const parts: string[] = []
  const color = parseColor(style.color) ?? parseColor(element.getAttribute("color") ?? undefined)
  if (color) parts.push("color:" + color)
  const background = parseColor(style.backgroundColor) ?? parseColor(element.getAttribute("bgcolor") ?? undefined)
  if (background) parts.push("background-color:" + background)
  const size = /^\s*([\d.]+)\s*px\s*$/i.exec(style.fontSize)
  if (size) parts.push("font-size:" + Number(size[1]) + "px")
  return parts.join(";")
}

function imageSource(element: Element): string | undefined {
  const src = (element.getAttribute("src") ?? "").trim()
  if (src.length === 0) return undefined
  if (/^data:image\//i.test(src)) return src
  // 网络图片和相对路径都留着；其它协议（javascript:、file: 等）直接丢。
  if (/^https?:\/\//i.test(src) || src.startsWith("/") || src.startsWith("./") || src.startsWith("../")) return src
  return undefined
}

function lastIsBreak(parts: string[]): boolean {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]!
    if (part.length === 0) continue
    return part.endsWith("<br>")
  }
  return false
}

function serializeNodes(parent: Node, parts: string[]): void {
  for (const node of Array.from(parent.childNodes)) {
    // 纯文字。
    if (node.nodeType === 3) {
      const text = node.textContent ?? ""
      if (text.length > 0) parts.push(escapeHtmlText(text.replace(/[\t\r\n]+/g, " ")))
      continue
    }
    if (node.nodeType !== 1) continue
    const element = node as Element
    const name = element.tagName.toLowerCase()
    if (SKIP.has(name)) continue
    if (name === "br") {
      parts.push("<br>")
      continue
    }
    if (name === "img") {
      const src = imageSource(element)
      if (src) parts.push('<img src="' + escapeAttribute(src) + '">')
      continue
    }

    const inner: string[] = []
    serializeNodes(element, inner)
    const body = inner.join("").replace(/(<br>)+$/, "")
    if (body.length === 0) continue

    if (BLOCK_LIKE.has(name)) {
      // 块与块之间分一行；开头没有前文时不补 `<br>`。
      if (!lastIsBreak(parts)) parts.push("<br>")
      parts.push(body)
      continue
    }

    // 链接：只留安全协议，其它只保留文字。
    if (name === "a") {
      const href = safeHref(element.getAttribute("href") ?? undefined)
      parts.push(href ? '<a href="' + escapeAttribute(href) + '">' + body + "</a>" : body)
      continue
    }

    const style = inlineStyleOf(element)
    const tag = INLINE_TAG[name]
    let wrapped = tag ? "<" + tag + ">" + body + "</" + tag + ">" : body
    if (style.length > 0 && name !== "mark") wrapped = '<span style="' + style + '">' + wrapped + "</span>"
    parts.push(wrapped)
  }
}

/**
 * 把剪贴板 HTML 归一成编辑器能安全写回的行内 HTML。
 * 归一后仍被 core 判成「不可编辑」时返回空串（调用方退回纯文本）。
 */
export function sanitizePastedHtml(html: string): string {
  if (typeof DOMParser === "undefined") return ""
  const document = new DOMParser().parseFromString(html, "text/html")
  const parts: string[] = []
  serializeNodes(document.body, parts)
  const clean = parts
    .join("")
    .replace(/^(<br>)+/, "")
    .replace(/(<br>){3,}/g, "<br><br>")
    .trim()
  if (clean.length === 0) return ""
  return parseInline(clean, 0).editable ? clean : ""
}

/** 纯文本粘贴：换行转 `<br>`，其余按文字转义。 */
export function pastedTextToHtml(text: string): string {
  const html = text.replace(/\r\n?/g, "\n").split("\n").map(escapeHtmlText).join("<br>")
  return parseInline(html, 0).editable ? html : ""
}
