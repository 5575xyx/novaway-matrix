/**
 * Markdown 的插入工具：脚注、Callout、公式块、图片、属性块。
 *
 * `insert_footnote` / `insert_callout` / `insert_math_block` / `insert_image` / `properties`：
 * 都是「纯函数 + 选区 → TextEdit」，UI 只负责把结果塞回草稿。
 * 不解释 `$1` 之类的替换语义，用户输入什么就得到什么。
 */

import { type Selection, type TextEdit, caret, range } from "./commands"

function lineStart(text: string, at: number): number {
  const index = text.lastIndexOf("\n", Math.max(0, at - 1))
  return index === -1 ? 0 : index + 1
}

function lineEnd(text: string, at: number): number {
  const index = text.indexOf("\n", at)
  return index === -1 ? text.length : index
}

/** 选区覆盖的整行范围（含行尾换行之前的最后一个字符）。 */
function linesRange(text: string, selection: Selection): { start: number; end: number } {
  const { start, end } = range(selection)
  return {
    start: lineStart(text, start),
    end: end > start && text[end - 1] === "\n" ? end - 1 : lineEnd(text, end),
  }
}

/**
 * 脚注：在光标处插 `[^n]`，定义追加在文末，光标落在定义后面可以直接写内容。
 * 编号从 1 开始找第一个没被用过的。
 */
export function insertFootnote(text: string, selection: Selection): TextEdit {
  let n = 1
  while (text.includes("[^" + n + "]")) n++
  const { start, end } = range(selection)
  const reference = "[^" + n + "]"
  const body = text.slice(0, start) + reference + text.slice(end)
  const lastLine = body.slice(lineStart(body, body.length))
  const tail = lastLine.startsWith("[^") ? "\n" : body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n"
  const definition = tail + "[^" + n + "]: "
  return {
    start: 0,
    end: text.length,
    text: body + definition,
    selection: caret(body.length + definition.length),
  }
}

/**
 * Callout：`> [!kind] title`。
 * 有选区就把选中的行整体引用，没有选区就插入一个空 Callout（光标在正文行）。
 */
export function insertCallout(text: string, selection: Selection, kind = "note", title = ""): TextEdit {
  const head = ("> [!" + kind + "] " + title).trimEnd()
  const { start, end } = range(selection)
  if (start === end) {
    const lead = lineStart(text, start) === start ? "" : "\n"
    const block = lead + head + "\n> "
    const trail = text.slice(start).startsWith("\n") || start === text.length ? "" : "\n"
    return {
      start,
      end: start,
      text: block + trail,
      selection: caret(start + block.length),
    }
  }
  const lines = linesRange(text, selection)
  const quoted = text
    .slice(lines.start, lines.end)
    .split("\n")
    .map((line) => (line.length === 0 ? ">" : "> " + line))
  const block = head + "\n" + quoted.join("\n")
  return {
    start: lines.start,
    end: lines.end,
    text: block,
    selection: caret(lines.start + block.length),
  }
}

/** 公式块：把选区（或空内容）包进一对 `$$`，光标在公式里面。 */
export function insertMathBlock(text: string, selection: Selection): TextEdit {
  const { start, end } = range(selection)
  const inner = text.slice(start, end)
  const lead = lineStart(text, start) === start ? "" : "\n"
  const block = lead + "$$\n" + inner + "\n$$\n"
  const caretAt = start + lead.length + 3 + inner.length
  return { start, end, text: block, selection: caret(caretAt) }
}

/** 图片：`![](目标)`；有选区就用选中文字当目标，否则用占位符并选中它方便直接替换。 */
export function insertMarkdownImage(text: string, selection: Selection, placeholder = "path/to/image.png"): TextEdit {
  const { start, end } = range(selection)
  const selected = text.slice(start, end)
  const target = selected.length > 0 ? selected : placeholder
  const image = "![](" + target + ")"
  const targetStart = start + 4
  return { start, end, text: image, selection: { anchor: targetStart, head: targetStart + target.length } }
}

const FRONT_MATTER = "---"

/**
 * 属性块（front matter）：文件顶部没有就插入一份带 title / tags / date 的，
 * 有的话把光标放到已有属性块里（和 Obsidian 的 Properties 命令一致）。
 */
