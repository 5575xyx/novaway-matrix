import { describe, expect, test } from "bun:test"
import { noteLinks, noteTags, noteTitle, resolveNotePath } from "../../src/office/text/notes"

const LF = String.fromCharCode(10)
const lines = (...items: string[]) => items.join(LF)

describe("note tags", () => {
  test("collects inline tags with line numbers and skips headings", () => {
    const text = lines("# 标题", "", "今天写 #写作 和 #灵感/素材，顺便 #2024-11。")
    expect(noteTags(text)).toEqual([
      { tag: "写作", line: 3 },
      { tag: "灵感/素材", line: 3 },
      { tag: "2024-11", line: 3 },
    ])
  })

  test("ignores fenced code, inline code, urls and bare numbers", () => {
    const text = lines(
      "```md",
      "#code 不是标签",
      "```",
      "行内 `#inline` 也不算，链接 https://example.com#frag 更不算。",
      "纯数字 #123 不是标签。",
    )
    expect(noteTags(text)).toEqual([])
  })

  test("requires a separator before the hash", () => {
    expect(noteTags("a#b")).toEqual([])
    expect(noteTags("(#c)")).toEqual([{ tag: "c", line: 1 }])
  })
})

describe("note links", () => {
  test("parses target, alias and anchor", () => {
    const text = lines("看 [[笔记/甲]]、[[乙|别名]] 和 [[丙#小节]]。")
    expect(noteLinks(text)).toEqual([
      { target: "笔记/甲", line: 1 },
      { target: "乙", alias: "别名", line: 1 },
      { target: "丙", anchor: "小节", line: 1 },
    ])
  })

  test("skips code spans and empty targets", () => {
    const text = lines("`[[代码里]]` 不算，[[]] 也不算，[[真链接]] 算。")
    expect(noteLinks(text)).toEqual([{ target: "真链接", line: 1 }])
  })
})

describe("note title", () => {
  test("uses the first level-1 heading", () => {
    expect(noteTitle(lines("---", "tag: x", "---", "# 真标题 #", "## 小标题"))).toBe("真标题")
  })

  test("returns undefined without a heading", () => {
    expect(noteTitle(lines("正文", "## 只有二级"))).toBeUndefined()
  })
})

describe("resolveNotePath", () => {
  test("resolves relative, parent and root targets", () => {
    expect(resolveNotePath("notes/a.md", "b")).toBe("notes/b.md")
    expect(resolveNotePath("notes/a.md", "../c")).toBe("c.md")
    expect(resolveNotePath("notes/a.md", "/d/e")).toBe("d/e.md")
    expect(resolveNotePath("notes/a.md", "x.html")).toBe("notes/x.html")
  })

  test("handles windows separators", () => {
    expect(resolveNotePath("notes\\a.md", "b")).toBe("notes/b.md")
  })
})
