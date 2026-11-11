/**
 * 把文档排成 PDF（引擎级导出）。
 *
 * 四个编辑器都能「导出 PDF / 打印」，因为它们共用同一个 PDF 写出器。
 * 这里补上同一条能力：把引擎已经算好的「可编辑视图」直接排成一页页纸，
 * 不依赖浏览器、不依赖桌面端 —— CLI 的 `export a.docx a.pdf` 和桌面端的
 * 打印走的是同一份状态，所以三端看到的内容一致。
 *
 * 排版策略是「够用且可预测」：
 *   - A4（可换 A3 / Letter），四边 64 pt 页边距；
 *   - 西文用 Helvetica，中文走 PDF 预定义 CID 字体（不嵌字体、不增体积）；
 *   - 标题按命名样式给字号，正文 11 pt、行距 1.45，表格按内容宽度分列；
 *   - 演示文稿一页一张幻灯片，页面尺寸就用幻灯片自己的尺寸，
 *     形状里的文字按文本框坐标落位。
 *
 * 这一层只读 state，不改文件，所以导出可以随手做、失败了也不脏原文件。
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import type { OfficeFormat } from "../engine/contract"
import { drawCjkLines, needsCjk } from "./cjk-font"

export type PdfPaper = "A4" | "A3" | "Letter"

/** 文档里的一张图：`after` 是这个图片所在的段落序号（0 起，画在该段之后）。 */
export type PrintImage = {
  after: number
  data: Uint8Array
  mime: string
  /** pt */
  width?: number
  height?: number
}

/** 幻灯片上的一张图：按页号放到它的占位框里（pt，左上角原点）。 */
export type PrintSlideImage = {
  /** 1 起的页号（演示顺序）。 */
  slide: number
  data: Uint8Array
  mime: string
  box?: { x: number; y: number; w: number; h: number }
}

export type PrintOptions = {
  /** 纸张；默认 A4。 */
  paper?: PdfPaper
  /** 页脚备注（DOCX 的页脚文字），画在页码上方。 */
  footerNote?: string
  /** 正文插图（DOCX 的 word/media）。 */
  images?: readonly PrintImage[]
  /** 幻灯片插图（PPTX 的 ppt/media）：按占位框等比缩放。 */
  slideImages?: readonly PrintSlideImage[]
}

type Metrics = { width: number; height: number; top: number; right: number; bottom: number; left: number }

const PAPERS: Record<PdfPaper, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  A3: { width: 841.89, height: 1190.55 },
  Letter: { width: 612, height: 792 },
}

function metricsOf(paper: PdfPaper = "A4"): Metrics {
  const size = PAPERS[paper] ?? PAPERS.A4
  return { width: size.width, height: size.height, top: 64, right: 64, bottom: 64, left: 64 }
}

type Align = "left" | "center" | "right"

type Block =
  | {
      kind: "text"
      text: string
      size?: number
      bold?: boolean
      color?: string
      align?: Align
      /** 左缩进，pt */
      indent?: number
      before?: number
      after?: number
      /** 行距倍数（相对字号），默认 1.45。 */
      lineHeight?: number
    }
  | { kind: "rule"; before?: number; after?: number }
  | { kind: "space"; height: number }
  | { kind: "pageBreak" }
  | {
      kind: "table"
      rows: string[][]
      /** 首行是否当表头（加粗 + 浅底）。 */
      header?: boolean
      size?: number
      before?: number
      after?: number
    }
  | {
      kind: "image"
      data: Uint8Array
      mime: string
      /** 期望显示尺寸（pt）；省略就按图片原始像素 / 96 dpi 换算。 */
      width?: number
      height?: number
      /** 说明文字（WMF / EMF 这类画不出来的图改用它）。 */
      caption?: string
      before?: number
      after?: number
    }

