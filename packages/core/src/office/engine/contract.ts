/**
 * 办公文档的统一契约。
 *
 * 这一层对齐的是 Weave Office 的宿主/编辑器边界（见其 `src/editor.rs`、
 * `crates/workspace/src/lib.rs`），但落到我们自己的技术栈：
 *
 *   - 宿主（DocumentSession）唯一负责：文件身份、脏标记、保存版本、撤销栈；
 *   - 编辑器（OfficeEngine）只负责：解析、出布局、按操作改字节；
 *   - 人和 AI 走同一套 `OfficeOp`，没有第二条改文件的路径；
 *   - 每次操作返回 `changed`，告诉调用方改了哪些包内条目。
 *
 * 之所以强调「人之上的宿主唯一负责脏标记」，是因为 Weave 在这一点上写得很好：
 * 保存期间产生的新修改不能被这次保存标成已保存（old revision 不能覆盖新 revision）。
 */

/**
 * 一个文件用哪种引擎打开。前四种是 OOXML / PDF 包格式，
 * 后三种是文本类文档（Weave 的 Editor::TextFile / Rich）。
 * 文本类文档的「字节」就是文件本身，没有 zip 条目可审计。
 */
export type OfficeFormat = "docx" | "xlsx" | "pptx" | "pdf" | "html" | "markdown" | "text"

export type OfficeErrorCode =
  | "usage"
  | "not_found"
  | "exists"
  | "unsupported_format"
  | "unknown_command"
  | "invalid_params"
  | "invalid_path"
  | "conflict"
  | "open_failed"
  | "io"
  | "engine"

export type OfficeError = {
  code: OfficeErrorCode
  message: string
  /** 给人和模型看的一句话修法，直接展示，不要吞掉。 */
  suggestion?: string
  candidates?: string[]
}

export type OfficeResult<T> = { ok: true; data: T } | { ok: false; error: OfficeError }

export function ok<T>(data: T): OfficeResult<T> {
  return { ok: true, data }
}

export function fail<T = never>(code: OfficeErrorCode, message: string, suggestion?: string): OfficeResult<T> {
  return { ok: false, error: { code, message, ...(suggestion ? { suggestion } : {}) } }
}

/** 按路径定位一个节点。四种格式共用一套字符串语法。 */
export type OfficePath = string

export type PathTarget =
  | { kind: "document"; path: "/body" }
  | { kind: "paragraph"; index: number } // /body/p[N]，1 起
  | { kind: "table"; index: number } // /body/table[N]，1 起
  | { kind: "sheet"; name: string } // /Sheet1
  | { kind: "cell"; sheet: string; row: number; col: number } // /Sheet1/B2（0 起行列）
  | { kind: "range"; sheet: string; start: CellRef; end: CellRef } // /Sheet1/A1:C10
  | { kind: "slide"; index: number } // /slide[N]，1 起
  | { kind: "shape"; slide: number; id?: string; index?: number } // /slide[N]/shape[M]
  | { kind: "page"; index: number } // /page[N]，1 起

export type CellRef = { row: number; col: number }

const COLUMN_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

export function columnToIndex(label: string): number | undefined {
  if (!/^[A-Za-z]+$/.test(label)) return undefined
  let value = 0
  for (const char of label.toUpperCase()) value = value * 26 + (char.charCodeAt(0) - 64)
  return value - 1
}

