import { describe, expect, test } from "bun:test"
import { paragraphsToHtml, slidesToHtml } from "../../src/office/engine/export"
import { docxEngine } from "../../src/office/engine/docx"
import { pptxEngine } from "../../src/office/engine/pptx"

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe("DOCX / PPTX 导出 HTML", () => {
  test("段落保留标题层级、行内格式和对齐", () => {
    const html = paragraphsToHtml([
      { text: "标题", heading: 2, bold: true, align: "center", size: 18, color: "1F2937" },
      { text: "正文 <a>", italic: true, underline: true },
      { text: "   " },
    ])
    expect(html).toContain('<h2 style="font-weight:600;font-size:18pt;color:#1F2937;text-align:center">标题</h2>')
    // 文本里的尖括号要转义，不能变成标签。
    expect(html).toContain('<p style="font-style:italic;text-decoration:underline">正文 &lt;a&gt;</p>')
    expect(html.match(/<p/g)?.length).toBe(1)
  })

  test("幻灯片按页分节，没有标题时用页码兜底", () => {
    const html = slidesToHtml([
      { index: 1, title: "开场", lines: ["第一点", "<第二点>"] },
      { index: 2, lines: [] },
    ])
    expect(html).toContain("<h2>开场</h2>")
    expect(html).toContain("<li>&lt;第二点&gt;</li>")
    expect(html).toContain("<h2>第 2 页</h2>")
  })

  test("引擎的 export 通道接上了 html", async () => {
    const docx = await docxEngine.export!(
      { paragraphs: [{ index: 1, text: "你好", bold: true }] },
      "html",
      new Uint8Array(),
    )
    expect(docx.ok).toBe(true)
    if (docx.ok) expect(decode(docx.data)).toContain("<p")

    const pptx = await pptxEngine.export!(
      { size: { w: 960, h: 540 }, nodes: [], slideCount: 1, layouts: [], slides: [] },
      "html",
      new Uint8Array(),
    )
    // 没有文字页也要能导出：HTML 里有空 section，不报错。
    expect(pptx.ok).toBe(true)

    const bad = await docxEngine.export!({ paragraphs: [] }, "csv", new Uint8Array())
    expect(bad.ok).toBe(false)
  })
})
