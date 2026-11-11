import { describe, expect, test } from "bun:test"
import { pastedTextToHtml, sanitizePastedHtml } from "./rich-clipboard"

describe("富文本粘贴归一化", () => {
  test("行内标签映射成规范写法，样式转成内联 style", () => {
    const pasted =
      '<p class=MsoNormal><b>粗</b><i>斜</i><span style="color: rgb(255, 0, 0); font-size: 18px">红</span></p>'
    expect(sanitizePastedHtml(pasted)).toBe(
      '<strong>粗</strong><em>斜</em><span style="color:#FF0000;font-size:18px">红</span>',
    )
  })

  test("段落拍平成行，块之间一个 br", () => {
    const pasted = "<p>第一段</p><p>第二段</p>"
    expect(sanitizePastedHtml(pasted)).toBe("第一段<br>第二段")
  })

  test("丢掉脚本、样式和事件属性", () => {
    const pasted =
      '<div onclick="alert(1)">安全<script>alert(1)</script></div><style>p{color:red}</style><meta charset="utf-8">'
    expect(sanitizePastedHtml(pasted)).toBe("安全")
  })

  test("不安全协议的链接只保留文字", () => {
    expect(sanitizePastedHtml('<a href="javascript:alert(1)">点我</a>')).toBe("点我")
    expect(sanitizePastedHtml('<a href="https://example.com">链接</a>')).toBe('<a href="https://example.com">链接</a>')
  })

  test("只留安全的图片地址", () => {
    const ok = sanitizePastedHtml('<img src="data:image/png;base64,AAAA">')
    expect(ok).toBe('<img src="data:image/png;base64,AAAA">')
    expect(sanitizePastedHtml('<img src="javascript:alert(1)">')).toBe("")
  })

  test("纯文本粘贴：转义并换行", () => {
    expect(pastedTextToHtml("a < b\n第二行")).toBe("a &lt; b<br>第二行")
  })
})
