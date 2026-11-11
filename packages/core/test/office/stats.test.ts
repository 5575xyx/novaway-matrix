import { describe, expect, test } from "bun:test"
import { caretPosition, textStats } from "../../src/office/text/stats"

const LF = String.fromCharCode(10)

describe("文本统计", () => {
  test("行数、字符数、词数", () => {
    const text = ["hello world", "", "second line"].join(LF)
    expect(textStats(text)).toEqual({ lines: 3, characters: text.length, words: 4, selected: 0 })
  })

  test("末尾换行不额外算一行，空文件算一行", () => {
    expect(textStats("a" + LF).lines).toBe(1)
    expect(textStats("").lines).toBe(1)
    expect(textStats("").words).toBe(0)
  })

  test("选区字符数", () => {
    expect(textStats("abcdef", { anchor: 1, head: 4 }).selected).toBe(3)
  })

  test("光标行列都从 1 起", () => {
    const text = ["abc", "de"].join(LF)
    expect(caretPosition(text, 0)).toEqual({ line: 1, column: 1 })
    expect(caretPosition(text, 2)).toEqual({ line: 1, column: 3 })
    expect(caretPosition(text, 4)).toEqual({ line: 2, column: 1 })
    // 越界偏移夹到文本范围内，不抛错。
    expect(caretPosition(text, 99)).toEqual({ line: 2, column: 3 })
  })
})
