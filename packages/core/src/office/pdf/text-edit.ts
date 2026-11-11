/**
 * PDF 原地改字：在页面内容流里替换已有的文字。
 *
 * 只做「换字符串」这一件事 —— 字体、字号、坐标、颜色全部沿用原 run，
 * 所以替换后排版基本不动。文字被拆成多个 run（"Hel" + "lo"）时这里不猜：
 * 找不到就明确报错，让用户改用叠加文字 / 批注。
 *
 * 支持字面量 `(Hello)` 与十六进制 `<00480065>`；十六进制先按单字节读，
 * 再按 UTF-16BE 读（CID 中文字体）。压缩流会先解压，写回明文。
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib"

export type StreamEntry = { ref?: PDFRef; stream: PDFRawStream }

function bytesToText(bytes: Uint8Array): string {
  let out = ""
  for (const byte of bytes) out += String.fromCharCode(byte)
  return out
}

function textToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff
  return out
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "")
  const out = new Uint8Array(Math.floor(clean.length / 2))
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ""
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0").toUpperCase()
  return out
}

function utf16ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2)
  const view = new DataView(out.buffer)
  for (let index = 0; index < text.length; index += 1) view.setUint16(index * 2, text.charCodeAt(index))
  return out
}

function bytesToUtf16(bytes: Uint8Array): string {
  let out = ""
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    out += String.fromCharCode((bytes[index]! << 8) | bytes[index + 1]!)
  }
  return out
}

/** PDF 字面量字符串的转义规则（八进制、括号、反斜杠）。 */
export function decodeLiteral(raw: string): string {
  let out = ""
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!
    if (char !== "\\") {
      out += char
      continue
    }
    index += 1
    const next = raw[index]
    if (next === undefined) break
    if (next === "n") out += "\n"
    else if (next === "r") out += "\r"
    else if (next === "t") out += "\t"
    else if (next === "b") out += "\b"
    else if (next === "f") out += "\f"
    else if (next === "(" || next === ")" || next === "\\") out += next
    else if (next === "\n") continue
    else if (next === "\r") {
      if (raw[index + 1] === "\n") index += 1
    } else if (next >= "0" && next <= "7") {
      let octal = next
      for (let extra = 0; extra < 2; extra += 1) {
        const digit = raw[index + 1]
        if (digit !== undefined && digit >= "0" && digit <= "7") {
          octal += digit
          index += 1
        } else break
      }
      out += String.fromCharCode(Number.parseInt(octal, 8))
    } else out += next
  }
  return out
}

function encodeLiteral(text: string): string {
  let out = ""
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (char === "\\" || char === "(" || char === ")") out += "\\" + char
    else if (code < 32 || code > 126) out += "\\" + code.toString(8).padStart(3, "0")
    else out += char
  }
  return out
}

type Replacement = { start: number; end: number; text: string }

