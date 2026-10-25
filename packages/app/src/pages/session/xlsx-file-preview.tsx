import * as XLSX from "xlsx"
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show, type Component } from "solid-js"
import { Spinner } from "@novaway/ui/spinner"
import { base64ToBytes } from "@/pages/session/office-file-preview"

// 网格渲染上限:超出部分不渲染(与只读预览定位一致,面板内翻不到那么深)。
const MAX_ROWS = 500
const MAX_COLS = 80

type GridCell = { value: string; rowSpan?: number; colSpan?: number; covered?: boolean }
type GridSheet = { name: string; rows: GridCell[][] }

const columnLabel = (index: number): string => {
  let value = index
  let label = ""
  do {
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return label
}

async function parseWorkbook(base64: string): Promise<GridSheet[]> {
  const bytes = base64ToBytes(base64)
  const workbook = XLSX.read(bytes, { type: "array" })
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    if (!sheet || !sheet["!ref"]) return { name, rows: [] as GridCell[][] }
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
        const display = cell ? cellText(cell) : ""
        row.push({
          value: display,
          ...(span ? { rowSpan: span.rowSpan, colSpan: span.colSpan } : {}),
        })
      }
      rows.push(row)
    }
    return { name, rows }
  })
}

const cellText = (cell: XLSX.CellObject): string => {
  // 公式单元格优先展示计算值;没有缓存值时回退到公式本身。
  if (cell.v !== undefined && cell.v !== null) {
    if (cell.t === "d" && cell.v instanceof Date) return cell.v.toLocaleString()
    return String(cell.w ?? cell.v)
  }
  if (cell.f) return `=${cell.f}`
  return ""
}

/**
 * Excel 真实渲染(SheetJS 解析 + 静态网格):列标/行号/合并单元格/选中高亮/底部 sheet 页,
 * 观感对齐 ZCode 的 XlsxView;不做公式重算与单元格编辑。
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

  const rows = createMemo(() => sheets()?.[active()]?.rows ?? [])

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
        <div class="min-h-0 flex-1 overflow-auto">
          <table class="border-collapse text-12-regular" data-component="xlsx-grid">
            <thead>
              <tr>
                <th class="sticky top-0 left-0 z-20 min-w-9 border border-border bg-surface px-1 py-1 text-11-regular text-foreground-subtle" />
                <For each={rows()[0]}>
                  {(_, col) => (
                    <th class="sticky top-0 z-10 min-w-24 max-w-72 border border-border bg-surface px-2 py-1 text-11-regular font-medium text-foreground-subtle">
                      {columnLabel(col())}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(row, rowIndex) => (
                  <tr>
                    <th class="sticky left-0 z-10 min-w-9 border border-border bg-surface px-1 py-1 text-center text-11-regular font-medium text-foreground-subtle">
                      {rowIndex() + 1}
                    </th>
                    <For each={row}>
                      {(cell, col) => (
                        <Show when={!cell.covered}>
                          <td
                            class="max-w-72 border border-border px-2 py-1 align-top text-foreground"
                            classList={{
                              "bg-selected outline outline-1 -outline-offset-1 outline-icon-blue":
                                selected()?.row === rowIndex() && selected()?.col === col(),
                            }}
                            rowSpan={cell.rowSpan}
                            colSpan={cell.colSpan}
                            onClick={() => setSelected({ row: rowIndex(), col: col() })}
                          >
                            <span class="line-clamp-6 whitespace-pre-wrap break-words">{cell.value}</span>
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
              {(sheet, index) => (
                <button
                  type="button"
                  class="shrink-0 rounded px-2 py-1 text-ui-xs transition-colors"
                  classList={{
                    "bg-surface font-medium text-foreground": active() === index(),
                    "text-foreground-subtle hover:bg-hover hover:text-foreground": active() !== index(),
                  }}
                  onClick={() => setActive(index())}
                >
                  {sheet.name}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}
