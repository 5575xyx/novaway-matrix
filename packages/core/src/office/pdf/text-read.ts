/**
 * 从 PDF 页面内容流里读出文字。
 *
 * `view <pdf> text` / `get /page[N]` 给出每页正文，AI 才能
 * 「先读再改」。实现上只读内容流里的 `Tj` / `TJ` / `'` / `"`，
 * 按 `Tf` 记录当前字体决定解码方式：
 *
 *   - Type0（CID 字体，如 STSong-Light / UniGB-UCS2-H）：十六进制串按 UTF-16BE；
 *   - 其它（WinAnsi / 单字节）：按单字节读。
 *
 * 限制（写清楚，别让人以为这是排版还原）：
 *   - 解析 ToUnicode 的 bfchar/bfrange；不解析外部 usecmap 或 Form XObject 内的文字；
 *   - 不还原分栏 / 表格几何，只按文本矩阵换行；
 *   - 加密文件由上层 openPdfBytes 解密后再传入。
 */
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib"
import { contentStreams, decodeLiteral } from "./text-edit"
import { decodeToUnicode, parseToUnicode } from "./to-unicode"

type Operand =
  | { kind: "string"; raw: string; hex: boolean }
  | { kind: "name"; value: string }
  | { kind: "number"; value: number }
  | { kind: "array"; items: Operand[] }
  | { kind: "operator"; value: string }

type Step = { operator: string; operands: Operand[] }

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f" || char === " "
}

function isDelimiter(char: string): boolean {
  return "()<>[]{}/%".includes(char)
}

