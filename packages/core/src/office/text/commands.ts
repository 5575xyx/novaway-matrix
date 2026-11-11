/**
 * 纯文本 / 代码编辑器的行与选区命令。
 *
 * 命令都是「纯函数 + 选区」，便于 UI、快捷键和 AI 共用同一条路径。
 * 选区用字符偏移（不用字节），中文与 emoji 才不会切在半路上。
 */

export type Selection = { anchor: number; head: number }

export const caret = (at: number): Selection => ({ anchor: at, head: at })

export function range(selection: Selection): { start: number; end: number } {
  return selection.anchor <= selection.head
    ? { start: selection.anchor, end: selection.head }
    : { start: selection.head, end: selection.anchor }
}

/** 一次替换：把 [start, end) 换成 text，并把光标放到指定位置。 */
export type TextEdit = { start: number; end: number; text: string; selection: Selection }

function lineStart(text: string, at: number): number {
  const index = text.lastIndexOf("\n", Math.max(0, at - 1))
  return index === -1 ? 0 : index + 1
}

function lineEnd(text: string, at: number): number {
  const index = text.indexOf("\n", at)
  return index === -1 ? text.length : index
}

/** 选区覆盖的整行范围（用于行命令）。 */
export function selectedLines(
  text: string,
  selection: Selection,
  wholeDocumentWhenEmpty = false,
): { start: number; end: number; lines: string[] } {
  const { start, end } = range(selection)
  if (start === end && wholeDocumentWhenEmpty) {
    const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text
    return { start: 0, end: trimmed.length, lines: trimmed.split("\n") }
  }
  const from = lineStart(text, start)
  const to = end > start && text[end - 1] === "\n" ? end - 1 : lineEnd(text, end)
  const slice = text.slice(from, to)
  return { start: from, end: to, lines: slice.split("\n") }
}

function replaceLines(
  text: string,
  selection: Selection,
  transform: (lines: string[]) => string[],
  wholeDocumentWhenEmpty = false,
): TextEdit | undefined {
  const target = selectedLines(text, selection, wholeDocumentWhenEmpty)
  const next = transform(target.lines)
  const value = next.join("\n")
  if (value === target.lines.join("\n")) return undefined
  return {
    start: target.start,
    end: target.end,
    text: value,
    selection: { anchor: target.start, head: target.start + value.length },
  }
}

/**
 * 自然排序：数字按大小比（`item 2` 排在 `item 10` 前面），字母忽略大小写，
 * 完全相同时再按原文比较，保证结果稳定。
 *
 * 不用 `localeCompare`：不同区域的排序规则不一样，中文环境下 `"10" < "2"`，
 * 而排序行的用户期望的永远是「第 2 项在第 10 项前面」。
 */
function naturalCompare(left: string, right: string): number {
  const folded = (value: string) => value.toLowerCase()
  const a = folded(left)
  const b = folded(right)
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const digitA = a[i]! >= "0" && a[i]! <= "9"
    const digitB = b[j]! >= "0" && b[j]! <= "9"
    if (digitA && digitB) {
      let endA = i
      let endB = j
      while (endA < a.length && a[endA]! >= "0" && a[endA]! <= "9") endA++
      while (endB < b.length && b[endB]! >= "0" && b[endB]! <= "9") endB++
      // 去掉前导 0 再比长度，长度相同才逐位比。
      const numA = a.slice(i, endA).replace(/^0+(?=\d)/, "")
      const numB = b.slice(j, endB).replace(/^0+(?=\d)/, "")
      if (numA.length !== numB.length) return numA.length - numB.length
      if (numA !== numB) return numA < numB ? -1 : 1
      i = endA
      j = endB
      continue
    }
    if (a[i] !== b[j]) return a[i]! < b[j]! ? -1 : 1
    i++
    j++
  }
  const restA = a.length - i
  const restB = b.length - j
  if (restA !== restB) return restA - restB
  // 折叠后相同：原文不同的，用原文定序。
  return left === right ? 0 : left < right ? -1 : 1
}

export function sortLines(text: string, selection: Selection, descending = false): TextEdit | undefined {
  return replaceLines(
    text,
    selection,
    (lines) => {
      const sorted = [...lines].sort(naturalCompare)
      return descending ? sorted.reverse() : sorted
    },
    true,
  )
}

