import { beforeEach, describe, expect, test } from "bun:test"
import {
  clearDraft,
  draftOf,
  flushDrafts,
  forgetEditorMemory,
  persistedDraftOf,
  persistedDrafts,
  rememberDraft,
  rememberScroll,
  rememberView,
  rememberViewMode,
  rememberZoom,
  resetEditorMemory,
  scrollOf,
  setDraftScope,
  viewModeOf,
  viewOf,
  zoomOf,
} from "./editor-memory"

/** 一个够用的 localStorage 替身（bun test 里默认没有）。 */
function fakeStorage() {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    raw: data,
  }
}

const store = fakeStorage()
Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true })

beforeEach(() => {
  setDraftScope("/work/a")
  resetEditorMemory()
})

describe("编辑器记忆", () => {
  test("草稿按路径存取，取不到就是 undefined", () => {
    expect(draftOf("a.ts")).toBeUndefined()
    rememberDraft("a.ts", "半截代码")
    expect(draftOf("a.ts")).toBe("半截代码")
    expect(draftOf("b.ts")).toBeUndefined()
  })

  test("写盘成功后才清草稿；保存期间又敲的字不会被清掉", () => {
    rememberDraft("a.ts", "第一版")
    clearDraft("a.ts", "第一版")
    expect(draftOf("a.ts")).toBeUndefined()

    rememberDraft("a.ts", "第二版")
    // 保存的是旧快照：里面的草稿已经更新，不能删。
    clearDraft("a.ts", "第一版")
    expect(draftOf("a.ts")).toBe("第二版")

    clearDraft("a.ts")
    expect(draftOf("a.ts")).toBeUndefined()
  })

  test("光标 / 选区 / 滚动位置原样返回", () => {
    rememberView("a.ts", { selectionStart: 12, selectionEnd: 18, scrollTop: 240, scrollLeft: 40 })
    expect(viewOf("a.ts")).toEqual({ selectionStart: 12, selectionEnd: 18, scrollTop: 240, scrollLeft: 40 })
    expect(viewOf("b.ts")).toBeUndefined()
  })

  test("滚动位置单独记一份（富文本设计视图没有光标）", () => {
    rememberScroll("a.html", 320, 12)
    expect(scrollOf("a.html")).toEqual({ top: 320, left: 12 })
    expect(scrollOf("b.html")).toBeUndefined()
  })

  test("文件删除后三条记忆都清掉", () => {
    rememberDraft("a.ts", "x")
    rememberView("a.ts", { selectionStart: 0, selectionEnd: 0, scrollTop: 0, scrollLeft: 0 })
    rememberScroll("a.ts", 100)
    forgetEditorMemory("a.ts")
    expect(draftOf("a.ts")).toBeUndefined()
    expect(viewOf("a.ts")).toBeUndefined()
    expect(scrollOf("a.ts")).toBeUndefined()
  })

  test("容量按 LRU 收口，不会无限增长", () => {
    for (let index = 0; index < 60; index++) rememberDraft("f" + index, String(index))
    // 最老的那批被挤掉，最近的一定还在。
    expect(draftOf("f0")).toBeUndefined()
    expect(draftOf("f59")).toBe("59")
    expect(draftOf("f30")).toBe("30")
  })

  test("读一次会刷新热度，正在用的文件不会被挤掉", () => {
    for (let index = 0; index < 39; index++) rememberDraft("f" + index, String(index))
    // f0 被读一次 → 变成最新。
    expect(draftOf("f0")).toBe("0")
    for (let index = 40; index < 60; index++) rememberDraft("f" + index, String(index))
    expect(draftOf("f0")).toBe("0")
    expect(draftOf("f1")).toBeUndefined()
  })

  test("草稿会落盘，重启后还能恢复", () => {
    rememberDraft("a.ts", "没来得及保存的半截代码")
    flushDrafts()
    // 模拟重启：内存清空，落盘那份还在。
    resetEditorMemory(true)
    expect(draftOf("a.ts")).toBeUndefined()
    expect(persistedDraftOf("a.ts")).toBe("没来得及保存的半截代码")
    expect(persistedDrafts()).toContain("a.ts")
  })

  test("写盘成功后落盘草稿一起清掉", () => {
    rememberDraft("a.ts", "旧内容")
    flushDrafts()
    clearDraft("a.ts")
    resetEditorMemory(true)
    expect(persistedDraftOf("a.ts")).toBeUndefined()
    expect(persistedDrafts()).toEqual([])
  })

  test("不同工作区的同名文件不串草稿", () => {
    rememberDraft("src/a.ts", "工作区 A")
    flushDrafts()
    setDraftScope("/work/b")
    expect(persistedDraftOf("src/a.ts")).toBeUndefined()
    expect(persistedDrafts()).toEqual([])
    rememberDraft("src/a.ts", "工作区 B")
    flushDrafts()
    setDraftScope("/work/a")
    expect(persistedDraftOf("src/a.ts")).toBe("工作区 A")
  })

  test("超过 1 MB 的草稿不落盘（localStorage 塞不下）", () => {
    rememberDraft("big.ts", "x".repeat(1_000_001))
    flushDrafts()
    resetEditorMemory(true)
    expect(persistedDraftOf("big.ts")).toBeUndefined()
  })
})

describe("视图状态记忆", () => {
  test("每个文件记住自己的视图模式", () => {
    rememberViewMode("/work/a/notes.md", "source")
    rememberViewMode("/work/a/data.csv", "text")
    expect(viewModeOf("/work/a/notes.md")).toBe("source")
    expect(viewModeOf("/work/a/data.csv")).toBe("text")
    expect(viewModeOf("/work/a/other.md")).toBeUndefined()
  })

  test("缩放只接受正数", () => {
    rememberZoom("/work/a/deck.pptx", 1.5)
    expect(zoomOf("/work/a/deck.pptx")).toBe(1.5)
    rememberZoom("/work/a/deck.pptx", 0)
    rememberZoom("/work/a/deck.pptx", Number.NaN)
    expect(zoomOf("/work/a/deck.pptx")).toBe(1.5)
  })

  test("忘记一个文件时视图和缩放一起清掉", () => {
    rememberViewMode("/work/a/deck.pptx", "source")
    rememberZoom("/work/a/deck.pptx", 2)
    forgetEditorMemory("/work/a/deck.pptx")
    expect(viewModeOf("/work/a/deck.pptx")).toBeUndefined()
    expect(zoomOf("/work/a/deck.pptx")).toBeUndefined()
  })
})
