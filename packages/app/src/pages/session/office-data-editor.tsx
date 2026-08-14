import { createMemo, createSignal, For, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import type { OfficeArtifact } from "./office-artifact"
import { bytesToBase64 } from "./office-export"
import { csvFromRows, xlsxFromRows, type OfficeSpreadsheetCell } from "./office-spreadsheet"

type TableRow = OfficeSpreadsheetCell[]

export function OfficeDataEditor(props: { artifact: OfficeArtifact; onClose: () => void }) {
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const [rows, setRows] = createSignal<TableRow[]>(parseMarkdownTables(props.artifact.body))
  const [csvInput, setCsvInput] = createSignal("")
  const [message, setMessage] = createSignal("")
  const columnCount = createMemo(() => Math.max(1, ...rows().map((row) => row.length)))

  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    setRows((current) =>
      current.map((row, index) =>
        index === rowIndex ? row.map((cell, cellIndex) => (cellIndex === columnIndex ? value : cell)) : row,
      ),
    )
  }

  function addRow() {
    setRows((current) => [...current, Array.from({ length: columnCount() }, () => "")])
  }

  function removeRow(rowIndex: number) {
    setRows((current) => current.filter((_, index) => index !== rowIndex))
  }

  function importCsv() {
    setRows(parseCsvText(csvInput()))
    setMessage("CSV 已导入")
  }

  async function save(kind: "csv" | "xlsx") {
    const data = rows()
    if (data.length === 0) return
    const bytes = kind === "csv" ? new TextEncoder().encode(csvFromRows(data)) : await xlsxFromRows(data)
    const filename = `${props.artifact.title || "数据分析"}.${kind}`
    const result = await globalSDK.client.office.artifact.save({
      directory: sdk.directory,
      kind: "data",
      filename,
      mime: kind === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      contentBase64: bytesToBase64(bytes),
    })
    setMessage(`已保存：${result.data?.path ?? filename}`)
  }

  return (
    <div class="flex max-h-[80vh] w-full max-w-4xl flex-col gap-4 p-5">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-16-medium text-text-strong">表格编辑</div>
          <div class="mt-1 text-12-regular text-text-weak">编辑表格后导出 CSV 或 XLSX</div>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="h-8 rounded-[7px] border border-emerald-300/40 bg-emerald-300/10 px-3 text-12-medium text-emerald-100"
            onClick={() => void save("csv")}
          >
            导出 CSV
          </button>
          <button
            type="button"
            class="h-8 rounded-[7px] border border-emerald-300/40 bg-emerald-300/10 px-3 text-12-medium text-emerald-100"
            onClick={() => void save("xlsx")}
          >
            导出 XLSX
          </button>
          <button
            type="button"
            class="grid size-8 place-items-center rounded-[7px] border border-border-weak-base text-text-weak"
            onClick={props.onClose}
          >
            <Icon name="close" size="small" />
          </button>
        </div>
      </div>

      <div class="overflow-auto rounded-[8px] border border-border-weak-base bg-background-base">
        <table class="w-full min-w-[640px] border-collapse text-12-regular">
          <thead>
            <tr class="bg-surface-raised-base">
              <For each={Array.from({ length: columnCount() })}>
                {(_, index) => (
                  <th class="border-b border-border-weaker-base px-2 py-2 text-left font-medium text-text-strong">
                    {String.fromCharCode(65 + index())}
                  </th>
                )}
              </For>
              <th class="w-10 border-b border-border-weaker-base" />
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(row, rowIndex) => (
                <tr>
                  <For each={Array.from({ length: columnCount() })}>
                    {(_, columnIndex) => (
                      <td class="border-b border-border-weaker-base px-1 py-1">
                        <input
                          value={String(row[columnIndex()] ?? "")}
                          onInput={(event) => updateCell(rowIndex(), columnIndex(), event.currentTarget.value)}
                          class="h-8 w-full min-w-20 rounded-[5px] bg-transparent px-2 text-12-regular text-text-strong outline-none focus:bg-surface-raised-base"
                        />
                      </td>
                    )}
                  </For>
                  <td class="border-b border-border-weaker-base px-1 text-center">
                    <button
                      type="button"
                      class="grid size-7 place-items-center rounded-[6px] text-text-muted hover:text-rose-300"
                      title="删除行"
                      onClick={() => removeRow(rowIndex())}
                    >
                      <Icon name="trash" size="small" />
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="h-8 rounded-[7px] border border-border-weak-base px-3 text-12-medium text-text-weak"
          onClick={addRow}
        >
          添加行
        </button>
        <Show when={message()}>
          <span class="text-11-regular text-emerald-200">{message()}</span>
        </Show>
      </div>

      <div class="rounded-[8px] border border-border-weak-base bg-background-panel/60 p-3">
        <div class="text-12-medium text-text-strong">粘贴 CSV 导入</div>
        <textarea
          value={csvInput()}
          onInput={(event) => setCsvInput(event.currentTarget.value)}
          class="mt-2 min-h-24 w-full resize-y rounded-[7px] border border-border-weaker-base bg-background-base p-3 text-12-regular leading-relaxed text-text-strong outline-none"
          placeholder="列1,列2,列3&#10;值1,值2,值3"
        />
        <button
          type="button"
          class="mt-2 h-8 rounded-[7px] border border-emerald-300/35 bg-emerald-300/10 px-3 text-12-medium text-emerald-100"
          onClick={importCsv}
        >
          导入 CSV
        </button>
      </div>
    </div>
  )
}

function parseMarkdownTables(body: string): TableRow[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n")
  const tables: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("|")) {
      current.push(trimmed)
      continue
    }
    if (current.length > 0) {
      tables.push(current)
      current = []
    }
  }
  if (current.length > 0) tables.push(current)
  const parsed = tables
    .map((table) => table.filter((line) => !/^\|[\s:\-|]+\|?$/.test(line)))
    .map((table) =>
      table.map((line) =>
        line
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim()),
      ),
    )
  return parsed.find((table) => table.length > 0) ?? [["", "", ""]]
}

function parseCsvText(input: string): TableRow[] {
  const result: TableRow[] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"'
        index++
      } else {
        quoted = !quoted
      }
      continue
    }
    if (!quoted && char === ",") {
      row.push(cell)
      cell = ""
      continue
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      row.push(cell)
      if (row.some((value) => value.trim().length > 0)) result.push(row)
      row = []
      cell = ""
      continue
    }
    cell += char
  }
  row.push(cell)
  if (row.some((value) => value.trim().length > 0)) result.push(row)
  return result.length > 0 ? result : [["", "", ""]]
}
