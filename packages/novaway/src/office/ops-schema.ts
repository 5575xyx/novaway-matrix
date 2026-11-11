/**
 * 文档操作的线上 schema。
 *
 * 和 `@novaway/core/office/engine/contract` 的 OfficeOp 一一对应，但只暴露
 * 引擎已经实现的子集。UI 的画布编辑、HTTP 路由和 Agent 工具共用这一份，
 * 避免「人能做的模型做不了」或反过来。
 *
 * 这里用宽松 struct + 手工校验，而不是给每个 op 写一份 Schema：
 * 错误信息要能告诉模型「缺了哪个字段」，而不是一句 "expected number"。
 */
import { Schema } from "effect"
import type { OfficeOp, ParagraphStylePatch, RichFormatPatch } from "@novaway/core/office/engine/contract"
import { parseCellRef, type CellRef } from "@novaway/core/office/engine/contract"

export const DocumentOpStyle = Schema.Struct({
  bold: Schema.optional(Schema.Boolean),
  italic: Schema.optional(Schema.Boolean),
  underline: Schema.optional(Schema.Boolean),
  /** 删除线。 */
  strike: Schema.optional(Schema.Boolean),
  size: Schema.optional(Schema.Number),
  color: Schema.optional(Schema.String),
  /** 文字底纹（高亮），RRGGBB；空串去掉。 */
  highlight: Schema.optional(Schema.String),
  /** 行距倍数（1 / 1.5 / 2…）。 */
  lineSpacing: Schema.optional(Schema.Number),
  /** 首行缩进，pt。 */
  firstLineIndent: Schema.optional(Schema.Number),
  /** 左缩进，pt。 */
  indent: Schema.optional(Schema.Number),
  /** 清除格式。 */
  clear: Schema.optional(Schema.Boolean),
  align: Schema.optional(Schema.Literals(["l", "ctr", "r", "just"])),
  font: Schema.optional(Schema.String),
  /** DOCX 命名段落样式（Heading1 / Title…）；空串恢复正文。 */
  paragraphStyle: Schema.optional(Schema.String),
  /** DOCX 列表：bullet / number / none。 */
  list: Schema.optional(Schema.Literals(["bullet", "number", "none"])),
  /** 列表层级（0 起）。 */
  listLevel: Schema.optional(Schema.Number),
})

export const DocumentFormatPatch = Schema.Struct({
  bold: Schema.optional(Schema.Boolean),
  italic: Schema.optional(Schema.Boolean),
  underline: Schema.optional(Schema.Boolean),
  strikethrough: Schema.optional(Schema.Boolean),
  color: Schema.optional(Schema.String),
  highlight: Schema.optional(Schema.String),
  size: Schema.optional(Schema.Number),
  /** 链接地址；空串表示去掉链接，文字保留。 */
  link: Schema.optional(Schema.String),
  clear: Schema.optional(Schema.Boolean),
})

