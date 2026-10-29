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

function parseSheet(name: string, sheet: XLSX.WorkSheet): GridSheet {
  if (!sheet || !sheet["!ref"]) return { name, rows: [], columns: [], heights: [] }
  const range = XLSX.utils.decode_range(sheet["!ref"])
  const rowCount = Math.min(range.e.r + 1, MAX_ROWS)
  const colCount = Math.min(range.e.c + 1, MAX_COLS)

  const covered = new Set<string>()
  const spans = new Map<string, { rowSpan: number; colSpan: number }>()
  for (const merge of sheet["!merges"] ?? []) {
    if (merge.s.r >= rowCount || merge.s.c >= colCount) continue
    const rowSpan = Math.min(merge.e.r, rowCount - 1) - merge.s.r + 1
    const colSpan = Math.min(merge.e.c, colCount - 1) - merge.s.c + 1
    spans.set(`${merge.s.r}:${merge.s.c}`, { rowSpan, colSpan })
    for (let r = merge.s.r; r <= Math.min(merge.e.r, rowCount - 1); r++) {
      for (let c = merge.s.c; c <= Math.min(merge.e.c, colCount - 1); c++) {
        if (r === merge.s.r && c === merge.s.c) continue
        covered.add(`${r}:${c}`)
      }
    }
  }

  const columns: GridColumn[] = []
  for (let c = 0; c < colCount; c++) {
    const info = sheet["!cols"]?.[c]
    // wch ≈ 字符数;Excel 的换算大约 1 字符 = 7px + 5px 边距。有 wpx 就用现成的。
    const width =
      typeof info?.wpx === "number"
        ? info.wpx
        : typeof info?.wch === "number"
          ? Math.round(info.wch * 7 + 5)
          : DEFAULT_COL_WIDTH
    columns.push({ width: Math.max(24, Math.min(width, 480)), hidden: info?.hidden === true })
  }

  const heights: (number | undefined)[] = []
  for (let r = 0; r < rowCount; r++) {
    const info = sheet["!rows"]?.[r]
    const height =
      typeof info?.hpx === "number"
        ? info.hpx
        : typeof info?.hpt === "number"
          ? Math.round((info.hpt * 4) / 3)
          : undefined
    heights.push(info?.hidden ? 0 : height)
  }

  const rows: GridCell[][] = []
  for (let r = 0; r < rowCount; r++) {
    const row: GridCell[] = []
    for (let c = 0; c < colCount; c++) {
      if (covered.has(`${r}:${c}`)) {
        row.push({ value: "", covered: true })
        continue
      }
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      const span = spans.get(`${r}:${c}`)
      const parsed = cell ? cellStyle(cell) : { style: {}, wrap: false }
      row.push({
        value: cell ? cellText(cell) : "",
        ...(span ? { rowSpan: span.rowSpan, colSpan: span.colSpan } : {}),
        style: parsed.style,
        wrap: parsed.wrap,
      })
    }
    rows.push(row)
  }
  return { name, rows, columns, heights }
}

async function parseWorkbook(base64: string): Promise<GridSheet[]> {
  const bytes = base64ToBytes(base64)
  // cellStyles = 读取 xlsx 里显式写过的字体/填充/对齐;cellDates = 日期按 Date 解析。
  const workbook = XLSX.read(bytes, { type: "array", cellStyles: true, cellDates: true })
  return workbook.SheetNames.map((name) => parseSheet(name, workbook.Sheets[name]))
}

/**
 * Excel 真实渲染(SheetJS 解析 + 静态网格):列标/行号/合并单元格/列宽行高/
 * 字体与填充/数字格式/对齐/选中高亮/底部 sheet 页,观感对齐 Excel;
 * 不做公式重算与单元格编辑。
 */
