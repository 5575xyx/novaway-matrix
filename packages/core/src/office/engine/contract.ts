/**
 * 办公文档的统一契约。
 *
 * 这一层定义宿主/编辑器边界，落到我们自己的技术栈：
 *
 *   - 宿主（DocumentSession）唯一负责：文件身份、脏标记、保存版本、撤销栈；
 *   - 编辑器（OfficeEngine）只负责：解析、出布局、按操作改字节；
 *   - 人和 AI 走同一套 `OfficeOp`，没有第二条改文件的路径；
 *   - 每次操作返回 `changed`，告诉调用方改了哪些包内条目。
 *
 * 之所以强调「宿主唯一负责脏标记」，关键原因是：
 * 保存期间产生的新修改不能被这次保存标成已保存（old revision 不能覆盖新 revision）。
 */

/**
 * 一个文件用哪种引擎打开。前四种是 OOXML / PDF 包格式，
 * 后三种是文本类文档（纯文本 / 富文本）。
 * 文本类文档的「字节」就是文件本身，没有 zip 条目可审计。
 */
export type OfficeFormat =
  | "docx"
  | "xlsx"
  | "csv"
  | "pptx"
  | "pdf"
  | "html"
  | "markdown"
  | "text"
  /** 旧格式（odt / ods / odp / rtf / doc / xls / ppt）：core 负责受限解析与转换导出；UI 宿主可先转换为 docx / xlsx / pptx，再交给现代编辑器编辑，绝不覆盖旧源文件。 */
  | "legacy"
  /** 插件可注册的扩展格式，例如 `foo`。 */
  | (string & {})

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
  /** 加密文件需要密码：没给密码或密码不对。给调用方一个明确的补参提示。 */
  | "password_required"
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
  | { kind: "paragraph"; index: number } // /body/p[N] 或 /body/block[N]，1 起
  | { kind: "table"; index: number } // /body/table[N]，1 起
  | { kind: "sheet"; name: string } // /Sheet1
  | { kind: "sheetByIndex"; index: number } // /sheet[N]，1 起
  | { kind: "cell"; sheet: string; row: number; col: number; sheetIndex?: number } // /Sheet1/B2（0 起行列）
  | { kind: "range"; sheet: string; start: CellRef; end: CellRef; sheetIndex?: number } // /Sheet1/A1:C10
  | { kind: "slide"; index: number } // /slide[N]，1 起
  | { kind: "shape"; slide: number; id?: string; name?: string; index?: number } // /slide[N]/shape[M] 或 shape[@id=…]
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
 * 解析文档路径。语法：
 *   /body、/body/p[3]、/body/table[2]
 *   /Sheet1、/Sheet1/B2、/Sheet1/A1:C10
 *   /slide[2]、/slide[2]/shape[1]
 *   /page[4]
 */
