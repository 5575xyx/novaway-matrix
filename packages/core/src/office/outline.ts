/**
 * 文档大纲：只留「结构」，不铺全文。
 *
 * `view <file> outline`：长文档先看骨架再决定读哪一段，
 * Agent 也常用它一屏摸清文档结构。CLI、AI 读工具和面板共用这一份实现。
 *
 * 每一条都尽量带 `path`（和 get / set 的寻址语法一致），拿到就能直接改；
 * 文本文件没有路径概念，改用 1 起的行号。
 */

import type { OfficeFormat } from "./engine/contract"
import { markdownOutline } from "./text/outline"

export type OutlineItem = {
  /** 1–6，越大越深；幻灯片 / 工作表这类平铺条目固定 1。 */
  level: number
  text: string
  /** 文本文件的行号；其他格式没有行号概念。 */
  line?: number
  /** 文档里的定位路径，能直接喂给 get / set。 */
  path?: string
}

/** 抽结构。状态来自各引擎的 `open`，这里只读公开字段，不做完整 AST。 */
export function outlineOf(format: OfficeFormat, state: unknown): OutlineItem[] {
  const value = state as Record<string, unknown>
  if (format === "docx") {
    const paragraphs = (value.paragraphs as Array<{ index: number; text: string; style?: string }>) ?? []
    const items: OutlineItem[] = []
    for (const item of paragraphs) {
      const match = /^(?:heading|标题)[ \t]*(\d)$/i.exec(item.style ?? "")
      if (!match || item.text.trim().length === 0) continue
      items.push({ level: Math.min(6, Math.max(1, Number(match[1]))), text: item.text, path: `/body/p[${item.index}]` })
    }
    return items
  }
  if (format === "xlsx" || format === "csv") {
    if (format === "csv") {
      const rows = (value.rows as unknown[][]) ?? []
      return [{ level: 1, text: "csv（" + rows.length + " 行）", path: "/" }]
    }
    const sheets = (value.sheets as Array<{ name: string; cells: Array<{ ref: string }> }>) ?? []
    return sheets.map((sheet) => ({
      level: 1,
      text: sheet.name + "（" + sheet.cells.length + " 个非空单元格）",
      path: "/" + sheet.name,
    }))
  }
  if (format === "pptx") {
    const nodes = (value.nodes as Array<{ slide: number; paragraphs: string[] }>) ?? []
    const slides = new Map<number, string[]>()
    for (const node of nodes) {
      const list = slides.get(node.slide) ?? []
      list.push(...node.paragraphs)
      slides.set(node.slide, list)
    }
    // 隐藏页在大纲里明确标出来：放映时看不到，但编辑时仍要能找到它。
    const meta = new Map(
      ((value.slides as Array<{ index: number; hidden: boolean; notes?: string }>) ?? []).map((item) => [
        item.index,
        item,
      ]),
    )
    const count = Math.max((value.slideCount as number) ?? 0, ...slides.keys(), 0)
    const items: OutlineItem[] = []
    for (let slide = 1; slide <= count; slide += 1) {
      const info = meta.get(slide)
      const title = (slides.get(slide) ?? []).find((text) => text.trim().length > 0) ?? "（空）"
      const marks = [info?.hidden ? "隐藏" : "", info?.notes ? "有备注" : ""].filter(Boolean).join("，")
      items.push({
        level: 1,
        text: "第 " + slide + " 页 · " + title + (marks ? "（" + marks + "）" : ""),
        path: `/slide[${slide}]`,
      })
    }
    return items
  }
  if (format === "pdf") {
    const pages = (value.pages as Array<{ page: number; width: number; height: number }>) ?? []
    const fields = (value.fields as Array<{ name: string }>) ?? []
    const items: OutlineItem[] = pages.map((page) => ({
      level: 1,
      text: `第 ${page.page} 页（${Math.round(page.width)}×${Math.round(page.height)}pt）`,
      path: `/page[${page.page}]`,
    }))
    return [...items, ...fields.map((field) => ({ level: 2, text: "表单字段 " + field.name }))]
  }
  if (format === "html") {
    const blocks = (value.blocks as Array<{ index: number; tag: string; text: string }>) ?? []
    return blocks
      .filter((block) => /^h[1-6]$/i.test(block.tag) && block.text.trim().length > 0)
      .map((block) => ({
        level: Number(block.tag.slice(1)),
        text: block.text,
        path: `/body/p[${block.index}]`,
      }))
  }
  if (format === "legacy") {
    const sheets = (value.sheets as Array<{ name: string }>) ?? []
    if ((value.kind as string) === "spreadsheet" && sheets.length > 0) {
      return sheets.map((sheet) => ({ level: 1, text: sheet.name, path: "/" + sheet.name }))
    }
    return ((value.paragraphs as string[]) ?? [])
      .map((text, index) => ({ level: 1, text, path: `/body/p[${index + 1}]` }))
      .filter((item) => item.text.trim().length > 0)
  }
  // markdown / text：标题就是大纲；纯文本没标题时退回逐行，和 view 一致。
  const text = (value.text as string) ?? ""
  const headings = markdownOutline(text)
  if (headings.length > 0) return headings
  return text
    .split("\n")
    .map((line, index) => ({ level: 1, text: line, line: index + 1 }))
    .filter((item) => item.text.trim().length > 0)
}

/** 给人看的大纲文本：层级用缩进，路径 / 行号跟在后面。 */
export function formatOutline(items: OutlineItem[]): string {
  return items
    .map((item) => {
      const indent = "  ".repeat(Math.max(0, item.level - 1))
      const where = item.path ? "  " + item.path : item.line ? "  第 " + item.line + " 行" : ""
      return indent + item.text + where
    })
    .join("\n")
}
