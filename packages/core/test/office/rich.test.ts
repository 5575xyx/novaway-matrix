import { describe, expect, test } from "bun:test"
import { DocumentSession } from "../../src/office/engine/session"
import { engineFor, officeFormatOf } from "../../src/office/engine/registry"
import {
  deleteBlock,
  formatRange,
  insertBlock,
  setBlockAlign,
  setBlockFirstLineIndent,
  setBlockIndent,
  setBlockLineHeight,
  setBlockList,
  setBlockText,
  setBlockType,
} from "../../src/office/rich/commands"
import { parseRichBlocks, sanitizeInlineHtml } from "../../src/office/rich/model"
import { richEngine } from "../../src/office/rich/engine"

const encoder = new TextEncoder()

const doc = (body: string) =>
  '<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>t</title></head>\n<body>\n' +
  body +
  "\n</body>\n</html>\n"

describe("富文本模型", () => {
  test("按文档顺序读出段落、列表项与内联格式", () => {
    const html = doc("<h1>标题</h1><p>a <strong>b</strong> <em>c</em></p><ul><li>x</li><li>y</li></ul>")
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

  test("安全链接算已知内联标签，段落仍可编辑", () => {
    const blocks = parseRichBlocks(doc('<p>见 <a href="https://example.com">链接</a></p>'))
    expect(blocks[0]!.editable).toBe(true)
    expect(blocks[0]!.text).toBe("见 链接")
    expect(blocks[0]!.runs.map((run) => run.text)).toEqual(["见 ", "链接"])
    expect(blocks[0]!.runs[1]!.href).toBe("https://example.com")
  })

  test("javascript: 之类的链接判成不可编辑，而不是悄悄丢掉 href", () => {
    const blocks = parseRichBlocks(doc('<p><a href="javascript:alert(1)">点我</a></p>'))
    expect(blocks[0]!.editable).toBe(false)
    expect(blocks[0]!.text).toBe("点我")
  })

  test("相对路径 / #锚点 / mailto 都算安全链接", () => {
    const blocks = parseRichBlocks(
      doc('<p><a href="/a.html">相对</a> <a href="#top">锚点</a> <a href="mailto:a@b.c">邮件</a></p>'),
    )
    expect(blocks[0]!.editable).toBe(true)
    expect(blocks[0]!.runs.filter((run) => run.href).map((run) => run.href)).toEqual([
      "/a.html",
      "#top",
      "mailto:a@b.c",
    ])
  })

  test("老式 <font> 归一成行内格式，段落仍可编辑", () => {
    const blocks = parseRichBlocks(doc('<p><font color="rgb(255, 0, 0)" size="5">红字</font></p>'))
    expect(blocks[0]!.editable).toBe(true)
    expect(blocks[0]!.text).toBe("红字")
    expect(blocks[0]!.runs[0]).toMatchObject({ color: "#FF0000", size: 24 })
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

  test("行内图片不产生文字，也不会让整段变成只读", () => {
    const blocks = parseRichBlocks(doc('<p>前<img src="a.png" alt="图" style="width:80px">后</p>'))
    expect(blocks[0]!.editable).toBe(true)
    expect(blocks[0]!.text).toBe("前后")
    const image = blocks[0]!.runs.find((run) => run.image)
    expect(image?.image).toBe('<img src="a.png" alt="图" style="width:80px">')
  })

  test("设计视图渲染前去掉内联事件属性，正文里的同名文字不受影响", () => {
    const html = '<p>看 <img src="a.png" onerror="alert(1)"> 和 onclick= 这几个字</p>'
    expect(sanitizeInlineHtml(html)).toBe('<p>看 <img src="a.png"> 和 onclick= 这几个字</p>')
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

  test("首行缩进独立于左缩进，读回来能区分", () => {
    const html = doc("<p>x</p>")
    const left = setBlockIndent(html, 1, 24)
    if (!left.ok) throw new Error(left.error.message)
    const both = setBlockFirstLineIndent(left.data, 1, 32)
    if (!both.ok) throw new Error(both.error.message)
    expect(both.data).toContain("padding-left:24px;text-indent:32px")
    const blocks = parseRichBlocks(left.data)
    expect(blocks[0]!.indent).toBe(24)
    const withFirst = parseRichBlocks(both.data)
    expect(withFirst[0]!.indent).toBe(24)
    expect(withFirst[0]!.firstLineIndent).toBe(32)
    const cleared = setBlockFirstLineIndent(both.data, 1, 0)
    if (!cleared.ok) throw new Error(cleared.error.message)
    expect(cleared.data).toContain('style="padding-left:24px"')
  })

  test("列表：段落包成列表、换类型、取消时拆开容器", () => {
    const html = doc("<p>一</p><p>二</p>")
    const bullet = setBlockList(html, 1, "ul")
    expect(bullet.ok).toBe(true)
    if (!bullet.ok) return
    expect(bullet.data).toContain("<ul><li>一</li></ul>")
    // 第二段不受影响。
    expect(bullet.data).toContain("<p>二</p>")

    const ordered = setBlockList(bullet.data, 1, "ol")
    expect(ordered.ok).toBe(true)
    if (!ordered.ok) return
    expect(ordered.data).toContain("<ol><li>一</li></ol>")

    // 多条列表里取消第一条：前面没有内容，直接在原地变回段落。
    const two = setBlockList(doc("<ul><li>一</li><li>二</li></ul>"), 2, "none")
    expect(two.ok).toBe(true)
    if (!two.ok) return
    expect(two.data).toContain("<ul><li>一</li></ul><p>二</p>")

    // 取消中间那条：前后各留一个列表。
    const middle = setBlockList(doc("<ul><li>一</li><li>二</li><li>三</li></ul>"), 2, "none")
    expect(middle.ok).toBe(true)
    if (!middle.ok) return
    expect(middle.data).toContain("<ul><li>一</li></ul><p>二</p><ul><li>三</li></ul>")

    // 唯一的一条：整个列表消失。
    const only = setBlockList(doc("<ul><li>一</li></ul>"), 1, "none")
    expect(only.ok).toBe(true)
    if (!only.ok) return
    expect(only.data).toContain("<p>一</p>")
    expect(only.data).not.toContain("<ul>")
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
    expect(result.data).toContain('<span style="color:#FF0000;background-color:#FFFF00;font-size:20px">abc</span>')
  })

  test("clear 去掉选区上的全部行内格式", () => {
    const html = doc("<p><strong>a</strong><em>b</em></p>")
    const result = formatRange(html, 1, 0, 2, { clear: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toContain("<p>ab</p>")
  })

  test("链接：加在某段文字上，空串表示去掉，危险协议被拒绝", () => {
    const html = doc("<p>点这里看文档</p>")
    const added = formatRange(html, 1, 0, 2, { link: "https://example.com" })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.data).toContain('<a href="https://example.com">点这</a>里看文档')

    const removed = formatRange(added.data, 1, 0, 2, { link: "" })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.data).not.toContain("<a ")

    const bad = formatRange(html, 1, 0, 2, { link: "javascript:alert(1)" })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe("invalid_params")
  })

  test("清除格式时保留链接（和 Word 一致）", () => {
    const html = doc('<p><a href="https://example.com"><strong>粗</strong>链接</a></p>')
    const result = formatRange(html, 1, 0, 1, { clear: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 只清了 <strong>，链接完整保留（文字按 run 切开，href 各带一份）。
    expect(result.data).toContain("粗")
    expect(result.data).toContain('<a href="https://example.com">')
    expect(result.data).not.toContain("<strong>")
  })

  test("格式化含图片的段落不会把图片弄丢", () => {
    const html = doc('<p>ab<img src="x.png"></p>')
    const result = formatRange(html, 1, 0, 2, { bold: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toContain("<strong>ab</strong>")
    expect(result.data).toContain('<img src="x.png">')
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

  test("apply 走 setBlockList：段落包成列表并重新解析", async () => {
    const bytes = encoder.encode(doc("<p>一</p><p>二</p>"))
    const opened = await richEngine.open(bytes)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const applied = await richEngine.apply(opened.data, [{ op: "setBlockList", block: 1, kind: "ol" }], bytes)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(new TextDecoder().decode(applied.data.bytes)).toContain("<ol><li>一</li></ol>")
    expect(applied.data.state.blocks[0]!.tag).toBe("li")
    expect(applied.data.state.blocks[0]!.list).toBe("ol")
  })

  test("没有改动时 changed 为空，不重新编码", async () => {
    const bytes = encoder.encode(doc("<p>same</p>"))
    const opened = await richEngine.open(bytes)
    if (!opened.ok) return
    const applied = await richEngine.apply(opened.data, [{ op: "setBlockAlign", block: 1, align: "left" }], bytes)
    // 加 text-align 是真实改动；这里用同值重复命令验证 no-op 分支。
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const again = await richEngine.apply(
      applied.data.state,
      [{ op: "setBlockAlign", block: 1, align: "left" }],
      applied.data.bytes,
    )
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

describe("插入 / 删除整块", () => {
  test("insertBlock 在指定段之后插入，段落序号顺延", () => {
    const html = doc("<p>一</p><p>三</p>")
    const result = insertBlock(html, 1, { text: "二" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toContain("<p>一</p><p>二</p><p>三</p>")
    expect(parseRichBlocks(result.data).map((block) => block.text)).toEqual(["一", "二", "三"])
  })

  test("insertBlock 在开头（after=0）插到正文容器里", () => {
    const html = doc("<p>正文</p>")
    const result = insertBlock(html, 0, { html: "<strong>新</strong>" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const body = result.data.slice(result.data.indexOf("<body>"))
    const inserted = body.indexOf("<p><strong>新</strong></p>")
    expect(inserted).toBeGreaterThan(-1)
    expect(inserted).toBeLessThan(body.indexOf("<p>正文</p>"))
  })

  test("insertBlock 支持标题类型，并拒绝不安全的行内结构", () => {
    const html = doc("<p>x</p>")
    const heading = insertBlock(html, 1, { text: "H", tag: "h2" })
    expect(heading.ok).toBe(true)
    if (heading.ok) expect(heading.data).toContain("<h2>H</h2>")

    // 安全链接可以插入；不安全的协议仍然拒绝。
    const linked = insertBlock(html, 1, { html: '<a href="https://example.com">链接</a>' })
    expect(linked.ok).toBe(true)
    if (linked.ok) expect(linked.data).toContain('<a href="https://example.com">链接</a>')

    const unsafe = insertBlock(html, 1, { html: '<a href="javascript:alert(1)">坏</a>' })
    expect(unsafe.ok).toBe(false)
  })

  test("列表项后面插入默认还是列表项", () => {
    const html = doc("<ul><li>一</li></ul>")
    const result = insertBlock(html, 1, { text: "二" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toContain("<ul><li>一</li><li>二</li></ul>")
  })

  test("insertBlock 位置越界或缺少内容时报错", () => {
    const html = doc("<p>x</p>")
    expect(insertBlock(html, 9, { text: "y" }).ok).toBe(false)
    expect(insertBlock(html, 1, {}).ok).toBe(false)
  })

  test("deleteBlock 只删这一段，块外字节不变", () => {
    const html = doc("<p>一</p><p>二</p><p>三</p>")
    const result = deleteBlock(html, 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toBe(doc("<p>一</p><p>三</p>"))
  })

  test("引擎按顺序应用 setBlockHtml + insertBlock（回车拆段）", async () => {
    const html = doc("<p>前半后半</p>")
    const opened = await richEngine.open(encoder.encode(html))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const applied = await richEngine.apply(
      opened.data,
      [
        { op: "setBlockHtml", block: 1, html: "前半" },
        { op: "insertBlock", after: 1, html: "后半" },
      ],
      encoder.encode(html),
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const text = new TextDecoder().decode(applied.data.bytes)
    expect(parseRichBlocks(text).map((block) => block.text)).toEqual(["前半", "后半"])
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

  test("设计视图里 execCommand 写出的 <font> 归一成 span 样式", async () => {
    const source = doc("<p>x</p>")
    const opened = await richEngine.open(encoder.encode(source))
    if (!opened.ok) return
    const applied = await richEngine.apply(
      opened.data,
      [{ op: "setBlockHtml", block: 1, html: '<font color="#ff0000">红</font><font size="7">大</font>' }],
      encoder.encode(source),
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const html = new TextDecoder().decode(applied.data.bytes)
    expect(html).toContain('<span style="color:#FF0000">红</span>')
    expect(html).toContain('<span style="font-size:48px">大</span>')
  })

  test("设计视图保存时保留链接的 href", async () => {
    const source = doc('<p><a href="https://example.com">链接</a></p>')
    const opened = await richEngine.open(encoder.encode(source))
    if (!opened.ok) return
    const applied = await richEngine.apply(
      opened.data,
      [{ op: "setBlockHtml", block: 1, html: '<a href="https://x.test">新</a>' }],
      encoder.encode(source),
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(new TextDecoder().decode(applied.data.bytes)).toContain('<a href="https://x.test">新</a>')
  })

  test("javascript: 链接拒绝写回", async () => {
    const source = doc("<p>a</p>")
    const opened = await richEngine.open(encoder.encode(source))
    if (!opened.ok) return
    const applied = await richEngine.apply(
      opened.data,
      [{ op: "setBlockHtml", block: 1, html: '<a href="javascript:alert(1)">x</a>' }],
      encoder.encode(source),
    )
    expect(applied.ok).toBe(false)
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

describe("富文本导出", () => {
  const html = doc("<h2>小标题</h2><p>正文 <strong>加粗</strong></p><ul><li>一</li><li>二</li></ul>")

  test("md 保留标题层级与列表符号", async () => {
    const opened = await richEngine.open(encoder.encode(html))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const result = await richEngine.export!(opened.data, "md", encoder.encode(html))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = new TextDecoder().decode(result.data)
    expect(text).toContain("## 小标题")
    expect(text).toContain("- 一")
    expect(text).toContain("- 二")
    // 行内格式在 md 里变成标记：`加粗` 现在是 `**加粗**`。
    expect(text).toContain("正文 **加粗**")
  })

  test("md 保留行内格式：加粗、斜体、删除线、链接", async () => {
    const source = doc('<p>a <strong>粗</strong> <em>斜</em> <s>删</s> <a href="https://example.com">链</a></p>')
    const opened = await richEngine.open(encoder.encode(source))
    if (!opened.ok) return
    const result = await richEngine.export!(opened.data, "md", encoder.encode(source))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new TextDecoder().decode(result.data)).toBe("a **粗** *斜* ~~删~~ [链](https://example.com)")
  })

  test("md 导出会转义会破坏结构的字符", async () => {
    const backslash = String.fromCharCode(92)
    const source = doc("<p>2 * 3 = 6 [注]</p>")
    const opened = await richEngine.open(encoder.encode(source))
    if (!opened.ok) return
    const result = await richEngine.export!(opened.data, "md", encoder.encode(source))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new TextDecoder().decode(result.data)).toBe(
      "2 " + backslash + "* 3 = 6 " + backslash + "[注" + backslash + "]",
    )
  })

  test("html 原样输出；pdf 能出纸；未知格式明确报错", async () => {
    const opened = await richEngine.open(encoder.encode(html))
    if (!opened.ok) return
    const same = await richEngine.export!(opened.data, "html", encoder.encode(html))
    expect(same.ok).toBe(true)
    if (same.ok) expect(new TextDecoder().decode(same.data)).toBe(html)

    const pdf = await richEngine.export!(opened.data, "pdf", encoder.encode(html))
    expect(pdf.ok).toBe(true)
    if (pdf.ok) expect(new TextDecoder("windows-1252").decode(pdf.data.slice(0, 5))).toBe("%PDF-")

    const docx = await richEngine.export!(opened.data, "docx", encoder.encode(html))
    expect(docx.ok).toBe(false)
  })
})
