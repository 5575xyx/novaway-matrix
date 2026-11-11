import { describe, expect, test } from "bun:test"
import {
  replaceMarkdownBlock,
  replaceMarkdownRange,
  splitMarkdownBlocks,
  splitMarkdownLines,
} from "../../src/office/text/live-preview"

const LF = String.fromCharCode(10)
const lines = (...items: string[]) => items.join(LF)

describe("markdown 实时预览切块", () => {
  test("空行分块，空行不属于任何块", () => {
    const text = lines("# 标题", "", "第一段", "还是第一段", "", "第二段")
    const blocks = splitMarkdownBlocks(text)
    expect(blocks.map((block) => [block.kind, block.source])).toEqual([
      ["heading", "# 标题"],
      ["paragraph", "第一段" + LF + "还是第一段"],
      ["paragraph", "第二段"],
    ])
    expect(blocks.map((block) => [block.firstLine, block.lastLine])).toEqual([
      [1, 1],
      [3, 4],
      [6, 6],
    ])
  })

  test("标题和分隔线即使紧贴正文也单独成块", () => {
    const text = lines("# 标题", "正文", "---", "后面")
    expect(splitMarkdownBlocks(text).map((block) => block.kind)).toEqual(["heading", "paragraph", "rule", "paragraph"])
  })

  test("围栏代码块整段算一块，里面的标记不当结构", () => {
    const text = lines("说明", "```md", "# 不是标题", "---", "```", "结尾")
    const blocks = splitMarkdownBlocks(text)
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "fence", "paragraph"])
    expect(blocks[1]!.source).toBe(lines("```md", "# 不是标题", "---", "```"))
  })

  test("列表、引用、表格各自成块并识别类型", () => {
    const text = lines("- 一", "- 二", "", "> 引用", "", "| a | b |", "| --- | --- |", "| 1 | 2 |")
    expect(splitMarkdownBlocks(text).map((block) => block.kind)).toEqual(["list", "quote", "table"])
  })

  test("偏移量能精确还原原文，块之间只隔空行", () => {
    const text = lines("# 标题", "", "正文", "", "```", "code", "```")
    const blocks = splitMarkdownBlocks(text)
    for (const block of blocks) expect(text.slice(block.start, block.end)).toBe(block.source)
    expect(
      blocks
        .map((block) => block.end)
        .every((end, index) => {
          const next = blocks[index + 1]
          return next === undefined || text.slice(end, next.start).trim().length === 0
        }),
    ).toBe(true)
  })

  test("替换一块只改这一块，块外逐字不动", () => {
    const text = lines("# 标题", "", "旧正文", "", "尾巴")
    const block = splitMarkdownBlocks(text)[1]!
    const next = replaceMarkdownBlock(text, block, "新正文" + LF + "第二行")
    expect(next).toBe(lines("# 标题", "", "新正文", "第二行", "", "尾巴"))
  })

  test("空文档和纯空行没有块", () => {
    expect(splitMarkdownBlocks("")).toEqual([])
    expect(splitMarkdownBlocks(LF + LF)).toEqual([])
  })

  test("未闭合的围栏一直算到文末", () => {
    const blocks = splitMarkdownBlocks(lines("```ts", "const a = 1"))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe("fence")
  })

  test("CRLF 原文也能正确切块与还原", () => {
    const text = ["# 标题", "", "正文"].join("\r\n")
    const blocks = splitMarkdownBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(text.slice(blocks[1]!.start, blocks[1]!.end)).toBe("正文")
    expect(replaceMarkdownBlock(text, blocks[1]!, "新正文")).toBe(["# 标题", "", "新正文"].join("\r\n"))
  })
})

describe("markdown 实时预览按行编辑", () => {
  test("逐行给出 1 起的行号和字符区间", () => {
    const text = lines("# 标题", "", "第一段", "第二行")
    expect(splitMarkdownLines(text)).toEqual([
      { number: 1, start: 0, end: 4, source: "# 标题" },
      { number: 2, start: 5, end: 5, source: "" },
      { number: 3, start: 6, end: 9, source: "第一段" },
      { number: 4, start: 10, end: 13, source: "第二行" },
    ])
  })

  test("末尾换行不会多算一行", () => {
    expect(splitMarkdownLines(lines("a", "")).map((line) => line.number)).toEqual([1])
    expect(splitMarkdownLines("")).toEqual([])
  })

  test("只改一行时，其它行逐字不动", () => {
    const text = lines("# 标题", "", "第一段", "还是第一段", "", "尾巴")
    const target = splitMarkdownLines(text)[3]!
    const next = replaceMarkdownRange(text, target.start, target.end, "改过的第二行")
    expect(next).toBe(lines("# 标题", "", "第一段", "改过的第二行", "", "尾巴"))
  })

  test("行内换行（拆成多行）也能写回", () => {
    const text = lines("前", "- 一", "- 二", "后")
    const target = splitMarkdownLines(text)[1]!
    expect(replaceMarkdownRange(text, target.start, target.end, "- 一" + LF + "- 一点五")).toBe(
      lines("前", "- 一", "- 一点五", "- 二", "后"),
    )
  })

  test("CRLF 文档按行替换后换行风格不变", () => {
    const text = ["# 标题", "", "正文", "第二行"].join("\r\n")
    const target = splitMarkdownLines(text)[2]!
    expect(target.source).toBe("正文")
    expect(replaceMarkdownRange(text, target.start, target.end, "新正文")).toBe(
      ["# 标题", "", "新正文", "第二行"].join("\r\n"),
    )
  })

  test("越界区间原样返回，不破坏文档", () => {
    const text = lines("a", "b")
    expect(replaceMarkdownRange(text, 0, text.length + 1, "x")).toBe(text)
    expect(replaceMarkdownRange(text, -1, 1, "x")).toBe(text)
    expect(replaceMarkdownRange(text, 2, 1, "x")).toBe(text)
  })
})
