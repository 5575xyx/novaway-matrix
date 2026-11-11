import { describe, expect, test } from "bun:test"
import { markdownOutline, outlineText } from "../../src/office/text/outline"

describe("Markdown 大纲", () => {
  test("按层级和行号抽标题", () => {
    const source = ["# 一级", "", "正文", "## 二级", "### 三级 ##", ""].join("\n")
    expect(markdownOutline(source)).toEqual([
      { level: 1, text: "一级", line: 1 },
      { level: 2, text: "二级", line: 4 },
      { level: 3, text: "三级", line: 5 },
    ])
  })

  test("代码围栏里的 # 注释不算标题", () => {
    const source = ["# 真标题", "```bash", "# 注释", "```", "## 另一个"].join("\n")
    expect(markdownOutline(source).map((item) => item.text)).toEqual(["真标题", "另一个"])
  })

  test("setext 标题按 CommonMark 认，空行后的分隔线不算", () => {
    // `正文` 紧接着 `---` 在 CommonMark 里就是二级标题；空行后的 `---` 才是分隔线。
    const source = ["标题一", "=====", "", "正文", "", "---", "", "标题二", "-----"].join("\n")
    expect(markdownOutline(source)).toEqual([
      { level: 1, text: "标题一", line: 1 },
      { level: 2, text: "标题二", line: 8 },
    ])
  })

  test("引用和列表里的 # 不当标题", () => {
    const source = ["> # 引用里", "- # 列表里", "正文"].join("\n")
    expect(markdownOutline(source)).toEqual([])
  })

  test("大纲文字去掉行内格式", () => {
    expect(outlineText("**粗** 与 [链接](https://x.y) 和 `code`")).toBe("粗 与 链接 和 code")
  })
})
