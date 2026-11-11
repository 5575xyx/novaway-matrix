import { describe, expect, test } from "bun:test"
import { formatFrontMatterValue, parseFrontMatter, updateFrontMatter } from "../../src/office/text/front-matter"

const DOC = ["---", "title: 周报", "tags: [工作, 2026]", "draft: false", "---", "", "# 正文", "内容"].join("\n")

describe("Markdown 属性区", () => {
  test("读出标量、数字、布尔、行内数组和块数组", () => {
    const block = parseFrontMatter(
      [
        "---",
        "title: 周报",
        "count: 3",
        "draft: false",
        "tags: [工作, 2026]",
        "people:",
        "  - 小明",
        "  - 小红",
        "---",
      ].join("\n"),
    )!
    expect(block.entries.map((entry) => [entry.key, entry.value])).toEqual([
      ["title", "周报"],
      ["count", 3],
      ["draft", false],
      ["tags", ["工作", "2026"]],
      ["people", ["小明", "小红"]],
    ])
  })

  test("没有属性区时返回 undefined", () => {
    expect(parseFrontMatter("# 只有正文")).toBeUndefined()
    // 只有开头没有结尾也不算：那可能只是一条分隔线。
    expect(parseFrontMatter("---\ntitle: x\n没有结尾")).toBeUndefined()
  })

  test("改一个键，其他行逐字节保留（含注释和顺序）", () => {
    const source = ["---", "# 注释留着", "title: 旧标题", "draft: false", "---", "正文"].join("\n")
    const next = updateFrontMatter(source, { title: "新标题" })
    expect(next).toBe(["---", "# 注释留着", "title: 新标题", "draft: false", "---", "正文"].join("\n"))
  })

  test("新增键追加到结尾分隔线之前", () => {
    const next = updateFrontMatter(DOC, { status: "完成" })
    expect(next).toBe(
      ["---", "title: 周报", "tags: [工作, 2026]", "draft: false", "status: 完成", "---", "", "# 正文", "内容"].join(
        "\n",
      ),
    )
  })

  test("删除键时连同它的块数组项一起删", () => {
    const source = ["---", "title: x", "tags:", "  - a", "  - b", "draft: false", "---", "正文"].join("\n")
    expect(updateFrontMatter(source, { tags: undefined })).toBe(
      ["---", "title: x", "draft: false", "---", "正文"].join("\n"),
    )
  })

  test("块数组改成行内数组：旧的行不会残留在下面", () => {
    const source = ["---", "tags:", "  - a", "  - b", "---"].join("\n")
    expect(updateFrontMatter(source, { tags: ["c"] })).toBe(["---", "tags: [c]", "---"].join("\n"))
  })

  test("没有属性区时新建一个", () => {
    expect(updateFrontMatter("正文", { title: "新文档", draft: true })).toBe(
      ["---", "title: 新文档", "draft: true", "---", "正文"].join("\n"),
    )
  })

  test("CRLF 文件保持 CRLF", () => {
    const source = ["---", "title: x", "---", "正文"].join("\r\n")
    expect(updateFrontMatter(source, { title: "y" })).toBe(["---", "title: y", "---", "正文"].join("\r\n"))
  })

  test("写入后能被重新解析出来", () => {
    const next = updateFrontMatter(DOC, { tags: ["工作", "季度"], draft: true, author: "小明" })
    const block = parseFrontMatter(next)!
    expect(block.entries.map((entry) => entry.key)).toEqual(["title", "tags", "draft", "author"])
    expect(block.entries.find((entry) => entry.key === "tags")?.value).toEqual(["工作", "季度"])
    expect(next).toContain("# 正文")
  })

  test("有歧义的字符串会加引号，普通字符串不加", () => {
    expect(formatFrontMatterValue("周报")).toBe("周报")
    expect(formatFrontMatterValue("a: b")).toBe('"a: b"')
    expect(formatFrontMatterValue("")).toBe('""')
    expect(formatFrontMatterValue(2026)).toBe("2026")
    expect(formatFrontMatterValue(null)).toBe("")
    expect(formatFrontMatterValue(["a", "b"])).toBe("[a, b]")
  })
})
