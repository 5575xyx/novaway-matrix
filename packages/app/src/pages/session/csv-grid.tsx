/**
 * CSV 表格视图：把纯文本 draft 当唯一事实来源。
 *
 * 单元格编辑、插行删行都只重算整份文本（未改动的字段沿用原文，见 core 的
 * `formatCell`），然后交给文本编辑器那条防抖保存 —— 所以表格视图和文本视图
 * 永远看到同一份草稿，不需要第二条写盘通道，也不会互相覆盖。
 */

import { createMemo, createSignal, For, onCleanup, Show, type Component } from "solid-js"
import {
  blankCell,
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  parseCsv,
  serializeCsv,
  setCell,
  tableWidth,
  type CsvCell,
} from "@novaway/core/office/csv/table"
import { indexToColumn } from "@novaway/core/office/engine/contract"
import { rememberScroll, scrollOf } from "@/pages/session/editor-memory"
import { PaneStatusBar } from "@/pages/session/pane-status-bar"

/** 渲染上限：和 XLSX 网格保持一致。 */
const MAX_ROWS = 500
const MAX_COLS = 80

export const CsvGrid: Component<{
  text: string
  path?: string
  onChange: (next: string) => void
  /** 阅读模式：隐藏结构编辑工具栏，双击也不再进入改值。 */
  readOnly?: boolean
}> = (props) => {
  // Parser consumes normalized LF and no BOM; retain both source markers for serialization.
  const hasBom = createMemo(() => props.text.startsWith("﻿"))
  const table = createMemo(() => parseCsv(props.text.replace(/^﻿/, "").replace(/\r\n/g, "\n")))
  const rows = createMemo(() => table().rows)
  const width = createMemo(() => Math.max(1, tableWidth(rows())))
  const eol = createMemo(() => (props.text.includes("\r\n") ? "\r\n" : "\n"))

  const [selected, setSelected] = createSignal<{ row: number; col: number }>()
  const [editing, setEditing] = createSignal<{ row: number; col: number }>()
  const [value, setValue] = createSignal("")
  // 网格缩放百分比：100 = 原始；状态栏是唯一入口（同 Excel）。
  const [zoom, setZoom] = createSignal(100)

  // 表格视图里的改动全部经 props.onChange 落到文本草稿，撤销/重做由面板头部
  // 那一条本地历史栈统一负责（见 file-tabs 的 stepTextHistory），这里不再自己留快照。
  const emit = (next: CsvCell[][]) => {
    const text = serializeCsv(next, table().delimiter, eol(), table().finalNewline)
    const output = (hasBom() ? "﻿" : "") + text
    if (output === props.text) return
    props.onChange(output)
  }

  const startEdit = (row: number, col: number) => {
    if (props.readOnly) return
    setEditing({ row, col })
    setValue(rows()[row]?.[col]?.value ?? "")
  }

  const commit = () => {
    const target = editing()
    setEditing(undefined)
    if (!target) return
    const current = rows()[target.row]?.[target.col]?.value ?? ""
    if (value() === current) return
    setSelected(target)
    emit(setCell(rows(), target.row, target.col, value()))
  }

  const move = (dRow: number, dCol: number) => {
    const from = selected() ?? { row: 0, col: 0 }
    setSelected({
      row: Math.max(0, Math.min(rows().length - 1, from.row + dRow)),
      col: Math.max(0, Math.min(width() - 1, from.col + dCol)),
    })
  }

  const applyStructure = (op: "insertRows" | "deleteRows" | "insertColumns" | "deleteColumns") => {
    const target = selected()
    if (!target) return
    const at = op === "insertRows" || op === "deleteRows" ? target.row : target.col
    const next =
      op === "insertRows"
        ? insertRows(rows(), at, 1)
        : op === "deleteRows"
          ? deleteRows(rows(), at, 1)
          : op === "insertColumns"
            ? insertColumns(rows(), at, 1)
            : deleteColumns(rows(), at, 1)
    emit(next)
    const limit = op === "insertRows" || op === "deleteRows" ? next.length : Math.max(1, tableWidth(next))
    setSelected(
      op === "insertRows" || op === "insertColumns"
        ? target
        : {
            row: Math.max(0, Math.min(next.length - 1, target.row)),
            col: Math.max(0, Math.min(limit - 1, target.col)),
          },
    )
  }

  const cellAt = (row: number, col: number): CsvCell => rows()[row]?.[col] ?? blankCell()
  const rowCount = createMemo(() => Math.min(rows().length, MAX_ROWS) || 1)
  const colCount = createMemo(() => Math.min(width(), MAX_COLS))
  // 切标签会销毁 DOM：滚动位置记在组件外，回来还在原处。
  let gridScroll: HTMLDivElement | undefined
  const rememberGridScroll = () => {
    if (props.path && gridScroll) rememberScroll(props.path, gridScroll.scrollTop, gridScroll.scrollLeft)
  }
  const restoreGridScroll = () => {
    const saved = props.path ? scrollOf(props.path) : undefined
    if (!saved) return
    requestAnimationFrame(() => {
      if (!gridScroll) return
      gridScroll.scrollTop = saved.top
      gridScroll.scrollLeft = saved.left
    })
  }
  onCleanup(rememberGridScroll)

  const indexes = (count: number) => Array.from({ length: count }, (_, index) => index)
  const rowIndexes = createMemo(() => indexes(rowCount()))
  const colIndexes = createMemo(() => indexes(colCount()))

  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <Show when={!props.readOnly}>
        <div class="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
          <span class="mr-1 text-11-regular text-foreground-subtlest">表格</span>
          <For
            each={
              [
                { id: "insertRows" as const, label: "上方插入行", title: "在当前行之前插入一行" },
                { id: "deleteRows" as const, label: "删除行", title: "删除当前行" },
                { id: "insertColumns" as const, label: "左侧插入列", title: "在当前列之前插入一列" },
                { id: "deleteColumns" as const, label: "删除列", title: "删除当前列" },
              ] as const
            }
          >
            {(item) => (
              <button
                type="button"
                data-action={"csv-" + item.id}
                class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                disabled={!selected()}
                title={item.title}
                onClick={() => applyStructure(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
          <span class="ml-auto text-11-regular text-foreground-subtlest">
            {rows().length} 行 × {width()} 列 · 双击改值
          </span>
        </div>
      </Show>
      <div
        ref={(el) => {
          gridScroll = el
          restoreGridScroll()
        }}
        class="min-h-0 flex-1 overflow-auto"
        onScroll={() => rememberGridScroll()}
        style={{ zoom: String(zoom() / 100) }}
      >
        <table class="border-collapse text-12-regular" data-component="csv-grid">
          {/* 索引数组本身当 key：For 按引用去重，一串 undefined 会互相覆盖。 */}
          <colgroup>
            <col style={{ width: "44px" }} />
            <For each={colIndexes()}>{() => <col style={{ width: "120px" }} />}</For>
          </colgroup>
          <thead>
            <tr>
              <th class="sticky top-0 left-0 z-20 border border-border bg-surface px-1 py-1" />
              <For each={colIndexes()}>
                {(col) => (
                  <th class="sticky top-0 z-10 overflow-hidden border border-border bg-surface px-2 py-1 text-11-regular font-normal text-foreground-subtle">
                    {indexToColumn(col)}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={rowIndexes()}>
              {(row) => (
                <tr>
                  <th class="sticky left-0 z-10 border border-border bg-surface px-1 py-1 text-center text-11-regular font-normal text-foreground-subtle">
                    {row + 1}
                  </th>
                  <For each={colIndexes()}>
                    {(col) => (
                      <td
                        class="max-w-[480px] cursor-default overflow-hidden border border-border px-1.5 py-[1px] align-bottom whitespace-nowrap text-ellipsis text-foreground"
                        classList={{
                          "bg-selected outline outline-1 -outline-offset-1 outline-icon-blue":
                            !editing() && selected()?.row === row && selected()?.col === col,
                        }}
                        onClick={() => {
                          setSelected({ row, col })
                          startEdit(row, col)
                        }}
                      >
                        <Show when={editing()?.row === row && editing()?.col === col} fallback={cellAt(row, col).value}>
                          <input
                            class="w-full bg-transparent outline-none"
                            value={value()}
                            autofocus
                            onInput={(event) => setValue(event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault()
                                commit()
                                move(1, 0)
                              }
                              if (event.key === "Tab") {
                                event.preventDefault()
                                commit()
                                move(0, event.shiftKey ? -1 : 1)
                              }
                              if (event.key === "Escape") {
                                event.preventDefault()
                                setEditing(undefined)
                              }
                              event.stopPropagation()
                            }}
                            onBlur={commit}
                          />
                        </Show>
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      {/* 底部状态栏：行列数 + 缩放（同 Excel）。 */}
      <PaneStatusBar
        info={
          <span class="truncate">
            {rows().length} 行 × {width()} 列
          </span>
        }
        zoom={{
          value: () => zoom(),
          onStep: (zoomIn) => setZoom((x) => Math.max(25, Math.min(400, x + (zoomIn ? 10 : -10)))),
          onReset: () => setZoom(100),
        }}
      />
    </div>
  )
}
