import { describe, expect, test } from "bun:test"
import {
  elementCommentItem,
  elementCommentNote,
  hitTestNodes,
  slideElementDetail,
  slideElementLabel,
} from "./element-comment"

describe("elementCommentNote", () => {
  test("带上用户评论和锚点", () => {
    const note = elementCommentNote({
      path: "export.pptx",
      label: "第 5 页 · 形状「典型应用场景」",
      anchor: "第 5 页 · 形状「典型应用场景」",
      detail: "元素信息：\n- 幻灯片：第 5 页",
      comment: "  把这张卡片换成蓝绿色  ",
    })
    expect(note).toContain("针对「第 5 页 · 形状「典型应用场景」」的修改要求：")
    expect(note).toContain("把这张卡片换成蓝绿色")
    expect(note.endsWith("- 幻灯片：第 5 页")).toBe(true)
  })

  test("没有评论时退回「请检查并优化」，不产出空句子", () => {
    const note = elementCommentNote({ path: "a.html", label: "h1.title", anchor: "h1.title", comment: "   " })
    expect(note).toBe("请检查并优化「h1.title」。")
  })
})

describe("elementCommentItem", () => {
  test("组装成不带 commentID 的文件上下文条目", () => {
    const item = elementCommentItem({
      path: "projects/a/export.pptx",
      label: "第 2 页 · 整页",
      anchor: "第 2 页 · 整页",
      comment: "这页太空了",
    })
    expect(item).toEqual({
      type: "file",
      path: "projects/a/export.pptx",
      comment: "针对「第 2 页 · 整页」的修改要求：\n这页太空了",
      preview: "第 2 页 · 整页",
      commentOrigin: "file",
    })
    // 没有 commentID：点 chip 不会去跳行级评论面板（PPT 没有行号概念）
    expect("commentID" in item).toBe(false)
  })
})

describe("slideElementLabel", () => {
  const base = { slide: 5, slideSize: { w: 960, h: 540 } }

  test("优先用元素文字做标签", () => {
    expect(slideElementLabel({ ...base, kind: "shape", name: "标题 1", text: "典型应用场景\n第二行" })).toBe(
      "第 5 页 · 形状「典型应用场景 第二行」",
    )
  })

  test("没有文字时退回形状名，图片按类型说话", () => {
    expect(slideElementLabel({ ...base, kind: "shape", name: "标题 1" })).toBe("第 5 页 · 形状「标题 1」")
    expect(slideElementLabel({ ...base, kind: "picture" })).toBe("第 5 页 · 图片")
    expect(slideElementLabel({ ...base, kind: "slide" })).toBe("第 5 页 · 整页")
  })
})

describe("slideElementDetail", () => {
  test("给出页码、形状名、坐标与文字", () => {
    const detail = slideElementDetail({
      slide: 3,
      kind: "shape",
      name: "文本框 7",
      text: "收入增长 20%",
      box: { x: 120.4, y: 180.6, w: 240, h: 90 },
      slideSize: { w: 960, h: 540 },
    })
    expect(detail).toContain("第 3 页（页面尺寸 960×540）")
    expect(detail).toContain("形状「文本框 7」")
    expect(detail).toContain("x=120, y=181, w=240, h=90")
    expect(detail).toContain("文字内容：收入增长 20%")
  })

  test("整页锚点不带坐标", () => {
    const detail = slideElementDetail({ slide: 1, kind: "slide", slideSize: { w: 960, h: 540 } })
    expect(detail).toContain("元素：整页")
    expect(detail).not.toContain("位置：")
  })
})

describe("hitTestNodes", () => {
  const node = (x: number, y: number, w: number, h: number, hidden = false) => ({
    position: { x, y },
    size: { w, h },
    hidden,
  })

  test("后画的节点盖住先画的", () => {
    const bottom = node(0, 0, 100, 100)
    const top = node(20, 20, 40, 40)
    expect(hitTestNodes([bottom, top], { x: 30, y: 30 })).toBe(top)
    expect(hitTestNodes([bottom, top], { x: 90, y: 90 })).toBe(bottom)
  })

  test("点空白处返回 undefined，隐藏节点不参与命中", () => {
    expect(hitTestNodes([node(0, 0, 10, 10)], { x: 500, y: 500 })).toBeUndefined()
    expect(hitTestNodes([node(0, 0, 100, 100, true)], { x: 10, y: 10 })).toBeUndefined()
  })
})
