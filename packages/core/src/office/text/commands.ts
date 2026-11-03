
/**
 * 纯文本 / 代码编辑器的行与选区命令。
 *
 * 对齐 Weave 的 `crates/text-editor/src/edit.rs` 与 `tools.rs`：命令都是
 * 「纯函数 + 选区」，便于 UI、快捷键和 AI 共用同一条路径。
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

export function sortLines(text: string, selection: Selection, descending = false): TextEdit | undefined {
  return replaceLines(
    text,
    selection,
    (lines) => {
      const sorted = [...lines].sort((a, b) => a.localeCompare(b, "zh-CN"))
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

/** 把多行合成一行，用空格连接（忽略空行）。合并会吃掉结尾换行。 */
export function joinLines(text: string, selection: Selection): TextEdit | undefined {
  const target = selectedLines(text, selection, true)
  if (target.lines.length <= 1) return undefined
  const joined = target.lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
  const end = target.end + (text[target.end] === "\n" ? 1 : 0)
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

export function convertIndent(
  text: string,
  selection: Selection,
  toTabs: boolean,
  width: number,
): TextEdit | undefined {
  return replaceLines(
    text,
    selection,
    (lines) =>
      lines.map((line) => {
        const expanded = line.replace(/^\t+/, (tabs) => " ".repeat(tabs.length * width))
        return toTabs
          ? expanded.replace(/^ +/, (spaces) => "\t".repeat(Math.floor(spaces.length / width)))
          : expanded
      }),
    true,
  )
}

/** 简单缩进/反缩进：对选区覆盖的每一行加/减一个缩进单位。 */
export function indentLines(
  text: string,
  selection: Selection,
  unit: string,
  outdent = false,
): TextEdit | undefined {
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

/** 行注释：全部已注释则取消，否则统一注释。 */
export function toggleComment(text: string, selection: Selection, marker: string): TextEdit | undefined {
  return replaceLines(
    text,
    selection,
    (lines) => {
      const meaningful = lines.filter((line) => line.trim().length > 0)
      if (meaningful.length === 0) return lines
      const allCommented = meaningful.every((line) => line.trimStart().startsWith(marker))
      return lines.map((line) => {
        if (line.trim().length === 0) return line
        if (allCommented) {
          const at = line.indexOf(marker)
          return line.slice(0, at) + line.slice(at + marker.length).replace(/^ /, "")
        }
        const indent = /^\s*/.exec(line)?.[0] ?? ""
        return `${indent}${marker} ${line.slice(indent.length)}`
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
