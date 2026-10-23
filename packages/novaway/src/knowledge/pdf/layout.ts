/**
 * PDF 版面：按坐标判断是否双栏，并把行按「先左栏、再右栏」重排。
 *
 * 之前的实现只按内容流顺序拼接 BT..ET 里的行，双栏论文/公报会左右串行
 * （左栏第一行、右栏第一行、左栏第二行…），读起来完全错乱。
 *
 * 这里不做完整版面分析，只做两件保守的事：
 * 1. 从 `Tm` / `Td` / `TD` 里取每行的起始 x 坐标；
 * 2. 若行坐标明显分成两簇（并且两簇各自有足够的行），认定为双栏，
 *    先输出左栏全部行、再输出右栏；否则保持原始顺序（单栏绝不重排）。
 */
import { unescapePdf, readPdfString } from "./lexer"

export type PdfLine = {
  text: string
  /** 页内行号（按内容流出现顺序，0-based）。 */
  index: number
  /** 起始 x 坐标，取不到时为 undefined。 */
  x?: number
  /** 起始 y 坐标，取不到时为 undefined。 */
  y?: number
  /** 所属页（内容流序号）。 */
  page: number
}

export type PdfColumnLayout = "single" | "double"

/** 从一段 BT 块里取出所有文本行以及它们的位置。 */
export function pdfLines(
  block: string,
  decode: (text: string) => string,
): Array<{ text: string; x?: number; y?: number }> {
  const out: Array<{ text: string; x?: number; y?: number }> = []
  let cursor = 0
  let line = ""
  let x: number | undefined
  let y: number | undefined
  let pendingX: number | undefined
  let pendingY: number | undefined

  const flush = () => {
    if (line.trim()) out.push({ text: line, x, y })
    line = ""
    x = undefined
    y = undefined
  }

  while (cursor < block.length) {
    const ch = block[cursor]

    // Tm: a b c d e f Tm —— e/f 是新的文本矩阵平移量
    if (ch === "T" && block[cursor + 1] === "m") {
      const numbers = readNumbersBefore(block, cursor)
      if (numbers.length >= 6) {
        pendingX = numbers[4]
        pendingY = numbers[5]
      }
      cursor += 2
      continue
    }

    // Td / TD: tx ty Td —— 相对当前行的平移
    if (ch === "T" && (block[cursor + 1] === "d" || block[cursor + 1] === "D")) {
      const numbers = readNumbersBefore(block, cursor)
      if (numbers.length >= 2) {
        pendingX = (x ?? 0) + numbers[0]
        pendingY = (y ?? 0) - Math.abs(numbers[1])
      }
      cursor += 2
      continue
    }

    // T*: 换到下一行
    if (ch === "T" && block[cursor + 1] === "*") {
      flush()
      if (pendingX !== undefined) x = pendingX
      cursor += 2
      continue
    }

    if (ch === "(") {
      const read = readPdfString(block, cursor)
      if (x === undefined && pendingX !== undefined) x = pendingX
      if (y === undefined && pendingY !== undefined) y = pendingY
      line += decode(read.text)
      cursor = read.end + 1
      continue
    }

    if (ch === "<" && block[cursor + 1] !== "<") {
      const close = block.indexOf(">", cursor)
      if (close === -1) break
      const hex = block.slice(cursor + 1, close).replace(/[^0-9a-fA-F]/g, "")
      if (x === undefined && pendingX !== undefined) x = pendingX
      if (y === undefined && pendingY !== undefined) y = pendingY
      line += decode(fromHex(hex))
      cursor = close + 1
      continue
    }

    if (ch === "T" && (block[cursor + 1] === "j" || block[cursor + 1] === "J")) {
      flush()
      cursor += 2
      continue
    }

    cursor++
  }
  flush()
  return out
}

/** 取操作符前紧邻的一串数字（PDF 里是 "e f Tm" 这种前缀写法）。 */
export function readNumbersBefore(block: string, at: number): number[] {
  let start = at
  while (start > 0 && /[0-9eE+\-.\s]/.test(block[start - 1])) start--
  const slice = block.slice(start, at).trim()
  if (!slice) return []
  return slice
    .split(/\s+/)
    .map((item) => Number(item))
    .filter((value) => Number.isFinite(value))
}

/** 十六进制字符串转 latin1 字节串（保持单字节，交由 CMap 解码）。 */
export function fromHex(hex: string) {
  let out = ""
  const padded = hex.length % 2 === 0 ? hex : hex + "0"
  for (let index = 0; index < padded.length; index += 2) {
    out += String.fromCharCode(parseInt(padded.slice(index, index + 2), 16))
  }
  return out
}

/**
 * 判断一组行的 x 坐标是否构成双栏。
 *
 * 判据（保守）：
 * - 至少 8 行有坐标，否则信息不足，不重排；
 * - 用「最大间隔」把 x 排序后切成两簇；
 * - 两簇的间隔要足够大（> 页面宽度的 15%），且两簇各占至少 30% 的行；
 * - 左簇大部分在左半页、右簇大部分在右半页。
 */
export function detectColumns(lines: ReadonlyArray<{ x?: number }>): PdfColumnLayout {
  const xs = lines
    .map((line) => line.x)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b)
  if (xs.length < 8) return "single"

  let gap = 0
  let split = 0
  for (let index = 1; index < xs.length; index++) {
    const distance = xs[index] - xs[index - 1]
    if (distance > gap) {
      gap = distance
      split = index
    }
  }
  if (gap <= 0) return "single"

  const width = xs[xs.length - 1] - xs[0] || 1
  const left = split
  const right = xs.length - split
  if (gap / width < 0.15) return "single"
  if (left / xs.length < 0.3 || right / xs.length < 0.3) return "single"
  return "double"
}

/** 双栏重排：先左栏自上而下，再右栏自上而下。 */
export function orderByColumns<T extends { x?: number; y?: number; index: number }>(lines: readonly T[]): T[] {
  if (detectColumns(lines) === "single") return [...lines]

  const xs = lines
    .map((line) => line.x)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b)
  let gap = 0
  let split = 0
  for (let index = 1; index < xs.length; index++) {
    const distance = xs[index] - xs[index - 1]
    if (distance > gap) {
      gap = distance
      split = index
    }
  }
  const threshold = xs[split - 1]

  const left = lines.filter((line) => line.x === undefined || line.x <= threshold)
  const right = lines.filter((line) => line.x !== undefined && line.x > threshold)
  const byY = (a: T, b: T) => (b.y ?? 0) - (a.y ?? 0) || a.index - b.index
  return [...left.sort(byY), ...right.sort(byY)]
}
