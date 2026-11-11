/**
 * 导出：把可编辑状态转成另一种格式的文本。
 *
 * 导出是**只读**操作，不碰原文件，
 * 也不改变会话状态。目标格式由调用方按扩展名/别名给出，
 * 引擎不认识就返回 `unsupported_format`，由上层决定要不要换一种。
 *
 * 这里刻意全部输出文本（csv / tsv / html / txt / md）：二进制导出
 * （PDF / PNG）需要排版引擎，属于另一条产品线，不在这层伪造。
 */

import type { XlsxSheetGrid } from "./xlsx-sheet"

/** 把一张表按行列铺成矩形，空格子补空串。 */
function gridMatrix(sheet: XlsxSheetGrid): string[][] {
  const rows: string[][] = []
  for (const cell of sheet.cells) {
    const row = (rows[cell.row] ??= [])
    // 合并区域的从属单元格没有内容，这里只填左上角那份即可。
    row[cell.col] = cell.formula !== undefined ? "=" + cell.formula : cell.text
  }
  const height = Math.max(sheet.lastRow + 1, rows.length)
  const width = Math.max(sheet.lastCol + 1, ...rows.map((row) => row.length))
  return Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => rows[r]?.[c] ?? ""))
}

function escapeDelimited(value: string, delimiter: string): string {
  if (!value.includes(delimiter) && !/["\r\n]/.test(value)) return value
  return '"' + value.replace(/"/g, '""') + '"'
}

/** 一张表 → CSV / TSV。第一行原样输出（Excel 里它本来就是表头）。 */
export function sheetToDelimited(sheet: XlsxSheetGrid, delimiter = ","): string {
  const lines = gridMatrix(sheet).map((row) => row.map((value) => escapeDelimited(value, delimiter)).join(delimiter))
  // 行尾不补空行：CLI 工具（diff、wc）看到多余空行会当成内容。
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  return lines.join("\n")
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** 一张表 → 独立的 HTML 文档（内联最小样式，粘进邮件/浏览器都能看）。 */
export function sheetToHtmlTable(sheet: XlsxSheetGrid): string {
  const rows = gridMatrix(sheet)
    .map((row) => "<tr>" + row.map((value) => "<td>" + escapeHtml(value) + "</td>").join("") + "</tr>")
    .join("\n")
  return (
    '<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>' +
    escapeHtml(sheet.name) +
    '</title></head>\n<body>\n<table border="1">\n' +
    rows +
    "\n</table>\n</body>\n</html>\n"
  )
}

/** 多张表 → 每个 sheet 一节，方便一次导出整本工作簿。 */
export function workbookToDelimited(sheets: readonly XlsxSheetGrid[], delimiter = ","): string {
  if (sheets.length === 1) return sheetToDelimited(sheets[0]!, delimiter)
  return sheets.map((sheet) => "# " + sheet.name + "\n" + sheetToDelimited(sheet, delimiter)).join("\n\n")
}

export type PlainParagraph = {
  text: string
  /** 1 = 标题 1 …… 6 = 标题 6；0 / 未定义 = 正文。 */
  heading?: number
  inTable?: boolean
  /** Word 的列表段落（w:numPr）：项目符号或编号，level 从 0 开始。 */
  list?: { kind: "bullet" | "number"; level: number }
}

/** 列表项 → Markdown 行；缩进两格一级，编号统一写成 1. 让 MD 自己排序。 */
function markdownListLine(item: { kind: "bullet" | "number"; level: number }, text: string): string {
  return "  ".repeat(Math.max(0, item.level)) + (item.kind === "bullet" ? "- " : "1. ") + text
}

/**
 * 段落 → Markdown。
 *
 * Word 的样式名（Title / Heading1 / 列表）映射到对应的 MD 记法；
 * 表格里的段落缩进成列表项，这样导出的文本至少保留「它在表格里」这件事。
 */
export function paragraphsToMarkdown(paragraphs: readonly PlainParagraph[]): string {
  const out: string[] = []
  let previousWasList = false
  for (const paragraph of paragraphs) {
    const text = paragraph.text.trim()
    if (text.length === 0) continue
    if (paragraph.heading && paragraph.heading >= 1 && paragraph.heading <= 6) {
      out.push("#".repeat(paragraph.heading) + " " + text)
      previousWasList = false
      continue
    }
    const line = paragraph.list ? markdownListLine(paragraph.list, text) : paragraph.inTable ? "- " + text : text
    const isList = Boolean(paragraph.list || paragraph.inTable)
    // 连续的列表项只换一行，否则 Markdown 会把它们拆成互不相干的小列表。
    if (isList && previousWasList) out[out.length - 1] += "\n" + line
    else out.push(line)
    previousWasList = isList
  }
  return out.join("\n\n")
}

/** 段落 → 纯文本：一个段落一行，空段落丢掉（和「复制全部文字」的观感一致）。 */
export function paragraphsToText(paragraphs: readonly PlainParagraph[]): string {
  return paragraphs
    .map((paragraph) => paragraph.text.trim())
    .filter((text) => text.length > 0)
    .join("\n")
}

export type PlainSlide = {
  /** 1-based 页码。 */
  index: number
  /** 标题（没有标题占位符时省略）。 */
  title?: string
  /** 正文行，按形状在页上的顺序排列。 */
  lines: string[]
}

/**
 * 幻灯片 → Markdown：一页一个二级标题，正文按项目符号排列。
 *
 * 没有标题的页用页码兜底，这样导出的文本仍然能看出「讲到第几页」。
 */
export function slidesToMarkdown(slides: readonly PlainSlide[]): string {
  return slides
    .map((slide) => {
      const head = "## " + (slide.title?.trim() || `幻灯片 ${slide.index}`)
      const body = slide.lines.map((line) => "- " + line)
      return [head, ...body].join("\n")
    })
    .join("\n\n")
}

/** 幻灯片 → 纯文本：每页一行「第 N 页：标题」，正文每行一条。 */
export function slidesToText(slides: readonly PlainSlide[]): string {
  return slides
    .map((slide) => {
      const title = slide.title?.trim()
      const head = `第 ${slide.index} 页` + (title ? "：" + title : "")
      return [head, ...slide.lines].join("\n")
    })
    .join("\n\n")
}

export type RichParagraph = PlainParagraph & {
  align?: "left" | "center" | "right" | "both"
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** pt */
  size?: number
  /** RRGGBB */
  color?: string
}

/** 段落 → 独立 HTML 文档：标题用 h1–h6，正文用 p，保留粗/斜/下划线、字号、颜色和对齐。 */
export function paragraphsToHtml(paragraphs: readonly RichParagraph[]): string {
  const body: string[] = []
  let openList: "ul" | "ol" | undefined
  const closeList = () => {
    if (!openList) return
    body.push("</" + openList + ">")
    openList = undefined
  }
  for (const paragraph of paragraphs) {
    const text = paragraph.text.trim()
    if (text.length === 0) continue
    const styles = [
      paragraph.bold ? "font-weight:600" : undefined,
      paragraph.italic ? "font-style:italic" : undefined,
      paragraph.underline ? "text-decoration:underline" : undefined,
      paragraph.size ? "font-size:" + paragraph.size + "pt" : undefined,
      paragraph.color ? "color:#" + paragraph.color : undefined,
      paragraph.align ? "text-align:" + (paragraph.align === "both" ? "justify" : paragraph.align) : undefined,
    ].filter(Boolean)
    const attrs = styles.length > 0 ? ' style="' + styles.join(";") + '"' : ""
    if (paragraph.list) {
      const tag = paragraph.list.kind === "bullet" ? "ul" : "ol"
      // 列表类型一变就换一个容器；连续的项目符号才会归进同一个 ul。
      if (openList !== tag) {
        closeList()
        openList = tag
        body.push("<" + tag + ">")
      }
      body.push("<li" + attrs + ">" + escapeHtml(text) + "</li>")
      continue
    }
    closeList()
    const tag = paragraph.heading && paragraph.heading >= 1 && paragraph.heading <= 6 ? "h" + paragraph.heading : "p"
    body.push("<" + tag + attrs + ">" + escapeHtml(text) + "</" + tag + ">")
  }
  closeList()
  return (
    '<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>Document</title></head>\n<body>\n' +
    body.join("\n") +
    "\n</body>\n</html>\n"
  )
}

/** 幻灯片 → 独立 HTML 文档：一页一个 section，标题 + 项目符号列表。 */
export function slidesToHtml(slides: readonly PlainSlide[]): string {
  const body = slides.map((slide) => {
    const heading = escapeHtml(slide.title ?? "第 " + slide.index + " 页")
    const lines = slide.lines.map((line) => "<li>" + escapeHtml(line) + "</li>").join("\n")
    return "<section>\n<h2>" + heading + "</h2>" + (lines ? "\n<ul>\n" + lines + "\n</ul>" : "") + "\n</section>"
  })
  return (
    '<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>Deck</title></head>\n<body>\n' +
    body.join("\n") +
    "\n</body>\n</html>\n"
  )
}