function colorOf(hex: string | undefined) {
  const fallback = rgb(0.1, 0.1, 0.1)
  if (!hex) return fallback
  const value = hex.replace(/^#/, "")
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return fallback
  return rgb(
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  )
}

function wide(char: string): boolean {
  return (char.codePointAt(0) ?? 0) > 0xff
}

/** 单行文字的宽度（中文按 1 em，其它交给 Helvetica 的实际字宽）。 */
function measure(text: string, size: number, font: PDFFont): number {
  let total = 0
  for (const char of text) total += wide(char) ? size : font.widthOfTextAtSize(char, size)
  return total
}

/** 断行：中文逐字可断，西文优先在空格处断；超长单词硬断。 */
function wrapText(text: string, size: number, maxWidth: number, font: PDFFont): string[] {
  if (text === "") return [""]
  const lines: string[] = []
  let line = ""
  let lineWidth = 0
  const flush = () => {
    lines.push(line)
    line = ""
    lineWidth = 0
  }
  const tokens: string[] = []
  let latin = ""
  for (const char of text) {
    if (wide(char) || char === " ") {
      if (latin !== "") {
        tokens.push(latin)
        latin = ""
      }
      tokens.push(char)
    } else {
      latin += char
    }
  }
  if (latin !== "") tokens.push(latin)

  for (const token of tokens) {
    const tokenWidth = measure(token, size, font)
    if (token === " " && line === "") continue
    if (lineWidth + tokenWidth <= maxWidth || line === "") {
      // 单个 token 本身就超宽：按字符硬断。
      if (token !== " " && tokenWidth > maxWidth) {
        for (const char of token) {
          const width = measure(char, size, font)
          if (line !== "" && lineWidth + width > maxWidth) flush()
          line += char
          lineWidth += width
        }
        continue
      }
      line += token
      lineWidth += tokenWidth
      continue
    }
    if (token === " ") {
      flush()
      continue
    }
    flush()
    line = token
    lineWidth = tokenWidth
  }
  if (line !== "" || lines.length === 0) lines.push(line)
  return lines
}
type Fonts = { regular: PDFFont; bold: PDFFont }

/** 绝对定位画一行（表格单元格、幻灯片文本框都用它）。 */
function paintLine(
  page: PDFPage,
  doc: PDFDocument,
  text: string,
  x: number,
  top: number,
  size: number,
  bold: boolean,
  color: string | undefined,
  fonts: Fonts,
) {
  if (text === "") return
  const font = bold ? fonts.bold : fonts.regular
  const y = page.getHeight() - top - size
  if (needsCjk(text)) {
    drawCjkLines(page, doc, { text, x, top, size, ...(color ? { color } : {}) })
    return
  }
  try {
    page.drawText(text, { x, y, size, font, color: colorOf(color) })
  } catch {
    // WinAnsi 之外的字符（个别符号）退回 CID 字体，至少不会整页失败。
    drawCjkLines(page, doc, { text, x, top, size, ...(color ? { color } : {}) })
  }
}

/** 一页一页写；负责分页、页边距和页码。 */
class Writer {
  readonly pages: PDFPage[] = []
  readonly labels: string[] = []
  private current!: PDFPage
  private cursor = 0
  private footerNote?: string
  private headerNote?: string

  constructor(
    private readonly doc: PDFDocument,
    private readonly metrics: Metrics,
    private readonly fonts: Fonts,
    private readonly label: (page: number) => string = () => "",
  ) {
    this.breakPage()
  }

  get contentWidth(): number {
    return this.metrics.width - this.metrics.left - this.metrics.right
  }

  get left(): number {
    return this.metrics.left
  }

  get top(): number {
    return this.metrics.top
  }

  setFooterNote(note: string | undefined) {
    this.footerNote = note && note.trim() !== "" ? note.trim() : undefined
  }

  setHeaderNote(note: string | undefined) {
    this.headerNote = note && note.trim() !== "" ? note.trim() : undefined
  }

  breakPage() {
    this.current = this.doc.addPage([this.metrics.width, this.metrics.height])
    this.pages.push(this.current)
    this.labels.push(this.label(this.pages.length))
    this.cursor = this.metrics.top
  }

  private ensure(height: number) {
    if (this.cursor + height > this.metrics.height - this.metrics.bottom) this.breakPage()
  }

  /** 在给定的「从上往下」的 y 处画一行，不推进光标。 */
  private drawLine(text: string, x: number, top: number, size: number, bold: boolean, color?: string) {
    paintLine(this.current, this.doc, text, x, top, size, bold, color, this.fonts)
  }

  text(block: Extract<Block, { kind: "text" }>) {
    const size = block.size ?? 11
    const lineHeight = size * (block.lineHeight ?? 1.45)
    const indent = block.indent ?? 0
    const width = Math.max(20, this.contentWidth - indent)
    const lines = wrapText(block.text, size, width, block.bold ? this.fonts.bold : this.fonts.regular)
    this.cursor += block.before ?? 0
    for (const line of lines) {
      this.ensure(lineHeight)
      const lineWidth = measure(line, size, block.bold ? this.fonts.bold : this.fonts.regular)
      const align = block.align ?? "left"
      const offset = align === "center" ? (width - lineWidth) / 2 : align === "right" ? width - lineWidth : 0
      this.drawLine(line, this.left + indent + Math.max(0, offset), this.cursor, size, block.bold === true, block.color)
      this.cursor += lineHeight
    }
    this.cursor += block.after ?? 0
  }

  rule(block: Extract<Block, { kind: "rule" }>) {
    this.cursor += block.before ?? 6
    this.ensure(6)
    this.current.drawLine({
      start: { x: this.left, y: this.metrics.height - this.cursor },
      end: { x: this.left + this.contentWidth, y: this.metrics.height - this.cursor },
      thickness: 0.6,
      color: rgb(0.78, 0.8, 0.84),
    })
    this.cursor += 6 + (block.after ?? 6)
  }

  space(height: number) {
    this.cursor += height
  }

  /**
   * 插图：优先按「文档里标的尺寸」画，放不下就等比缩到页宽 / 页高。
   *
   * PNG / JPEG 直接嵌入；GIF、WMF、EMF 这类 pdf-lib 画不了的格式留一行说明
   * —— 和面板里的占位一致，至少不会让人以为图片被弄丢了。
   */
  async image(block: Extract<Block, { kind: "image" }>) {
    this.cursor += block.before ?? 0
    // 有说明文字时先写一行，再照常画图（说明不是「替代」）。
    if (block.caption) this.text({ kind: "text", text: block.caption, size: 9, color: "8A8F98", after: 2 })
    const embedded = await this.embed(block)
    if (!embedded) {
      this.text({
        kind: "text",
        text: "（这张图片的格式暂不支持排版：GIF / WMF / EMF）",
        size: 9,
        color: "8A8F98",
        after: 2,
      })
      return
    }
    const natural = embedded.scale(1)
    // 没标尺寸就按 96 dpi 换算（1 px → 0.75 pt），和 Word 的默认显示接近。
    let width = block.width ?? natural.width * 0.75
    let height = block.height ?? natural.height * 0.75
    // 只标了一个方向时保等比，别把图拉扁。
    if (block.width !== undefined && block.height === undefined && natural.width > 0) {
      height = (block.width * natural.height) / natural.width
    } else if (block.height !== undefined && block.width === undefined && natural.height > 0) {
      width = (block.height * natural.width) / natural.height
    }
    const maxWidth = this.contentWidth
    const maxHeight = this.metrics.height - this.metrics.top - this.metrics.bottom
    if (width > maxWidth) {
      height = (height * maxWidth) / width
      width = maxWidth
    }
    if (height > maxHeight) {
      width = (width * maxHeight) / height
      height = maxHeight
    }
    // 页面剩余空间不够就换页，不让图片被裁掉。
    this.ensure(height)
    this.current.drawImage(embedded, {
      x: this.left + Math.max(0, (this.contentWidth - width) / 2),
      y: this.metrics.height - this.cursor - height,
      width,
      height,
    })
    this.cursor += height + (block.after ?? 6)
  }

  private async embed(block: Extract<Block, { kind: "image" }>) {
    const mime = block.mime.toLowerCase()
    try {
      if (mime === "image/png") return await this.doc.embedPng(block.data)
      if (mime === "image/jpeg" || mime === "image/jpg") return await this.doc.embedJpg(block.data)
    } catch {
      return undefined
    }
    return undefined
  }

  table(block: Extract<Block, { kind: "table" }>) {
    const rows = block.rows.filter((row) => row.some((cell) => cell.trim() !== ""))
    if (rows.length === 0) return
    const size = block.size ?? 9
    const columns = Math.max(...rows.map((row) => row.length))
    const chars = Array.from({ length: columns }, (_, index) =>
      Math.min(
        46,
        Math.max(6, ...rows.map((row) => [...(row[index] ?? "")].reduce((sum, char) => sum + (wide(char) ? 2 : 1), 0))),
      ),
    )
    const total = chars.reduce((sum, value) => sum + value, 0) || 1
    const widths = chars.map((value) => (value / total) * this.contentWidth)
    const rowHeight = Math.max(14, size * 1.7)
    this.cursor += block.before ?? 0

    rows.forEach((row, rowIndex) => {
      this.ensure(rowHeight)
      const top = this.cursor
      const isHeader = block.header === true && rowIndex === 0
      if (isHeader) {
        this.current.drawRectangle({
          x: this.left,
          y: this.metrics.height - top - rowHeight,
          width: this.contentWidth,
          height: rowHeight,
          color: rgb(0.94, 0.95, 0.97),
        })
      }
      let x = this.left
      for (let column = 0; column < columns; column += 1) {
        const width = widths[column] ?? 0
        this.current.drawRectangle({
          x,
          y: this.metrics.height - top - rowHeight,
          width,
          height: rowHeight,
          borderColor: rgb(0.82, 0.84, 0.88),
          borderWidth: 0.5,
        })
        const cell = fitCell(row[column] ?? "", size, this.fonts.regular, width - 8)
        this.drawLine(cell, x + 4, top + (rowHeight - size) / 2, size, isHeader, undefined)
        x += width
      }
      this.cursor = top + rowHeight
    })
    this.cursor += block.after ?? 0
  }

  labelCurrent(text: string) {
    if (this.labels.length > 0) this.labels[this.labels.length - 1] = text
  }

  /** 所有页写完后再补页码：这样「共 N 页」才是准的。 */
  stamp() {
    const total = this.pages.length
    this.pages.forEach((page, index) => {
      const label = this.labels[index] ?? ""
      const footnote = this.footerNote ? this.footerNote + "    " : ""
      const text = `${footnote}${label}${label ? " · " : ""}第 ${index + 1} / ${total} 页`
      const size = 8
      const width = measure(text, size, this.fonts.regular)
      const x = Math.max(24, (this.metrics.width - width) / 2)
      drawCjkLines(page, this.doc, {
        text,
        x,
        top: this.metrics.height - this.metrics.bottom + 26,
        size,
        color: "8A8F98",
      })
      if (this.headerNote) {
        drawCjkLines(page, this.doc, {
          text: this.headerNote,
          x: this.metrics.left,
          top: this.metrics.top - 30,
          size: 8,
          color: "8A8F98",
        })
        page.drawLine({
          start: { x: this.metrics.left, y: this.metrics.height - this.metrics.top + 14 },
          end: { x: this.metrics.width - this.metrics.right, y: this.metrics.height - this.metrics.top + 14 },
          thickness: 0.5,
          color: rgb(0.86, 0.88, 0.9),
        })
      }
    })
  }
}

/** 单元格放不下就截断加省略号（表格里换行会破坏行高的一致性）。 */
function fitCell(text: string, size: number, font: PDFFont, maxWidth: number): string {
  if (measure(text, size, font) <= maxWidth) return text
  const chars = [...text]
  let result = ""
  let width = 0
  for (const char of chars) {
    const next = width + (wide(char) ? size : font.widthOfTextAtSize(char, size))
    if (next > maxWidth - size * 0.9) break
    result += char
    width = next
  }
  return result + "…"
}

async function writeBlocks(writer: Writer, blocks: Block[]) {
  for (const block of blocks) {
    if (block.kind === "text") writer.text(block)
    else if (block.kind === "rule") writer.rule(block)
    else if (block.kind === "space") writer.space(block.height)
    else if (block.kind === "table") writer.table(block)
    else if (block.kind === "image") await writer.image(block)
    else writer.breakPage()
  }
}

// ---------------------------------------------------------------------------
// 各格式的段落模型 → 排版块
// ---------------------------------------------------------------------------

const HEADING_SIZES = [0, 18, 15, 13, 12, 11, 11]

/** 命名样式 → 标题层级（Title 单独处理成居中的大标题）。 */
function namedStyle(style: string | undefined): { level: number; title: boolean } | undefined {
  const value = (style ?? "").trim()
  if (value === "") return undefined
  if (/^title$/i.test(value) || value === "标题") return { level: 0, title: true }
  const match = /^(?:heading|标题)[ \t]*([1-9])$/i.exec(value)
  if (!match) return undefined
  return { level: Number(match[1]), title: false }
}

function alignOf(value: string | undefined): Align {
  if (value === "center" || value === "ctr") return "center"
  if (value === "right" || value === "r") return "right"
  return "left"
}

function imageBlock(image: PrintImage): Block {
  return {
    kind: "image",
    data: image.data,
    mime: image.mime,
    ...(image.width === undefined ? {} : { width: image.width }),
    ...(image.height === undefined ? {} : { height: image.height }),
    before: 4,
    after: 6,
  }
}

function docxBlocks(
  state: {
    paragraphs: Array<{
      index: number
      text: string
      style?: string
      align?: string
      bold?: boolean
      size?: number
      color?: string
      lineSpacing?: number
      inTable?: boolean
      list?: { kind: "bullet" | "number"; level: number }
    }>
  },
  images: readonly PrintImage[] = [],
): Block[] {
  const blocks: Block[] = []
  const byParagraph = new Map<number, PrintImage[]>()
  for (const image of images) {
    const list = byParagraph.get(image.after) ?? []
    list.push(image)
    byParagraph.set(image.after, list)
  }
  // 没有段落归属的图（游离的 drawing）画在最前面，不静默丢掉。
  const leading = byParagraph.get(-1) ?? []
  for (const image of leading) blocks.push(imageBlock(image))
  let inTableRun = false
  let listCounter = 0
  let lastList = false
  for (const paragraph of state.paragraphs) {
    for (const image of byParagraph.get(paragraph.index) ?? []) blocks.push(imageBlock(image))
    if (paragraph.inTable) {
      if (!inTableRun) {
        blocks.push({ kind: "rule", before: 4, after: 2 })
        inTableRun = true
      }
      blocks.push({
        kind: "text",
        text: paragraph.text,
        size: 10,
        indent: 12,
        color: "374151",
        lineHeight: 1.3,
        after: 1,
      })
      continue
    }
    inTableRun = false
    if (paragraph.text.trim() === "") {
      blocks.push({ kind: "space", height: 6 })
      lastList = false
      continue
    }
    const named = namedStyle(paragraph.style)
    const headingSize = named && !named.title ? HEADING_SIZES[Math.min(named.level, 6)] : undefined
    const size = paragraph.size ?? (named?.title ? 22 : (headingSize ?? 11))
    let text = paragraph.text
    if (paragraph.list) {
      listCounter = lastList && paragraph.list.kind === "number" ? listCounter + 1 : 1
      text = (paragraph.list.kind === "bullet" ? "• " : `${listCounter}. `) + text
      lastList = true
    } else {
      lastList = false
    }
    blocks.push({
      kind: "text",
      text,
      size,
      bold: paragraph.bold ?? (named !== undefined && named.level > 0),
      ...(paragraph.color ? { color: paragraph.color } : {}),
      ...(named?.title ? { align: "center" as Align } : { align: alignOf(paragraph.align) }),
      indent: paragraph.list ? 12 * ((paragraph.list.level ?? 0) + 1) : 0,
      before: named ? (named.title ? 10 : 12) : 0,
      after: named ? 6 : 4,
      lineHeight: paragraph.lineSpacing ?? 1.45,
    })
  }
  return blocks
}

type SheetGrid = {
  name: string
  cells: Array<{ row: number; col: number; text: string }>
  lastRow: number
  lastCol: number
}

/** 宽表按 8 列一段切，避免 50 列挤成一团看不清。 */
function sheetBlocks(sheet: SheetGrid): Block[] {
  const blocks: Block[] = []
  if (sheet.lastRow < 0 || sheet.lastCol < 0) {
    blocks.push({ kind: "text", text: "（空工作表）", size: 10, color: "8A8F98" })
    return blocks
  }
  const rows: string[][] = Array.from({ length: sheet.lastRow + 1 }, () =>
    Array.from({ length: sheet.lastCol + 1 }, () => ""),
  )
  for (const cell of sheet.cells) {
    if (cell.row > sheet.lastRow || cell.col > sheet.lastCol) continue
    const row = rows[cell.row]
    if (row) row[cell.col] = cell.text
  }
  const CHUNK = 8
  for (let start = 0; start <= sheet.lastCol; start += CHUNK) {
    const end = Math.min(sheet.lastCol, start + CHUNK - 1)
    if (start > 0) {
      blocks.push({ kind: "text", text: `（续）第 ${start + 1}–${end + 1} 列`, size: 9, color: "6B7280", before: 10 })
    }
    blocks.push({
      kind: "table",
      rows: rows.map((row) => row.slice(start, end + 1)),
      size: 9,
      after: 10,
    })
  }
  return blocks
}

function csvBlocks(rows: Array<Array<{ value: string }>>): Block[] {
  const grid = rows.map((row) => row.map((cell) => cell.value ?? ""))
  const columns = grid.reduce((max, row) => Math.max(max, row.length), 0)
  if (columns === 0) return [{ kind: "text", text: "（空表格）", size: 10, color: "8A8F98" }]
  return [
    {
      kind: "table",
      rows: grid.map((row) => Array.from({ length: columns }, (_, index) => row[index] ?? "")),
      size: 9,
    },
  ]
}

/** 行内 Markdown 标记 → 纯文字（打印时不需要 `**` 这些符号）。 */
function inlineText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_match, alt: string) => (alt ? `[图片：${alt}]` : "[图片]"))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => `${label}（${href}）`)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/<[^>]+>/g, "")
}

function markdownBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.split(/\r?\n/)
  let index = 0
  // front matter 不打印。
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((line, position) => position > 0 && line.trim() === "---")
    if (close > 0) index = close + 1
  }
  let inCode = false
  let codeLines: string[] = []
  const flushCode = () => {
    if (codeLines.length === 0) return
    for (const line of codeLines) {
      blocks.push({
        kind: "text",
        text: line === "" ? " " : line,
        size: 9,
        indent: 10,
        color: "374151",
        lineHeight: 1.25,
      })
    }
    blocks.push({ kind: "space", height: 6 })
    codeLines = []
  }
  for (; index < lines.length; index += 1) {
    const line = lines[index]!
    if (/^\s*(```|~~~)/.test(line)) {
      if (inCode) flushCode()
      inCode = !inCode
      continue
    }
    if (inCode) {
      codeLines.push(line)
      continue
    }
    if (line.trim() === "") {
      blocks.push({ kind: "space", height: 6 })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      blocks.push({
        kind: "text",
        text: inlineText(heading[2]!),
        size: HEADING_SIZES[Math.min(level, 6)]! + 2,
        bold: true,
        before: 12,
        after: 4,
        lineHeight: 1.3,
      })
      continue
    }
    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: "rule" })
      continue
    }
    // 表格：连续的 | 行，第二行是分隔行。
    if (/^\s*\|/.test(line)) {
      const tableRows: string[][] = []
      let cursor = index
      while (cursor < lines.length && /^\s*\|/.test(lines[cursor]!)) {
        const row = lines[cursor]!.trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => inlineText(cell.trim()))
        if (!row.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === "")) tableRows.push(row)
        cursor += 1
      }
      index = cursor - 1
      if (tableRows.length > 0)
        blocks.push({ kind: "table", rows: tableRows, header: true, size: 9, before: 4, after: 8 })
      continue
    }
    const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line)
    if (task) {
      blocks.push({
        kind: "text",
        text: `${task[1]!.toLowerCase() === "x" ? "☑" : "☐"} ${inlineText(task[2]!)}`,
        indent: 12,
      })
      continue
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      blocks.push({ kind: "text", text: "• " + inlineText(bullet[1]!), indent: 12 })
      continue
    }
    const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
    if (ordered) {
      blocks.push({ kind: "text", text: `${ordered[1]}. ${inlineText(ordered[2]!)}`, indent: 12 })
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      blocks.push({ kind: "text", text: inlineText(quote[1]!), indent: 14, color: "4B5563" })
      continue
    }
    blocks.push({ kind: "text", text: inlineText(line), lineHeight: 1.5 })
  }
  flushCode()
  return blocks
}

function textBlocks(text: string, size = 10): Block[] {
  const blocks: Block[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line === "") blocks.push({ kind: "space", height: size * 0.9 })
    else blocks.push({ kind: "text", text: line.replace(/ +$/, ""), size, lineHeight: 1.4 })
  }
  return blocks
}

function htmlBlocks(state: {
  blocks: Array<{ tag: string; text: string; align?: string; list?: "ul" | "ol"; lineHeight?: number }>
}): Block[] {
  const blocks: Block[] = []
  for (const block of state.blocks) {
    const text = block.text.replace(/\r/g, "")
    if (text.trim() === "") {
      blocks.push({ kind: "space", height: 6 })
      continue
    }
    const heading = /^h([1-6])$/.exec(block.tag)
    if (heading) {
      const level = Number(heading[1])
      blocks.push({
        kind: "text",
        text,
        size: HEADING_SIZES[Math.min(level, 6)]! + 2,
        bold: true,
        before: 12,
        after: 4,
        lineHeight: 1.3,
      })
      continue
    }
    if (block.tag === "li") {
      blocks.push({
        kind: "text",
        text: "• " + text,
        indent: 14,
        align: alignOf(block.align),
        lineHeight: block.lineHeight ?? 1.45,
      })
      continue
    }
    if (block.tag === "blockquote") {
      blocks.push({ kind: "text", text, indent: 16, color: "4B5563", align: alignOf(block.align) })
      continue
    }
    if (block.tag === "pre") {
      for (const line of text.split("\n")) {
        blocks.push({
          kind: "text",
          text: line === "" ? " " : line,
          size: 9,
          indent: 10,
          color: "374151",
          lineHeight: 1.25,
        })
      }
      continue
    }
    blocks.push({
      kind: "text",
      text,
      align: alignOf(block.align),
      ...(block.lineHeight ? { lineHeight: block.lineHeight } : {}),
    })
  }
  return blocks
}

function legacyBlocks(state: {
  kind: string
  text: string
  paragraphs: string[]
  sheets: Array<{ name: string; rows: string[][] }>
}): Block[] {
  if (state.kind === "spreadsheet") {
    const blocks: Block[] = []
    for (const sheet of state.sheets) {
      blocks.push({ kind: "text", text: sheet.name, size: 13, bold: true, before: 10, after: 4 })
      blocks.push({ kind: "table", rows: sheet.rows, size: 9, after: 10 })
    }
    return blocks.length > 0 ? blocks : textBlocks(state.text)
  }
  if (state.paragraphs.length > 0) {
    return state.paragraphs.map((text, index) => {
      if (text.trim() === "") return { kind: "space", height: 6 } as Block
      return { kind: "text", text, size: index === 0 ? 16 : 11, bold: index === 0, after: 4 } as Block
    })
  }
  return textBlocks(state.text)
}

/** 幻灯片：一页一张，页面尺寸就用演示文稿自己的尺寸（通常是 960×540 pt）。 */
async function writePptx(
  doc: PDFDocument,
  state: {
    size: { w: number; h: number }
    slideCount: number
    nodes: Array<{
      slide: number
      kind?: string
      box?: { x: number; y: number; w: number; h: number }
      paragraphs: string[]
      styles: Array<{ bold?: boolean; size?: number; color?: string; align?: string }>
      cells?: Array<{
        box?: { x: number; y: number; w: number; h: number }
        paragraphs: string[]
        styles: Array<{ bold?: boolean; size?: number; color?: string; align?: string }>
      }>
    }>
  },
  fonts: Fonts,
  images: readonly PrintSlideImage[] = [],
) {
  const width = Math.max(240, Math.min(2400, state.size?.w || 960))
  const height = Math.max(180, Math.min(2400, state.size?.h || 540))
  const total = Math.max(1, state.slideCount)
  for (let slide = 1; slide <= total; slide += 1) {
    const page = doc.addPage([width, height])
    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) })
    const nodes = state.nodes.filter((node) => node.slide === slide)
    for (const image of images.filter((item) => item.slide === slide)) {
      await drawSlideImage(page, doc, image)
    }
    for (const node of nodes) {
      if (node.kind === "picture") continue
      const box = node.box ?? { x: 48, y: 48, w: width - 96, h: 60 }
      drawParagraphs(page, doc, box, node.paragraphs, node.styles, fonts, node.kind === "table")
      for (const cell of node.cells ?? []) {
        if (!cell.box) continue
        drawParagraphs(page, doc, cell.box, cell.paragraphs, cell.styles, fonts, false)
      }
    }
    drawCjkLines(page, doc, {
      text: `${slide} / ${total}`,
      x: 16,
      top: height - 22,
      size: 9,
      color: "9CA3AF",
    })
  }
}

/**
 * 幻灯片插图：等比缩进占位框里，居中。
 * PDF 的坐标系是左下原点，而版式给的是左上原点，这里翻一下 y。
 */
async function drawSlideImage(page: PDFPage, doc: PDFDocument, image: PrintSlideImage) {
  const mime = image.mime.toLowerCase()
  let embedded
  try {
    if (mime === "image/png") embedded = await doc.embedPng(image.data)
    else if (mime === "image/jpeg" || mime === "image/jpg") embedded = await doc.embedJpg(image.data)
  } catch {
    return
  }
  if (!embedded) return
  const natural = embedded.scale(1)
  const box = image.box ?? {
    x: 0,
    y: 0,
    w: page.getWidth(),
    h: page.getHeight(),
  }
  if (box.w <= 0 || box.h <= 0 || natural.width <= 0 || natural.height <= 0) return
  const ratio = Math.min(box.w / natural.width, box.h / natural.height)
  const drawWidth = natural.width * ratio
  const drawHeight = natural.height * ratio
  page.drawImage(embedded, {
    x: box.x + (box.w - drawWidth) / 2,
    y: page.getHeight() - box.y - box.h + (box.h - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  })
}

function drawParagraphs(
  page: PDFPage,
  doc: PDFDocument,
  box: { x: number; y: number; w: number; h: number },
  paragraphs: string[],
  styles: Array<{ bold?: boolean; size?: number; color?: string; align?: string }>,
  fonts: Fonts,
  shrink: boolean,
) {
  let top = box.y
  const limit = box.y + box.h + 4
  paragraphs.forEach((text, index) => {
    const style = styles[index] ?? {}
    const size = Math.max(8, Math.min(72, style.size ?? (shrink ? 14 : 18)))
    const lineHeight = size * 1.3
    for (const line of wrapText(text, size, Math.max(20, box.w), style.bold ? fonts.bold : fonts.regular)) {
      if (top + size > limit) return
      paintLine(page, doc, line, box.x, top, size, style.bold === true, style.color, fonts)
      top += lineHeight
    }
  })
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

/** 把引擎状态排成一份新的 PDF。`format` 只能是能出纸的格式（PDF 本身请直接复制字节）。 */
export async function printToPdf(
  format: OfficeFormat,
  state: unknown,
  options: PrintOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setCreator("NovaWay")
  doc.setProducer("NovaWay Office")
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  }

  if (format === "pptx") {
    await writePptx(doc, state as Parameters<typeof writePptx>[1], fonts, options.slideImages ?? [])
    return doc.save()
  }

  let section = ""
  const writer = new Writer(doc, metricsOf(options.paper), fonts, () => section)
  if (options.footerNote) writer.setFooterNote(options.footerNote)

  switch (format) {
    case "docx": {
      const value = state as Parameters<typeof docxBlocks>[0] & { header?: string; footer?: string }
      if (value.header) writer.setHeaderNote(value.header)
      writer.setFooterNote(value.footer ?? options.footerNote)
      await writeBlocks(writer, docxBlocks(value, options.images ?? []))
      break
    }
    case "xlsx": {
      const value = state as { sheets: SheetGrid[] }
      for (const [index, sheet] of value.sheets.entries()) {
        // 先把分区名定下来，再开新页 —— 页码里的工作表名才不会错位。
        section = sheet.name
        if (index > 0) writer.breakPage()
        else writer.labelCurrent(sheet.name)
        await writeBlocks(writer, sheetBlocks(sheet))
      }
      break
    }
    case "csv": {
      const value = state as { rows: Array<Array<{ value: string }>> }
      await writeBlocks(writer, csvBlocks(value.rows))
      break
    }
    case "markdown":
      await writeBlocks(writer, markdownBlocks(String((state as { text?: string }).text ?? "")))
      break
    case "html":
      await writeBlocks(writer, htmlBlocks(state as Parameters<typeof htmlBlocks>[0]))
      break
    case "legacy":
      await writeBlocks(writer, legacyBlocks(state as Parameters<typeof legacyBlocks>[0]))
      break
    case "text":
      await writeBlocks(writer, textBlocks(String((state as { text?: string }).text ?? ""), 10))
      break
    default:
      await writeBlocks(writer, textBlocks(String((state as { text?: string }).text ?? ""), 10))
  }

  writer.stamp()
  return doc.save()
}
