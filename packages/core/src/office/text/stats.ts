/**
 * 文本统计：状态栏用的行数 / 字符数 / 词数 / 选中字符数。
 *
 * 状态栏统计：编辑长文档时，「多少行、多少字」
 * 比滚动条更能说明体量。纯函数，输入是草稿和选区，不碰文件。
 *
 * 词数按空白切分 —— 中文没有空格时整段算一个「词」，
 * 所以中文用户更应该看字符数，这也是状态栏同时给两者的原因。
 */

import { lineOfOffset, offsetOfLine, range, type Selection } from "./commands"

export type TextStats = {
  /** 行数（末尾换行不额外算一行）。 */
  lines: number
  characters: number
  words: number
  /** 有选区时的字符数；没有选区为 0。 */
  selected: number
}

export function textStats(text: string, selection?: Selection): TextStats {
  const characters = text.length
  const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length
  const lines = text.length === 0 ? 1 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
  let selected = 0
  if (selection) {
    const span = range(selection)
    selected = span.end - span.start
  }
  return { lines, characters, words, selected }
}

/** 光标位置（1 起的行、列），状态栏直接显示。 */
export function caretPosition(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(text.length, offset))
  const line = lineOfOffset(text, clamped)
  return { line, column: clamped - offsetOfLine(text, line) + 1 }
}