/** 内容流扫描：字符串 / 数组 / 名字 / 数字原样留住，其它当操作符。 */
function parse(content: string): Step[] {
  const steps: Step[] = []
  let operands: Operand[] = []
  let index = 0

  const literal = (): Operand => {
    const start = index
    index += 1
    let depth = 1
    while (index < content.length && depth > 0) {
      const char = content[index]!
      if (char === "\\") {
        index += 2
        continue
      }
      if (char === "(") depth += 1
      else if (char === ")") depth -= 1
      index += 1
    }
    return { kind: "string", raw: content.slice(start, index), hex: false }
  }

  const hexString = (): Operand => {
    const close = content.indexOf(">", index + 1)
    const end = close === -1 ? content.length : close + 1
    const raw = content.slice(index, end)
    index = end
    return { kind: "string", raw, hex: true }
  }

  const array = (): Operand => {
    const items: Operand[] = []
    index += 1
    while (index < content.length) {
      const char = content[index]!
      if (char === "]") {
        index += 1
        break
      }
      const item = operand()
      if (!item) {
        if (index < content.length && isWhitespace(content[index]!)) index += 1
        else break
        continue
      }
      if (item.kind !== "operator") items.push(item)
    }
    return { kind: "array", items }
  }

  const operand = (): Operand | undefined => {
    const char = content[index]
    if (char === undefined) return undefined
    if (isWhitespace(char)) {
      index += 1
      return undefined
    }
    if (char === "%") {
      while (index < content.length && content[index] !== "\n" && content[index] !== "\r") index += 1
      return undefined
    }
    if (char === "/") {
      const start = index
      index += 1
      while (index < content.length && !isWhitespace(content[index]!) && !isDelimiter(content[index]!)) index += 1
      return { kind: "name", value: content.slice(start + 1, index) }
    }
    if (char === "(") return literal()
    if (char === "[") return array()
    if (char === "]") {
      index += 1
      return undefined
    }
    if (char === "<") {
      if (content[index + 1] === "<") {
        // 内容流里的字典只出现在标记内容中，整段跳过。
        let depth = 0
        while (index < content.length) {
          if (content[index] === "<" && content[index + 1] === "<") {
            depth += 1
            index += 2
            continue
          }
          if (content[index] === ">" && content[index + 1] === ">") {
            depth -= 1
            index += 2
            if (depth <= 0) break
            continue
          }
          index += 1
        }
        return undefined
      }
      return hexString()
    }
    const start = index
    while (index < content.length && !isWhitespace(content[index]!) && !isDelimiter(content[index]!)) index += 1
    const text = content.slice(start, index)
    if (text === "") {
      index += 1
      return undefined
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return { kind: "number", value: Number(text) }
    return { kind: "operator", value: text }
  }

  while (index < content.length) {
    const item = operand()
    if (!item) continue
    if (item.kind !== "operator") {
      operands.push(item)
      continue
    }
    if (item.value === "BI") {
      // 内联图片：ID 之后是二进制，直接跳到 EI。
      const tail = content.slice(index)
      const end = /\sEI(\s|$)/.exec(tail)
      index = end ? index + end.index + end[0].length : content.length
      operands = []
      continue
    }
    steps.push({ operator: item.value, operands })
    operands = []
  }
  return steps
}

type FontEncoding = { kind: "type0" | "simple"; mapping?: Map<string, string>; winAnsi?: boolean }

/** Font dictionaries may provide a ToUnicode CMap for subset glyph IDs. */
function fontKinds(doc: PDFDocument, pageIndex: number): Map<string, FontEncoding> {
  const kinds = new Map<string, FontEncoding>()
  const resources = doc.getPage(pageIndex).node.Resources()
  if (!resources) return kinds
  const fonts = resources.lookupMaybe(PDFName.of("Font"), PDFDict)
  if (!fonts) return kinds
  for (const [key, value] of fonts.entries()) {
    const font = value instanceof PDFDict ? value : doc.context.lookup(value)
    if (!(font instanceof PDFDict)) continue
    const subtype = font.get(PDFName.of("Subtype"))
    const encoding: FontEncoding = {
      kind: subtype?.toString() === "/Type0" ? "type0" : "simple",
      winAnsi: font.get(PDFName.of("Encoding"))?.toString() === "/WinAnsiEncoding",
    }
    try {
      const cmap = doc.context.lookup(font.get(PDFName.of("ToUnicode")))
      if (cmap instanceof PDFRawStream) {
        const mapping = parseToUnicode(new TextDecoder().decode(decodePDFRawStream(cmap).decode()))
        if (mapping.size) encoding.mapping = mapping
      }
    } catch {
      // An invalid optional CMap must not prevent reading other page text.
    }
    kinds.set(key.asString().replace(/^\//, ""), encoding)
  }
  return kinds
}

function decodeString(operand: Operand, encoding: FontEncoding): string {
  if (operand.kind !== "string") return ""
  const literal = operand.hex ? undefined : decodeLiteral(operand.raw.slice(1, -1))
  const clean = operand.hex ? operand.raw.replace(/[^0-9a-fA-F]/g, "") : ""
  const even = clean.length % 2 === 0 ? clean : clean + "0"
  const bytes =
    literal === undefined
      ? Uint8Array.from({ length: even.length / 2 }, (_, index) =>
          Number.parseInt(even.slice(index * 2, index * 2 + 2), 16),
        )
      : Uint8Array.from(literal, (char) => char.charCodeAt(0))
  if (encoding.mapping) return decodeToUnicode(bytes, encoding.mapping)
  if (encoding.winAnsi) return new TextDecoder("windows-1252").decode(bytes)
  let out = ""
  if (encoding.kind === "type0") {
    for (let index = 0; index + 1 < bytes.length; index += 2) {
      out += String.fromCharCode((bytes[index]! << 8) | bytes[index + 1]!)
    }
    return out
  }
  for (const byte of bytes) out += String.fromCharCode(byte)
  return out
}

/**
 * 抽一页的文字。换行按 PDF 的文本定位操作符（`Td` / `TD` / `T*` / `Tm` / `'` / `"`）判断，
 * 同一行里连续的 run 直接拼接（CJK 不会凭空多空格），负向位移大的 `TJ` 补一个空格。
 */
export function pageText(doc: PDFDocument, pageIndex: number): string {
  const entries = contentStreams(doc, doc.getPage(pageIndex).node.Contents())
  const kinds = fontKinds(doc, pageIndex)
  const lines: string[] = []
  let line = ""
  let font: FontEncoding = { kind: "simple" }

  const breakLine = () => {
    const text = line.replace(/[ \t]+$/g, "")
    if (text.trim() !== "") lines.push(text)
    line = ""
  }

  for (const entry of entries) {
    let bytes: Uint8Array
    try {
      bytes = decodePDFRawStream(entry.stream).decode()
    } catch {
      continue
    }
    // Content stream strings contain glyph bytes, not Windows-1252 text. Preserve
    // every byte until the active font's CMap/encoding decodes the string operand.
    const content = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")
    for (const step of parse(content)) {
      switch (step.operator) {
        case "Tf": {
          const name = step.operands.find((item) => item.kind === "name")
          if (name && name.kind === "name") font = kinds.get(name.value) ?? { kind: "simple" }
          break
        }
        case "Tj": {
          for (const item of step.operands) if (item.kind === "string") line += decodeString(item, font)
          break
        }
        case "TJ": {
          const array = step.operands.find((item) => item.kind === "array")
          if (array && array.kind === "array") {
            for (const item of array.items) {
              if (item.kind === "string") line += decodeString(item, font)
              else if (item.kind === "number" && item.value <= -250) line += " "
            }
          }
          break
        }
        case "'":
        case '"':
          breakLine()
          for (const item of step.operands) if (item.kind === "string") line += decodeString(item, font)
          break
        case "Td":
        case "TD":
        case "T*":
        case "Tm":
        case "BT":
        case "ET":
          breakLine()
          break
        default:
          break
      }
    }
  }
  breakLine()
  return lines.join("\n")
}

/** 读出若干页（1 起）；pages 省略表示整份。 */
export function pageTexts(doc: PDFDocument, pages?: readonly number[]): Array<{ page: number; text: string }> {
  const total = doc.getPageCount()
  const wanted = pages?.length ? pages : Array.from({ length: total }, (_item, index) => index + 1)
  return wanted
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= total)
    .map((page) => ({ page, text: pageText(doc, page - 1) }))
}
