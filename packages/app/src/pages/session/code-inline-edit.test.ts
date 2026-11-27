import { beforeEach, describe, expect, test } from "bun:test"
import { applyInlineReplacement, inlineReplacementOf } from "./code-inline-edit"
import {
  canRedoText,
  canUndoText,
  redoText,
  recordTextChange,
  resetTextHistory,
  undoText,
} from "./text-history"

beforeEach(() => resetTextHistory())

describe("code inline edit", () => {
  test("extracts fenced code without removing the first line indentation", () => {
    expect(inlineReplacementOf("说明\n```ts\n  return value + 1\n```\n")).toBe("  return value + 1")
  })

  test("replaces complete lines and keeps the following newline", () => {
    const source = "const a = 1\nconst b = 2\nconst c = 3"
    const edit = applyInlineReplacement(source, { start: 2, end: 2 }, "```ts\nconst b = a + 1\n```")
    expect(edit).toEqual({
      text: "const a = 1\nconst b = a + 1\nconst c = 3",
      replacement: "const b = a + 1",
      start: 12,
      end: 23,
    })
  })

  test("preserves CRLF files and supports multi-line replacement", () => {
    const source = "one\r\ntwo\r\nthree\r\n"
    const edit = applyInlineReplacement(source, { start: 1, end: 2 }, "```\nONE\nTWO\n```")
    expect(edit?.text).toBe("ONE\r\nTWO\r\nthree\r\n")
    expect(edit?.replacement).toBe("ONE\r\nTWO")
  })

  test("inline replacement is undoable and redoable through editor history", () => {
    const path = "/inline.ts"
    const before = "const value = 1"
    const edit = applyInlineReplacement(before, { start: 1, end: 1 }, "```ts\nconst value = 2\n```")!
    recordTextChange(
      path,
      { text: before, anchor: edit.start, head: edit.end },
      { text: edit.text, anchor: edit.start, head: edit.start + edit.replacement.length },
      "command",
    )

    expect(canUndoText(path)).toBe(true)
    expect(undoText(path, { text: edit.text, anchor: edit.start, head: edit.start + edit.replacement.length })).toEqual({
      text: before,
      anchor: edit.start,
      head: edit.end,
    })
    expect(canRedoText(path)).toBe(true)
    expect(redoText(path, { text: before, anchor: edit.start, head: edit.end })).toEqual({
      text: edit.text,
      anchor: edit.start,
      head: edit.start + edit.replacement.length,
    })
  })
})