/**
 * 解析文档路径。语法：
 *   /body、/body/p[3]、/body/block[3]、/body/table[2]
 *   /Sheet1、/sheet[2]、/Sheet1/B2、/Sheet1/A1:C10
 *   /slide[2]、/slide[2]/shape[1]、/slide[2]/shape[@id=7]、/slide[2]/shape[@name=Title 1]
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
    // block 是「正文里的第 N 个块」；我们的文档模型按段落编号，两者同义。
    const match = /^(p|block|table)\[(\d+)\]$/.exec(parts[1]!)
    if (!match)
      return fail(
        "invalid_path",
        `无法识别的正文节点：${parts[1]}`,
        "支持 /body/p[N]、/body/block[N] 和 /body/table[N]",
      )
    const index = Number(match[2])
    if (index < 1) return fail("invalid_path", "索引从 1 开始")
    return ok(match[1] === "table" ? { kind: "table", index } : { kind: "paragraph", index })
  }

  const slide = /^slide\[(\d+)\]$/.exec(head)
  if (slide) {
    const index = Number(slide[1])
    if (index < 1) return fail("invalid_path", "幻灯片序号从 1 开始")
    if (parts.length === 1) return ok({ kind: "slide", index })
    const node = parts[1]!
    const byIndex = /^shape\[(\d+)\]$/.exec(node)
    if (byIndex) {
      const shapeIndex = Number(byIndex[1])
      if (shapeIndex < 1) return fail("invalid_path", "形状序号从 1 开始")
      return ok({ kind: "shape", slide: index, index: shapeIndex })
    }
    const byId = /^shape\[@id=(.+)\]$/.exec(node)
    if (byId) {
      const id = byId[1]!.trim()
      if (!id) return fail("invalid_path", "shape[@id=…] 少了 id")
      return ok({ kind: "shape", slide: index, id })
    }
    const byName = /^shape\[@name=(.+)\]$/.exec(node)
    if (byName) {
      const name = byName[1]!.trim()
      if (!name) return fail("invalid_path", "shape[@name=…] 少了名字")
      return ok({ kind: "shape", slide: index, name })
    }
    return fail(
      "invalid_path",
      `无法识别的幻灯片节点：${node}`,
      "支持 /slide[N]、/slide[N]/shape[M]、/slide[N]/shape[@id=…]、/slide[N]/shape[@name=…]",
    )
  }

  const page = /^page\[(\d+)\]$/.exec(head)
  if (page) {
    const index = Number(page[1])
    if (index < 1) return fail("invalid_path", "页码从 1 开始")
    return ok({ kind: "page", index })
  }

  // /sheet[N]：按 1 起的工作表序号定位，不依赖名字。
  const sheetIndex = /^sheet\[(\d+)\]$/.exec(head)
  if (sheetIndex) {
    const index = Number(sheetIndex[1])
    if (index < 1) return fail("invalid_path", "工作表序号从 1 开始")
    if (parts.length === 1) return ok({ kind: "sheetByIndex", index })
    if (parts.length > 2) return fail("invalid_path", `/sheet[${index}] 只接受一个单元格或区域`)
    const [start, end] = parts[1]!.split(":")
    const from = parseCellRef(start ?? "")
    if (!from) return fail("invalid_path", `无法识别的单元格：${parts[1]}`, "用 /sheet[2]/B2 或 /sheet[2]/A1:C10")
    if (!end) return ok({ kind: "cell", sheet: "", sheetIndex: index, ...from })
    const to = parseCellRef(end)
    if (!to) return fail("invalid_path", `无法识别的区域终点：${end}`)
    return ok({ kind: "range", sheet: "", sheetIndex: index, start: from, end: to })
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
  /** 段落格式。定位规则同上。start/end 是段内字符区间（选中文字加粗）；省略就是整段。 */
  | {
      op: "setParagraphStyle"
      paragraph: number
      style: ParagraphStylePatch
      slide?: number
      shapeId?: string
      start?: number
      end?: number
    }
  /** 在第 N 段之后插入一段（0 = 文档开头）。只对 DOCX 生效。 */
  | { op: "insertParagraph"; after: number; text: string; style?: ParagraphStylePatch }
  /** 删除第 N 段。只对 DOCX 生效；表格里的段落拒绝删除。 */
  | { op: "deleteParagraph"; paragraph: number }
  /** 在第 N 段之后插入一张表格（rows 是二维文本数组，第一行默认加粗当表头）。 */
  | { op: "addTable"; after: number; rows: string[][]; header?: boolean }
  /**
   * DOCX 表格结构编辑。`table` 是文档里第几张表（1 起），行列都从 1 起；
   * 插入行列会复制相邻行的边框 / 列宽，新单元格是空的。
   */
  /** 删除文档里的第 N 张表（1 起，连同表格里的段落）。 */
  | { op: "deleteTable"; table: number }
  | { op: "insertTableRow"; table: number; at: number; count?: number }
  | { op: "deleteTableRow"; table: number; at: number; count?: number }
  | { op: "insertTableColumn"; table: number; at: number; count?: number }
  | { op: "deleteTableColumn"; table: number; at: number; count?: number }
  /** 改单元格文字：只换这一个格的内容，保留字体和段落格式。 */
  | { op: "setTableCellText"; table: number; row: number; col: number; text: string }
  /** 在第 N 段之后插入分页符。 */
  | { op: "addPageBreak"; after: number }
  /** 设置页眉或页脚的文字（DOCX）；保留部件里已有的图片和格式。 */
  /** 整篇替换所有出现的文字（保留命中 run 的格式；跨 run 时退化为整段重写）。 */
  | { op: "replaceDocumentText"; find: string; replace: string }
  | { op: "setHeaderFooter"; kind: "header" | "footer"; text: string }
  /** 在第 N 段之后插入一张图片（base64，宽高单位 pt，等比缩放由调用方决定）。 */
  | { op: "addImage"; after: number; dataBase64: string; mime: string; width?: number; height?: number }
  // -------------------------------------------------------------------------
  // PDF（页面级操作 + 叠加内容 + 表单填写）
  // -------------------------------------------------------------------------
  /** 删除一页（1 起）；至少要保留一页。 */
  | { op: "deletePage"; page: number }
  /** 把第 from 页挪到第 to 页（都从 1 起）。 */
  | { op: "movePage"; from: number; to: number }
  /** 旋转一页；degrees 只能是 90 的倍数。 */
  | { op: "rotatePage"; page: number; degrees: number }
  /** 在第 N 页之后插入一张空白页（0 = 最前面）；尺寸默认沿用相邻页。 */
  | { op: "insertBlankPage"; after: number; width?: number; height?: number }
  /**
   * 从另一份 PDF 复制页面插到第 N 页之后（0 = 最前面）。
   * pages 省略表示整份；页面按给定顺序插入，原文件不受影响。
   */
  | { op: "insertPdfPages"; after: number; dataBase64: string; pages?: number[] }
  /** 在页面上叠加一行文字；x/y 以左上角为原点（pt）。 */
  | {
      op: "addPageText"
      page: number
      text: string
      x: number
      y: number
      size?: number
      color?: string
    }
  /** 在页面上叠加一张图片；x/y/宽高都是 pt，原点在左上角。 */
  | {
      op: "addPageImage"
      page: number
      dataBase64: string
      mime: string
      x: number
      y: number
      width: number
      height: number
    }
  /** 把页面上的第 index 张图片（默认第一张）换成新图，位置和缩放保持不变。 */
  | { op: "replacePageImage"; page: number; index?: number; dataBase64: string; mime: string }
  /**
   * 调整页面上已有图片的位置 / 尺寸 / 旋转（图片本身不动）。
   * x / y 以左上角为原点（pt），rotation 顺时针角度；省略的字段沿用原值。
   */
  | {
      op: "setPageImageBox"
      page: number
      index?: number
      x?: number
      y?: number
      width?: number
      height?: number
      rotation?: number
    }
  /** 加一条批注（标记 / 便签 / 文本框 / 形状 / 回复）。 */
  | {
      op: "annotatePage"
      page: number
      kind: PdfAnnotationKind
      x: number
      y: number
      width: number
      height: number
      color?: string
      contents?: string
      /** 给这条批注起个名字，供回复引用。 */
      id?: string
      /** 回复另一条批注（用它的 id）。 */
      replyTo?: string
      /** 文本框批注的字号（pt）。 */
      fontSize?: number
    }
  /** 裁切页面：四边各裁掉多少 pt（原点沿用页面媒体框）。 */
  | { op: "cropPage"; page: number; top?: number; right?: number; bottom?: number; left?: number }
  /** 填写 AcroForm 表单字段。 */
  | { op: "fillForm"; fields: Array<{ name: string; value: string | boolean }> }
  /**
   * 在页面内容流里替换已有文字（保留原字体 / 字号 / 坐标）。
   * 只匹配内容流里完整的字符串 run；跨 run 或复合字体会明确报 not_found。
   */
  | { op: "replacePageText"; page: number; find: string; replace: string; all?: boolean }
  /** 页面设置：纸张、方向、页边距（mm）。 */
  | {
      op: "setPageSetup"
      size?: "A4" | "A3" | "Letter"
      orientation?: "portrait" | "landscape"
      margins?: { top?: number; right?: number; bottom?: number; left?: number }
    }
  | { op: "setShapeBox"; slide: number; shapeId: string; box: import("./units").BoxPt }
  | { op: "rotateShape"; slide: number; shapeId: string; degrees: number }
  | { op: "replaceImage"; slide: number; shapeId: string; data: Uint8Array; mime: string }
  /** 删除一页；至少要保留一页。只改 presentation.xml，页面部件留在包里。 */
  | { op: "deleteSlide"; slide: number }
  /** 调整页面顺序：第 from 页挪到第 to 页（都从 1 开始）。 */
  | { op: "moveSlide"; from: number; to: number }
  /** 复制一页（内容与版式照抄，紧跟在原页后面）；接着用按页改字的 op 改成新内容。 */
  | { op: "duplicateSlide"; slide: number }
  /**
   * 新建一页空白页：插在第 after 页之后（0 = 最前面，省略 = 最后）。
   * `layout` 指定版式（显示名 / slideLayoutN.xml / 1-based 序号）；省略则沿用相邻页。
   */
  | { op: "addSlide"; after?: number; layout?: string }
  /** 在页上新增一个文本框。不传 box 时放在左上角默认位置。 */
  | {
      op: "addTextBox"
      slide: number
      text: string
      box?: import("./units").BoxPt
      style?: {
        bold?: boolean
        italic?: boolean
        underline?: boolean
        size?: number
        color?: string
        align?: "l" | "ctr" | "r" | "just"
        font?: string
      }
    }
  /** 在页上新增一个预设形状（矩形 / 圆 / 箭头 / 线条…）。box 单位 pt。 */
  | {
      op: "addShape"
      slide: number
      kind: "rect" | "roundRect" | "ellipse" | "triangle" | "diamond" | "rightArrow" | "line" | "star5"
      box?: import("./units").BoxPt
      /** 填充色 RRGGBB；省略用主题强调色。 */
      fill?: string
      /** 描边色 RRGGBB；省略无描边。 */
      line?: string
      /** 形状里的文字。 */
      text?: string
      style?: {
        bold?: boolean
        italic?: boolean
        underline?: boolean
        size?: number
        color?: string
        align?: "l" | "ctr" | "r" | "just"
        font?: string
      }
    }
  /** 删除页上的一个形状（组合里的子形状不能单独删）。 */
  | { op: "deleteShape"; slide: number; shapeId?: string; shapeName?: string }
  /** 改形状的名字（幻灯片里显示在「选择窗格」中的那个名字）。 */
  | { op: "renameShape"; slide: number; shapeId?: string; shapeName?: string; name: string }
  /** 设置备注页正文；没有备注页时自动新建一个。 */
  | { op: "setSlideNotes"; slide: number; text: string }
  /** 放映时隐藏 / 取消隐藏一页。 */
  | { op: "setSlideHidden"; slide: number; hidden: boolean }
  /** 换版式：显示名 / slideLayoutN.xml / 1 起的序号。 */
  | { op: "setSlideLayout"; slide: number; layout: string }
  | { op: "setCellValue"; sheet: string; ref: CellRef; value: string | number | { formula: string } }
  | { op: "setCellStyle"; sheet: string; range: { start: CellRef; end: CellRef }; style: CellStylePatch }
  /** 清空一块区域里的单元格（保留行列位置和其他内容）；`remove /Sheet1/A1:B2` 用它。 */
  | { op: "clearCells"; sheet: string; range: { start: CellRef; end: CellRef } }
  /** 在第 at 行之前插入 count 行（at 从 1 开始）；引用、合并、列宽一起跟着走。 */
  | { op: "insertRows"; sheet: string; at: number; count?: number }
  /** 从第 at 行开始删除 count 行。 */
  | { op: "deleteRows"; sheet: string; at: number; count?: number }
  /** 在第 at 列之前插入 count 列（at 从 1 开始，A=1）。 */
  | { op: "insertColumns"; sheet: string; at: number; count?: number }
  /** 从第 at 列开始删除 count 列。 */
  | { op: "deleteColumns"; sheet: string; at: number; count?: number }
  /** 新增一张空工作表，插在最后；名字最多 31 字符、不能重名。 */
  | { op: "addSheet"; name: string }
  /** 重命名工作表；sheet 是旧名字。 */
  | { op: "renameSheet"; sheet: string; name: string }
  /** 删除工作表；至少要保留一张。 */
  | { op: "deleteSheet"; sheet: string }
  /** 设置工作表标签颜色（RRGGBB / AARRGGBB）；空串或省略表示去掉颜色。 */
  | { op: "setSheetTabColor"; sheet: string; color?: string }
  /** 纯文本/富文本编辑器的整段替换（避免和文档段落混淆）。 */
  | { op: "setSpanText"; paragraph: number; text: string }
  // -------------------------------------------------------------------------
  // 文本 / 代码编辑器命令
  // -------------------------------------------------------------------------
  /** 整体替换文档内容（换行用 \n；编码与换行符由引擎按原文件恢复）。 */
  | { op: "setText"; text: string }
  | { op: "sortLines"; descending?: boolean }
  | { op: "uniqueLines" }
  | { op: "reverseLines" }
  | { op: "joinLines" }
  /** 上下移动选中的行（省略 start/end 时是第一行）。 */
  | { op: "moveLines"; direction: "up" | "down"; start?: number; end?: number }
  | { op: "duplicateLines"; start?: number; end?: number }
  | { op: "deleteLines"; start?: number; end?: number }
  | { op: "trimTrailing"; keepHardBreaks?: boolean }
  /**
   * 转换大小写。省略 start / end 时作用于整篇；
   * 模型没有光标，只能给区间或整篇。
   */
  | { op: "changeCase"; mode: "upper" | "lower" | "title"; start?: number; end?: number }
  /** 统一缩进（tab ↔ 空格）。区间语义同 changeCase。 */
  | { op: "convertIndent"; toTabs: boolean; width?: number; start?: number; end?: number }
  | { op: "toggleComment"; marker?: string }
  | { op: "formatJson"; indent?: string }
  /** 设标题级别（0 = 取消）。start/end 是选中行的偏移范围；仅 Markdown。 */
  | { op: "setHeading"; level: number; start: number; end: number }
  /** 无序 / 有序 / 任务列表开关。start/end 是选中行的偏移范围。 */
  | { op: "toggleList"; kind: "bullet" | "ordered" | "task"; start: number; end: number }
  /** 引用开关。start/end 是选中行的偏移范围。 */
  | { op: "toggleQuote"; start: number; end: number }
  /** 翻转选中行的任务勾选（`- [ ]` ↔ `- [x]`）。 */
  | { op: "toggleTask"; start: number; end: number }
  /** 改 Markdown front-matter 里的一个属性（没有属性区时新建）。 */
  | { op: "setProperty"; key: string; value: string | number | boolean | null | string[] }
  /** 删除 Markdown front-matter 里的一个属性。 */
  | { op: "deleteProperty"; key: string }
  // -------------------------------------------------------------------------
  // 富文本编辑器命令
  // -------------------------------------------------------------------------
  | { op: "setBlockType"; block: number; tag: RichBlockTag }
  | { op: "setBlockAlign"; block: number; align: RichAlign }
  | { op: "setBlockLineHeight"; block: number; value: number }
  | { op: "setBlockIndent"; block: number; value: number }
  /** 首行缩进（px）；0 表示不缩进。 */
  | { op: "setBlockFirstLineIndent"; block: number; value: number }
  /** 列表开关：包成 <ul>/<ol>、换类型，或 none 取消。 */
  | { op: "setBlockList"; block: number; kind: "ul" | "ol" | "none" }
  /** 只改 [start, end) 这一小段文字的行内格式（不传区间则整块）。 */
  | { op: "formatRange"; block: number; start?: number; end?: number; patch: RichFormatPatch }
  /**
   * 用一段 HTML 替换整个块的内部（富文本设计视图用）。
   * 引擎会重新解析这段 HTML，解析不出安全结构就整体拒绝。
   */
  | { op: "setBlockHtml"; block: number; html: string }
  /** 在第 N 块之后插入一个新块（0 = 文档开头）；只对富文本生效。 */
  | { op: "insertBlock"; after: number; html?: string; text?: string; tag?: RichBlockTag }
  /** 删除第 N 块；只对富文本生效。 */
  | { op: "deleteBlock"; block: number }

