/**
 * XLSX 公式求值（只读展示）。
 *
 * 引擎写公式时刻意不落缓存值（让 Excel 自己算），于是面板、`office get` 和
 * AI 读到的公式单元格只有 "=SUM(A1:A3)" 这一串文字。这里补一层保守的求值：
 *
 *   - 只支持常见函数与四则 / 比较 / 字符串连接，认不出来的公式原样保留；
 *   - 求值失败（循环引用、未知函数）不写任何值，绝不给出错误答案；
 *   - 只在内存里补 `value` / `text`，从不改文件 —— 保存时仍然是原来的公式。
 */
import { columnToIndex, indexToColumn } from "./contract"
import type { XlsxCell, XlsxSheetGrid } from "./xlsx-sheet"

type Scalar = number | string | boolean

class FormulaFailure extends Error {}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9"
}

function isAlpha(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isWordChar(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch) || ch === "_" || ch === "." || ch === "$"
}

function cellParts(text: string): { row: number; col: number } | undefined {
  let index = 0
  if (text[index] === "$") index += 1
  let column = ""
  while (index < text.length && isAlpha(text[index]!)) column += text[index++]
  if (text[index] === "$") index += 1
  let row = ""
  while (index < text.length && isDigit(text[index]!)) row += text[index++]
  if (index !== text.length || column === "" || row === "") return undefined
  const col = columnToIndex(column)
  if (col === undefined) return undefined
  const rowNumber = Number(row) - 1
  if (!Number.isInteger(rowNumber) || rowNumber < 0) return undefined
  return { row: rowNumber, col }
}

type Token =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "word"; value: string }
  | { kind: "ref"; sheet?: string; start: string; end?: string }
  | { kind: "op"; value: string }
  | { kind: "paren"; open: boolean }
  | { kind: "comma" }

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  const readWord = () => {
    let value = ""
    while (index < source.length && isWordChar(source[index]!)) value += source[index++]
    return value
  }
  const readRef = () => {
    let value = ""
    while (index < source.length && (isWordChar(source[index]!) || source[index] === ":")) value += source[index++]
    return value
  }
  const readCell = (sheet: string | undefined) => {
    const text = readRef()
    const parts = text.split(":")
    const start = parts[0]
    if (!start) throw new FormulaFailure("工作表引用缺少单元格")
    tokens.push({
      kind: "ref",
      ...(sheet === undefined ? {} : { sheet }),
      start,
      ...(parts[1] ? { end: parts[1] } : {}),
    })
  }

  while (index < source.length) {
    const ch = source[index]!
    if (ch.charCodeAt(0) <= 32) {
      index += 1
      continue
    }
    if (ch === '"') {
      let value = ""
      index += 1
      while (index < source.length) {
        if (source[index] === '"') {
          if (source[index + 1] === '"') {
            value += '"'
            index += 2
            continue
          }
          index += 1
          break
        }
        value += source[index++]
      }
      tokens.push({ kind: "string", value })
      continue
    }
    if (isDigit(ch) || (ch === "." && isDigit(source[index + 1] ?? ""))) {
      let value = ""
      while (index < source.length && (isDigit(source[index]!) || source[index] === ".")) value += source[index++]
      if (source[index] === "E" || source[index] === "e") {
        let exponent = source[index++]!
        if (source[index] === "+" || source[index] === "-") exponent += source[index++]!
        while (index < source.length && isDigit(source[index]!)) exponent += source[index++]!
        value += exponent
      }
      tokens.push({ kind: "number", value: Number(value) })
      continue
    }
    if (ch === "'") {
      let sheet = ""
      index += 1
      while (index < source.length && source[index] !== "'") sheet += source[index++]
      if (source[index] === "'") index += 1
      if (source[index] !== "!") throw new FormulaFailure("工作表引用缺少 !")
      index += 1
      readCell(sheet)
      continue
    }
    if (isAlpha(ch) || ch === "_" || ch === "$") {
      const word = readWord()
      if (source[index] === "!") {
        index += 1
        readCell(word)
      } else if (source[index] === ":" && cellParts(word)) {
        index += 1
        const end = readRef()
        tokens.push({ kind: "ref", start: word, ...(end ? { end } : {}) })
      } else {
        tokens.push({ kind: "word", value: word })
      }
      continue
    }
    const pair = ch + (source[index + 1] ?? "")
    if (pair === "<>" || pair === "<=" || pair === ">=") {
      tokens.push({ kind: "op", value: pair })
      index += 2
      continue
    }
    if ("+-*/^&%=<>".includes(ch)) {
      tokens.push({ kind: "op", value: ch })
      index += 1
      continue
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ kind: "paren", open: ch === "(" })
      index += 1
      continue
    }
    if (ch === "," || ch === ";") {
      tokens.push({ kind: "comma" })
      index += 1
      continue
    }
    throw new FormulaFailure("无法识别的字符：" + ch)
  }
  return tokens
}

