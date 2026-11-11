import { beforeEach, describe, expect, test } from "bun:test"
import {
  canRedoText,
  canUndoText,
  forgetTextHistory,
  redoText,
  recordTextChange,
  resetTextHistory,
  undoText,
} from "./text-history"

const snap = (text: string, anchor = 0, head = anchor) => ({ text, anchor, head })

beforeEach(() => resetTextHistory())

describe("文本撤销历史", () => {
  test("连续输入合并成一步，撤销回到这段输入之前", () => {
    const path = "/a.md"
    recordTextChange(path, snap("a", 1), snap("ab", 2), "typing", 1000)
    recordTextChange(path, snap("ab", 2), snap("abc", 3), "typing", 1100)
    recordTextChange(path, snap("abc", 3), snap("abcd", 4), "typing", 1200)
    expect(canUndoText(path)).toBe(true)
    expect(undoText(path, snap("abcd", 4))).toEqual(snap("a", 1))
    expect(canUndoText(path)).toBe(false)
  })

  test("停顿超过窗口就是新的一步", () => {
    const path = "/b.md"
    recordTextChange(path, snap("a", 1), snap("ab", 2), "typing", 1000)
    recordTextChange(path, snap("ab", 2), snap("abc", 3), "typing", 5000)
    expect(undoText(path, snap("abc", 3))).toEqual(snap("ab", 2))
    expect(undoText(path, snap("ab", 2))).toEqual(snap("a", 1))
  })

  test("撤销后可以重做，新的输入清空重做栈", () => {
    const path = "/c.md"
    recordTextChange(path, snap("a"), snap("b"), "command", 1)
    const undone = undoText(path, snap("b"))!
    expect(undone).toEqual(snap("a"))
    expect(canRedoText(path)).toBe(true)
    expect(redoText(path, snap("a"))).toEqual(snap("b"))
    expect(canRedoText(path)).toBe(false)

    undoText(path, snap("b"))
    recordTextChange(path, snap("a"), snap("c"), "command", 2)
    expect(canRedoText(path)).toBe(false)
  })

  test("不同文件的历史互不串线，忘记时单独清掉", () => {
    recordTextChange("/x.md", snap(""), snap("x"), "command", 1)
    recordTextChange("/y.md", snap(""), snap("y"), "command", 1)
    forgetTextHistory("/x.md")
    expect(canUndoText("/x.md")).toBe(false)
    expect(canUndoText("/y.md")).toBe(true)
  })

  test("没有变化的一步不记", () => {
    recordTextChange("/z.md", snap("a"), snap("a"), "typing", 1)
    expect(canUndoText("/z.md")).toBe(false)
  })
})