export const XlsxFilePreview: Component<{ base64: string }> = (props) => {
  const [sheets] = createResource(() => props.base64, parseWorkbook)
  const [active, setActive] = createSignal(0)
  const [selected, setSelected] = createSignal<{ row: number; col: number }>()

  // 换文件/换 sheet 时复位选中。
  createEffect(
    on(
      () => [props.base64, sheets(), active()] as const,
      () => setSelected(undefined),
    ),
  )

  const sheet = createMemo(() => sheets()?.[active()])
  const rows = createMemo(() => sheet()?.rows ?? [])
  const columns = createMemo(() => sheet()?.columns ?? [])

  onCleanup(() => {
    /* SheetJS 无需手动释放 */
  })

  return (
    <Show
      when={sheets.state === "ready"}
      fallback={
        <Show
          when={!sheets.error}
          fallback={
            <div class="flex h-full items-center justify-center text-12-regular text-foreground-subtle">
              无法解析该表格文件。
            </div>
          }
        >
          <div class="flex h-full items-center justify-center">
            <Spinner class="size-4 text-foreground-subtle" />
          </div>
        </Show>
      }
    >
      <div class="flex h-full min-h-0 flex-col">
        <div class="min-h-0 flex-1 overflow-auto bg-background">
          <table class="border-collapse text-12-regular" data-component="xlsx-grid">
            <colgroup>
              <col style={{ width: "44px" }} />
              <For each={columns()}>
                {(column) => <col style={{ width: `${column.width}px`, display: column.hidden ? "none" : undefined }} />}
              </For>
            </colgroup>
            <thead>
              <tr>
                <th class="sticky top-0 left-0 z-20 border border-border bg-surface px-1 py-1 text-11-regular text-foreground-subtle" />
                <For each={columns()}>
                  {(_, col) => (
                    <th class="sticky top-0 z-10 overflow-hidden border border-border bg-surface px-2 py-1 text-11-regular font-normal text-foreground-subtle">
                      {columnLabel(col())}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(row, rowIndex) => (
                  <tr
                    style={{
                      height:
                        (sheet()?.heights[rowIndex()] ?? 0) > 0 ? `${sheet()!.heights[rowIndex()]}px` : undefined,
                      display: sheet()?.heights[rowIndex()] === 0 ? "none" : undefined,
                    }}
                  >
                    <th class="sticky left-0 z-10 border border-border bg-surface px-1 py-1 text-center text-11-regular font-normal text-foreground-subtle">
                      {rowIndex() + 1}
                    </th>
                    <For each={row}>
                      {(cell, col) => (
                        <Show when={!cell.covered}>
                          <td
                            class="max-w-[480px] overflow-hidden border border-border px-1.5 py-[1px] align-bottom text-foreground"
                            classList={{
                              "bg-selected outline outline-1 -outline-offset-1 outline-icon-blue":
                                selected()?.row === rowIndex() && selected()?.col === col(),
                              "whitespace-nowrap text-ellipsis": !cell.wrap,
                            }}
                            style={cell.style}
                            rowSpan={cell.rowSpan}
                            colSpan={cell.colSpan}
                            title={cell.value || undefined}
                            onClick={() => setSelected({ row: rowIndex(), col: col() })}
                          >
                            <span classList={{ "whitespace-pre-wrap break-words": cell.wrap }}>{cell.value}</span>
                          </td>
                        </Show>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        {/* 底部 sheet 页签(对齐 ZCode / Excel 的 sheet bar)。 */}
        <Show when={(sheets()?.length ?? 0) > 1}>
          <div class="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t border-border px-2 no-scrollbar">
            <For each={sheets()}>
              {(item, index) => (
                <button
                  type="button"
                  class="shrink-0 rounded px-2 py-1 text-ui-xs transition-colors"
                  classList={{
                    "bg-surface font-medium text-foreground": active() === index(),
                    "text-foreground-subtle hover:bg-hover hover:text-foreground": active() !== index(),
                  }}
                  onClick={() => setActive(index())}
                >
                  {item.name}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}