export function indexToColumn(index: number): string {
  let value = index
  let label = ""
  do {
    label = COLUMN_NAMES[value % 26] + label
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return label
}

/** `B2` → `{ row: 1, col: 1 }`；1 起的行号转成 0 起。 */
export function parseCellRef(input: string): CellRef | undefined {
  const match = /^([A-Za-z]+)(\d+)$/.exec(input.trim())
  if (!match) return undefined
  const col = columnToIndex(match[1]!)
  if (col === undefined) return undefined
  const row = Number(match[2]) - 1
  if (!Number.isInteger(row) || row < 0) return undefined
  return { row, col }
}

export function formatCellRef(ref: CellRef): string {
  return `${indexToColumn(ref.col)}${ref.row + 1}`
}

/**
 * 解析 Weave 风格的路径。语法：
 *   /body、/body/p[3]、/body/table[2]
 *   /Sheet1、/Sheet1/B2、/Sheet1/A1:C10
 *   /slide[2]、/slide[2]/shape[1]
 *   /page[4]
 */
export function parseOfficePath(input: OfficePath): OfficeResult<PathTarget> {
  const path = input.trim()
  if (!path.startsWith("/")) return fail("invalid_path", `路径必须以 / 开头：${input}`)

  const parts = path.slice(1).split("/").filter(Boolean)
  if (parts.length === 0) return fail("invalid_path", `路径为空：${input}`)

  const head = parts[0]!

  if (head === "body") {
    if (parts.length === 1) return ok({ kind: "document", path: "/body" })
    const match = /^(p|table)\[(\d+)\]$/.exec(parts[1]!)
    if (!match) return fail("invalid_path", `无法识别的正文节点：${parts[1]}`, "支持 /body/p[N] 和 /body/table[N]")
    const index = Number(match[2])
    if (index < 1) return fail("invalid_path", "索引从 1 开始")
    return ok(match[1] === "p" ? { kind: "paragraph", index } : { kind: "table", index })
  }

  const slide = /^slide\[(\d+)\]$/.exec(head)
  if (slide) {
    const index = Number(slide[1])
    if (index < 1) return fail("invalid_path", "幻灯片序号从 1 开始")
    if (parts.length === 1) return ok({ kind: "slide", index })
    const shape = /^shape\[(\d+)\]$/.exec(parts[1]!)
    if (!shape) return fail("invalid_path", `无法识别的幻灯片节点：${parts[1]}`, "支持 /slide[N] 和 /slide[N]/shape[M]")
    const shapeIndex = Number(shape[1])
    if (shapeIndex < 1) return fail("invalid_path", "形状序号从 1 开始")
    return ok({ kind: "shape", slide: index, index: shapeIndex })
  }

  const page = /^page\[(\d+)\]$/.exec(head)
  if (page) {
    const index = Number(page[1])
    if (index < 1) return fail("invalid_path", "页码从 1 开始")
    return ok({ kind: "page", index })
  }

  // 剩下的是表格：/Sheet 或 /Sheet/A1(:B2)
  if (parts.length === 1) return ok({ kind: "sheet", name: head })
  if (parts.length === 2) {
    const [start, end] = parts[1]!.split(":")
    const from = parseCellRef(start ?? "")
    if (!from) return fail("invalid_path", `无法识别的单元格：${parts[1]}`, "用 /Sheet1/B2 或 /Sheet1/A1:C10")
    if (!end) return ok({ kind: "cell", sheet: head, ...from })
    const to = parseCellRef(end)
    if (!to) return fail("invalid_path", `无法识别的区域终点：${end}`)
    return ok({ kind: "range", sheet: head, start: from, end: to })
  }

  return fail("invalid_path", `无法识别的路径：${input}`)
}

/**
 * 一次编辑操作。人和 Agent 都构造这个结构，由各格式引擎解释。
 * 字段故意设计成「所见即所得」的语义，而不是 XML 片段。
 */
export type OfficeOp =
  /** 段落文字。DOCX 用 paragraph 直接定位；PPTX 还要给 slide + shapeId。 */
  | { op: "setParagraphText"; paragraph: number; text: string; slide?: number; shapeId?: string }
  /** 段落格式。定位规则同上。 */
  | { op: "setParagraphStyle"; paragraph: number; style: ParagraphStylePatch; slide?: number; shapeId?: string }
  | { op: "setShapeBox"; slide: number; shapeId: string; box: import("./units").BoxPt }
  | { op: "rotateShape"; slide: number; shapeId: string; degrees: number }
  | { op: "replaceImage"; slide: number; shapeId: string; data: Uint8Array; mime: string }
  | { op: "setCellValue"; sheet: string; ref: CellRef; value: string | number | { formula: string } }
  | { op: "setCellStyle"; sheet: string; range: { start: CellRef; end: CellRef }; style: CellStylePatch }
  /** 纯文本/富文本编辑器的整段替换（避免和文档段落混淆）。 */
  | { op: "setSpanText"; paragraph: number; text: string }
  // -------------------------------------------------------------------------
  // 文本 / 代码编辑器（Weave 的 crates/text-editor 命令）
  // -------------------------------------------------------------------------
  /** 整体替换文档内容（换行用 \n；编码与换行符由引擎按原文件恢复）。 */
  | { op: "setText"; text: string }
  | { op: "sortLines"; descending?: boolean }
  | { op: "uniqueLines" }
  | { op: "reverseLines" }
  | { op: "joinLines" }
  | { op: "trimTrailing"; keepHardBreaks?: boolean }
  | { op: "toggleComment"; marker?: string }
  | { op: "formatJson"; indent?: string }
  // -------------------------------------------------------------------------
  // 富文本编辑器（Weave 的 crates/rich-editor 命令）
  // -------------------------------------------------------------------------
  | { op: "setBlockType"; block: number; tag: RichBlockTag }
  | { op: "setBlockAlign"; block: number; align: RichAlign }
  | { op: "setBlockLineHeight"; block: number; value: number }
  | { op: "setBlockIndent"; block: number; value: number }
  /** 只改 [start, end) 这一小段文字的行内格式（不传区间则整块）。 */
  | { op: "formatRange"; block: number; start?: number; end?: number; patch: RichFormatPatch }
  /**
   * 用一段 HTML 替换整个块的内部（富文本设计视图用）。
   * 引擎会重新解析这段 HTML，解析不出安全结构就整体拒绝。
   */
  | { op: "setBlockHtml"; block: number; html: string }

export type RichBlockTag = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote" | "li" | "pre" | "div"

export type RichAlign = "left" | "center" | "right" | "justify"

export type RichFormatPatch = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  /** RRGGBB */
  color?: string
  /** RRGGBB */
  highlight?: string
  /** px */
  size?: number
  /** 清空选区上的所有行内格式（与其它字段互斥）。 */
  clear?: boolean
}