export const DocumentOp = Schema.Struct({
  op: Schema.String,
  paragraph: Schema.optional(Schema.Number),
  block: Schema.optional(Schema.Number),
  text: Schema.optional(Schema.String),
  style: Schema.optional(DocumentOpStyle),
  tag: Schema.optional(Schema.String),
  /** 列表类型：toggleList 用（bullet / ordered / task）。 */
  kind: Schema.optional(Schema.String),
  /** 标题级别：setHeading 用（0 到 6，0 = 取消标题）。 */
  level: Schema.optional(Schema.Number),
  align: Schema.optional(Schema.String),
  /** 行高/缩进是数字，单元格是字符串/数字/公式 —— 两种语义共用一个字段。 */
  value: Schema.optional(Schema.Union([Schema.Number, Schema.String, Schema.Struct({ formula: Schema.String })])),
  start: Schema.optional(Schema.Number),
  end: Schema.optional(Schema.Number),
  patch: Schema.optional(DocumentFormatPatch),
  /** replacePageText：要查找 / 替换的文字。 */
  find: Schema.optional(Schema.String),
  replace: Schema.optional(Schema.String),
  /** replacePageText：true = 替换整页所有匹配。 */
  all: Schema.optional(Schema.Boolean),
  html: Schema.optional(Schema.String),
  // ---- 表格 ----
  /** 插入段落：在第 after 段之后（0 = 开头）。 */
  after: Schema.optional(Schema.Number),
  /** 插入/删除行列的位置：行号或列序号，1 起。 */
  at: Schema.optional(Schema.Number),
  /** DOCX 表格序号（文档顺序，1 起）。 */
  table: Schema.optional(Schema.Number),
  /** 表格单元格的行列（1 起）。 */
  row: Schema.optional(Schema.Number),
  col: Schema.optional(Schema.Number),
  /** 插入/删除的行列数，默认 1。 */
  count: Schema.optional(Schema.Number),
  sheet: Schema.optional(Schema.String),
  /** 工作表名（addSheet / renameSheet 的新名字）。 */
  name: Schema.optional(Schema.String),
  /** 幻灯片页码（1 起）：deleteSlide / duplicateSlide 用。 */
  slide: Schema.optional(Schema.Number),
  /** 新建页的版式：显示名 / slideLayoutN.xml / 1-based 序号。 */
  layout: Schema.optional(Schema.String),
  /** 页面调序：把第 from 页挪到第 to 页（都从 1 开始）。 */
  from: Schema.optional(Schema.Number),
  to: Schema.optional(Schema.Number),
  /** PPTX 形状定位：office_pptx_read 给出的 id 或名称。 */
  shapeId: Schema.optional(Schema.String),
  shapeName: Schema.optional(Schema.String),
  /** 新文本框的位置与尺寸（pt）。 */
  box: Schema.optional(
    Schema.Struct({
      x: Schema.Number,
      y: Schema.Number,
      w: Schema.Number,
      h: Schema.Number,
    }),
  ),
  /** A1 形式，例如 "B2" */
  cell: Schema.optional(Schema.String),
  /** A1:B4 形式 */
  range: Schema.optional(Schema.String),
  cellStyle: Schema.optional(
    Schema.Struct({
      bold: Schema.optional(Schema.Boolean),
      italic: Schema.optional(Schema.Boolean),
      underline: Schema.optional(Schema.Boolean),
      color: Schema.optional(Schema.String),
      fill: Schema.optional(Schema.String),
      size: Schema.optional(Schema.Number),
      format: Schema.optional(Schema.String),
      align: Schema.optional(Schema.Literals(["l", "ctr", "r"])),
      wrap: Schema.optional(Schema.Boolean),
      /** 四边框线型：thin / medium / thick / dashed / dotted / double / none。 */
      border: Schema.optional(Schema.String),
      /** true 合并 range，false 取消 range 上的合并。 */
      merge: Schema.optional(Schema.Boolean),
    }),
  ),
  descending: Schema.optional(Schema.Boolean),
  /** 幻灯片是否隐藏（setSlideHidden）。 */
  hidden: Schema.optional(Schema.Boolean),
  keepHardBreaks: Schema.optional(Schema.Boolean),
  marker: Schema.optional(Schema.String),
  indent: Schema.optional(Schema.String),
  /** 大小写模式：upper / lower / title。 */
  mode: Schema.optional(Schema.String),
  /** 缩进转换方向：true = 用 tab，false = 用空格。 */
  toTabs: Schema.optional(Schema.Boolean),
  /** 缩进宽度（一个 tab 等于几个空格），默认 2。 */
  width: Schema.optional(Schema.Number),
  /** Markdown 属性名（setProperty / deleteProperty）。 */
  key: Schema.optional(Schema.String),
  /** 表格内容（addTable）：二维文本数组。 */
  rows: Schema.optional(Schema.Array(Schema.Array(Schema.String))),
  /** 第一行是否当表头加粗（addTable），默认 true。 */
  header: Schema.optional(Schema.Boolean),
  /** 图片 base64 与 MIME（addImage / replacePageImage）。 */
  dataBase64: Schema.optional(Schema.String),
  mime: Schema.optional(Schema.String),
  /** 页面上的第几张图片（replacePageImage，1 起，默认第一张）。 */
  index: Schema.optional(Schema.Number),
  /** 图片高度 pt（addImage）；宽度复用 width。 */
  height: Schema.optional(Schema.Number),
  /** 页面方向（setPageSetup）。 */
  orientation: Schema.optional(Schema.Literals(["portrait", "landscape"])),
  /** 要复制的源 PDF 页码（insertPdfPages，1 起；省略 = 整份）。 */
  pages: Schema.optional(Schema.Array(Schema.Number)),
  /** 纸张大小（setPageSetup）。 */
  size: Schema.optional(Schema.Literals(["A4", "A3", "Letter"])),
  /** 页边距 mm（setPageSetup）。 */
  margins: Schema.optional(
    Schema.Struct({
      top: Schema.optional(Schema.Number),
      right: Schema.optional(Schema.Number),
      bottom: Schema.optional(Schema.Number),
      left: Schema.optional(Schema.Number),
    }),
  ),
  // ---- PDF ----
  /** 页码（1 起）：deletePage / rotatePage / addPageText / annotatePage 等。 */
  page: Schema.optional(Schema.Number),
  /** 旋转角度（90 的倍数）。 */
  degrees: Schema.optional(Schema.Number),
  /** 图片旋转角度（setPageImageBox，顺时针）。 */
  rotation: Schema.optional(Schema.Number),
  /** 裁切页面的四边距离 pt（cropPage）。 */
  top: Schema.optional(Schema.Number),
  right: Schema.optional(Schema.Number),
  bottom: Schema.optional(Schema.Number),
  left: Schema.optional(Schema.Number),
  /** 叠加 / 批注的左上角坐标（pt）。 */
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
  /** 颜色 RRGGBB（批注、文字）。 */
  color: Schema.optional(Schema.String),
  /** 文字字号 pt（addPageText）。 */
  fontSize: Schema.optional(Schema.Number),
  /** 批注内容（便签正文）。 */
  contents: Schema.optional(Schema.String),
  /** 批注类型：highlight / underline / squiggly / strikeOut / note / text / square / circle / line。 */
  annotation: Schema.optional(Schema.String),
  /** 给批注起名，供回复引用。 */
  id: Schema.optional(Schema.String),
  /** 回复另一条批注（它的 id）。 */
  replyTo: Schema.optional(Schema.String),
  /** 表单字段及其值（fillForm）。 */
  fields: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.Union([Schema.String, Schema.Boolean]) })),
  ),
  /** 属性值：字符串 / 数字 / 布尔 / 字符串数组（YAML 里的标量或列表）。 */
  property: Schema.optional(Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Array(Schema.String)])),
})

