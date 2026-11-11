/**
 * Markdown 大纲：把标题抽成「层级 + 行号」的列表。
 *
 * outline 侧栏：面板里点一条就跳到那一行，
 * 不必在长文里自己滚。实现只认标题语法本身，不建完整 AST ——
 * 大纲要的是稳定和快，认错一条标题比卡住整篇更糟。
 *
 * 行号从 1 起，和文本编辑器的行号栏、查找结果的行偏移一致。
 */

export type OutlineEntry = {
  /** 1–6，对应 #…###### */
  level: number
  text: string
  /** 1 起的行号，点击后直接定位到这一行。 */
  line: number
}

const ATX = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const FENCE = /^ {0,3}(```+|~~~+)/
/** 这些行开头的 `---` 不是标题下划线（列表项、引用、列表本身的横线）。 */
const NOT_HEADING_TEXT = /^ {0,3}(?:[-*+][ \t]|\d+[.)][ \t]|>|#{1,6}[ \t]|[-*_]{3,}[ \t]*$)/

/** 去掉行内格式，留下人眼在大纲里想看到的文字。 */
export function outlineText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/<[^>]+>/g, "")
    .trim()
}

/**
 * 抽取标题。代码围栏里的 `# 注释` 不是标题，必须跳过；
 * setext 标题（下一行是 === / ---）按 CommonMark 认。
 */
export function markdownOutline(source: string): OutlineEntry[] {
  const lines = source.split(/\r?\n/)
  const entries: OutlineEntry[] = []
  let fence: string | undefined

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!

    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]![0]!
      if (fence === undefined) fence = marker
      else if (marker === fence) fence = undefined
      continue
    }
    if (fence !== undefined) continue

    const atx = ATX.exec(line)
    if (atx) {
      entries.push({ level: atx[1]!.length, text: outlineText(atx[2]!), line: index + 1 })
      continue
    }

    // setext：当前行是正文，下一行是等号/短横线。
    const next = lines[index + 1]
    if (next === undefined || line.trim().length === 0 || NOT_HEADING_TEXT.test(line)) continue
    const setext = SETEXT.exec(next)
    if (!setext) continue
    entries.push({ level: setext[1]![0] === "=" ? 1 : 2, text: outlineText(line), line: index + 1 })
    index += 1
  }

  return entries
}