export type ParagraphStylePatch = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** pt */
  size?: number
  /** RRGGBB */
  color?: string
  align?: "l" | "ctr" | "r" | "just"
  font?: string
}

export type CellStylePatch = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  fill?: string
  size?: number
  format?: string
  align?: "l" | "ctr" | "r"
  wrap?: boolean
  merge?: boolean
}

/** 一次 apply 的结果：新字节 + 改了哪些包内条目 + 实际生效的操作。 */
export type ApplyOutcome<TState> = {
  state: TState
  bytes: Uint8Array
  /** 真正被重写的 zip 条目（正常情况下只有目标 XML）。 */
  changed: string[]
  applied: unknown[]
}

/** 每种格式实现这一组方法，宿主不关心它内部是 XML 还是 PDF 对象。 */
export interface OfficeEngine<TState> {
  readonly format: OfficeFormat
  /** 解析字节，产出可编辑的布局状态。 */
  open(bytes: Uint8Array): Promise<OfficeResult<TState>>
  /**
   * 应用一批操作。契约要求**全有或全无**：
   * 任何一步失败都不能留下半改的文件，也不能返回新字节。
   * `bytes` 是当前完整文件，引擎只在内存里改，写盘由宿主负责。
   */
  apply(
    state: TState,
    ops: readonly OfficeOp[],
    bytes: Uint8Array,
  ): Promise<OfficeResult<ApplyOutcome<TState>>>
  /** 导出成另一种格式（pdf/png/csv…）；不支持时返回 unsupported_format。 */
  export?(state: TState, target: string, bytes: Uint8Array): Promise<OfficeResult<Uint8Array>>
}