function display(value: Scalar): string {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  if (typeof value === "string") return value
  if (!Number.isFinite(value)) throw new FormulaFailure("非有限数值")
  const rounded = Math.round(value * 1e10) / 1e10
  return String(rounded)
}

function toNumber(value: Scalar): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "boolean") return value ? 1 : 0
  const trimmed = value.trim()
  if (trimmed === "") return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function toBoolean(value: Scalar): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  return value.trim().toLowerCase() === "true"
}

function scalarText(value: Scalar): string {
  return typeof value === "string" ? value : display(value)
}

function compare(left: Scalar, right: Scalar): number {
  const a = toNumber(left)
  const b = toNumber(right)
  if (a !== undefined && b !== undefined) return a - b
  const textA = scalarText(left).toLowerCase()
  const textB = scalarText(right).toLowerCase()
  return textA < textB ? -1 : textA > textB ? 1 : 0
}

function numbers(args: Scalar[]): number[] {
  const out: number[] = []
  for (const value of args) {
    const number = toNumber(value)
    if (number !== undefined) out.push(number)
  }
  return out
}

function callFunction(name: string, args: Scalar[]): Scalar {
  const upper = name.toUpperCase()
  if (upper === "SUM") return numbers(args).reduce((sum, item) => sum + item, 0)
  if (upper === "PRODUCT") return numbers(args).reduce((product, item) => product * item, 1)
  if (upper === "AVERAGE") {
    const list = numbers(args)
    if (list.length === 0) throw new FormulaFailure("AVERAGE 没有数值")
    return list.reduce((sum, item) => sum + item, 0) / list.length
  }
  if (upper === "MIN") return numbers(args).reduce((min, item) => Math.min(min, item), Number.POSITIVE_INFINITY)
  if (upper === "MAX") return numbers(args).reduce((max, item) => Math.max(max, item), Number.NEGATIVE_INFINITY)
  if (upper === "COUNT") return numbers(args).length
  if (upper === "COUNTA") return args.filter((value) => scalarText(value) !== "").length
  if (upper === "ABS") return Math.abs(numbers(args)[0] ?? 0)
  if (upper === "INT") return Math.floor(numbers(args)[0] ?? 0)
  if (upper === "SQRT") return Math.sqrt(numbers(args)[0] ?? 0)
  if (upper === "POWER") return Math.pow(numbers(args)[0] ?? 0, numbers(args)[1] ?? 0)
  if (upper === "MOD") {
    const left = numbers(args)[0] ?? 0
    const right = numbers(args)[1] ?? 0
    if (right === 0) throw new FormulaFailure("MOD 除以 0")
    return left - right * Math.floor(left / right)
  }
  if (upper === "ROUND") {
    const value = numbers(args)[0] ?? 0
    const digits = numbers(args)[1] ?? 0
    const factor = Math.pow(10, Math.trunc(digits))
    return Math.round(value * factor) / factor
  }
  if (upper === "IF") {
    if (args.length < 2) throw new FormulaFailure("IF 需要至少两个参数")
    return toBoolean(args[0]!) ? args[1]! : (args[2] ?? false)
  }
  if (upper === "AND") return args.every((value) => toBoolean(value))
  if (upper === "OR") return args.some((value) => toBoolean(value))
  if (upper === "NOT") return !toBoolean(args[0] ?? false)
  if (upper === "IFERROR") {
    if (args.length < 2) throw new FormulaFailure("IFERROR 需要两个参数")
    return args[0]!
  }
  if (upper === "LEN") return scalarText(args[0] ?? "").length
  if (upper === "LEFT") return scalarText(args[0] ?? "").slice(0, Math.max(0, Math.trunc(toNumber(args[1] ?? 1) ?? 1)))
  if (upper === "RIGHT") {
    const text = scalarText(args[0] ?? "")
    const count = Math.max(0, Math.trunc(toNumber(args[1] ?? 1) ?? 1))
    return count === 0 ? "" : text.slice(-count)
  }
  if (upper === "MID") {
    const text = scalarText(args[0] ?? "")
    const start = Math.max(1, Math.trunc(toNumber(args[1] ?? 1) ?? 1))
    const count = Math.max(0, Math.trunc(toNumber(args[2] ?? 0) ?? 0))
    return text.slice(start - 1, start - 1 + count)
  }
  if (upper === "TRIM") return scalarText(args[0] ?? "").trim()
  if (upper === "UPPER") return scalarText(args[0] ?? "").toUpperCase()
  if (upper === "LOWER") return scalarText(args[0] ?? "").toLowerCase()
  if (upper === "CONCATENATE" || upper === "CONCAT") return args.map(scalarText).join("")
  if (upper === "TRUE") return true
  if (upper === "FALSE") return false
  throw new FormulaFailure("不支持的函数：" + name)
}