/** 找出内容流里所有字面量 / 十六进制字符串中的匹配片段。 */
function findReplacements(content: string, find: string, replace: string, limit: number): Replacement[] {
  const edits: Replacement[] = []
  let index = 0
  let count = 0
  while (index < content.length && count < limit) {
    const char = content[index]!
    if (char === "%") {
      while (index < content.length && content[index] !== "\n" && content[index] !== "\r") index += 1
      continue
    }
    if (char === "(") {
      let cursor = index + 1
      let depth = 1
      let raw = ""
      while (cursor < content.length && depth > 0) {
        const current = content[cursor]!
        if (current === "\\") {
          raw += current
          if (cursor + 1 < content.length) {
            raw += content[cursor + 1]
            cursor += 2
            continue
          }
          cursor += 1
          continue
        }
        if (current === "(") depth += 1
        else if (current === ")") {
          depth -= 1
          if (depth === 0) break
        }
        raw += current
        cursor += 1
      }
      const decoded = decodeLiteral(raw)
      if (decoded.includes(find)) {
        const pieces = Math.min(limit - count, decoded.split(find).length - 1)
        let next = decoded
        for (let piece = 0; piece < pieces; piece += 1) next = next.replace(find, replace)
        edits.push({ start: index + 1, end: cursor, text: encodeLiteral(next) })
        count += pieces
      }
      index = cursor + 1
      continue
    }
    if (char === "<" && content[index + 1] !== "<") {
      const close = content.indexOf(">", index + 1)
      if (close === -1) break
      const bytes = hexToBytes(content.slice(index + 1, close))
      const latin = bytesToText(bytes)
      if (latin.includes(find) && [...replace].every((item) => (item.codePointAt(0) ?? 0) <= 0xff)) {
        const pieces = Math.min(limit - count, latin.split(find).length - 1)
        let next = latin
        for (let piece = 0; piece < pieces; piece += 1) next = next.replace(find, replace)
        edits.push({ start: index + 1, end: close, text: bytesToHex(textToBytes(next)) })
        count += pieces
      } else {
        const wide = bytesToUtf16(bytes)
        if (wide.includes(find)) {
          const pieces = Math.min(limit - count, wide.split(find).length - 1)
          let next = wide
          for (let piece = 0; piece < pieces; piece += 1) next = next.replace(find, replace)
          edits.push({ start: index + 1, end: close, text: bytesToHex(utf16ToBytes(next)) })
          count += pieces
        }
      }
      index = close + 1
      continue
    }
    if (char === "<" && content[index + 1] === "<") {
      const close = content.indexOf(">>", index + 2)
      index = close === -1 ? content.length : close + 2
      continue
    }
    index += 1
  }
  return edits
}

export function contentStreams(doc: PDFDocument, contents: unknown): StreamEntry[] {
  const list: StreamEntry[] = []
  const push = (value: unknown) => {
    if (value instanceof PDFRawStream) list.push({ stream: value })
  }
  if (contents instanceof PDFArray) {
    for (let index = 0; index < contents.size(); index += 1) {
      const item = contents.get(index)
      if (item instanceof PDFRef) {
        const looked = doc.context.lookup(item)
        if (looked instanceof PDFRawStream) list.push({ ref: item, stream: looked })
      } else push(item)
    }
  } else if (contents instanceof PDFRef) {
    const looked = doc.context.lookup(contents)
    if (looked instanceof PDFRawStream) list.push({ ref: contents, stream: looked })
  } else push(contents)
  return list
}

export function rewriteStream(doc: PDFDocument, entry: StreamEntry, bytes: Uint8Array): void {
  const dict = PDFDict.withContext(doc.context)
  for (const [key, value] of entry.stream.dict.entries()) {
    const name = key.toString()
    if (name === "/Filter" || name === "/DecodeParms" || name === "/Length") continue
    dict.set(key, value)
  }
  dict.set(PDFName.of("Length"), PDFNumber.of(bytes.length))
  const next = PDFRawStream.of(dict, bytes)
  // 直接挂在页面上的流没有 ref，改不了；这种情况极少，跳过即可。
  if (entry.ref) doc.context.assign(entry.ref, next)
}

/**
 * 在页面的内容流里替换文字。返回替换次数；0 表示没有找到（调用方据此报错）。
 */
export function replacePageText(
  doc: PDFDocument,
  pageIndex: number,
  find: string,
  replace: string,
  all = false,
): number {
  if (find === "") return 0
  const page = doc.getPage(pageIndex)
  const entries = contentStreams(doc, page.node.Contents())
  let remaining = all ? Number.MAX_SAFE_INTEGER : 1
  let replaced = 0
  for (const entry of entries) {
    if (remaining <= 0) break
    let bytes: Uint8Array
    try {
      bytes = decodePDFRawStream(entry.stream).decode()
    } catch {
      continue
    }
    const content = bytesToText(bytes)
    const edits = findReplacements(content, find, replace, remaining)
    if (edits.length === 0) continue
    let next = content
    // 从后往前替换，偏移不会失效。
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
      next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)
      replaced += 1
      remaining -= 1
    }
    rewriteStream(doc, entry, textToBytes(next))
  }
  return replaced
}
