import { describe, expect, test } from "bun:test"
import { marked } from "marked"
import { markdownNotes, markdownWikiLinks } from "./marked-notes"

marked.use(markdownNotes(), markdownWikiLinks())

const parse = (source: string) => marked.parse(source, { async: false })

describe("Markdown 脚注与 Callout", () => {
  test("脚注引用渲染成上标序号，定义收进文末列表", () => {
    const html = parse("正文[^1] 继续。\n\n[^1]: 这里是说明。\n")
    expect(html).toContain('class="md-footnote-ref"')
    expect(html).toContain('href="#fn-1"')
    expect(html).toContain('class="md-footnotes"')
    expect(html).toContain("这里是说明。")
    // 定义本身不再作为正文段落出现
    expect(html).not.toContain("[^1]:")
  })

  test("多个脚注按引用顺序编号", () => {
    const html = parse("甲[^b] 乙[^a]\n\n[^a]: A\n[^b]: B\n")
    const first = html.indexOf("fn-1")
    const second = html.indexOf("fn-2")
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    expect(html).toContain("B")
    expect(html).toContain("A")
  })

  test("Callout 变成带类型色的块，标题单独一行", () => {
    const html = parse("> [!warning] 注意\n> 别删库。\n")
    expect(html).toContain('class="md-callout md-callout-warning"')
    expect(html).toContain('class="md-callout-title">注意<')
    expect(html).toContain("别删库。")
    expect(html).not.toContain("[!warning]")
  })

  test("普通引用块不受影响", () => {
    const html = parse("> 只是一段引用\n")
    expect(html).toContain("<blockquote>")
    expect(html).not.toContain("md-callout")
  })

  test("代码块里的同形文本保持原样", () => {
    const html = parse("```\n[^1]: 不是脚注\n> [!note] 也不是 Callout\n```\n")
    expect(html).toContain("[^1]: 不是脚注")
    expect(html).not.toContain("md-footnote-ref")
    expect(html).not.toContain("md-callout")
  })
})

describe("Markdown wikilink", () => {
  test("[[目标]] 渲染成可点的内部链接", () => {
    const html = parse("见 [[项目计划]]。")
    expect(html).toContain('class="md-wikilink"')
    expect(html).toContain('data-wikilink="项目计划"')
    expect(html).toContain(">项目计划</a>")
  })

  test("[[目标|别名]] 显示别名、保留目标", () => {
    const html = parse("[[notes/a|第一篇]]")
    expect(html).toContain('data-wikilink="notes/a"')
    expect(html).toContain(">第一篇</a>")
  })

  test("代码块里的 [[...]] 不动", () => {
    const html = parse("```\n[[x]]\n```\n")
    expect(html).not.toContain("md-wikilink")
  })
})