type Resolver = {
  cell: (sheet: string | undefined, row: number, col: number) => Scalar | undefined
  defaultSheet: string
}

class Parser {
  private index = 0
  constructor(
    private tokens: Token[],
    private resolver: Resolver,
  ) {}

  parse(): Scalar {
    const value = this.comparison()
    if (this.index < this.tokens.length) throw new FormulaFailure("公式末尾有多余内容")
    return value
  }

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private eat(kind: Token["kind"]): Token | undefined {
    const token = this.tokens[this.index]
    if (!token || token.kind !== kind) return undefined
    this.index += 1
    return token
  }

  private isOp(value: string): boolean {
    const token = this.peek()
    return token !== undefined && token.kind === "op" && token.value === value
  }

  private comparison(): Scalar {
    let left = this.concat()
    while (true) {
      const token = this.peek()
      if (!token || token.kind !== "op") return left
      if (!["=", "<>", "<", ">", "<=", ">="].includes(token.value)) return left
      this.index += 1
      const right = this.concat()
      const order = compare(left, right)
      if (token.value === "=") left = order === 0
      else if (token.value === "<>") left = order !== 0
      else if (token.value === "<") left = order < 0
      else if (token.value === ">") left = order > 0
      else if (token.value === "<=") left = order <= 0
      else left = order >= 0
    }
  }

  private concat(): Scalar {
    let left = this.addition()
    while (this.isOp("&")) {
      this.index += 1
      left = scalarText(left) + scalarText(this.addition())
    }
    return left
  }

  private addition(): Scalar {
    let left = this.multiplication()
    while (this.isOp("+") || this.isOp("-")) {
      const operator = (this.tokens[this.index++] as { kind: "op"; value: string }).value
      const right = this.multiplication()
      const a = toNumber(left)
      const b = toNumber(right)
      if (a === undefined || b === undefined) throw new FormulaFailure("算术运算需要数值")
      left = operator === "+" ? a + b : a - b
    }
    return left
  }

  private multiplication(): Scalar {
    let left = this.power()
    while (this.isOp("*") || this.isOp("/")) {
      const operator = (this.tokens[this.index++] as { kind: "op"; value: string }).value
      const right = this.power()
      const a = toNumber(left)
      const b = toNumber(right)
      if (a === undefined || b === undefined) throw new FormulaFailure("算术运算需要数值")
      if (operator === "/" && b === 0) throw new FormulaFailure("除以 0")
      left = operator === "*" ? a * b : a / b
    }
    return left
  }

  private power(): Scalar {
    const base = this.unary()
    if (!this.isOp("^")) return base
    this.index += 1
    const exponent = this.power()
    const a = toNumber(base)
    const b = toNumber(exponent)
    if (a === undefined || b === undefined) throw new FormulaFailure("幂运算需要数值")
    return Math.pow(a, b)
  }

  private unary(): Scalar {
    if (this.isOp("-")) {
      this.index += 1
      const value = toNumber(this.unary())
      if (value === undefined) throw new FormulaFailure("负号需要数值")
      return -value
    }
    if (this.isOp("+")) {
      this.index += 1
      return this.unary()
    }
    if (this.isOp("%")) {
      this.index += 1
      const value = toNumber(this.unary())
      if (value === undefined) throw new FormulaFailure("百分号需要数值")
      return value / 100
    }
    return this.primary()
  }

  private primary(): Scalar {
    const token = this.peek()
    if (!token) throw new FormulaFailure("公式不完整")
    if (token.kind === "number") {
      this.index += 1
      return token.value
    }
    if (token.kind === "string") {
      this.index += 1
      return token.value
    }
    if (token.kind === "paren" && token.open) {
      this.index += 1
      const value = this.comparison()
      const close = this.eat("paren")
      if (!close || (close as { open: boolean }).open) throw new FormulaFailure("括号不匹配")
      return value
    }
    if (token.kind === "ref") {
      this.index += 1
      return this.reference(token)
    }
    if (token.kind === "word") {
      this.index += 1
      const name = token.value
      if (this.peek()?.kind === "paren") return this.call(name)
      const upper = name.toUpperCase()
      if (upper === "TRUE") return true
      if (upper === "FALSE") return false
      const cell = cellParts(name)
      if (cell) {
        const value = this.resolver.cell(undefined, cell.row, cell.col)
        return value ?? 0
      }
      throw new FormulaFailure("无法识别的名称：" + name)
    }
    throw new FormulaFailure("公式语法错误")
  }