export function uniqueLines(text: string, selection: Selection): TextEdit | undefined {
  return replaceLines(text, selection, (lines) => [...new Set(lines)], true)
}

export function reverseLines(text: string, selection: Selection): TextEdit | undefined {
  return replaceLines(text, selection, (lines) => [...lines].reverse(), true)
}

/**
 * 把多行合成一行，用空格连接（忽略空行）。合并会吃掉结尾换行。
 *
 * `wholeDocumentWhenEmpty` 区分两种调用方：AI 没有光标，空选区表示「整篇」；
 * 编辑器里用户就是想让当前行和下一行接起来，传 false。
 */
export function joinLines(text: string, selection: Selection, wholeDocumentWhenEmpty = true): TextEdit | undefined {
  const target = selectedLines(text, selection, wholeDocumentWhenEmpty)
  let lines = target.lines
  let to = target.end
  if (!wholeDocumentWhenEmpty && lines.length === 1 && to < text.length) {
    const nextEnd = lineEnd(text, to + 1)
    lines = [lines[0]!, text.slice(to + 1, nextEnd)]
    to = nextEnd
  }
  if (lines.length <= 1) return undefined
  const joined = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
  // 只有合并范围一直延伸到文件末尾时才吃掉结尾换行；中间的选区必须留下
  // 分隔下一行的换行，否则会把后面的一行粘上来。
  const end = to + 1 === text.length && text[to] === "\n" ? to + 1 : to
  return { start: target.start, end, text: joined, selection: caret(target.start + joined.length) }
}

export type CaseMode = "upper" | "lower" | "title"

export function changeCase(text: string, selection: Selection, mode: CaseMode): TextEdit | undefined {
  const { start, end } = range(selection)
  if (start === end) return undefined
  const value = text.slice(start, end)
  const next =
    mode === "upper"
      ? value.toUpperCase()
      : mode === "lower"
        ? value.toLowerCase()
        : value.replace(/\b\p{L}/gu, (char) => char.toUpperCase())
  if (next === value) return undefined
  return { start, end, text: next, selection: { anchor: start, head: start + next.length } }
}

/** 去掉选区覆盖行的行尾空格。Markdown 里行尾两个空格表示硬换行，需要保留。 */
export function trimTrailing(text: string, selection: Selection, keepHardBreaks = false): TextEdit | undefined {
  return replaceLines(
    text,
    selection,
    (lines) =>
      lines.map((line) => {
        const trailing = /[ \t]+$/.exec(line)?.[0] ?? ""
        if (trailing.length === 0) return line
        const hard = keepHardBreaks && trailing === "  "
        return line.slice(0, line.length - trailing.length) + (hard ? "  " : "")
      }),
    true,
  )
}

/**
 * 缩进转换：先把行首缩进换算成列（一个 tab 前进到下一个 width 的倍数），
 * 再按目标风格重新写出来。混用 tab 与空格的行也能得到正确的列。
 */
export function convertIndent(
  text: string,
  selection: Selection,
  toTabs: boolean,
  width: number,
): TextEdit | undefined {
  const step = Math.max(1, width)
  return replaceLines(
    text,
    selection,
    (lines) =>
      lines.map((line) => {
        const indent = /^[ \t]*/.exec(line)?.[0] ?? ""
        if (indent.length === 0) return line
        let columns = 0
        for (const char of indent) {
          columns = char === "\t" ? (Math.floor(columns / step) + 1) * step : columns + 1
        }
        const next = toTabs ? "\t".repeat(Math.floor(columns / step)) + " ".repeat(columns % step) : " ".repeat(columns)
        return next + line.slice(indent.length)
      }),
    true,
  )
}

/** 简单缩进/反缩进：对选区覆盖的每一行加/减一个缩进单位。 */
export function indentLines(text: string, selection: Selection, unit: string, outdent = false): TextEdit | undefined {
  return replaceLines(
    text,
    selection,
    (lines) =>
      lines.map((line) => {
        if (!outdent) return line.length === 0 ? line : unit + line
        if (line.startsWith(unit)) return line.slice(unit.length)
        if (line.startsWith("\t")) return line.slice(1)
        const spaces = /^ +/.exec(line)?.[0].length ?? 0
        return spaces > 0 ? line.slice(Math.min(spaces, unit.length || 1)) : line
      }),
    true,
  )
}