export function insertProperties(
  text: string,
  selection: Selection,
  options: { title?: string; date?: string } = {},
): TextEdit {
  const open = text.startsWith(FRONT_MATTER + "\n") ? 4 : text.startsWith(FRONT_MATTER + "\r\n") ? 5 : undefined
  if (open !== undefined) {
    const rest = text.slice(open)
    const close = rest.indexOf("\n" + FRONT_MATTER)
    const at = close === -1 ? open : open + close
    return { start: at, end: at, text: "", selection: caret(at) }
  }
  const block =
    FRONT_MATTER +
    "\n" +
    "title: " +
    (options.title ?? "") +
    "\ntags: \n" +
    "date: " +
    (options.date ?? "") +
    "\n" +
    FRONT_MATTER +
    "\n"
  const tagsAt = block.indexOf("tags: ") + "tags: ".length
  return { start: 0, end: 0, text: block, selection: caret(tagsAt) }
}

/** 光标所在的单词范围（字母/数字/下划线）；UI 的大小写转换在没有选区时用它。 */
export function wordAt(text: string, offset: number): Selection {
  const isWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_]/u.test(char)
  let start = Math.min(offset, text.length)
  let end = start
  while (start > 0 && isWord(text[start - 1])) start--
  while (end < text.length && isWord(text[end])) end++
  return { anchor: start, head: end }
}

/** 代码块：把选中内容包进 ``` 里，没有选区就插一个空块。 */
export function insertCodeBlock(text: string, selection: Selection, language = ""): TextEdit {
  const { start, end } = range(selection)
  const inner = text.slice(start, end)
  const lead = lineStart(text, start) === start ? "" : "\n"
  const block = lead + "```" + language + "\n" + inner + "\n```\n"
  // 空块时把光标放进围栏中间，用户直接敲代码。
  const caretAt = start + lead.length + 3 + language.length + 1 + inner.length
  return { start, end, text: block, selection: caret(caretAt) }
}

/** Markdown 表格骨架：第一行表头 + 一行分隔线，光标落在第一个表头里。 */
export function insertTable(text: string, selection: Selection, rows = 2, cols = 3): TextEdit {
  const columns = Math.max(1, Math.min(12, Math.floor(cols)))
  const body = Math.max(1, Math.min(50, Math.floor(rows)))
  const lead = lineStart(text, range(selection).start) === range(selection).start ? "" : "\n"
  const head = "| " + Array.from({ length: columns }, (_, index) => "列" + (index + 1)).join(" | ") + " |"
  const rule = "| " + Array.from({ length: columns }, () => "---").join(" | ") + " |"
  const rowsText = Array.from(
    { length: body },
    () => "| " + Array.from({ length: columns }, () => "").join(" | ") + " |",
  )
  const block = lead + [head, rule, ...rowsText].join("\n") + "\n"
  const start = range(selection).start
  return {
    start,
    end: range(selection).end,
    text: block,
    // 光标放到「列1」第一个字之前，直接输入就能改表头。
    selection: caret(start + lead.length + 2),
  }
}

/** 分隔线单独成行；光标不留在这一行，免得继续打字把 `---` 变成标题。 */
export function insertRule(text: string, selection: Selection): TextEdit {
  const { start, end } = range(selection)
  const lead = lineStart(text, start) === start ? "" : "\n"
  const block = lead + "---\n"
  return { start, end, text: block, selection: caret(start + block.length) }
}

/** 行内公式 `$…$`；有选区就用选中内容，否则放占位符并选中它。 */
export function insertInlineMath(text: string, selection: Selection, placeholder = "x"): TextEdit {
  const { start, end } = range(selection)
  const selected = text.slice(start, end)
  const inner = selected.length > 0 ? selected : placeholder
  const math = "$" + inner + "$"
  const innerStart = start + 1
  return { start, end, text: math, selection: { anchor: innerStart, head: innerStart + inner.length } }
}

export type DateStyle = "date" | "time" | "datetime"

/** 插入日期 / 时间；用本地时区，和系统日历显示一致。 */
export function dateText(when: Date, style: DateStyle = "date"): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  const date = when.getFullYear() + "-" + pad(when.getMonth() + 1) + "-" + pad(when.getDate())
  const time = pad(when.getHours()) + ":" + pad(when.getMinutes())
  if (style === "time") return time
  if (style === "datetime") return date + " " + time
  return date
}

/**
 * 链接：有选区就把选中文字当标签、把 URL 占位符选中方便直接粘贴；
 * 没有选区就插 `[链接文字](https://)` 并选中标签。
 */
export function insertLink(text: string, selection: Selection, placeholder = "https://"): TextEdit {
  const { start, end } = range(selection)
  const selected = text.slice(start, end)
  const label = selected.length > 0 ? selected : "链接文字"
  const link = "[" + label + "](" + placeholder + ")"
  const labelStart = start + 1
  const urlStart = start + label.length + 3
  return {
    start,
    end,
    text: link,
    selection:
      selected.length > 0
        ? { anchor: urlStart, head: urlStart + placeholder.length }
        : { anchor: labelStart, head: labelStart + label.length },
  }
}

