import { describe, expect, test } from "bun:test"
import { formatOutline, outlineOf } from "../../src/office/outline"

describe("文档大纲", () => {
  test("docx 只挑标题样式，路径能直接用于 get", () => {
    const state = {
      paragraphs: [
        { index: 1, text: "合同", style: "Heading1" },
        { index: 2, text: "正文" },
        { index: 3, text: "付款", style: "Heading 2" },
      ],
    }
    expect(outlineOf("docx", state)).toEqual([
      { level: 1, text: "合同", path: "/body/p[1]" },
      { level: 2, text: "付款", path: "/body/p[3]" },
    ])
  })

  test("pptx 每页一条，取第一个非空段落", () => {
    const state = {
      nodes: [
        { slide: 1, paragraphs: ["", "封面"] },
        { slide: 1, paragraphs: ["副标题"] },
        { slide: 2, paragraphs: [""] },
      ],
    }
    expect(outlineOf("pptx", state).map((item) => item.text)).toEqual(["第 1 页 · 封面", "第 2 页 · （空）"])
  })

  test("xlsx / csv 给工作表和数据体量", () => {
    expect(outlineOf("xlsx", { sheets: [{ name: "数据", cells: [{ ref: "A1" }, { ref: "B1" }] }] })).toEqual([
      { level: 1, text: "数据（2 个非空单元格）", path: "/数据" },
    ])
    expect(outlineOf("csv", { rows: [["a"], ["b"], ["c"]] })).toEqual([{ level: 1, text: "csv（3 行）", path: "/" }])
  })

  test("Markdown 用标题，纯文本退回逐行并带行号", () => {
    expect(outlineOf("markdown", { text: "# 标题\n正文\n## 小节" })).toEqual([
      { level: 1, text: "标题", line: 1 },
      { level: 2, text: "小节", line: 3 },
    ])
    expect(outlineOf("text", { text: "第一行\n\n第三行" })).toEqual([
      { level: 1, text: "第一行", line: 1 },
      { level: 1, text: "第三行", line: 3 },
    ])
  })

  test("formatOutline 用缩进表达层级", () => {
    const text = formatOutline([
      { level: 1, text: "一", path: "/body/p[1]" },
      { level: 2, text: "二", line: 5 },
    ])
    expect(text).toBe("一  /body/p[1]\n  二  第 5 行")
  })
})