export type DocumentOpInput = Schema.Schema.Type<typeof DocumentOp>

const RICH_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li", "pre", "div"])
const RICH_ALIGNS = new Set(["left", "center", "right", "justify"])

/** 把线上 JSON 转成引擎的 OfficeOp；缺字段时返回可读错误。 */
export function toOfficeOp(input: DocumentOpInput): { ok: true; op: OfficeOp } | { ok: false; message: string } {
  const need = (name: string) => {
    const value = (input as Record<string, unknown>)[name]
    if (value === undefined || value === null) return undefined
    return value
  }
  const needNumber = (name: string) => {
    const value = need(name)
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
  }
  const needString = (name: string) => {
    const value = need(name)
    return typeof value === "string" ? value : undefined
  }
  /**
   * 标题 / 列表 / 引用必须指定行范围。
   * 不给 start/end 就作用整篇会把每一行都变成标题 —— 这几乎不可能是本意，
   * 所以这里要求明确给出，而不是沿用行命令「省略即整篇」的默认。
   */
  const blockSpan = (): { ok: true; start: number; end: number } | { ok: false; message: string } => {
    const start = needNumber("start")
    const end = needNumber("end")
    if (start === undefined || end === undefined) {
      return { ok: false, message: "标题 / 列表 / 引用需要 start 和 end（要改的行的偏移范围）" }
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      return { ok: false, message: "start / end 必须是 0 起的整数，且 start ≤ end" }
    }
    return { ok: true, start, end }
  }

  switch (input.op) {
    case "setParagraphText":
    case "setSpanText": {
      const paragraph = needNumber("paragraph")
      const text = needString("text")
      if (paragraph === undefined || text === undefined) return missing("paragraph 和 text")
      if (input.op === "setSpanText") return { ok: true, op: { op: "setSpanText", paragraph, text } }
      return { ok: true, op: { op: "setParagraphText", paragraph, text } }
    }
    case "setParagraphStyle": {
      const paragraph = needNumber("paragraph")
      if (paragraph === undefined || !input.style) return missing("paragraph 和 style")
      const start = needNumber("start")
      const end = needNumber("end")
      return {
        ok: true,
        op: {
          op: "setParagraphStyle",
          paragraph,
          style: input.style as ParagraphStylePatch,
          ...(start !== undefined && end !== undefined ? { start, end } : {}),
        },
      }
    }
    case "insertParagraph": {
      const after = needNumber("after")
      const text = needString("text")
      if (after === undefined || text === undefined) return missing("after 和 text")
      return {
        ok: true,
        op: {
          op: "insertParagraph",
          after,
          text,
          ...(input.style ? { style: input.style as ParagraphStylePatch } : {}),
        },
      }
    }
    case "deleteParagraph": {
      const paragraph = needNumber("paragraph")
      if (paragraph === undefined) return missing("paragraph")
      return { ok: true, op: { op: "deleteParagraph", paragraph } }
    }
    case "setText": {
      const text = needString("text")
      if (text === undefined) return missing("text")
      return { ok: true, op: { op: "setText", text } }
    }
    case "moveLines": {
      const direction = needString("direction")
      if (direction !== "up" && direction !== "down") return { ok: false, message: "direction 只能是 up 或 down" }
      return {
        ok: true,
        op: {
          op: "moveLines",
          direction,
          ...(input.start !== undefined ? { start: input.start } : {}),
          ...(input.end !== undefined ? { end: input.end } : {}),
        },
      }
    }
    case "duplicateLines":
    case "deleteLines":
      return {
        ok: true,
        op: {
          op: input.op,
          ...(input.start !== undefined ? { start: input.start } : {}),
          ...(input.end !== undefined ? { end: input.end } : {}),
        },
      }
    case "sortLines":
      return {
        ok: true,
        op: { op: "sortLines", ...(input.descending !== undefined ? { descending: input.descending } : {}) },
      }
    case "uniqueLines":
      return { ok: true, op: { op: "uniqueLines" } }
    case "reverseLines":
      return { ok: true, op: { op: "reverseLines" } }
    case "joinLines":
      return { ok: true, op: { op: "joinLines" } }
    case "trimTrailing":
      return {
        ok: true,
        op: {
          op: "trimTrailing",
          ...(input.keepHardBreaks !== undefined ? { keepHardBreaks: input.keepHardBreaks } : {}),
        },
      }
    case "toggleComment":
      return { ok: true, op: { op: "toggleComment", ...(input.marker !== undefined ? { marker: input.marker } : {}) } }
    case "formatJson":
      return { ok: true, op: { op: "formatJson", ...(input.indent !== undefined ? { indent: input.indent } : {}) } }
    case "setHeading": {
      const level = needNumber("level")
      if (level === undefined) return missing("level")
      if (!Number.isInteger(level) || level < 0 || level > 6) {
        return { ok: false, message: "标题级别必须是 0 到 6（0 = 取消标题）" }
      }
      const span = blockSpan()
      if (!span.ok) return span
      return { ok: true, op: { op: "setHeading", level, start: span.start, end: span.end } }
    }
    case "toggleList": {
      const kind = needString("kind") ?? "bullet"
      if (kind !== "bullet" && kind !== "ordered" && kind !== "task") {
        return { ok: false, message: "列表类型只能是 bullet / ordered / task" }
      }
      const span = blockSpan()
      if (!span.ok) return span
      return { ok: true, op: { op: "toggleList", kind, start: span.start, end: span.end } }
    }
    case "toggleQuote": {
      const span = blockSpan()
      if (!span.ok) return span
      return { ok: true, op: { op: "toggleQuote", start: span.start, end: span.end } }
    }
    case "toggleTask": {
      const span = blockSpan()
      if (!span.ok) return span
      return { ok: true, op: { op: "toggleTask", start: span.start, end: span.end } }
    }
    case "changeCase": {
      const mode = needString("mode")
      if (mode !== "upper" && mode !== "lower" && mode !== "title") {
        return { ok: false, message: "changeCase 的 mode 只能是 upper / lower / title" }
      }
      return {
        ok: true,
        op: {
          op: "changeCase",
          mode,
          ...(input.start !== undefined ? { start: input.start } : {}),
          ...(input.end !== undefined ? { end: input.end } : {}),
        },
      }
    }
    case "convertIndent": {
      if (typeof input.toTabs !== "boolean") {
        return { ok: false, message: "convertIndent 需要 toTabs（true = tab，false = 空格）" }
      }
      if (input.width !== undefined && (!Number.isInteger(input.width) || input.width < 1 || input.width > 8)) {
        return { ok: false, message: "缩进宽度必须是 1 到 8" }
      }
      return {
        ok: true,
        op: {
          op: "convertIndent",
          toTabs: input.toTabs,
          ...(input.width !== undefined ? { width: input.width } : {}),
          ...(input.start !== undefined ? { start: input.start } : {}),
          ...(input.end !== undefined ? { end: input.end } : {}),
        },
      }
    }
    case "addTable": {
      const after = needNumber("after")
      if (after === undefined) return missing("after")
      const rows = input.rows
      if (!rows || rows.length === 0) return missing("rows（二维文本数组）")
      return {
        ok: true,
        op: {
          op: "addTable",
          after,
          rows: rows.map((row) => row.map((cell) => String(cell))),
          ...(input.header !== undefined ? { header: input.header } : {}),
        },
      }
    }
    case "deleteTable": {
      const table = needNumber("table")
      if (table === undefined) return missing("table")
      if (!Number.isInteger(table) || table < 1) return { ok: false, message: "表格序号从 1 开始" }
      return { ok: true, op: { op: "deleteTable", table } }
    }
    case "insertTableRow":
    case "deleteTableRow":
    case "insertTableColumn":
    case "deleteTableColumn": {
      const table = needNumber("table")
      const at = needNumber("at")
      if (table === undefined || at === undefined) return missing("table 和 at")
      const count = needNumber("count")
      const kind = input.op as "insertTableRow" | "deleteTableRow" | "insertTableColumn" | "deleteTableColumn"
      return { ok: true, op: { op: kind, table, at, ...(count !== undefined ? { count } : {}) } }
    }
    case "setTableCellText": {
      const table = needNumber("table")
      const row = needNumber("row")
      const col = needNumber("col")
      const text = needString("text")
      if (table === undefined || row === undefined || col === undefined || text === undefined) {
        return missing("table、row、col 和 text")
      }
      return { ok: true, op: { op: "setTableCellText", table, row, col, text } }
    }
    case "addPageBreak": {
      const after = needNumber("after")
      if (after === undefined) return missing("after")
      return { ok: true, op: { op: "addPageBreak", after } }
    }
    case "setHeaderFooter": {
      const kind = needString("kind")
      const text = needString("text")
      if (kind !== "header" && kind !== "footer") return missing("kind（header 或 footer）")
      if (text === undefined) return missing("text")
      return { ok: true, op: { op: "setHeaderFooter", kind, text } }
    }
    case "addImage": {
      const after = needNumber("after")
      if (after === undefined) return missing("after")
      const dataBase64 = needString("dataBase64")
      const mime = needString("mime")
      if (!dataBase64 || !mime) return missing("dataBase64 和 mime")
      return {
        ok: true,
        op: {
          op: "addImage",
          after,
          dataBase64,
          mime,
          ...(input.width !== undefined ? { width: input.width } : {}),
          ...(input.height !== undefined ? { height: input.height } : {}),
        },
      }
    }
    case "deletePage":
    case "rotatePage": {
      const page = needNumber("page")
      if (page === undefined) return missing("page")
      if (input.op === "deletePage") return { ok: true, op: { op: "deletePage", page } }
      const degrees = needNumber("degrees")
      if (degrees === undefined) return missing("degrees")
      return { ok: true, op: { op: "rotatePage", page, degrees } }
    }
    case "movePage": {
      const from = needNumber("from")
      const to = needNumber("to")
      if (from === undefined || to === undefined) return missing("from 和 to")
      return { ok: true, op: { op: "movePage", from, to } }
    }
    case "insertBlankPage": {
      const after = needNumber("after")
      if (after === undefined) return missing("after")
      return {
        ok: true,
        op: {
          op: "insertBlankPage",
          after,
          ...(input.width !== undefined ? { width: input.width } : {}),
          ...(input.height !== undefined ? { height: input.height } : {}),
        },
      }
    }
    case "replaceDocumentText": {
      const find = needString("find")
      const replace = needString("replace")
      if (find === undefined || replace === undefined) return missing("find 和 replace")
      return { ok: true, op: { op: "replaceDocumentText", find, replace } }
    }
    case "insertPdfPages": {
      const after = needNumber("after")
      const dataBase64 = needString("dataBase64")
      if (after === undefined || dataBase64 === undefined) return missing("after 和 dataBase64")
      const pages = Array.isArray(input.pages)
        ? input.pages.filter((item): item is number => typeof item === "number" && Number.isInteger(item))
        : undefined
      return {
        ok: true,
        op: {
          op: "insertPdfPages",
          after,
          dataBase64,
          ...(pages && pages.length > 0 ? { pages } : {}),
        },
      }
    }
    case "addPageText": {
      const page = needNumber("page")
      const text = needString("text")
      const x = needNumber("x")
      const y = needNumber("y")
      if (page === undefined || text === undefined || x === undefined || y === undefined) {
        return missing("page / text / x / y")
      }
      return {
        ok: true,
        op: {
          op: "addPageText",
          page,
          text,
          x,
          y,
          ...(input.fontSize !== undefined ? { size: input.fontSize } : {}),
          ...(input.color ? { color: input.color } : {}),
        },
      }
    }
    case "addPageImage": {
      const page = needNumber("page")
      const dataBase64 = needString("dataBase64")
      const mime = needString("mime")
      const x = needNumber("x")
      const y = needNumber("y")
      const width = needNumber("width")
      const height = needNumber("height")
      if (
        page === undefined ||
        dataBase64 === undefined ||
        mime === undefined ||
        x === undefined ||
        y === undefined ||
        width === undefined ||
        height === undefined
      ) {
        return missing("page / dataBase64 / mime / x / y / width / height")
      }
      return { ok: true, op: { op: "addPageImage", page, dataBase64, mime, x, y, width, height } }
    }
    case "replacePageImage": {
      const page = needNumber("page")
      const dataBase64 = needString("dataBase64")
      const mime = needString("mime")
      if (page === undefined || dataBase64 === undefined || mime === undefined) {
        return missing("page / dataBase64 / mime")
      }
      return {
        ok: true,
        op: {
          op: "replacePageImage",
          page,
          dataBase64,
          mime,
          ...(input.index !== undefined ? { index: input.index } : {}),
        },
      }
    }
    case "setPageImageBox": {
      const page = needNumber("page")
      if (page === undefined) return missing("page")
      return {
        ok: true,
        op: {
          op: "setPageImageBox",
          page,
          ...(input.index !== undefined ? { index: input.index } : {}),
          ...(input.x !== undefined ? { x: input.x } : {}),
          ...(input.y !== undefined ? { y: input.y } : {}),
          ...(input.width !== undefined ? { width: input.width } : {}),
          ...(input.height !== undefined ? { height: input.height } : {}),
          ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
        },
      }
    }
    case "annotatePage": {
      const page = needNumber("page")
      const kind = needString("annotation")
      const x = needNumber("x")
      const y = needNumber("y")
      const width = needNumber("width")
      const height = needNumber("height")
      if (
        page === undefined ||
        !kind ||
        x === undefined ||
        y === undefined ||
        width === undefined ||
        height === undefined
      ) {
        return missing("page / annotation / x / y / width / height")
      }
      if (
        !["highlight", "underline", "squiggly", "strikeOut", "note", "text", "square", "circle", "line"].includes(kind)
      ) {
        return {
          ok: false,
          message: "批注类型只能是 highlight / underline / squiggly / strikeOut / note / text / square / circle / line",
        }
      }
      return {
        ok: true,
        op: {
          op: "annotatePage",
          page,
          kind: kind as never,
          x,
          y,
          width,
          height,
          ...(input.color ? { color: input.color } : {}),
          ...(input.contents ? { contents: input.contents } : {}),
          ...(input.id ? { id: input.id } : {}),
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
          ...(input.fontSize !== undefined ? { fontSize: input.fontSize } : {}),
        },
      }
    }
    case "cropPage": {
      const page = needNumber("page")
      if (page === undefined) return missing("page")
      if (
        input.margins === undefined &&
        input.top === undefined &&
        input.right === undefined &&
        input.bottom === undefined &&
        input.left === undefined
      ) {
        return missing("top / right / bottom / left 至少一个")
      }
      return {
        ok: true,
        op: {
          op: "cropPage",
          page,
          ...(input.top !== undefined ? { top: input.top } : {}),
          ...(input.right !== undefined ? { right: input.right } : {}),
          ...(input.bottom !== undefined ? { bottom: input.bottom } : {}),
          ...(input.left !== undefined ? { left: input.left } : {}),
        },
      }
    }
    case "replacePageText": {
      const page = needNumber("page")
      const find = needString("find")
      const replace = needString("replace")
      if (page === undefined || !find || replace === undefined) return missing("page / find / replace")
      return {
        ok: true,
        op: {
          op: "replacePageText",
          page,
          find,
          replace,
          ...(input.all === true ? { all: true } : {}),
        },
      }
    }
    case "fillForm": {
      const fields = input.fields
      if (!fields || fields.length === 0) return missing("fields")
      return {
        ok: true,
        op: {
          op: "fillForm",
          fields: fields.map((field) => ({ name: field.name, value: field.value })),
        },
      }
    }
    case "setPageSetup": {
      if (!input.size && !input.orientation && !input.margins) {
        return missing("size / orientation / margins 至少一个")
      }
      return {
        ok: true,
        op: {
          op: "setPageSetup",
          ...(input.size ? { size: input.size } : {}),
          ...(input.orientation ? { orientation: input.orientation } : {}),
          ...(input.margins ? { margins: input.margins } : {}),
        },
      }
    }
    case "setProperty": {
      const key = needString("key")
      if (!key) return missing("key")
      if (input.property === undefined) return missing("property")
      const property = input.property
      const value = typeof property === "object" ? property.map((item) => String(item)) : property
      return { ok: true, op: { op: "setProperty", key, value } }
    }
    case "deleteProperty": {
      const key = needString("key")
      if (!key) return missing("key")
      return { ok: true, op: { op: "deleteProperty", key } }
    }
    case "setBlockType": {
      const block = needNumber("block")
      const tag = needString("tag")
      if (block === undefined || !tag) return missing("block 和 tag")
      if (!RICH_TAGS.has(tag)) return { ok: false, message: "不支持的段落类型：" + tag }
      return { ok: true, op: { op: "setBlockType", block, tag: tag as never } }
    }
    case "setBlockAlign": {
      const block = needNumber("block")
      const align = needString("align")
      if (block === undefined || !align) return missing("block 和 align")
      if (!RICH_ALIGNS.has(align)) return { ok: false, message: "不支持的对齐方式：" + align }
      return { ok: true, op: { op: "setBlockAlign", block, align: align as never } }
    }
    case "setBlockLineHeight":
    case "setBlockIndent":
    case "setBlockFirstLineIndent": {
      const block = needNumber("block")
      const value = needNumber("value")
      if (block === undefined || value === undefined) return missing("block 和 value")
      return { ok: true, op: { op: input.op, block, value } }
    }
    case "setBlockList": {
      const block = needNumber("block")
      const kind = needString("kind")
      if (block === undefined || !kind) return missing("block 和 kind")
      if (kind !== "ul" && kind !== "ol" && kind !== "none") {
        return { ok: false, message: "kind 只能是 ul / ol / none" }
      }
      return { ok: true, op: { op: "setBlockList", block, kind } }
    }
    case "setBlockHtml": {
      const block = needNumber("block")
      const html = needString("html")
      if (block === undefined || html === undefined) return missing("block 和 html")
      return { ok: true, op: { op: "setBlockHtml", block, html } }
    }
    case "insertBlock": {
      const after = needNumber("after")
      if (after === undefined) return missing("after")
      const html = typeof input.html === "string" ? input.html : undefined
      const text = typeof input.text === "string" ? input.text : undefined
      if (html === undefined && text === undefined) return missing("html 或 text")
      const tag = typeof input.tag === "string" ? input.tag : undefined
      if (tag !== undefined && !RICH_TAGS.has(tag)) return { ok: false, message: "不支持的段落类型：" + tag }
      return {
        ok: true,
        op: {
          op: "insertBlock",
          after,
          ...(html !== undefined ? { html } : {}),
          ...(text !== undefined ? { text } : {}),
          ...(tag !== undefined ? { tag: tag as never } : {}),
        },
      }
    }
    case "deleteBlock": {
      const block = needNumber("block")
      if (block === undefined) return missing("block")
      return { ok: true, op: { op: "deleteBlock", block } }
    }
    case "formatRange": {
      const block = needNumber("block")
      if (block === undefined || !input.patch) return missing("block 和 patch")
      return {
        ok: true,
        op: {
          op: "formatRange",
          block,
          ...(input.start !== undefined ? { start: input.start } : {}),
          ...(input.end !== undefined ? { end: input.end } : {}),
          patch: input.patch as RichFormatPatch,
        },
      }
    }
    case "setCellValue": {
      const sheet = needString("sheet")
      const cell = needString("cell")
      if (!sheet || !cell) return missing("sheet 和 cell")
      const ref = parseCellRef(cell)
      if (!ref) return { ok: false, message: "无法识别的单元格：" + cell + "（用 A1 形式）" }
      const value = (input as Record<string, unknown>).value
      if (value === undefined || value === null) return missing("value")
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "object") {
        return { ok: false, message: "value 只能是字符串、数字或 {formula}" }
      }
      return {
        ok: true,
        op: {
          op: "setCellValue",
          sheet,
          ref,
          value: value as string | number | { formula: string },
        },
      }
    }
    case "insertRows":
    case "deleteRows":
    case "insertColumns":
    case "deleteColumns": {
      const sheet = needString("sheet")
      const at = needNumber("at")
      if (!sheet || at === undefined) return missing("sheet 和 at")
      if (!Number.isInteger(at) || at < 1) return { ok: false, message: "at 从 1 开始（行号或列序号）" }
      const count = input.count
      if (count !== undefined && (!Number.isInteger(count) || count < 1)) {
        return { ok: false, message: "count 必须是正整数" }
      }
      return {
        ok: true,
        op: {
          op: input.op,
          sheet,
          at,
          ...(count !== undefined ? { count } : {}),
        } as never,
      }
    }
    case "addSheet": {
      const name = needString("name")
      if (!name) return missing("name")
      return { ok: true, op: { op: "addSheet", name } }
    }
    case "renameSheet": {
      const sheet = needString("sheet")
      const name = needString("name")
      if (!sheet || !name) return missing("sheet 和 name")
      return { ok: true, op: { op: "renameSheet", sheet, name } }
    }
    case "deleteSheet": {
      const sheet = needString("sheet")
      if (!sheet) return missing("sheet")
      return { ok: true, op: { op: "deleteSheet", sheet } }
    }
    case "setSheetTabColor": {
      const sheet = needString("sheet")
      if (!sheet) return missing("sheet")
      // color 省略 / 空串 = 去掉标签颜色（和不传 tabColor 的语义一致）。
      return { ok: true, op: { op: "setSheetTabColor", sheet, ...(input.color ? { color: input.color } : {}) } }
    }
    case "deleteSlide": {
      const slide = needNumber("slide")
      if (slide === undefined) return missing("slide")
      if (!Number.isInteger(slide) || slide < 1) return { ok: false, message: "页码从 1 开始" }
      return { ok: true, op: { op: "deleteSlide", slide } }
    }
    case "setSlideNotes": {
      const slide = needNumber("slide")
      if (slide === undefined) return missing("slide")
      if (!Number.isInteger(slide) || slide < 1) return { ok: false, message: "页码从 1 开始" }
      return { ok: true, op: { op: "setSlideNotes", slide, text: typeof input.text === "string" ? input.text : "" } }
    }
    case "setSlideHidden": {
      const slide = needNumber("slide")
      if (slide === undefined) return missing("slide")
      if (!Number.isInteger(slide) || slide < 1) return { ok: false, message: "页码从 1 开始" }
      if (typeof input.hidden !== "boolean") return missing("hidden（true / false）")
      return { ok: true, op: { op: "setSlideHidden", slide, hidden: input.hidden } }
    }
    case "setSlideLayout": {
      const slide = needNumber("slide")
      const layout = needString("layout")
      if (slide === undefined || !layout) return missing("slide 和 layout")
      if (!Number.isInteger(slide) || slide < 1) return { ok: false, message: "页码从 1 开始" }
      return { ok: true, op: { op: "setSlideLayout", slide, layout } }
    }
    case "renameShape": {
      const slide = needNumber("slide")
      const name = needString("name")
      const shapeId = needString("shapeId")
      const shapeName = needString("shapeName")
      if (slide === undefined || !name) return missing("slide 和 name")
      if (!shapeId && !shapeName) return missing("shapeId 或 shapeName")
      if (!Number.isInteger(slide) || slide < 1) return { ok: false, message: "页码从 1 开始" }
      return {
        ok: true,
        op: { op: "renameShape", slide, name, ...(shapeId ? { shapeId } : {}), ...(shapeName ? { shapeName } : {}) },
      }
    }
    case "moveSlide": {
      const from = needNumber("from")
      const to = needNumber("to")
      if (from === undefined || to === undefined) return missing("from 和 to")
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) {
        return { ok: false, message: "页码从 1 开始，且必须是整数" }
      }
      return { ok: true, op: { op: "moveSlide", from, to } }
    }
    case "duplicateSlide": {
      const slide = needNumber("slide")
      if (slide === undefined) return missing("slide")
      if (!Number.isInteger(slide) || slide < 1) return { ok: false, message: "页码从 1 开始" }
      return { ok: true, op: { op: "duplicateSlide", slide } }
    }
    case "addSlide": {
      const after = input.after
      if (after !== undefined && (!Number.isInteger(after) || after < 0)) {
        return { ok: false, message: "after 必须是非负整数（0 = 插到最前面）" }
      }
      const layout = typeof input.layout === "string" && input.layout.trim() ? input.layout.trim() : undefined
      return {
        ok: true,
        op: {
          op: "addSlide",
          ...(after === undefined ? {} : { after }),
          ...(layout === undefined ? {} : { layout }),
        },
      }
    }
    case "addTextBox": {
      const slide = needNumber("slide")
      if (slide === undefined) return missing("slide")
      const text = needString("text")
      if (text === undefined) return missing("text")
      const box = input.box
      return {
        ok: true,
        op: {
          op: "addTextBox",
          slide,
          text,
          ...(box ? { box } : {}),
          ...(input.style ? { style: input.style } : {}),
        },
      }
    }
    case "deleteShape": {
      const slide = needNumber("slide")
      if (slide === undefined) return missing("slide")
      if (!input.shapeId && !input.shapeName) return missing("shapeId 或 shapeName")
      return {
        ok: true,
        op: {
          op: "deleteShape",
          slide,
          ...(input.shapeId ? { shapeId: input.shapeId } : {}),
          ...(input.shapeName ? { shapeName: input.shapeName } : {}),
        },
      }
    }
    case "setCellStyle": {
      const sheet = needString("sheet")
      const range = needString("range") ?? needString("cell")
      if (!sheet || !range) return missing("sheet 和 range")
      if (!input.cellStyle) return missing("cellStyle")
      const parsed = parseRange(range)
      if (!parsed) return { ok: false, message: "无法识别的区域：" + range + "（用 A1 或 A1:C3）" }
      return {
        ok: true,
        op: { op: "setCellStyle", sheet, range: parsed, style: input.cellStyle },
      }
    }
    case "clearCells": {
      const sheet = needString("sheet")
      const range = needString("range") ?? needString("cell")
      if (!sheet || !range) return missing("sheet 和 range")
      const parsed = parseRange(range)
      if (!parsed) return { ok: false, message: "无法识别的区域：" + range + "（用 A1 或 A1:C3）" }
      return { ok: true, op: { op: "clearCells", sheet, range: parsed } }
    }
    default:
      return { ok: false, message: "不支持的操作：" + input.op }
  }
}

function parseRange(input: string): { start: CellRef; end: CellRef } | undefined {
  const [from, to] = input.split(":")
  const start = parseCellRef(from ?? "")
  if (!start) return undefined
  // "A1:" 这种半截区间当成错误，别默默解释成单格。
  if (to === "") return undefined
  const end = to ? parseCellRef(to) : start
  if (!end) return undefined
  return { start, end }
}

function missing(fields: string): { ok: false; message: string } {
  return { ok: false, message: "缺少字段：" + fields }
}
