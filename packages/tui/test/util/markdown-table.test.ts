import { describe, expect, test } from "bun:test"
import { extractResultText, parseMarkdownTable } from "../../src/util/markdown-table"

describe("markdown 表格解析(dbx 工具输出)", () => {
  test("带分隔线的标准表格", () => {
    const text = "| name | type |\n| --- | --- |\n| id | int |\n| title | varchar |"
    const { headers, rows } = parseMarkdownTable(text)
    expect(headers).toEqual(["name", "type"])
    expect(rows).toEqual([
      ["id", "int"],
      ["title", "varchar"],
    ])
  })

  test("没有分隔线时跳过第一行当数据", () => {
    const text = "| name |\n| a |\n| b |"
    const { rows } = parseMarkdownTable(text)
    expect(rows).toEqual([["a"], ["b"]])
  })

  test("非表格文本返回空", () => {
    expect(parseMarkdownTable("plain text").rows).toEqual([])
    expect(parseMarkdownTable("").headers).toEqual([])
  })
})

describe("工具结果取文本", () => {
  test("MCP content 数组取第一个 text", () => {
    expect(
      extractResultText({ content: [{ type: "text", text: "| a |\n| 1 |" }] }),
    ).toBe("| a |\n| 1 |")
  })

  test("字符串直通,其他返回空", () => {
    expect(extractResultText("raw")).toBe("raw")
    expect(extractResultText({ nope: 1 })).toBe("")
  })
})
