import { describe, expect, test } from "bun:test"
import { addedCharCount, newLineIndexes, revealAdded } from "./typing-additions"

const previous = "a\nb\nc"
const next = "a\nB\nc\nd"

describe("newLineIndexes", () => {
  test("只把新写/改写的行算进来", () => {
    // 第二行被改写、末尾多一行：新文件里的 1 和 3 是新写的。
    expect(newLineIndexes(previous, next)).toEqual([1, 3])
  })

  test("没有变化时为空", () => {
    expect(newLineIndexes(next, next)).toEqual([])
  })

  test("纯追加", () => {
    expect(newLineIndexes("a", "a\nb")).toEqual([1])
  })

  test("纯删除不产生新增行", () => {
    expect(newLineIndexes("a\nb\nc", "a\nc")).toEqual([])
  })
})

describe("revealAdded", () => {
  const after = "a\nB\nc\nd"

  test("未改动行始终完整，新增行在预算内逐字出现", () => {
    // 预算 0：新增行还没开始，以空行占位（不删行，版面才不会跳）。
    expect(revealAdded(after, [1, 3], 0)).toBe("a\n\nc\n")
    // 预算 1：第二行的 "B" 打完，末尾的新增行还是空行。
    expect(revealAdded(after, [1, 3], 1)).toBe("a\nB\nc\n")
    // 预算 2：全部打完。
    expect(revealAdded(after, [1, 3], 2)).toBe("a\nB\nc\nd")
  })

  test("没有新增行时原样返回", () => {
    expect(revealAdded(after, [], 0)).toBe(after)
  })

  test("总预算等于新增字符数", () => {
    expect(addedCharCount(after, [1, 3])).toBe(2)
  })
})