/** 上下移动选区覆盖的行。 */
export function moveLines(text: string, selection: Selection, direction: -1 | 1): TextEdit | undefined {
  const target = selectedLines(text, selection)
  if (direction === -1) {
    if (target.start === 0) return undefined
    const previousStart = lineStart(text, target.start - 1)
    const previous = text.slice(previousStart, target.start - 1)
    const value = target.lines.join("\n") + "\n" + previous
    return {
      start: previousStart,
      end: target.end,
      text: value,
      selection: { anchor: previousStart, head: previousStart + value.length },
    }
  }
  if (target.end >= text.length) return undefined
  const nextEnd = lineEnd(text, target.end + 1)
  const nextLine = text.slice(target.end + 1, nextEnd)
  const value = nextLine + "\n" + target.lines.join("\n")
  return {
    start: target.start,
    end: nextEnd,
    text: value,
    selection: { anchor: target.start, head: target.start + value.length },
  }
}

export function duplicateLines(text: string, selection: Selection): TextEdit | undefined {
  return replaceLines(text, selection, (lines) => [...lines, ...lines])
}

export function deleteLines(text: string, selection: Selection): TextEdit {
  const target = selectedLines(text, selection)
  const trailingNewline = text[target.end] === "\n" ? 1 : 0
  return {
    start: target.start,
    end: target.end + trailingNewline,
    text: "",
    selection: caret(target.start),
  }
}

const COMMENT_PREFIX: Record<string, string> = {
  js: "//",
  mjs: "//",
  cjs: "//",
  ts: "//",
  tsx: "//",
  jsx: "//",
  rs: "//",
  go: "//",
  c: "//",
  h: "//",
  cc: "//",
  cpp: "//",
  hpp: "//",
  java: "//",
  kt: "//",
  swift: "//",
  php: "//",
  cs: "//",
  scala: "//",
  groovy: "//",
  dart: "//",
  py: "#",
  rb: "#",
  sh: "#",
  bash: "#",
  zsh: "#",
  fish: "#",
  ps1: "#",
  yaml: "#",
  yml: "#",
  toml: "#",
  ini: "#",
  conf: "#",
  sql: "--",
  lua: "--",
  hs: "--",
}

export function commentPrefix(extension: string): string | undefined {
  return COMMENT_PREFIX[extension.toLowerCase()]
}

/** 需要成对包裹的注释（HTML / Markdown / XML / CSS）。 */
const WRAPPED_COMMENTS: Record<string, { open: string; close: string }> = {
  html: { open: "<!--", close: "-->" },
  htm: { open: "<!--", close: "-->" },
  xhtml: { open: "<!--", close: "-->" },
  xml: { open: "<!--", close: "-->" },
  svg: { open: "<!--", close: "-->" },
  vue: { open: "<!--", close: "-->" },
  md: { open: "<!--", close: "-->" },
  markdown: { open: "<!--", close: "-->" },
  css: { open: "/*", close: "*/" },
  scss: { open: "/*", close: "*/" },
  less: { open: "/*", close: "*/" },
}

/**
 * 注释符号：行注释返回 `{ open }`，块注释返回 `{ open, close }`。
 * Markdown 的 `#` 是标题不是注释，所以这里不能拿 `commentPrefix` 凑合。
 */
export function commentTokens(extension: string): { open: string; close?: string } | undefined {
  const ext = extension.toLowerCase()
  const wrapped = WRAPPED_COMMENTS[ext]
  if (wrapped) return wrapped
  const prefix = COMMENT_PREFIX[ext]
  return prefix ? { open: prefix } : undefined
}