export type PdfAnnotationKind =
  | "highlight"
  | "underline"
  | "squiggly"
  | "strikeOut"
  | "note"
  | "text"
  | "square"
  | "circle"
  | "line"

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
  /**
   * 链接地址：`https://…` / `mailto:…` / 相对路径 / `#锚点`。
   * 传空串表示去掉链接（文字保留）。`javascript:` 这类协议一律拒绝。
   */
  link?: string
  /** 清空选区上的所有行内格式（与其它字段互斥）。链接保留，和常见编辑器一致。 */
  clear?: boolean
}

export type ParagraphStylePatch = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** 删除线。 */
  strike?: boolean
  /** pt */
  size?: number
  /** RRGGBB */
  color?: string
  /** 文字底纹（高亮），RRGGBB；空串表示去掉。 */
  highlight?: string
  align?: "l" | "ctr" | "r" | "just"
  /** 行距倍数：1 = 单倍，1.5 = 1.5 倍。 */
  lineSpacing?: number
  /** 首行缩进，pt。 */
  firstLineIndent?: number
  /** 左缩进，pt。 */
  indent?: number
  /** 清除格式：去掉字符样式和段落缩进/对齐，恢复正文。 */
  clear?: boolean
  font?: string
  /**
   * 命名段落样式（`w:pStyle`），如 `Heading1`、`Title`。
   * DOCX 用它套用文档自己的样式表；传空串表示恢复「正文」。
   */
  paragraphStyle?: string
  /**
   * 列表：`bullet` 项目符号、`number` 编号、`none` 取消列表。
   * 目前 DOCX 会写入 `w:numPr` 并自动补齐 `word/numbering.xml`。
   */
  list?: "bullet" | "number" | "none"
  /** 列表层级，0 起；省略按 0。 */
  listLevel?: number
}

