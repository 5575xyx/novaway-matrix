/**
 * 文本文件的编码 / BOM / 换行符保留。
 *
 * 对齐 Weave 的 text-editor：**没改动的文件保存后一个字节都不变**，
 * 改动过的文件按原来的编码、BOM 和换行符写回。纯文本编辑器如果总是写成
 * UTF-8 + LF，会让 GBK 的中文文件变成乱码、让 Windows 的 CRLF 文件每次都显示
 * 「整个文件都改了」。
 */

export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "gbk"
export type LineEnding = "\n" | "\r\n" | "\r"

export type TextFormat = {
  encoding: TextEncoding
  bom: boolean
  eol: LineEnding
}

export type DecodedText = {
  /** 内存里统一用 \n 表示换行。 */
  text: string
  format: TextFormat
}

const BOM_UTF8 = [0xef, 0xbb, 0xbf]
const BOM_UTF16LE = [0xff, 0xfe]
const BOM_UTF16BE = [0xfe, 0xff]

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((value, index) => bytes[index] === value)
}

function decodeWith(bytes: Uint8Array, label: string): string | undefined {
  try {
    return new TextDecoder(label as ConstructorParameters<typeof TextDecoder>[0], { fatal: false }).decode(bytes)
  } catch {
    return undefined
  }
}

/** 探测编码与换行符，并把换行统一成 \n。 */
export function decodeText(bytes: Uint8Array): DecodedText {
  let encoding: TextEncoding = "utf-8"
  let bom = false
  let body = bytes

  if (startsWith(bytes, BOM_UTF8)) {
    encoding = "utf-8"
    bom = true
    body = bytes.subarray(3)
  } else if (startsWith(bytes, BOM_UTF16LE)) {
    encoding = "utf-16le"
    bom = true
    body = bytes.subarray(2)
  } else if (startsWith(bytes, BOM_UTF16BE)) {
    encoding = "utf-16be"
    bom = true
    body = bytes.subarray(2)
  } else {
    // 没有 BOM：先按 UTF-8 严格解码，失败再试 GBK。
    const strict = new TextDecoder("utf-8", { fatal: true })
    try {
      strict.decode(bytes)
      encoding = "utf-8"
    } catch {
      encoding = decodeWith(bytes, "gbk") !== undefined && looksNonAscii(bytes) ? "gbk" : "utf-8"
    }
  }

  const raw = decodeWith(body, encoding === "gbk" ? "gbk" : encoding) ?? decodeWith(body, "utf-8") ?? ""
  return { text: normalizeEol(raw), format: { encoding, bom, eol: detectEol(raw) } }
}

function looksNonAscii(bytes: Uint8Array): boolean {
  for (const byte of bytes) if (byte > 0x7f) return true
  return false
}

function detectEol(text: string): LineEnding {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length
  const cr = (text.match(/\r(?!\n)/g) ?? []).length
  if (crlf >= lf && crlf >= cr && crlf > 0) return "\r\n"
  if (cr > lf && cr > 0) return "\r"
  return "\n"
}

function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

/** 按原来的编码、BOM、换行符写回。 */
export function encodeText(text: string, format: TextFormat): Uint8Array {
  const body = text.replace(/\n/g, format.eol)
  let encoded: Uint8Array
  switch (format.encoding) {
    case "utf-16le":
    case "utf-16be": {
      const little = format.encoding === "utf-16le"
      encoded = new Uint8Array(body.length * 2)
      for (let index = 0; index < body.length; index++) {
        const code = body.charCodeAt(index)
        encoded[index * 2 + (little ? 0 : 1)] = code & 0xff
        encoded[index * 2 + (little ? 1 : 0)] = code >> 8
      }
      break
    }
    case "gbk":
      encoded = encodeGbk(body)
      break
    default:
      encoded = new TextEncoder().encode(body)
  }

  if (!format.bom) return encoded
  const prefix =
    format.encoding === "utf-16le" ? BOM_UTF16LE : format.encoding === "utf-16be" ? BOM_UTF16BE : BOM_UTF8
  const out = new Uint8Array(prefix.length + encoded.length)
  out.set(prefix, 0)
  out.set(encoded, prefix.length)
  return out
}

/**
 * GBK 编码：运行时没有 TextEncoder("gbk")，所以这里走一次「反查表」。
 * 只在用户真的用 GBK 文件时才走这条路径，代价可接受。
 */
function encodeGbk(text: string): Uint8Array {
  const table = gbkTable()
  if (!table) return new TextEncoder().encode(text)

  const out: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code < 0x80) {
      out.push(code)
      continue
    }
    const mapped = table.get(char)
    if (mapped !== undefined) {
      out.push(mapped >> 8, mapped & 0xff)
      continue
    }
    // 表里没有的字：用 UTF-8 字节会破坏 GBK，退化成 '?' 更好排查。
    out.push(0x3f)
  }
  return new Uint8Array(out)
}

let cachedTable: Map<string, number> | undefined

/** 懒构建 GBK 双字节反查表（约 2.3 万个码位，只建一次）。 */
function gbkTable(): Map<string, number> | undefined {
  if (cachedTable) return cachedTable
  const decoder = (() => {
    try {
      return new TextDecoder("gbk" as ConstructorParameters<typeof TextDecoder>[0], { fatal: false })
    } catch {
      return undefined
    }
  })()
  if (!decoder) return undefined
  const table = new Map<string, number>()
  for (let high = 0x81; high <= 0xfe; high++) {
    for (let low = 0x40; low <= 0xfe; low++) {
      if (low === 0x7f) continue
      const bytes = new Uint8Array([high, low])
      const char = decoder.decode(bytes)
      if (char.length === 1 && char !== "\uFFFD") table.set(char, (high << 8) | low)
    }
  }
  cachedTable = table
  return table
}

/**
 * 二进制文件被当成文本打开时会解出一堆替换字符或 NUL。
 * 引擎在 open 时用它兜底：宁可报「不是文本文件」，也不要把乱码写回去。
 */
export function looksBinary(text: string): boolean {
  if (text.length === 0) return false
  let bad = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === 0) return true
    if (code === 0xfffd) bad += 1
  }
  return bad > 0 && bad / text.length > 0.02
}