/** 行注释：全部已注释则取消，否则统一注释。支持行注释与成对块注释。 */
export function toggleComment(
  text: string,
  selection: Selection,
  marker: string | { open: string; close?: string },
): TextEdit | undefined {
  const tokens = typeof marker === "string" ? { open: marker } : marker
  const open = tokens.open
  const close = tokens.close

  return replaceLines(
    text,
    selection,
    (lines) => {
      const meaningful = lines.filter((line) => line.trim().length > 0)
      if (meaningful.length === 0) return lines
      const allCommented = meaningful.every((line) => {
        const value = line.trim()
        return value.startsWith(open) && (!close || value.endsWith(close))
      })
      return lines.map((line) => {
        if (line.trim().length === 0) return line
        const indent = /^\s*/.exec(line)?.[0] ?? ""
        const body = line.slice(indent.length)
        if (allCommented) {
          let next = body.slice(open.length).replace(/^ /, "")
          if (close) {
            const end = next.lastIndexOf(close)
            if (end !== -1) next = next.slice(0, end).replace(/ $/, "")
          }
          return indent + next
        }
        return close ? `${indent}${open} ${body} ${close}` : `${indent}${open} ${body}`
      })
    },
    true,
  )
}

/** 格式化 / 压缩 JSON。解析失败时抛出可读的错误，不吞掉。 */
export function formatJson(text: string, selection: Selection, indent?: string): TextEdit {
  const { start, end } = range(selection)
  const source = end > start ? text.slice(start, end) : text
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error(`不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  const value = indent === undefined ? JSON.stringify(parsed) : JSON.stringify(parsed, undefined, indent)
  const from = end > start ? start : 0
  const to = end > start ? end : text.length
  return { start: from, end: to, text: value, selection: caret(from + value.length) }
}

/**
 * 通用代码格式化（`Format Document`）：按扩展名分发到内置格式化器。
 *
 * 不做完整 Prettier —— 那是 CLI 侧用外部二进制干的活（packages/novaway/src/format）。
 * 这里提供不依赖外部工具的**内置**格式化：JSON/JSONC 用 formatJson，HTML/XML/SVG
 * 与 CSS/SCSS 用轻量的括号缩进重排。解析失败抛出可读错误（调用方弹 toast），不吞掉。
 */
export function formatSource(text: string, selection: Selection, extension: string): TextEdit {
  const ext = extension.replace(/^\./, "").toLowerCase()
  if (ext === "json" || ext === "jsonc") return formatJson(text, selection, "  ")
  if (ext === "html" || ext === "htm" || ext === "xml" || ext === "svg") {
    return formatMarkup(text, selection)
  }
  if (ext === "css" || ext === "scss" || ext === "less") return formatBrace(text, selection)
  // 其它类型没有内置格式化器：抛可读错误，提示用户用外部工具。
  throw new Error(`暂不支持格式化 .${ext} 文件`)
}

/**
 * HTML / XML / SVG 的轻量格式化：把标签结构重排成每行一个节点并按深度缩进，
 * 文本节点（内联内容）粘在所属标签那一行，不拆散。
 * 自闭合与 void 元素不额外缩进。解析失败抛错。
 */
interface MarkupToken {
  type: "tag" | "text"
  value: string
}

/** 把 HTML/XML/SVG 源码切成「标签 / 文本」token 流（标签含尖括号本身）。 */
function tokenizeMarkup(source: string): MarkupToken[] {
  const tokens: MarkupToken[] = []
  let buffer = ""
  let i = 0
  while (i < source.length) {
    if (source[i] === "<") {
      if (buffer) {
        tokens.push({ type: "text", value: buffer })
        buffer = ""
      }
      const end = source.indexOf(">", i)
      if (end === -1) break
      tokens.push({ type: "tag", value: source.slice(i, end + 1) })
      i = end + 1
    } else {
      buffer += source[i]
      i++
    }
  }
  if (buffer) tokens.push({ type: "text", value: buffer })
  return tokens
}

function formatMarkup(text: string, selection: Selection): TextEdit {
  const { start, end } = range(selection)
  const source = end > start ? text.slice(start, end) : text
  const tokens = tokenizeMarkup(source)
  const lines: string[] = []
  const indent = "  "
  let index = 0
  // 按标签树递归排布：开标签独占一行（缩进加深），内联「文本+闭合」合并成一行，
  // 自闭合 / void 元素独占一行，闭合标签缩进回退并输出。
  // depth 是「子内容的深度」；闭合标签属于父级（depth - 1），据此缩进。
  const walk = (depth: number): void => {
    while (index < tokens.length) {
      const token = tokens[index]
      if (token.type === "text") {
        const trimmed = token.value.trim()
        if (trimmed) lines.push(indent.repeat(depth) + trimmed)
        index++
        continue
      }
      const tag = token.value
      if (tag.startsWith("</")) {
        lines.push(indent.repeat(Math.max(0, depth - 1)) + tag)
        index++
        return
      }
      if (tag.endsWith("/>") || isVoidTag(tag)) {
        lines.push(indent.repeat(depth) + tag)
        index++
        continue
      }
      index++
      const inner = tokens[index]
      const closer = tokens[index + 1]
      // 空元素 <span></span>：合并成一行。
      if (inner?.type === "tag" && inner.value.startsWith("</")) {
        lines.push(indent.repeat(depth) + tag + inner.value)
        index++
        continue
      }
      // 内联文本 + 闭合标签：<span>hi</span> 保持在一行。
      if (inner?.type === "text" && closer?.type === "tag" && closer.value.startsWith("</")) {
        lines.push(indent.repeat(depth) + tag + inner.value.trim() + closer.value)
        index += 2
        continue
      }
      // 有子结构：开标签独占一行，内容递归（深度 +1），闭合标签由递归 return 前输出。
      lines.push(indent.repeat(depth) + tag)
      walk(depth + 1)
    }
  }
  walk(0)
  const value = lines.join("\n")
  const from = end > start ? start : 0
  const to = end > start ? end : text.length
  return { start: from, end: to, text: value, selection: caret(from + value.length) }
}

/** HTML void 元素：没有结束标签，自成一行。 */
const VOID_TAGS = new Set([
  "br",
  "hr",
  "img",
  "input",
  "meta",
  "link",
  "area",
  "base",
  "col",
  "embed",
  "source",
  "track",
  "wbr",
])
function isVoidTag(tag: string): boolean {
  const name = tag.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1]?.toLowerCase()
  return name ? VOID_TAGS.has(name) : false
}

/** CSS / SCSS 的轻量格式化：把声明块重排成每行一条规则，按花括号缩进。 */
function formatBrace(text: string, selection: Selection): TextEdit {
  const { start, end } = range(selection)
  const source = end > start ? text.slice(start, end) : text
  const out: string[] = []
  let depth = 0
  // 按 { } 切分；选择器行与 `{` 合并，声明按 `;` 拆成行，`}` 回退缩进。
  const blocks = source.split(/([{}])/)
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    if (trimmed === "{") {
      // 追加到上一行（选择器）末尾：`body {`。上一行可能是 `body;`，合并前去掉误加的 `;`。
      const prev = out[out.length - 1]
      if (prev && !prev.endsWith("{")) out[out.length - 1] = prev.replace(/;$/, "") + " {"
      else out.push(indent(depth) + "{")
      depth++
      continue
    }
    if (trimmed === "}") {
      depth = Math.max(0, depth - 1)
      out.push(indent(depth) + "}")
      continue
    }
    // 声明或选择器行：声明可能有多条（`a:1;b:2`），逐条拆开。不自动增删分号，保留原样。
    const pieces = trimmed.split(";")
    for (const piece of pieces) {
      const line = piece.trim()
      if (!line) continue
      out.push(indent(depth) + line)
    }
  }
  // 把选择器行的 `{` 正确衔接：若选择器行和 `{` 之间被拆开（`body` + `{` 分属两 token），
  // 上面的逻辑已合并。仅兜底去掉末尾多余空行。
  const value = out.join("\n").replace(/\n{3,}/g, "\n\n")
  const from = end > start ? start : 0
  const to = end > start ? end : text.length
  return { start: from, end: to, text: value, selection: caret(from + value.length) }
}

function indent(depth: number): string {
  return "  ".repeat(depth)
}

/** 应用一次编辑；越界时返回原文。 */
export function applyTextEdit(text: string, edit: TextEdit): string {
  if (edit.start < 0 || edit.end > text.length || edit.start > edit.end) return text
  return text.slice(0, edit.start) + edit.text + text.slice(edit.end)
}

export function offsetOfLine(text: string, line: number): number {
  if (line <= 1) return 0
  let offset = 0
  for (let index = 1; index < line; index++) {
    const next = text.indexOf("\n", offset)
    if (next === -1) return text.length
    offset = next + 1
  }
  return offset
}

export function lineOfOffset(text: string, offset: number): number {
  return text.slice(0, Math.max(0, offset)).split("\n").length
}
