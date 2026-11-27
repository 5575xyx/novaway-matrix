import { offsetOfLine } from "@novaway/core/office/text/commands"

export type InlineEditSelection = { start: number; end: number }

/** 从模型回答中取出可以直接替换选区的代码。 */
export const inlineReplacementOf = (answer: string): string => {
  const fenced = [...answer.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
  const value = fenced.at(-1)?.[1] ?? answer
  // 不使用 trim：第一行的缩进属于代码，不能被误删。
  return value.replace(/^(?:\r?\n)+/, "").replace(/(?:\r?\n)+$/, "")
}

/**
 * 将模型回答应用到选中的完整代码行。
 * 返回精确的字符范围，调用方可用同一范围写入历史和恢复选区。
 */
export const applyInlineReplacement = (
  source: string,
  selection: InlineEditSelection,
  answer: string,
): { text: string; replacement: string; start: number; end: number } | undefined => {
  const startLine = Math.max(1, Math.min(selection.start, selection.end))
  const endLine = Math.max(startLine, Math.max(selection.start, selection.end))
  const start = offsetOfLine(source, startLine)
  const endLineStart = offsetOfLine(source, endLine)
  const newlineAt = source.indexOf("\n", endLineStart)
  // 保留选区之后的换行符，避免模型是否补换行造成下一行粘连。
  const end = newlineAt === -1 ? source.length : newlineAt - (source[newlineAt - 1] === "\r" ? 1 : 0)
  const eol = source.includes("\r\n") ? "\r\n" : "\n"
  const replacement = inlineReplacementOf(answer).replace(/\r\n|\r|\n/g, eol)
  if (!replacement.trim()) return undefined
  const text = source.slice(0, start) + replacement + source.slice(end)
  if (text === source) return undefined
  return { text, replacement, start, end }
}
