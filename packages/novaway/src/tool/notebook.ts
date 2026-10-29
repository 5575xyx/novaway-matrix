/**
 * Jupyter notebook (.ipynb) support, mirroring Claude Code's notebook handling:
 * the read tool renders cells instead of the raw JSON, and `notebook_edit`
 * changes one cell at a time so the model never has to hand-edit the JSON
 * envelope (which is easy to corrupt and expensive in tokens).
 */
export type CellType = "code" | "markdown" | "raw"

export type CellOutput = {
  output_type?: string
  text?: string | string[]
  data?: Record<string, unknown>
  ename?: string
  evalue?: string
  traceback?: string[]
}

export type Cell = {
  cell_type: CellType
  id?: string
  source?: string | string[]
  outputs?: CellOutput[]
  execution_count?: number | null
  metadata?: Record<string, unknown>
}

export type Notebook = {
  cells?: Cell[]
  metadata?: { language_info?: { name?: string } }
  nbformat?: number
  nbformat_minor?: number
} & Record<string, unknown>

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const
/** A single cell whose outputs exceed this is replaced by a pointer hint. */
export const MAX_CELL_OUTPUT_CHARS = 10_000
const MAX_IMAGES = 5
const MAX_IMAGE_BASE64 = 5 * 1024 * 1024

export function parse(text: string): Notebook {
  const value = JSON.parse(text) as unknown
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Notebook is not a JSON object.")
  }
  const notebook = value as Notebook
  if (!Array.isArray(notebook.cells)) {
    throw new Error("Notebook has no cells array.")
  }
  return notebook
}

export function text(value: string | string[] | undefined) {
  if (!value) return ""
  return Array.isArray(value) ? value.join("") : value
}

export function cellID(cell: Cell, index: number) {
  return cell.id ?? `cell-${index}`
}

export function language(notebook: Notebook) {
  return notebook.metadata?.language_info?.name ?? "python"
}

/**
 * `cell-3` style ids are what the read tool emits when a notebook has no
 * per-cell ids (nbformat < 4.5). Accept them as indexes so the model can edit
 * a cell it was shown even then.
 */
export function parseCellID(id: string) {
  const match = id.match(/^cell-(\d+)$/)
  if (!match) return undefined
  const index = Number(match[1])
  return Number.isInteger(index) ? index : undefined
}

export function findCell(notebook: Notebook, id: string) {
  const cells = notebook.cells ?? []
  const byID = cells.findIndex((cell) => cell.id === id)
  if (byID !== -1) return byID
  const index = parseCellID(id)
  if (index === undefined || index < 0 || index >= cells.length) return -1
  return index
}

function outputText(output: CellOutput) {
  switch (output.output_type) {
    case "stream":
      return text(output.text)
    case "execute_result":
    case "display_data":
      return text(output.data?.["text/plain"] as string | string[] | undefined)
    case "error": {
      const head = [output.ename, output.evalue].filter(Boolean).join(": ")
      const trace = output.traceback?.length ? output.traceback.join("\n") : ""
      return [head, trace].filter(Boolean).join("\n")
    }
    default:
      return ""
  }
}

function outputImages(output: CellOutput) {
  const data = output.data
  if (!data) return []
  const result: { mime: string; base64: string }[] = []
  for (const mime of IMAGE_MIMES) {
    const value = data[mime]
    if (typeof value !== "string" || !value) continue
    const base64 = value.replace(/\s/g, "")
    if (base64.length > MAX_IMAGE_BASE64) continue
    result.push({ mime, base64 })
  }
  return result
}

export type Rendered = {
  text: string
  truncated: boolean
  images: { mime: string; base64: string }[]
}

/**
 * Render the cells as text the model can reason about and refer back to by id.
 * Outputs are included (streams, results, tracebacks, image markers) but each
 * cell is capped: a huge DataFrame dump would otherwise crowd out the code.
 */
export function render(notebook: Notebook, opts: { filePath: string; maxBytes: number }): Rendered {
  const cells = notebook.cells ?? []
  const lang = language(notebook)
  const lines: string[] = ["<cells>"]
  const images: { mime: string; base64: string }[] = []
  let bytes = 0
  let shown = 0
  let truncated = false

  for (const [index, cell] of cells.entries()) {
    const id = cellID(cell, index)
    const source = text(cell.source)
    const attrs = [`id="${id}"`, `type="${cell.cell_type}"`]
    if (cell.cell_type === "code") {
      attrs.push(`language="${lang}"`)
      if (typeof cell.execution_count === "number") attrs.push(`execution_count="${cell.execution_count}"`)
    }

    const outputs = (cell.outputs ?? []).filter((item) => item && typeof item === "object")
    const rendered = outputs.map(outputText).filter((item) => item.length > 0)
    const outputChars = rendered.reduce((sum, item) => sum + item.length, 0)
    const cellImages = outputs.flatMap(outputImages)
    const bigOutputs = outputChars > MAX_CELL_OUTPUT_CHARS

    const chunk: string[] = [`<cell ${attrs.join(" ")}>`, source, "</cell>"]
    if (bigOutputs) {
      chunk.push(
        `<output cell="${id}">(Outputs are too large to include. Read them with the shell tool: ` +
          `\`jq '.cells[${index}].outputs' "${opts.filePath}"\`)</output>`,
      )
    } else if (rendered.length > 0) {
      chunk.push(`<output cell="${id}">`, rendered.join("\n"), "</output>")
    }
    for (const image of cellImages) {
      chunk.push(`<image cell="${id}" mime="${image.mime}" />`)
      if (images.length < MAX_IMAGES) images.push(image)
    }

    const block = chunk.join("\n")
    const size = Buffer.byteLength(block, "utf-8") + 1
    if (bytes + size > opts.maxBytes) {
      truncated = true
      break
    }
    bytes += size
    shown++
    lines.push(block)
  }

  lines.push("</cells>")
  if (truncated) {
    lines.push(
      `\n(Notebook truncated: showing ${shown} of ${cells.length} cells. Read the remaining cells with the shell tool, ` +
        `e.g. \`jq '.cells[${shown}:]' "${opts.filePath}"\`.)`,
    )
  } else {
    lines.push(`\n(${cells.length} cells)`)
  }

  return { text: lines.join("\n"), truncated, images }
}

/** Jupyter writes notebooks with one-space indentation and a trailing newline. */
export function serialize(notebook: Notebook, opts: { trailingNewline: boolean; lineEnding: string }) {
  const text = JSON.stringify(notebook, null, 1)
  const next = opts.trailingNewline ? text + "\n" : text
  return opts.lineEnding === "\r\n" ? next.replaceAll("\n", "\r\n") : next
}

export function hasTrailingNewline(text: string) {
  return /\r?\n$/.test(text)
}

export function detectLineEnding(text: string) {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

export * as Notebook from "./notebook"
