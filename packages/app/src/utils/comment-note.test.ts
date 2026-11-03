import { describe, expect, test } from "bun:test"
import { commentSummary } from "./comment-note"

describe("commentSummary", () => {
  test("选元素备注只留用户写的那句，不带元素细节", () => {
    const note = [
      "用户对「div.user-card」的修改要求：",
      "这里可以扩展一下别的功能",
      "",
      "下面是我在预览里选中的元素，请基于它修改页面：",
      "",
      "- CSS 路径: body > aside > div:nth-of-type(4)",
      "- 关键样式:",
      "  - color: rgb(26, 29, 39);",
    ].join("\n")
    expect(commentSummary(note)).toBe("这里可以扩展一下别的功能")
  })

  test("PPT 备注的锚点里还嵌着「」，也能把用户那句话摘出来", () => {
    const note =
      "针对「第 5 页 · 形状「典型应用场景」」的修改要求：\n把这张卡片换成蓝绿色\n\n元素信息：\n- 幻灯片：第 5 页"
    expect(commentSummary(note)).toBe("把这张卡片换成蓝绿色")
  })

  test("用户写了多段时只取第一段（卡片只有两行）", () => {
    const note = "针对「h1.title」的修改要求：\n标题再大一点\n第二段细节\n\n元素信息：\n- 幻灯片：第 1 页"
    expect(commentSummary(note)).toBe("标题再大一点\n第二段细节")
  })

  test("只点了元素、没写评论：没有可展示的摘要", () => {
    const note = "下面是我在预览里选中的元素，请基于它修改页面：\n\n- CSS 路径: div#app"
    expect(commentSummary(note)).toBe("")
  })

  test("普通行级评论原样返回", () => {
    expect(commentSummary("这里的空判断漏了")).toBe("这里的空判断漏了")
    expect(commentSummary("第一行\n第二行")).toBe("第一行\n第二行")
  })

  test("CRLF 与首尾空白归一化", () => {
    expect(commentSummary("  用户对「a.b」的修改要求：\r\n  改个颜色  \r\n")).toBe("改个颜色")
  })
})
