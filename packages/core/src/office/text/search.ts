/**
 * 查找与替换。
 *
 * Find/Replace：纯函数，输入输出都是文本，
 * 由编辑器决定要不要写回文件。默认区分大小写开关与「整词」开关，
 * 正则模式用用户给的表达式（失败时抛出可读错误，不静默退化成普通文本）。
 */

export type SearchOptions = {
  caseSensitive?: boolean
  regex?: boolean
  wholeWord?: boolean
}

export type SearchMatch = { start: number; end: number; text: string }

/** 单次最多返回的匹配数：大文件里搜一个空模式不至于把界面卡死。 */
const MAX_MATCHES = 5000

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^\$(){}|[\]\\]/g, "\\$&")
}

function buildPattern(query: string, options: SearchOptions): RegExp | undefined {
  if (query.length === 0) return undefined
  let source = options.regex ? query : escapeRegExp(query)
  if (options.wholeWord) source = "(?<![\\w\\u4e00-\\u9fa5])" + source + "(?![\\w\\u4e00-\\u9fa5])"
  try {
    return new RegExp(source, options.caseSensitive ? "g" : "gi")
  } catch (error) {
    throw new Error("正则表达式无效：" + (error instanceof Error ? error.message : String(error)))
  }
}

export function searchMatches(text: string, query: string, options: SearchOptions = {}): SearchMatch[] {
  const pattern = buildPattern(query, options)
  if (!pattern) return []
  const matches: SearchMatch[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    // 零宽匹配（例如 `^`）会让 exec 原地打转，手动前进一格。
    if (match[0].length === 0) {
      pattern.lastIndex += 1
      if (pattern.lastIndex > text.length) break
      continue
    }
    matches.push({ start: match.index, end: match.index + match[0].length, text: match[0] })
    if (matches.length >= MAX_MATCHES) break
  }
  return matches
}

export function countMatches(text: string, query: string, options: SearchOptions = {}): number {
  return searchMatches(text, query, options).length
}

/** 从光标位置往后找第一个匹配（找不到就绕回开头）。 */
export function nextMatch(
  text: string,
  query: string,
  from: number,
  options: SearchOptions = {},
): SearchMatch | undefined {
  const matches = searchMatches(text, query, options)
  if (matches.length === 0) return undefined
  return matches.find((match) => match.start >= from) ?? matches[0]
}

/** 从光标位置往前找（找不到就绕到末尾）。 */
export function previousMatch(
  text: string,
  query: string,
  from: number,
  options: SearchOptions = {},
): SearchMatch | undefined {
  const matches = searchMatches(text, query, options)
  if (matches.length === 0) return undefined
  for (let index = matches.length - 1; index >= 0; index--) {
    if (matches[index]!.start < from) return matches[index]
  }
  return matches.at(-1)
}

/**
 * 替换全部。`replacement` 按字面量插入（不解释 `$1`），
 * 与「所见即所得」的编辑器语义一致：用户输入什么就得到什么。
 */
export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  options: SearchOptions = {},
): { text: string; count: number } {
  const matches = searchMatches(text, query, options)
  if (matches.length === 0) return { text, count: 0 }

  let out = ""
  let cursor = 0
  for (const match of matches) {
    out += text.slice(cursor, match.start) + replacement
    cursor = match.end
  }
  out += text.slice(cursor)
  return { text: out, count: matches.length }
}

/** 替换单个匹配；区间越界时原样返回。 */
export function replaceMatch(text: string, match: SearchMatch, replacement: string): string {
  if (match.start < 0 || match.end > text.length || match.start > match.end) return text
  return text.slice(0, match.start) + replacement + text.slice(match.end)
}