// ---------------------------------------------------------------------------
// 块级转换：标题、列表、引用
//
// 和上面的「插入」不同，这些命令改写**选中的整行**（没有选区就是光标所在行），
// 再按一次就取消 —— 和常见 Markdown 编辑器的手感一致。
// 代码围栏里的行一律不动：往代码块里塞 `- ` 只会毁掉内容。
// ---------------------------------------------------------------------------

const HEADING_PREFIX = /^(#{1,6})[ \t]+/
const LIST_MARKER = /^([-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/
const QUOTE_PREFIX = /^>[ \t]?/
const INDENT = /^[ \t]*/

export type ListKind = "bullet" | "ordered" | "task"
export type HeadingLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6

function lineStartOf(text: string, at: number): number {
  const index = text.lastIndexOf("\n", Math.max(0, at - 1))
  return index === -1 ? 0 : index + 1
}

/** 每一行是否在代码围栏里（围栏行本身也算，不能改）。 */
function fencedLines(text: string): boolean[] {
  const result: boolean[] = []
  let fence: string | undefined
  for (const line of text.split("\n")) {
    const match = /^ {0,3}(```+|~~~+)/.exec(line)
    if (match) {
      const marker = match[1]![0]!
      if (fence === undefined) {
        fence = marker
        result.push(true)
        continue
      }
      if (marker === fence) {
        fence = undefined
        result.push(true)
        continue
      }
    }
    result.push(fence !== undefined)
  }
  return result
}

/**
 * 对选区覆盖的行逐行施加变换。
 *
 * `decide` 先看一遍可编辑行（围栏和空行已排除）决定「这一组行要不要改」，
 * 再给出行级变换；返回 undefined 表示没有任何变化。
 * 光标在单行上时保持在原字符位置附近，整段选中时选中变换后的整段。
 */
function transformBlock(
  text: string,
  selection: Selection,
  decide: (lines: string[]) => { apply: (line: string, index: number) => string } | undefined,
): TextEdit | undefined {
  const { start, end } = range(selection)
  const blockStart = lineStartOf(text, start)
  const blockEnd = end > start && text[end - 1] === "\n" ? end - 1 : lineEnd(text, end)
  const block = text.slice(blockStart, blockEnd)
  const lines = block.split("\n")
  const firstLine = text.slice(0, blockStart).split("\n").length - 1
  const mask = fencedLines(text)

  // 空行不参与判断，也不加前缀：`- ` 挂在一行空处没有意义。
  const editable = lines
    .map((line, index) => ({ line, index }))
    .filter((item) => !mask[firstLine + item.index] && item.line.trim().length > 0)
  if (editable.length === 0) return undefined

  const plan = decide(editable.map((item) => item.line))
  if (!plan) return undefined

  let editableIndex = 0
  const next = lines.map((line, index) => {
    if (mask[firstLine + index] || line.trim().length === 0) return line
    return plan.apply(line, editableIndex++)
  })
  const nextBlock = next.join("\n")
  if (nextBlock === block) return undefined

  if (start === end) {
    // 光标所在的行变了多少，光标就挪多少（被删掉的前缀让光标跟着左移）。
    const column = start - blockStart
    let offset = 0
    let cursor = blockStart
    for (let index = 0; index < lines.length; index++) {
      const oldLine = lines[index]!
      const newLine = next[index]!
      if (column <= offset + oldLine.length) {
        const inLine = Math.max(0, Math.min(oldLine.length, column - offset))
        cursor =
          blockStart +
          next.slice(0, index).reduce((sum, item) => sum + item.length + 1, 0) +
          Math.min(newLine.length, Math.max(0, inLine + newLine.length - oldLine.length))
        break
      }
      offset += oldLine.length + 1
    }
    return { start: blockStart, end: blockEnd, text: nextBlock, selection: caret(cursor) }
  }

  return {
    start: blockStart,
    end: blockEnd,
    text: nextBlock,
    selection: { anchor: blockStart, head: blockStart + nextBlock.length },
  }
}

const withoutMarker = (line: string) => {
  const indent = INDENT.exec(line)![0]
  return indent + line.slice(indent.length).replace(LIST_MARKER, "")
}

/**
 * 设置标题级别（0 = 取消标题）。
 * 选中的行已经全是这一级时再点一次就取消 —— 按钮可以当开关用。
 */
/**
 * 文档里所有任务行的起始偏移（跳过围栏代码块）。
 *
 * 阅读视图把复选框按渲染顺序编号，这里给出「第几个框对应原文哪一行」，
 * 和 `toggleTask` 共用同一套围栏判定 —— 代码块里的 `- [ ]` 不会被误认成任务。
 */
export function taskLineOffsets(text: string): number[] {
  const mask = fencedLines(text)
  const offsets: number[] = []
  let offset = 0
  for (const [index, line] of text.split("\n").entries()) {
    if (!mask[index] && TASK_BOX.test(line)) offsets.push(offset)
    offset += line.length + 1
  }
  return offsets
}

export function setHeading(text: string, selection: Selection, level: HeadingLevel): TextEdit | undefined {
  return transformBlock(text, selection, (lines) => {
    const current = lines.map((line) => HEADING_PREFIX.exec(line.slice(INDENT.exec(line)![0].length))?.[1].length ?? 0)
    const target = level > 0 && current.every((value) => value === level) ? 0 : level
    return {
      apply: (line) => {
        const indent = INDENT.exec(line)![0]
        const body = line.slice(indent.length).replace(HEADING_PREFIX, "")
        return indent + (target > 0 ? "#".repeat(target) + " " : "") + body
      },
    }
  })
}

function hasListMarker(line: string, kind: ListKind): boolean {
  const indent = INDENT.exec(line)![0]
  const body = line.slice(indent.length)
  const match = LIST_MARKER.exec(body)
  if (!match) return false
  const ordered = /\d/.test(match[1]!)
  if (kind === "task") return match[2] !== undefined
  if (kind === "ordered") return ordered && match[2] === undefined
  return !ordered && match[2] === undefined
}

/** 列表开关：无序 / 有序 / 任务列表。整组都已经是这种列表时取消。 */
export function toggleList(text: string, selection: Selection, kind: ListKind = "bullet"): TextEdit | undefined {
  return transformBlock(text, selection, (lines) => {
    const removal = lines.every((line) => hasListMarker(line, kind))
    return {
      apply: (line, index) => {
        if (removal) return withoutMarker(line)
        const indent = INDENT.exec(line)![0]
        const body = line.slice(indent.length).replace(LIST_MARKER, "")
        if (kind === "ordered") return indent + (index + 1) + ". " + body
        if (kind === "task") return indent + "- [ ] " + body
        return indent + "- " + body
      },
    }
  })
}

/** 引用开关：整组都已经在引用里时取消。 */
export function toggleQuote(text: string, selection: Selection): TextEdit | undefined {
  return transformBlock(text, selection, (lines) => {
    const removal = lines.every((line) => QUOTE_PREFIX.test(line.slice(INDENT.exec(line)![0].length)))
    return {
      apply: (line) => {
        const indent = INDENT.exec(line)![0]
        const body = line.slice(indent.length)
        return indent + (removal ? body.replace(QUOTE_PREFIX, "") : "> " + body)
      },
    }
  })
}

// ---------------------------------------------------------------------------
// 任务勾选：`- [ ]` ↔ `- [x]`
//
// Markdown 视图里复选框是可点的。我们的源码视图是
// textarea，点击画不出来，但「光标在这一行按一下」能精确对应同一件事，
// 而且这个命令能直接被 Agent 调用：改完一行状态，保存后就是文件的真实内容。
// ---------------------------------------------------------------------------

const TASK_BOX = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[([ xX])\]([ \t]?)/

/**
 * 翻转选中行的任务状态；勾上的行也照常翻转成未完成。
 *
 * 没有选区的行不是任务项时返回 undefined（不擅自加一个空任务）；
 * 多行选区里只改真正的任务项，普通段落原样保留。
 */
export function toggleTask(text: string, selection: Selection): TextEdit | undefined {
  const { start, end } = range(selection)
  const blockStart = lineStartOf(text, start)
  const blockEnd = end > start && text[end - 1] === "\n" ? end - 1 : lineEnd(text, end)
  const block = text.slice(blockStart, blockEnd)
  const lines = block.split("\n")
  const mask = fencedLines(text)
  const firstLine = text.slice(0, blockStart).split("\n").length - 1

  let changed = false
  const next = lines.map((line, index) => {
    if (mask[firstLine + index]) return line
    const match = TASK_BOX.exec(line)
    if (!match) return line
    changed = true
    const done = match[2] !== " "
    return match[1] + "[" + (done ? " " : "x") + "]" + match[3] + line.slice(match[0].length)
  })
  if (!changed) return undefined

  const nextBlock = next.join("\n")
  return {
    start: blockStart,
    end: blockEnd,
    text: nextBlock,
    selection:
      start === end
        ? caret(blockStart + (start - blockStart))
        : { anchor: blockStart, head: blockStart + nextBlock.length },
  }
}
