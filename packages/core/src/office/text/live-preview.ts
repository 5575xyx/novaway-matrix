/**
 * Markdown 实时预览的「可编辑块 / 可编辑行」切分。
 *
 * Obsidian 式实况预览：整篇按块渲染，
 * 双击某一行，那一行就变回源码（`#`、`**`、`[]()` 这些标记只在正在编辑的行里露出），
 * 改完再把这一行的源码换回原文。围栏代码块和表格是天然的多行结构，
 * 单独一行拆开就没有意义，仍然整块编辑。
 *
 * 这里只做一件事：把原文切成互不重叠、首尾相接的块与行，给出**字符区间**和行号。
 * 纯函数，不建 AST、不渲染 —— 认错一行最多是编辑粒度粗一点，不会损坏文档：
 * 写回时用的是原区间切片，区间外的字节一个字都不动。
 */

export type MarkdownBlockKind = "heading" | "fence" | "rule" | "list" | "quote" | "table" | "paragraph"

export type MarkdownBlock = {
  /** 1 起的块序号，和面板上显示的一致。 */
  index: number
  /** 块首字符在原文件里的偏移。 */
  start: number
  /** 块尾字符（不含）的偏移；块末尾的换行不属于块。 */
  end: number
  /** 1 起的起止行号。 */
  firstLine: number
  lastLine: number
  /** 这一块自己的源码（可能多行，行间用原文的换行符）。 */
  source: string
  kind: MarkdownBlockKind
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const ATX = /^ {0,3}#{1,6}[ \t]/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const LIST = /^ {0,3}(?:[-*+]|\d+[.)])[ \t]/
const QUOTE = /^ {0,3}>/
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/

type Line = { text: string; start: number; end: number }

/** 拆行并记下每行的字符区间（不含行尾的 \r\n / \n）。 */
function splitLines(text: string): Line[] {
  const lines: Line[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") continue
    const end = index > start && text[index - 1] === "\r" ? index - 1 : index
    lines.push({ text: text.slice(start, end), start, end })
    start = index + 1
  }
  if (start < text.length) lines.push({ text: text.slice(start), start, end: text.length })
  return lines
}

function kindOf(lines: Line[]): MarkdownBlockKind {
  const first = lines[0]?.text ?? ""
  if (FENCE.test(first)) return "fence"
  if (ATX.test(first)) return "heading"
  if (RULE.test(first)) return "rule"
  if (QUOTE.test(first)) return "quote"
  if (LIST.test(first)) return "list"
  // 表格：表头行后面紧跟分隔行（`| --- | --- |`）。
  if (first.includes("|") && lines.length > 1 && TABLE_DELIMITER.test(lines[1]!.text)) return "table"
  return "paragraph"
}

/**
 * 切块规则（和 CommonMark 的「块」概念对齐，但故意更保守）：
 *
 * - 空行永远分块，空行本身不属于任何块；
 * - 围栏代码块整段算一块（里面的 `#`、`---` 都是内容）；
 * - ATX 标题、分隔线单独成块，即使下一行没有空行；
 * - 其余连续非空行算一块：段落、列表、引用、表格都在这里，
 *   这样点一下就编辑整段，不会把列表拆成一条一条。
 */
export function splitMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = splitLines(text)
  const blocks: MarkdownBlock[] = []
  let pending: Line[] = []
  let pendingFrom = 0

  const flush = (until: number) => {
    if (pending.length === 0) return
    const first = pending[0]!
    const last = pending[pending.length - 1]!
    blocks.push({
      index: blocks.length + 1,
      start: first.start,
      end: last.end,
      firstLine: pendingFrom + 1,
      lastLine: until,
      source: text.slice(first.start, last.end),
      kind: kindOf(pending),
    })
    pending = []
  }

  let fence: string | undefined
  for (const [index, line] of lines.entries()) {
    const match = FENCE.exec(line.text)
    if (fence) {
      pending.push(line)
      if (match && match[1]![0] === fence) {
        fence = undefined
        flush(index + 1)
      }
      continue
    }
    if (line.text.trim().length === 0) {
      flush(index)
      continue
    }
    if (match) {
      flush(index)
      fence = match[1]![0]
      pending = [line]
      pendingFrom = index
      continue
    }
    if (ATX.test(line.text) || RULE.test(line.text)) {
      flush(index)
      pending = [line]
      pendingFrom = index
      flush(index + 1)
      continue
    }
    if (pending.length === 0) pendingFrom = index
    pending.push(line)
  }
  flush(lines.length)
  return blocks
}

/**
 * 用新的块源码替换原区间，返回整篇新文本。
 * 只拼一次字符串：块外内容逐字保留，换行符由调用方的原文决定。
 */
export function replaceMarkdownBlock(text: string, block: MarkdownBlock, next: string): string {
  return replaceMarkdownRange(text, block.start, block.end, next)
}

/** 一行的字符区间（不含行尾的 \r\n / \n）。行号从 1 起，和编辑器显示的一致。 */
export type MarkdownLine = {
  number: number
  start: number
  end: number
  source: string
}

/** 拆出每一行及其区间。空文档返回空数组；末尾换行不会多出一个空行。 */
export function splitMarkdownLines(text: string): MarkdownLine[] {
  return splitLines(text).map((line, index) => ({
    number: index + 1,
    start: line.start,
    end: line.end,
    source: line.text,
  }))
}

/**
 * 用新源码替换 [start, end) 区间。行的编辑和块的编辑共用这一条写回路径，
 * 保证「只改选中的那几个字符，其余原样」。
 */
export function replaceMarkdownRange(text: string, start: number, end: number, next: string): string {
  if (start < 0 || end > text.length || start > end) return text
  return text.slice(0, start) + next + text.slice(end)
}
