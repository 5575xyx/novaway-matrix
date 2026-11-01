import type { FileContextItem } from "@/context/prompt"

// 预览里「点一个元素 → 写一句评论 → 挂到输入框上方」的公共部分。
// PPT 页和 HTML 页面走同一套：描述锚点（哪一页 / 哪个 DOM 节点）+ 用户那句话，
// 组装成 composer 的文件上下文条目（file + comment），发送时作为 synthetic 注释带给模型。

export type ElementCommentInput = {
  /** 工作区相对路径（PPTX / HTML 文件） */
  path: string
  /** chip 上的短标签，也是一句话说明「说的是哪个东西」 */
  label: string
  /** 锚点描述：`第 5 页 · 文本框「典型应用场景」` / `div.hero#main` */
  anchor: string
  /** 元素细节：几何、样式、源码片段；没有就不传 */
  detail?: string
  /** 用户写的评论；空字符串表示「只指出元素，让模型自己看」 */
  comment: string
}

/** 发给模型的注释正文（会被 comment-note 包一层「用户对 X 的评论：……」）。 */
export function elementCommentNote(input: ElementCommentInput) {
  const comment = input.comment.trim()
  const head = comment ? `针对「${input.anchor}」的修改要求：\n${comment}` : `请检查并优化「${input.anchor}」。`
  const detail = input.detail?.trim()
  return detail ? `${head}\n\n${detail}` : head
}

/** 组装成 composer 的文件上下文条目：不带 commentID，点击 chip 不会去跳转行级评论面板。 */
export function elementCommentItem(input: ElementCommentInput): FileContextItem {
  return {
    type: "file",
    path: input.path,
    comment: elementCommentNote(input),
    preview: input.label,
    commentOrigin: "file",
  }
}

export type SlideElementKind = "shape" | "picture" | "table" | "chart" | "group" | "slide" | "unknown"

export type SlideElementAnchor = {
  /** 1-based 页码 */
  slide: number
  /** 元素类型；点到空白处时为整页 */
  kind: SlideElementKind
  /** PPTX 里的形状名（「标题 1」「文本框 5」） */
  name?: string
  /** 形状里的文字（表格取前几格） */
  text?: string
  /** 幻灯片坐标系里的位置与尺寸 */
  box?: { x: number; y: number; w: number; h: number }
  slideSize: { w: number; h: number }
}

const KIND_LABEL: Record<SlideElementKind, string> = {
  shape: "形状",
  picture: "图片",
  table: "表格",
  chart: "图表",
  group: "组合",
  slide: "整页",
  unknown: "元素",
}

/** chip 上的标签：`第 5 页 · 形状「典型应用场景」` */
export function slideElementLabel(anchor: SlideElementAnchor) {
  const snippet = anchor.text?.replace(/\s+/g, " ").trim().slice(0, 24)
  const name = snippet || anchor.name?.trim()
  return `第 ${anchor.slide} 页 · ${KIND_LABEL[anchor.kind]}${name ? `「${name}」` : ""}`
}

/** 给模型看的元素细节：页码、形状名、位置，都换算成页面坐标便于对号入座。 */
export function slideElementDetail(anchor: SlideElementAnchor) {
  const lines = [
    "元素信息：",
    `- 幻灯片：第 ${anchor.slide} 页（页面尺寸 ${Math.round(anchor.slideSize.w)}×${Math.round(anchor.slideSize.h)}）`,
    `- 元素：${KIND_LABEL[anchor.kind]}${anchor.name ? `「${anchor.name}」` : ""}`,
  ]
  if (anchor.box) {
    const { x, y, w, h } = anchor.box
    lines.push(`- 位置：x=${Math.round(x)}, y=${Math.round(y)}, w=${Math.round(w)}, h=${Math.round(h)}（左上角为原点）`)
  }
  const text = anchor.text?.trim()
  if (text) {
    lines.push(`- 文字内容：${text.replace(/\s+/g, " ").slice(0, 300)}`)
  }
  return lines.join("\n")
}

type Bounded = { position: { x: number; y: number }; size: { w: number; h: number }; hidden?: boolean }

/**
 * 点选命中：按绘制顺序**反向**找（后画的在上面），返回第一个包含该点的节点。
 * 只做矩形近似 —— 圆形/三角形元素的边角会选中它，这比点不中要好。
 */
export function hitTestNodes<T extends Bounded>(nodes: readonly T[], point: { x: number; y: number }): T | undefined {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]!
    if (node.hidden) continue
    const { x, y } = node.position
    const { w, h } = node.size
    if (point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h) return node
  }
  return undefined
}
