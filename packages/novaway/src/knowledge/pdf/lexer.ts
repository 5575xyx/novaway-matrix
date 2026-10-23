/**
 * PDF 内容流的两个底层读取器。
 *
 * 单独成文件是因为「按坐标重排版面」的模块也要用它们，
 * 而版面模块不应该反向依赖 extract.ts（那里有 ocr/jszip 等重依赖）。
 */

/** PDF 字符串转义：括号、反斜杠、换行。用字符码判断，避免正则转义层。 */
const SLASH = 92
export function unescapePdf(value: string) {
  let out = ""
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch.charCodeAt(0) !== SLASH) {
      out += ch
      continue
    }
    const next = value[++i] ?? ""
    if (next === "n") out += String.fromCharCode(10)
    else if (next === "r") out += String.fromCharCode(13)
    else if (next === "b" || next === "f") continue
    else if (next >= "0" && next <= "7") {
      let code = next
      for (let k = 0; k < 2; k++) {
        const digit = value[i + 1]
        if (!digit || digit < "0" || digit > "7") break
        code += digit
        i++
      }
      out += String.fromCharCode(parseInt(code, 8))
    } else out += next
  }
  return out
}

/** 取一个以 ( 开始的字面量字符串；返回内容与结束位置。支持嵌套括号。 */
export function readPdfString(source: string, start: number) {
  let depth = 0
  let text = ""
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (ch.charCodeAt(0) === SLASH) {
      text += ch + (source[i + 1] ?? "")
      i++
      continue
    }
    if (ch === "(") {
      depth++
      if (depth === 1) continue
    }
    if (ch === ")") {
      depth--
      if (depth === 0) return { text: unescapePdf(text), end: i }
    }
    text += ch
  }
  return { text: unescapePdf(text), end: source.length }
}