  private reference(token: { sheet?: string; start: string; end?: string }): Scalar {
    const startCell = cellParts(token.start)
    if (!startCell) throw new FormulaFailure("无法识别的单元格：" + token.start)
    if (!token.end) {
      const value = this.resolver.cell(token.sheet, startCell.row, startCell.col)
      return value ?? 0
    }
    const endCell = cellParts(token.end)
    if (!endCell) throw new FormulaFailure("无法识别的单元格：" + token.end)
    const values = this.rangeValues(token.sheet, startCell, endCell)
    return values[0] ?? 0
  }

  private rangeValues(
    sheet: string | undefined,
    start: { row: number; col: number },
    end: { row: number; col: number },
  ): Scalar[] {
    const out: Scalar[] = []
    const top = Math.min(start.row, end.row)
    const bottom = Math.max(start.row, end.row)
    const left = Math.min(start.col, end.col)
    const right = Math.max(start.col, end.col)
    // 整列引用（=SUM(A:A)）在预览里可能覆盖上百行，设个上限免得卡住。
    if ((bottom - top + 1) * (right - left + 1) > 20000) throw new FormulaFailure("区域太大")
    for (let row = top; row <= bottom; row += 1) {
      for (let col = left; col <= right; col += 1) {
        const value = this.resolver.cell(sheet, row, col)
        if (value !== undefined) out.push(value)
      }
    }
    return out
  }

  private call(name: string): Scalar {
    this.eat("paren")
    const args: Scalar[] = []
    const push = (value: Scalar | Scalar[]) => {
      if (Array.isArray(value)) args.push(...value)
      else args.push(value)
    }
    if (this.peek() && !(this.peek()!.kind === "paren" && !(this.peek() as { open: boolean }).open)) {
      while (true) {
        push(this.argument())
        if (this.peek()?.kind === "comma") {
          this.index += 1
          continue
        }
        break
      }
    }
    const close = this.eat("paren")
    if (!close || (close as { open: boolean }).open) throw new FormulaFailure("函数括号不匹配")
    return callFunction(name, args)
  }

  private argument(): Scalar | Scalar[] {
    const token = this.peek()
    if (token && token.kind === "ref" && token.end) {
      this.index += 1
      const startCell = cellParts(token.start)
      const endCell = cellParts(token.end)
      if (!startCell || !endCell) throw new FormulaFailure("无法识别的区域")
      return this.rangeValues(token.sheet, startCell, endCell)
    }
    return this.comparison()
  }
}

function evaluateFormula(formula: string, resolver: Resolver): Scalar {
  const source = formula.startsWith("=") ? formula.slice(1) : formula
  const parser = new Parser(tokenize(source), resolver)
  return parser.parse()
}

/** 给工作簿里所有能算的公式单元格补上 value / text（只在内存里）。 */
export function evaluateFormulas(sheets: XlsxSheetGrid[]): void {
  const byName = new Map<string, XlsxSheetGrid>()
  for (const sheet of sheets) byName.set(sheet.name.toLowerCase(), sheet)
  const index = new Map<string, XlsxCell>()
  for (const sheet of sheets) {
    for (const cell of sheet.cells) index.set(sheet.name.toLowerCase() + "!" + cell.ref, cell)
  }

  const memo = new Map<string, Scalar | undefined>()
  const visiting = new Set<string>()

  const lookup = (sheetName: string | undefined, row: number, col: number): Scalar | undefined => {
    const name = (sheetName ?? sheets[0]?.name ?? "").toLowerCase()
    const grid = byName.get(name)
    if (!grid) throw new FormulaFailure("找不到工作表：" + sheetName)
    const key = name + "!" + indexToColumn(col) + String(row + 1)
    if (memo.has(key)) return memo.get(key)
    const cell = index.get(key)
    if (!cell) return undefined
    if (cell.value !== undefined) return cell.value as Scalar
    if (!cell.formula) return undefined
    if (visiting.has(key)) throw new FormulaFailure("循环引用")
    visiting.add(key)
    try {
      const resolver: Resolver = {
        defaultSheet: grid.name,
        cell: (targetSheet, targetRow, targetCol) => lookup(targetSheet ?? grid.name, targetRow, targetCol),
      }
      const computed = evaluateFormula(cell.formula, resolver)
      memo.set(key, computed)
      cell.value = computed
      cell.text = display(computed)
      cell.type = typeof computed === "boolean" ? "b" : typeof computed === "number" ? "n" : "str"
      return computed
    } finally {
      visiting.delete(key)
    }
  }

  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (!cell.formula || cell.value !== undefined) continue
      try {
        lookup(sheet.name, cell.row, cell.col)
      } catch {
        // 循环引用 / 未知函数：保持公式原文，不展示猜测出来的数字。
      }
    }
  }
}
