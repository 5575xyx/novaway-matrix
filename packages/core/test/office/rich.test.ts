import { describe, expect, test } from "bun:test"
import { DocumentSession } from "../../src/office/engine/session"
import { engineFor, officeFormatOf } from "../../src/office/engine/registry"
import {
  formatRange,
  setBlockAlign,
  setBlockIndent,
  setBlockLineHeight,
  setBlockText,
  setBlockType,
} from "../../src/office/rich/commands"
import { parseRichBlocks } from "../../src/office/rich/model"
import { richEngine } from "../../src/office/rich/engine"

const encoder = new TextEncoder()

const doc = (body: string) =>
  "<!doctype html>\n<html>\n<head><meta charset=\"utf-8\"><title>t</title></head>\n<body>\n" +
  body +
  "\n</body>\n</html>\n"

describe("富文本模型", () => {
  test("按文档顺序读出段落、列表项与内联格式", () => {
    const html = doc('<h1>标题</h1><p>a <strong>b</strong> <em>c</em></p><ul><li>x</li><li>y</li></ul>')
    const blocks = parseRichBlocks(html)
    expect(blocks.map((block) => block.tag)).toEqual(["h1", "p", "li", "li"])
    expect(blocks.map((block) => block.text)).toEqual(["标题", "a b c", "x", "y"])
    const paragraph = blocks[1]!
    expect(paragraph.runs.map((run) => [run.text, Boolean(run.bold), Boolean(run.italic)])).toEqual([
      ["a ", false, false],
      ["b", true, false],
      [" ", false, false],
      ["c", false, true],
    ])
  })

  test("列表项记录所属列表类型", () => {
    const blocks = parseRichBlocks(doc("<ol><li>一</li></ol>"))
    expect(blocks[0]!.list).toBe("ol")
  })

  test("识别对齐、行高与缩进", () => {
    const blocks = parseRichBlocks(doc('<p style="text-align:center;line-height:1.8;padding-left:24px">x</p>'))
    expect(blocks[0]!.align).toBe("center")
    expect(blocks[0]!.lineHeight).toBe(1.8)
    expect(blocks[0]!.indent).toBe(24)
  })

  test("表格内的内容不可编辑，但文字仍可读", () => {
    const blocks = parseRichBlocks(doc("<table><tr><td><p>单元格</p></td></tr></table>"))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.editable).toBe(false)
    expect(blocks[0]!.text).toBe("单元格")
    expect(blocks[0]!.reason).toContain("table")
  })

  test("未知内联标签（链接）标记为不可编辑", () => {
    const blocks = parseRichBlocks(doc('<p>见 <a href="https://example.com">链接</a></p>'))
    expect(blocks[0]!.editable).toBe(false)
    expect(blocks[0]!.text).toBe("见 链接")
  })

  test("HTML 实体在文字里还原，写回时重新转义", () => {
    const blocks = parseRichBlocks(doc("<p>a &amp; b &lt; c</p>"))
    expect(blocks[0]!.text).toBe("a & b < c")
  })

  test("顶层散落文字被当成合成段落", () => {
    const blocks = parseRichBlocks(doc("裸文字"))
    expect(blocks[0]!.synthetic).toBe(true)
    expect(blocks[0]!.text).toBe("裸文字")
  })
})

