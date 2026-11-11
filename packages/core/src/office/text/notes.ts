/**
 * Markdown 笔记索引：标题、标签、[[wikilink]]。
 *
 * 和 `outline` / `stats` 一样是纯函数：输入原文，输出位置信息，不读文件、不碰 DOM。
 * 右侧面板用它画「笔记」浮层；要拿去做侧栏、命令面板或 AI 的上下文，直接复用即可。
 *
 * 扫描前先剔掉围栏代码块和行内代码：那里的 `#` 与 `[[` 只是字面字符，
 * 不应该被当成标签或链接（笔记功能的语义）。
 */

export type NoteTag = { tag: string; line: number }
export type NoteLink = { target: string; alias?: string; anchor?: string; line: number }

/** 围栏代码块：``` 或 ~~~，长度 ≥3 即可，允许缩进。 */
const FENCE = /^\s*(`{3,}|~{3,})/
const INLINE_CODE = /`[^`\n]*`/g
/** 标签前缀必须是空白或常见分隔符，避免把 URL 里的 `#fragment` 当成标签。 */
const TAG = /(^|[\s([{,;:>])#([\p{L}\p{N}_/-]+)/gu
const LINK = /\[\[([^[\]\n]+)\]\]/g
const HEADING = /^#\s+(.+?)\s*#*\s*$/

/** 逐行标记「这一行在（或本身就是）围栏代码块里」。 */
function fencedMask(lines: string[]): boolean[] {
  const mask: boolean[] = []
  let fence: string | undefined
  for (const line of lines) {
    const match = FENCE.exec(line)
    if (!fence && match) {
      fence = match[1]![0]
      mask.push(true)
      continue
    }
    if (fence) {
      mask.push(true)
      if (match && match[1]![0] === fence) fence = undefined
      continue
    }
    mask.push(false)
  }
  return mask
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/)
}

/** 行内代码换成等长空格：只影响扫描，不改变行内其它字符的位置关系。 */
function stripInlineCode(line: string): string {
  return line.replace(INLINE_CODE, (match) => " ".repeat(match.length))
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator)
  return index === -1 ? [value, undefined] : [value.slice(0, index), value.slice(index + separator.length)]
}

/** 文档里出现的标签，行号从 1 开始；纯数字不算法标签。 */
export function noteTags(text: string): NoteTag[] {
  const lines = splitLines(text)
  const fenced = fencedMask(lines)
  const tags: NoteTag[] = []
  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue
    for (const match of stripInlineCode(line).matchAll(TAG)) {
      const tag = match[2]!
      if (/^\d+$/.test(tag)) continue
      tags.push({ tag, line: index + 1 })
    }
  }
  return tags
}

/** 文档里的 [[wikilink]]：支持 `[[目标|别名]]` 与 `[[目标#小节]]`。 */
export function noteLinks(text: string): NoteLink[] {
  const lines = splitLines(text)
  const fenced = fencedMask(lines)
  const links: NoteLink[] = []
  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue
    for (const match of stripInlineCode(line).matchAll(LINK)) {
      const [body, alias] = splitOnce(match[1]!, "|")
      const [target, anchor] = splitOnce(body, "#")
      const clean = target.trim()
      if (clean.length === 0) continue
      links.push({
        target: clean,
        ...(alias !== undefined && alias.trim().length > 0 ? { alias: alias.trim() } : {}),
        ...(anchor !== undefined && anchor.trim().length > 0 ? { anchor: anchor.trim() } : {}),
        line: index + 1,
      })
    }
  }
  return links
}

/** 第一个一级标题；没有就返回 undefined（调用方用文件名兜底）。 */
export function noteTitle(text: string): string | undefined {
  const lines = splitLines(text)
  const fenced = fencedMask(lines)
  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue
    const match = HEADING.exec(line)
    if (match) return match[1]!.trim()
  }
  return undefined
}

function normalizePath(input: string): string {
  const parts: string[] = []
  for (const part of input.split("/")) {
    if (part.length === 0 || part === ".") continue
    if (part === "..") {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join("/")
}

const HAS_EXTENSION = /\.[A-Za-z0-9]+$/

/**
 * 把 wikilink 的目标解析成工作区里的相对路径。
 *
 * - `[[a]]` 从当前文件所在目录算，补 `.md`；
 * - `[[../b]]` 支持上级目录；
 * - `[[/notes/a]]` 从工作区根算；
 * - `[[a.html]]` 这类自带后缀的原样保留。
 */
export function resolveNotePath(from: string, target: string): string {
  const clean = target.trim().replace(/\\/g, "/").replace(/^\.\//, "")
  const withExtension = HAS_EXTENSION.test(clean) ? clean : clean + ".md"
  if (withExtension.startsWith("/")) return normalizePath(withExtension)
  const source = from.replace(/\\/g, "/")
  const slash = source.lastIndexOf("/")
  const dir = slash === -1 ? "" : source.slice(0, slash)
  return normalizePath(dir.length > 0 ? dir + "/" + withExtension : withExtension)
}

/** 反链判断用：链接的目标是否就是这篇笔记。 */
export function noteLinkTargets(from: string, link: NoteLink): string {
  return resolveNotePath(from, link.target)
}