export type CellStylePatch = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  fill?: string
  size?: number
  /** 数字格式：别名（general/percent/date/…）或 Excel 格式代码原文。 */
  format?: string
  align?: "l" | "ctr" | "r"
  wrap?: boolean
  merge?: boolean
  /** 四边框线型：thin / medium / thick / dashed / dotted / double / none。 */
  border?: string
}

/** 一次 apply 的结果：新字节 + 改了哪些包内条目 + 实际生效的操作。 */
export type ApplyOutcome<TState> = {
  state: TState
  bytes: Uint8Array
  /** 真正被重写的 zip 条目（正常情况下只有目标 XML）。 */
  changed: string[]
  applied: unknown[]
}

/** 打开 / 编辑时可以带的宿主级选项；目前只有加密 PDF 的密码。 */
export type OfficeEngineOptions = {
  /** 加密 PDF 的用户密码或所有者密码；其它格式忽略。 */
  password?: string
}

/** 每种格式实现这一组方法，宿主不关心它内部是 XML 还是 PDF 对象。 */
export interface OfficeEngine<TState> {
  readonly format: OfficeFormat
  /** 解析字节，产出可编辑的布局状态。 */
  open(bytes: Uint8Array, options?: OfficeEngineOptions): Promise<OfficeResult<TState>>
  /**
   * 应用一批操作。契约要求**全有或全无**：
   * 任何一步失败都不能留下半改的文件，也不能返回新字节。
   * `bytes` 是当前完整文件，引擎只在内存里改，写盘由宿主负责。
   */
  apply(
    state: TState,
    ops: readonly OfficeOp[],
    bytes: Uint8Array,
    options?: OfficeEngineOptions,
  ): Promise<OfficeResult<ApplyOutcome<TState>>>
  /** 导出成另一种格式（pdf/png/csv…）；不支持时返回 unsupported_format。 */
  export?(
    state: TState,
    target: string,
    bytes: Uint8Array,
    options?: OfficeEngineOptions,
  ): Promise<OfficeResult<Uint8Array>>
}