describe("富文本命令", () => {
  test("替换段落文字只动目标块，其它字节不变", () => {
    const html = doc("<h1>标题</h1><p>旧文字</p><p>保留</p>")
    const result = setBlockText(html, 2, "新文字")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toBe(doc("<h1>标题</h1><p>新文字</p><p>保留</p>"))
    expect(parseRichBlocks(result.data)[1]!.text).toBe("新文字")
  })

  test("替换文字保留首段的字符格式", () => {
    const html = doc("<p><strong>旧</strong>文字</p>")
    const result = setBlockText(html, 1, "新")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toContain("<strong>新</strong>")
  })

  test("换段落类型保留属性", () => {
    const html = doc('<h1 class="title" style="color:red">标题</h1>')
    const result = setBlockType(html, 1, "h2")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toContain('<h2 class="title" style="color:red">标题</h2>')
  })

  test("对齐写入 style，重复设置不会重复属性", () => {
    const html = doc('<p style="line-height:1.5">x</p>')
    const first = setBlockAlign(html, 1, "center")
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = setBlockAlign(first.data, 1, "right")
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data).toContain('style="line-height:1.5;text-align:right"')
    expect(second.data.match(/text-align/g)).toHaveLength(1)
  })

  test("行高与缩进，0 表示清除", () => {
    const html = doc("<p>x</p>")
    const withLine = setBlockLineHeight(html, 1, 2)
    expect(withLine.ok).toBe(true)
    if (!withLine.ok) return
    const withAll = setBlockIndent(withLine.data, 1, 32)
    expect(withAll.ok).toBe(true)
    if (!withAll.ok) return
    expect(withAll.data).toContain("line-height:2;padding-left:32px")
    const cleared = setBlockIndent(withAll.data, 1, 0)
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.data).toContain('style="line-height:2"')
  })

  test("给选区加粗，不碰选区外的文字", () => {
    const html = doc("<p>abcd</p>")
    const result = formatRange(html, 1, 1, 3, { bold: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toContain("<p>a<strong>bc</strong>d</p>")
  })

  test("颜色 / 高亮 / 字号一起写入 span", () => {
    const html = doc("<p>abc</p>")
    const result = formatRange(html, 1, 0, 3, { color: "#FF0000", highlight: "ff0", size: 20 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toContain(
      '<span style="color:#FF0000;background-color:#FFFF00;font-size:20px">abc</span>',
    )
  })

  test("clear 去掉选区上的全部行内格式", () => {
    const html = doc("<p><strong>a</strong><em>b</em></p>")
    const result = formatRange(html, 1, 0, 2, { clear: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toContain("<p>ab</p>")
  })

  test("整块格式化：不传区间", () => {
    const html = doc("<p>abc</p>")
    const result = formatRange(html, 1, undefined, undefined, { italic: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toContain("<p><em>abc</em></p>")
  })

  test("越界、空选区、非法颜色都明确报错", () => {
    const html = doc("<p>abc</p>")
    expect(formatRange(html, 1, 0, 9, { bold: true }).ok).toBe(false)
    expect(formatRange(html, 1, 1, 1, { bold: true }).ok).toBe(false)
    const bad = formatRange(html, 1, 0, 3, { color: "red" })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe("invalid_params")
  })

  test("不支持的块与不存在的段落分别报错", () => {
    const table = doc("<table><tr><td>x</td></tr></table>")
    const locked = setBlockText(table, 1, "y")
    expect(locked.ok).toBe(false)
    if (!locked.ok) expect(locked.error.code).toBe("unsupported_format")
    const missing = setBlockText(doc("<p>x</p>"), 9, "y")
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe("not_found")
  })
})

describe("富文本引擎", () => {
  test("注册表把 .html 交给富文本引擎", () => {
    expect(officeFormatOf("a/b/note.html")).toBe("html")
    expect(officeFormatOf("a/b/note.md")).toBe("markdown")
    expect(officeFormatOf("a/b/note.txt")).toBe("text")
    expect(engineFor("html")).toBe(richEngine)
  })

  test("打开后 blocks 与 HTML 对齐", async () => {
    const result = await richEngine.open(encoder.encode(doc("<h1>T</h1><p>x</p>")))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.blocks.map((block) => block.tag)).toEqual(["h1", "p"])
    expect(result.data.format.encoding).toBe("utf-8")
  })

  test("apply 改文字并重新解析状态", async () => {
    const bytes = encoder.encode(doc("<p>旧</p>"))
    const opened = await richEngine.open(bytes)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const applied = await richEngine.apply(opened.data, [{ op: "setSpanText", paragraph: 1, text: "新" }], bytes)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.changed).toEqual(["html"])
    expect(applied.data.state.blocks[0]!.text).toBe("新")
    expect(new TextDecoder().decode(applied.data.bytes)).toContain("<p>新</p>")
  })

  test("没有改动时 changed 为空，不重新编码", async () => {
    const bytes = encoder.encode(doc("<p>same</p>"))
    const opened = await richEngine.open(bytes)
    if (!opened.ok) return
    const applied = await richEngine.apply(opened.data, [{ op: "setBlockAlign", block: 1, align: "left" }], bytes)
    // 加 text-align 是真实改动；这里用同值重复命令验证 no-op 分支。
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const again = await richEngine.apply(applied.data.state, [{ op: "setBlockAlign", block: 1, align: "left" }], applied.data.bytes)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.data.changed).toEqual([])
    expect(again.data.bytes).toBe(applied.data.bytes)
  })

  test("会话：撤销回到原文后不再是脏文件", async () => {
    const bytes = encoder.encode(doc("<p>a</p>"))
    const session = await DocumentSession.open(richEngine, bytes)
    expect(session.ok).toBe(true)
    if (!session.ok) return
    expect(session.data.dirty).toBe(false)
    const applied = await session.data.apply([{ op: "setSpanText", paragraph: 1, text: "b" }], "改文字")
    expect(applied.ok).toBe(true)
    expect(session.data.dirty).toBe(true)
    expect(session.data.undo().ok).toBe(true)
    expect(session.data.dirty).toBe(false)
    expect(session.data.bytes).toBe(bytes)
  })

  test("不支持的 op 全有或全无", async () => {
    const bytes = encoder.encode(doc("<p>a</p>"))
    const opened = await richEngine.open(bytes)
    if (!opened.ok) return
    const applied = await richEngine.apply(
      opened.data,
      [
        { op: "setSpanText", paragraph: 1, text: "b" },
        { op: "setCellValue", sheet: "Sheet1", ref: { row: 0, col: 0 }, value: 1 },
      ],
      bytes,
    )
    expect(applied.ok).toBe(false)
  })
})

describe("设计视图保存", () => {
  test("setBlockHtml 只替换这一块，块外字节不变", async () => {
    const source = doc("<h1>标题</h1><p>旧</p>")
    const opened = await richEngine.open(encoder.encode(source))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const applied = await richEngine.apply(
      opened.data,
      [{ op: "setBlockHtml", block: 2, html: "<strong>新</strong>文字" }],
      encoder.encode(source),
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(new TextDecoder().decode(applied.data.bytes)).toBe(doc("<h1>标题</h1><p><strong>新</strong>文字</p>"))
    expect(applied.data.state.blocks[1]!.runs.map((run) => [run.text, Boolean(run.bold)])).toEqual([
      ["新", true],
      ["文字", false],
    ])
  })

  test("浏览器序列化的 <b>/<i> 会归一成 <strong>/<em>", async () => {
    const source = doc("<p>x</p>")
    const opened = await richEngine.open(encoder.encode(source))
    if (!opened.ok) return
    const applied = await richEngine.apply(
      opened.data,
      [{ op: "setBlockHtml", block: 1, html: "<b>a</b><i>b</i>" }],
      encoder.encode(source),
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(new TextDecoder().decode(applied.data.bytes)).toContain("<strong>a</strong><em>b</em>")
  })

  test("含链接的 HTML 拒绝写回，而不是悄悄丢掉 href", async () => {
    const source = doc('<p><a href="https://example.com">链接</a></p>')
    const opened = await richEngine.open(encoder.encode(source))
    if (!opened.ok) return
    const applied = await richEngine.apply(
      opened.data,
      [{ op: "setBlockHtml", block: 1, html: '<a href="https://x.test">新</a>' }],
      encoder.encode(source),
    )
    expect(applied.ok).toBe(false)
    if (!applied.ok) expect(applied.error.code).toBe("unsupported_format")
  })

  test("源码视图保存整篇时保留文档头", async () => {
    const source = doc("<p>a</p>")
    const next = source.replace("<p>a</p>", "<p>b</p>")
    const opened = await richEngine.open(encoder.encode(source))
    if (!opened.ok) return
    const applied = await richEngine.apply(opened.data, [{ op: "setText", text: next }], encoder.encode(source))
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(new TextDecoder().decode(applied.data.bytes)).toBe(next)
    expect(applied.data.changed).toEqual(["html"])
  })
})
