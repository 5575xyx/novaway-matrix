import * as XLSX from "xlsx"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type Component,
  type JSX,
} from "solid-js"
import { Spinner } from "@novaway/ui/spinner"
import { base64ToBytes } from "@/pages/session/office-file-preview"

// 网格渲染上限:超出部分不渲染(与只读预览定位一致,面板内翻不到那么深)。
const MAX_ROWS = 500
const MAX_COLS = 80
// Excel 默认列宽(8.43 字符)对应的像素,没有 !cols 时用它兜底。
const DEFAULT_COL_WIDTH = 72

type GridCell = {
  value: string
  rowSpan?: number
  colSpan?: number
  covered?: boolean
  style?: JSX.CSSProperties
  /** 有换行样式的单元格用 wrap,其余按 Excel 的"单行 + 截断"呈现。 */
  wrap?: boolean
}
type GridColumn = { width: number; hidden?: boolean }
type GridSheet = {
  name: string
  rows: GridCell[][]
  columns: GridColumn[]
  heights: (number | undefined)[]
}

const columnLabel = (index: number): string => {
  let value = index
  let label = ""
  do {
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return label
}

/** SheetJS 里的颜色是 ARGB/RGB 十六进制,统一转成 CSS。 */
const cssColor = (input: unknown): string | undefined => {
  if (!input || typeof input !== "object") return undefined
  const rgb = (input as { rgb?: unknown }).rgb
  if (typeof rgb !== "string") return undefined
  const hex = rgb.length === 8 ? rgb.slice(2) : rgb.length === 6 ? rgb : undefined
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined
  return `#${hex.toLowerCase()}`
}

/** 判断颜色是否接近黑色:深色主题下这种字色配默认背景会看不见。 */
const isDark = (hex: string | undefined) => {
  if (!hex || hex.length !== 7) return false
  const value = Number.parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.4
}

/**
 * 把单元格样式翻译成 CSS。
 *
 * SheetJS 的 `cell.s` 保留了 xlsx 里显式写过的字体/填充/对齐(`cellStyles: true`),
 * 之前的预览完全不看它 —— 标题行不加粗、金额没有底色、数字不右对齐,
 * 所以一眼就看得出"不是 Excel"。这里尽量按原样还原,只做两件保守的修正:
 * - 没设数字格式的数字用 Excel 的默认右对齐;
 * - 深色主题下不套用纯黑字色(否则字直接消失)。
 */
const cellStyle = (cell: XLSX.CellObject): { style: JSX.CSSProperties; wrap: boolean } => {
  const style: JSX.CSSProperties = {}
  const raw = (cell as { s?: Record<string, any> }).s
  let wrap = false

  const font = raw?.font
  const fill = cssColor(raw?.fill?.fgColor)
  if (font && typeof font === "object") {
    if (font.bold) style["font-weight"] = "600"
    if (font.italic) style["font-style"] = "italic"
    if (font.underline) style["text-decoration"] = "underline"
    if (font.strike) style["text-decoration"] = "line-through"
    if (typeof font.sz === "number" && font.sz > 0 && font.sz !== 11) style["font-size"] = `${font.sz}pt`
    const color = cssColor(font.color)
    // 有底色时尊重原始字色;没底色时跳过硬编码的深色字(主题背景可能也是深的)。
    if (color && (fill || !isDark(color))) style.color = color
  }
  if (fill) style["background-color"] = fill

  const align = raw?.alignment
  const horizontal = typeof align?.horizontal === "string" ? align.horizontal : undefined
  if (horizontal === "center" || horizontal === "centerContinuous") style["text-align"] = "center"
  else if (horizontal === "right") style["text-align"] = "right"
  else if (horizontal === "left") style["text-align"] = "left"
  else if (horizontal === "justify" || horizontal === "distributed") style["text-align"] = "justify"
  else if (cell.t === "n") style["text-align"] = "right"
  else if (cell.t === "b" || cell.t === "e") style["text-align"] = "center"

  const vertical = typeof align?.vertical === "string" ? align.vertical : undefined
  if (vertical === "top") style["vertical-align"] = "top"
  else if (vertical === "center") style["vertical-align"] = "middle"
  else if (vertical === "bottom") style["vertical-align"] = "bottom"

  if (align?.wrapText === true) {
    wrap = true
    style["white-space"] = "pre-wrap"
    style["word-break"] = "break-word"
  }
  return { style, wrap }
}

const cellText = (cell: XLSX.CellObject): string => {
  // 公式单元格优先展示计算值;没有缓存值时回退到公式本身。
  if (cell.v !== undefined && cell.v !== null) {
    if (cell.v instanceof Date) return cell.w ?? cell.v.toLocaleString()
    // cell.w 是 SheetJS 按单元格数字格式渲染好的文本(日期、百分比、千分位、货币都在这)。
    return String(cell.w ?? cell.v)
  }
  if (cell.f) return `=${cell.f}`
  return ""
}
