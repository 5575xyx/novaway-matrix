/**
 * 极简 XML 定位工具。
 *
 * 办公文档的写回不能用「解析成对象树再序列化」：那样会把解析器不认识的
 * 扩展（SmartArt、墨迹、图表缓存、批注、修订）全丢掉。Weave 的做法是在原始
 * XML 文本上做外科手术，我们也一样 —— 所以只需要能可靠地找到某个标签的
 * 起止，不需要完整 DOM。
 */

export function decodeXmlText(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
}

export function encodeXmlText(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * 从 `start`（某个开标签的 `<`）开始，找到同名标签的结束位置（闭标签之后）。
 * 自闭合标签直接返回开标签结尾。同名的嵌套标签会被正确配平。
 */
export function endOfElement(xml: string, start: number, tag: string): number {
  const open = `<${tag}`
  const close = `</${tag}>`
  if (!xml.startsWith(open, start)) return -1
  const openEnd = xml.indexOf(">", start)
  if (openEnd === -1) return -1
  if (xml[openEnd - 1] === "/") return openEnd + 1

  let depth = 1
  let cursor = openEnd + 1
  while (depth > 0) {
    const nextClose = xml.indexOf(close, cursor)
    if (nextClose === -1) return -1

    // 先跳过所有「前缀相同但不是同名」的开标签（<w:p> 里的 <w:pPr>、<w:r> 里的 <w:rPr>）。
    let nextOpen = xml.indexOf(open, cursor)
    while (nextOpen !== -1 && nextOpen < nextClose && !sameTagName(xml, nextOpen, open.length)) {
      cursor = nextOpen + open.length
      nextOpen = xml.indexOf(open, cursor)
    }

    if (nextOpen !== -1 && nextOpen < nextClose) {
      const openTagEnd = xml.indexOf(">", nextOpen)
      if (openTagEnd === -1) return -1
      // 自闭合的同名标签不增加深度。
      if (xml[openTagEnd - 1] === "/") {
        cursor = openTagEnd + 1
        continue
      }
      depth += 1
      cursor = openTagEnd + 1
      continue
    }

    depth -= 1
    cursor = nextClose + close.length
  }
  return cursor
}

/** 标签名后必须紧跟空白、`>` 或 `/`，`<w:pPr>` 不算 `<w:p>`。 */
function sameTagName(xml: string, start: number, openLength: number): boolean {
  const after = xml[start + openLength]
  return after === ">" || after === "/" || after === " " || after === "\t" || after === "\n" || after === "\r"
}

/** 找第一个 `<tag ...>` / `<tag/>` 的位置与结束位置。 */
export function findElement(
  xml: string,
  tag: string,
  from = 0,
  to = xml.length,
): { start: number; end: number; openEnd: number } | undefined {
  let cursor = from
  while (cursor < to) {
    const start = xml.indexOf(`<${tag}`, cursor)
    if (start === -1 || start >= to) return undefined
    if (!sameTagName(xml, start, tag.length + 1)) {
      cursor = start + 1
      continue
    }
    const end = endOfElement(xml, start, tag)
    if (end === -1) return undefined
    return { start, end, openEnd: xml.indexOf(">", start) }
  }
  return undefined
}

export function findAll(xml: string, tag: string, from = 0, to = xml.length): Array<{ start: number; end: number; openEnd: number }> {
  const out: Array<{ start: number; end: number; openEnd: number }> = []
  let cursor = from
  while (cursor < to) {
    const found = findElement(xml, tag, cursor, to)
    if (!found) break
    out.push(found)
    cursor = found.end
  }
  return out
}

/** 读一个标签上的属性值（只处理双引号形式，够 OOXML 用）。 */
export function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp("(?:^|\\s)" + name + '="([^"]*)"').exec(tag)
  return match?.[1]
}

/**
 * 在 tag 文本里增/删/改一个属性。
 * `value === undefined` 表示删掉这个属性。
 */
export function setAttribute(tag: string, name: string, value: string | undefined): string {
  // 值没变就原样返回：属性顺序会进比较（xf / font 的复用靠逐字比对），
  // 每次「删了再加」会让同一条样式看起来是新条目。
  const current = attribute(tag, name)
  if (value === undefined ? current === undefined : current === value) return tag
  const selfClosing = /\/>$/.test(tag)
  const openEnd = tag.lastIndexOf(">")
  const prefix = tag.slice(0, selfClosing ? openEnd - 1 : openEnd)
  const suffix = tag.slice(selfClosing ? openEnd - 1 : openEnd)
  const pattern = new RegExp("(?:^|\\s)" + name + '="[^"]*"')
  const cleaned = prefix.replace(pattern, "")
  if (value === undefined) return `${cleaned}${suffix}`
  return `${cleaned} ${name}="${value}"${suffix}`
}
