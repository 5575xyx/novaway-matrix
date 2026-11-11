import { describe, expect, test } from "bun:test"
import { filterCommands, findCommand, fuzzyMatch } from "../../src/office/text/palette"

describe("命令面板模糊匹配", () => {
  test("按顺序出现的字符就算命中，大小写与空格不敏感", () => {
    expect(fuzzyMatch("fnd", "Find 查找")).toBeDefined()
    expect(fuzzyMatch("FN D", "Find 查找")).toBeDefined()
    expect(fuzzyMatch("zzz", "Find 查找")).toBeUndefined()
    expect(fuzzyMatch("", "任何")).toEqual({ score: 0, positions: [] })
  })

  test("词首和连续匹配得分更高", () => {
    const head = fuzzyMatch("fi", "Find")!.score
    const middle = fuzzyMatch("fi", "notified")!.score
    expect(head).toBeGreaterThan(middle)
    expect(fuzzyMatch("保存", "保存")!.positions).toEqual([0, 1])
  })

  test("标签命中优先于别名命中", () => {
    const commands = filterCommands({ kind: "text" }, "find")
    expect(commands[0]?.id).toBe("find")
    // 别名也能搜到中文命令。
    expect(filterCommands({ kind: "markdown" }, "jiaozhu").map((item) => item.id)).toContain("footnote")
  })

  test("按文档类型过滤：JSON 没有 Markdown 插入，富文本只有视图命令", () => {
    const json = filterCommands({ kind: "json" }, "").map((item) => item.id)
    expect(json).toContain("json")
    expect(json).not.toContain("footnote")
    // JSON 也是文本文件：行命令仍然可用，只多了「格式化 JSON」。
    expect(json).toContain("sort")

    const rich = filterCommands({ kind: "rich" }, "").map((item) => item.id)
    expect(rich).toContain("richSource")
    expect(rich).not.toContain("upper")

    const markdown = filterCommands({ kind: "markdown" }, "").map((item) => item.id)
    expect(markdown).toContain("table")
    expect(markdown).toContain("comment")
    expect(markdown).toContain("save")
  })

  test("空查询返回当前范围内的全部命令，顺序稳定", () => {
    const first = filterCommands({ kind: "text" }, "").map((item) => item.id)
    const second = filterCommands({ kind: "text" }, "").map((item) => item.id)
    expect(first).toEqual(second)
    expect(first[0]).toBe("save")
  })

  test("按 id 反查命令（面板显示快捷键用）", () => {
    expect(findCommand("find")?.shortcut).toBe("⌘F")
    expect(findCommand("nope")).toBeUndefined()
  })

  test("块级命令按文档类型出现", () => {
    const markdown = filterCommands({ kind: "markdown" }, "").map((item) => item.id)
    expect(markdown).toContain("heading2")
    expect(markdown).toContain("bulletList")
    expect(markdown).toContain("quote")
    // 笔记面板（标签 / wikilink / 反链）只对 Markdown 有意义。
    expect(markdown).toContain("notes")
    expect(markdown).not.toContain("richSource")

    // 纯文本也能加列表和引用，但没有「标题」。
    const text = filterCommands({ kind: "text" }, "").map((item) => item.id)
    expect(text).toContain("orderedList")
    expect(text).not.toContain("heading2")
  })

  test("视图开关在每种文档里都能搜到", () => {
    // 自动换行只影响显示，不属于某一种格式，所以 all 作用域里必须有。
    for (const kind of ["text", "markdown", "json", "rich"] as const) {
      expect(filterCommands({ kind }, "huanhang").map((item) => item.id)).toContain("wrap")
    }
  })
})
