/**
 * `novaway office` —— 给 Agent 和脚本用的文档命令行（子命令：
 * `create / info / view / get / set / add / remove / batch / run / export / commands`）。
 *
 * 和面板、`office_document_edit` 工具走**同一条引擎路径**：
 *   - 同一份 `OfficeOp` 词汇（`ops-schema.ts` 校验）；
 *   - 同样的外科手术式写回（只重写被点中的 XML 部件，其余字节原样）；
 *   - 同样的原子写盘（临时文件 + rename）。
 *
 * 内容用统一路径寻址（和 `parseOfficePath` 一套语法）：
 *   `/body/p[3]`、`/Sheet1/B2`、`/Sheet1/A1:C10`、`/slide[2]/shape[1]`、`/page[4]`。
 * 这样模型不用先理解一整份 `OfficeOp` JSON，也能点名改一个段落 / 单元格 / 形状。
 *
 * 输出统一是 JSON 信封：`{"ok":true,"data":…}` / `{"ok":false,"error":{code,message}}`，
 * 加 `--json` 时只打这一行，方便脚本 `| jq`。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { PDFDocument } from "pdf-lib"
import type { Argv } from "yargs"
import {
  parseOfficePath,
  type OfficeEngine,
  type OfficeFormat,
  type OfficeOp,
  type ParagraphStylePatch,
  type PathTarget,
} from "@novaway/core/office/engine/contract"
import { engineFor, kindOfPath, officeFormatOf } from "@novaway/core/office/engine/registry"
import { createDocumentAsync } from "@novaway/core/office/create"
import {
  extractPdfImages,
  extractPdfPages,
  mergePdfPages,
  openPdfBytes,
  readPdfPageText,
  readPdfText,
  splitPdfPages,
} from "@novaway/core/office/pdf/engine"
import { RasterError, rasterizePdf } from "@/office/raster"
import { replaceMarkdownRange, splitMarkdownLines } from "@novaway/core/office/text/live-preview"
import { formatOutline, outlineOf } from "@novaway/core/office/outline"
import { toOfficeOp, type DocumentOpInput } from "@/office/ops-schema"
import { cmd } from "./cmd"

type Actions =
  | "create"
  | "info"
  | "view"
  | "get"
  | "set"
  | "add"
  | "remove"
  | "batch"
  | "run"
  | "export"
  | "split"
  | "merge"
  | "commands"
  | "guide"
  | "help"

type Args = {
  action: string
  file?: string
  /** 内容路径（get / set / add / remove）或导出目标文件（export）。 */
  target?: string
  /** set 的值；也可以是 `value=1280` / `text=...` / `rotation=90` 这种赋值写法。 */
  value?: string
  ops?: string
  json?: boolean
  kind?: string
  title?: string
  body?: string
  force?: boolean
  type?: string
  text?: string
  rows?: string
  /** `--rows 2 --cols 3` 生成空表格骨架。 */
  cols?: number
  image?: string
  /** add --type pages 的源 PDF 路径（插到目标 PDF 里）。 */
  from?: string
  /** merge 的其余源文件（逗号分隔的路径，追加在位置参数之后）。 */
  files?: string
  /** 加密 PDF 的密码（用户密码或所有者密码）。 */
  password?: string
  width?: number
  height?: number
  /** 文本框 / 形状 / PDF 叠字的左上角（pt）。 */
  x?: number
  y?: number
  after?: number
  /** add --type slide 的版式：名称 / slideLayoutN.xml / 1-based 序号。 */
  layout?: string
  /** add --type shape 的预设形状名（也可直接用 --type ellipse 这种简写）。 */
  shape?: string
  degrees?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  highlight?: string
  lineSpacing?: number
  firstLineIndent?: number
  indent?: number
  clear?: boolean
  size?: number
  color?: string
  fill?: string
  align?: "l" | "ctr" | "r" | "just"
  font?: string
  style?: string
  /** set 段落：bullet / number / none。 */
  list?: "bullet" | "number" | "none"
  /** set 段落：列表层级（0 起）。 */
  level?: number
  border?: string
  format?: string
  wrap?: boolean
  merge?: boolean
  /** set：段落格式的字符区间（选中文字）。 */
  start?: number
  end?: number
  /** set /page[N] find=… 时的新文字。 */
  replace?: string
  /** PDF 原地替换的目标文字（和 `find=…` 等价）。 */
  find?: string
  /** 工作表 / 形状的名字。 */
  name?: string
  /** 工作表标签颜色（RRGGBB / AARRGGBB）；空串表示去掉。 */
  tabColor?: string
  /** 幻灯片备注页正文。 */
  notes?: string
  /** 放映时隐藏这一页。 */
  hidden?: boolean
  /** export PNG 的位图缩放（1 = 72 dpi，默认 2）。 */
  scale?: number
  /** PDF 页 / PPTX 形状的旋转角度；配合 --image-index 时是图片角度。 */
  rotation?: number
  /** set /page[N] 时要调整的图片序号（1 起）。 */
  imageIndex?: number
  /** replacePageText：替换整页所有匹配。 */
  all?: boolean
  /** export：要提取的页码，例如 1-3,5。 */
  pages?: string
  /** export PDF 时导出内嵌图片而不是页面。 */
  images?: boolean
  /** split：每份页数。 */
  every?: number
  /** 写到另一个文件，而不是原地覆盖（set / add / remove / run / batch）。 */
  out?: string
  /** 只演算，不写盘。 */
  dryRun?: boolean
  /** batch：某一步失败后继续执行剩下的步骤。 */
  keepGoing?: boolean
  /** run / batch：没有改动也写盘。 */
  save?: boolean
  /** run 的命令参数（JSON 对象）。 */
  params?: string
  /** batch：步骤 JSON 文件。 */
  input?: string
  /** batch：步骤 JSON 文本。 */
  commands?: string
  /** create：起始模板（内置名字或一份现有文档的路径）。 */
  template?: string
  /** export：只导出某一页（等价 --pages N）。 */
  page?: number
  /** add：插到这个路径之前。 */
  before?: string
  /** add：插到第 N 个位置（1 起）。 */
  index?: number
  /** 单元格矩阵写入（set /Sheet1/A1 values:=[[…]]）。 */
  values?: string
}

type Envelope =
  | { ok: true; data: unknown }
  | {
      ok: false
      error: {
        code: string
        message: string
        suggestion?: string
        candidates?: string[]
        details?: unknown
      }
    }

/** 传给引擎的选项；没有密码时返回 undefined，保持零开销。 */
function engineOptions(args: Args): { password?: string } | undefined {
  return args.password === undefined ? undefined : { password: args.password }
}

class CliError extends Error {
  candidates?: string[]
  details?: unknown

  constructor(
    readonly code: string,
    message: string,
    readonly suggestion?: string,
  ) {
    super(message)
  }

  withCandidates(candidates: string[]): this {
    this.candidates = candidates
    return this
  }

  withDetails(details: unknown): this {
    this.details = details
    return this
  }
}

const KINDS = ["document", "spreadsheet", "presentation", "markdown", "richtext", "plaintext"] as const

function resolveFile(input: string): string {
  return path.resolve(process.cwd(), input)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new CliError(
      "invalid_json",
      what + "不是合法 JSON：" + (error instanceof Error ? error.message : String(error)),
    )
  }
}

/** 编辑距离：用来给拼错的命令 / 操作名一个「你是想…吗」。 */
function editDistance(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  let previous = Array.from({ length: b.length + 1 }, (_item, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length] ?? Math.max(a.length, b.length)
}

/** 在候选里找最接近的一个；差得太远就返回 undefined，不硬猜。 */
function closestMatch(input: string, choices: readonly string[]): string | undefined {
  let best: { name: string; distance: number } | undefined
  const needle = input.toLowerCase()
  const limit = Math.max(2, Math.floor(Math.max(needle.length, 4) / 3))
  for (const choice of choices) {
    const lower = choice.toLowerCase()
    const distance = lower.startsWith(needle) ? 0 : editDistance(needle, lower)
    if (distance > limit) continue
    if (!best || distance < best.distance) best = { name: choice, distance }
  }
  return best?.name
}

/** 最接近的几个候选（错误里给人 / 模型一排可选项，不硬猜一个）。 */
function closestMatches(input: string, choices: readonly string[], count = 5): string[] {
  const needle = input.toLowerCase()
  return choices
    .map((name) => ({ name, distance: editDistance(needle, name.toLowerCase()) }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, count)
    .filter((item) => item.distance <= Math.max(3, Math.floor(needle.length / 2)))
    .map((item) => item.name)
}

/** 线上 JSON → 引擎操作；校验规则和 AI 工具完全一致。 */
function parseOps(text: string): OfficeOp[] {
  const parsed = parseJson(text, "ops")
  const list = Array.isArray(parsed) ? parsed : (parsed as { ops?: unknown }).ops
  if (!Array.isArray(list)) throw new CliError("invalid_params", "ops 需要是数组（或 {ops:[...]}）")
  return list.map((item, index) => {
    const converted = toOfficeOp(item as DocumentOpInput)
    if (!converted.ok) {
      const unknown = /^不支持的操作：(.+)$/.exec(converted.message)?.[1]
      const near = unknown ? closestMatch(unknown, OP_NAMES) : undefined
      throw new CliError(
        "invalid_params",
        `第 ${index + 1} 个操作：${converted.message}`,
        near ? "你是想用 " + near + " 吗？" : "用 `novaway office commands` 查看全部操作名",
      )
    }
    return converted.op
  })
}

async function open(
  file: string,
  options: { password?: string } = {},
): Promise<{
  absolute: string
  format: OfficeFormat
  bytes: Uint8Array
  engine: OfficeEngine<unknown>
  state: unknown
}> {
  const absolute = resolveFile(file)
  const format = officeFormatOf(absolute)
  if (!format) throw new CliError("unsupported_format", "不认识这种文件类型：" + file)
  const engine = engineFor(format)
  if (!engine) throw new CliError("unsupported_format", `${format} 还不能编辑：${file}`)
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(absolute))
  } catch {
    throw new CliError("not_found", "找不到文件：" + absolute)
  }
  const opened = await engine.open(bytes, options.password === undefined ? undefined : { password: options.password })
  if (!opened.ok) throw new CliError(opened.error.code, opened.error.message, opened.error.suggestion)
  return { absolute, format, bytes, engine, state: opened.data }
}

/** 原子写盘：先写同目录临时文件，再 rename 覆盖。 */
async function writeAtomic(absolute: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(absolute), { recursive: true })
  const temp = `${absolute}.novaway-${Date.now()}.tmp`
  await writeFile(temp, bytes)
  await rename(temp, absolute)
}

/** 工作表摘要：`view` 里 xlsx / csv / ods 共用。 */
function summarizeSheets(sheets: Array<{ name: string; cells: Array<{ ref: string; text: string }> }>): string {
  return sheets
    .map((sheet) => "## " + sheet.name + "\n" + sheet.cells.map((cell) => cell.ref + "\t" + cell.text).join("\n"))
    .join("\n\n")
}

/** 人能看懂的结构摘要；`view` 不带 --json 时用它。 */
function summarize(format: OfficeFormat, state: unknown): string {
  const value = state as Record<string, unknown>
  if (format === "docx") {
    const paragraphs = (value.paragraphs as Array<{ index: number; text: string; style?: string }>) ?? []
    return paragraphs
      .map((item) => `[${item.index}] ${item.text}${item.style ? "  (" + item.style + ")" : ""}`)
      .join("\n")
  }
  if (format === "xlsx" || format === "csv") {
    const sheets =
      format === "xlsx"
        ? ((value.sheets as Array<{ name: string; cells: Array<{ ref: string; text: string }> }>) ?? [])
        : [
            {
              name: "csv",
              cells: ((value.rows as Array<Array<{ value: string }>>) ?? []).flatMap((row, rowIndex) =>
                row.map((cell, colIndex) => ({ ref: columnRef(colIndex) + String(rowIndex + 1), text: cell.value })),
              ),
            },
          ]
    return summarizeSheets(sheets)
  }
  if (format === "pptx") {
    const nodes =
      (value.nodes as Array<{ slide: number; shapeId: string; shapeName?: string; paragraphs: string[] }>) ?? []
    return nodes
      .map(
        (node) =>
          `slide ${node.slide} · ${node.shapeName ?? node.shapeId}\n` +
          node.paragraphs.map((paragraph) => "  " + paragraph).join("\n"),
      )
      .join("\n")
  }
  if (format === "pdf") {
    const pages = (value.pages as Array<{ page: number; width: number; height: number; rotation: number }>) ?? []
    const fields = (value.fields as Array<{ name: string; kind: string; value?: string | boolean }>) ?? []
    const pageLines = pages.map(
      (page) =>
        `[${page.page}] ${Math.round(page.width)}×${Math.round(page.height)}pt${page.rotation ? ` 旋转 ${page.rotation}°` : ""}`,
    )
    const fieldLines = fields.map(
      (field) => `- ${field.name}（${field.kind}）${field.value !== undefined ? " = " + String(field.value) : ""}`,
    )
    return [...pageLines, ...(fieldLines.length > 0 ? ["表单字段：", ...fieldLines] : [])].join("\n")
  }
  if (format === "html") {
    const blocks = (value.blocks as Array<{ index: number; tag: string; text: string; editable: boolean }>) ?? []
    return blocks
      .map((block) => `[${block.index}] <${block.tag}> ${block.text}${block.editable ? "" : "  (只读)"}`)
      .join("\n")
  }
  if (format === "legacy") {
    const paragraphs = legacyParagraphsOf(state)
    if (paragraphs.length === 0) return summarizeSheets(sheetsOf(state))
    return paragraphs.map((text, index) => `[${index + 1}] ${text}`).join("\n")
  }
  const text = (value.text as string) ?? ""
  return text
    .split("\n")
    .map((line, index) => `${index + 1}\t${line}`)
    .join("\n")
}

function columnRef(index: number): string {
  let value = index
  let name = ""
  while (value >= 0) {
    name = String.fromCharCode(65 + (value % 26)) + name
    value = Math.floor(value / 26) - 1
  }
  return name
}

async function runView(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "view 需要文件路径")
  const target = await open(args.file, args)
  // 三种视图：outline（默认骨架）、text（纯文本结构）、json（完整状态）。
  const mode = (args.target ?? "outline").toLowerCase()
  if (mode === "outline") {
    const outline = outlineOf(target.format, target.state)
    return {
      path: target.absolute,
      format: target.format,
      mode,
      outline,
      summary: outline.length > 0 ? formatOutline(outline) : "（空）",
    }
  }
  if (mode === "text") {
    // PDF 的「文字」就是页面正文：`view <pdf> text` 给出每页文字。
    if (target.format === "pdf") {
      let texts: Array<{ page: number; text: string }> = []
      try {
        texts = await readPdfText(target.bytes, undefined, args.password)
      } catch (error) {
        throw new CliError("unsupported_format", error instanceof Error ? error.message : String(error))
      }
      const body = texts
        .map((page) => "## 第 " + page.page + " 页\n" + (page.text.trim() || "（没有可读文字，可能是扫描件）"))
        .join("\n\n")
      const summary = summarize(target.format, target.state)
      return {
        path: target.absolute,
        format: target.format,
        mode,
        summary: summary + "\n\n" + body,
        text: body,
        pages: texts,
      }
    }
    const summary = summarize(target.format, target.state)
    return { path: target.absolute, format: target.format, mode, summary, text: summary }
  }
  if (mode === "json" || mode === "inspect" || mode === "tree") {
    return {
      path: target.absolute,
      format: target.format,
      mode: "json",
      state: target.state,
      summary: JSON.stringify(target.state, null, 2),
    }
  }
  throw new CliError("usage", `不认识的视图：${mode}`, "可选 outline / text / json").withCandidates([
    "outline",
    "text",
    "json",
  ])
}

async function runSet(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "set 需要文件路径")
  if (args.ops === undefined) throw new CliError("invalid_params", "set 需要 --ops '<json>'（用 - 从标准输入读）")
  const ops = parseOps(args.ops === "-" ? await readStdin() : args.ops)
  if (ops.length === 0) throw new CliError("invalid_params", "没有要执行的操作")
  return applyOps(args, ops)
}

type BatchStep = { path: string; ops: OfficeOp[] }

async function readBatch(args: Args): Promise<BatchStep[]> {
  if (!args.file) throw new CliError("invalid_params", "batch 需要脚本路径（用 - 从标准输入读）")
  const text = args.file === "-" ? await readStdin() : await readFile(resolveFile(args.file), "utf8")
  const parsed = parseJson(text, "batch 脚本")
  const steps = Array.isArray(parsed) ? parsed : (parsed as { steps?: unknown }).steps
  if (!Array.isArray(steps)) throw new CliError("invalid_params", "batch 脚本需要 {steps:[{path,ops}]}")
  return steps.map((raw, index) => {
    const step = raw as { path?: unknown; ops?: unknown }
    if (typeof step.path !== "string") throw new CliError("invalid_params", `第 ${index + 1} 步缺少 path`)
    if (!Array.isArray(step.ops)) throw new CliError("invalid_params", `第 ${index + 1} 步缺少 ops 数组`)
    return {
      path: step.path,
      ops: step.ops.map((item, opIndex) => {
        const converted = toOfficeOp(item as DocumentOpInput)
        if (!converted.ok) {
          throw new CliError("invalid_params", `第 ${index + 1} 步第 ${opIndex + 1} 个操作：${converted.message}`)
        }
        return converted.op
      }),
    }
  })
}

function errorJson(error: unknown) {
  if (error instanceof CliError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.suggestion ? { suggestion: error.suggestion } : {}),
    }
  }
  return { code: "engine", message: error instanceof Error ? error.message : String(error) }
}

/**
 * `batch`：按「一个文件 + 一串步骤」工作。
 *
 * 步骤可以是 `{"set":路径,"props":{…}}`、`{"add":父路径,"type":…,"props":{…}}`、
 * `{"remove":路径}`、`{"get":路径}` 或 `{"command":命令id,"params":{…}}`。
 * 所有步骤先在内存里跑完；任何一步失败就整份文件都不写，错误里逐步列出状态。
 * 旧的多文件脚本写法（`{steps:[{path,ops}]}`）继续可用。
 */
async function runBatch(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "batch 需要文件路径或脚本路径")
  return isScriptBatch(args) ? runScriptBatch(args) : runFileBatch(args)
}

/** 没有给 --input/--commands 且指向 .json（或标准输入）时，按旧的多文件脚本读。 */
function isScriptBatch(args: Args): boolean {
  if (args.input !== undefined || args.commands !== undefined) return false
  return args.file === "-" || /\.json$/i.test(args.file ?? "")
}

/** 旧写法：脚本里的步骤各自带 path，一次改多个文件。 */
async function runScriptBatch(args: Args): Promise<Record<string, unknown>> {
  const steps = await readBatch(args)
  if (steps.length === 0) throw new CliError("invalid_params", "batch 脚本里没有步骤")
  const pending = new Map<string, { bytes: Uint8Array; changed: string[]; format: OfficeFormat }>()
  const touched: string[] = []
  const results: Array<Record<string, unknown>> = []
  let failed = 0

  for (const [index, step] of steps.entries()) {
    if (failed > 0 && !args.keepGoing) {
      results.push({ index: index + 1, path: step.path, status: "skipped" })
      continue
    }
    try {
      const previous = pending.get(resolveFile(step.path))
      const target = previous
        ? await openFromBytes(resolveFile(step.path), previous.bytes, args)
        : await open(step.path, args)
      const applied = await target.engine.apply(target.state, step.ops, target.bytes, engineOptions(args))
      if (!applied.ok) throw new CliError(applied.error.code, applied.error.message)
      pending.set(target.absolute, {
        bytes: applied.data.bytes,
        changed: [...new Set([...(previous?.changed ?? []), ...applied.data.changed])],
        format: target.format,
      })
      if (!touched.includes(target.absolute)) touched.push(target.absolute)
      results.push({ index: index + 1, path: step.path, status: "ok", changed: applied.data.changed })
    } catch (error) {
      failed += 1
      results.push({ index: index + 1, path: step.path, status: "failed", error: errorJson(error) })
    }
  }

  if (failed > 0) {
    const first = results.find((item) => item.status === "failed")
    const detail = first?.error as { message?: string; suggestion?: string } | undefined
    throw new CliError(
      "batch_failed",
      `${failed} / ${steps.length} 步失败；没有写任何文件（第一处：第 ${first?.index} 步 ${detail?.message ?? ""}）`,
      detail?.suggestion,
    ).withDetails({ results })
  }

  if (args.out && touched.length > 1) {
    throw new CliError("usage", "--out 只能配单个文件", "多文件脚本请分别调用，或去掉 --out")
  }
  let saved = false
  for (const absolute of touched) {
    const entry = pending.get(absolute)!
    if (args.dryRun) continue
    const writeTo = args.out ? resolveFile(args.out) : absolute
    if (entry.changed.length > 0 || args.save) {
      await writeAtomic(writeTo, entry.bytes)
      saved = true
    }
  }
  return {
    steps: steps.length,
    files: touched.map((absolute) => ({ path: absolute, changed: pending.get(absolute)!.changed })),
    results,
    saved,
    ...(args.dryRun ? { dryRun: true } : {}),
  }
}

type FileStep =
  | { kind: "get"; path: string }
  | { kind: "set"; path: string; props: Record<string, unknown> }
  | {
      kind: "add"
      parent: string
      type: string
      props: Record<string, unknown>
      after?: number | string
      before?: string
      index?: number
    }
  | { kind: "remove"; path: string }
  | { kind: "command"; id: string; params: Record<string, unknown> }
  | { kind: "ops"; ops: OfficeOp[] }

function stepLabel(step: FileStep): string {
  if (step.kind === "get") return "get " + step.path
  if (step.kind === "set") return "set " + step.path
  if (step.kind === "add") return "add " + step.type + " to " + step.parent
  if (step.kind === "remove") return "remove " + step.path
  if (step.kind === "command") return step.id
  return "ops"
}

function fileStepsOf(text: string): FileStep[] {
  const parsed = parseJson(text, "batch")
  const holder = parsed as { commands?: unknown; steps?: unknown } | unknown[]
  const list = Array.isArray(holder) ? holder : (holder.commands ?? holder.steps)
  if (!Array.isArray(list)) {
    throw new CliError(
      "invalid_params",
      'batch 是一串步骤（JSON 数组或 {"commands":[…] }）',
      '例如 [{"set":"/body/p[1]","props":{"text":"新标题"}}]',
    )
  }
  if (list.length === 0) throw new CliError("invalid_params", "batch 里没有步骤")
  const objectOf = (value: unknown, label: string): Record<string, unknown> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new CliError("invalid_params", label + " 需要 JSON 对象")
    }
    return value as Record<string, unknown>
  }
  return list.map((raw, index) => {
    const at = "第 " + (index + 1) + " 步："
    const item = objectOf(raw, at + "步骤")
    const props = () => (item.props === undefined ? {} : objectOf(item.props, at + "props"))
    if (typeof item.get === "string") return { kind: "get", path: item.get }
    if (typeof item.set === "string") return { kind: "set", path: item.set, props: props() }
    if (typeof item.remove === "string") return { kind: "remove", path: item.remove }
    if (typeof item.add === "string") {
      const type = typeof item.type === "string" ? item.type : typeof item.kind === "string" ? item.kind : undefined
      if (!type) throw new CliError("invalid_params", at + "add 需要 type")
      return {
        kind: "add",
        parent: item.add,
        type,
        props: props(),
        ...(typeof item.after === "number" || typeof item.after === "string" ? { after: item.after } : {}),
        ...(typeof item.before === "string" ? { before: item.before } : {}),
        ...(typeof item.index === "number" ? { index: item.index } : {}),
      }
    }
    const id = typeof item.command === "string" ? item.command : typeof item.op === "string" ? item.op : undefined
    if (id) {
      return { kind: "command", id, params: item.params === undefined ? {} : objectOf(item.params, at + "params") }
    }
    if (Array.isArray(item.ops)) {
      return {
        kind: "ops",
        ops: item.ops.map((entry, opIndex) => {
          const converted = toOfficeOp(entry as DocumentOpInput)
          if (!converted.ok) {
            throw new CliError("invalid_params", at + "第 " + (opIndex + 1) + " 个操作：" + converted.message)
          }
          return converted.op
        }),
      }
    }
    throw new CliError(
      "invalid_params",
      at + "不认识这种步骤",
      '支持 {"get":路径}、{"set":路径,"props":{…}}、{"add":路径,"type":…,"props":{…}}、{"remove":路径}、{"command":命令id,"params":{…}}',
    )
  })
}

/**
 * 把步骤里的 props 对象翻成 CLI 参数。
 * 属性名用固定写法（text / bold / size / color / x / y / w / h …），
 * 认不出来就明确报错 —— 静默忽略会让人以为改成功了。
 */
function argsFromProps(props: Record<string, unknown>, base: Args): Args {
  const args: Args = { ...base }
  for (const [rawKey, raw] of Object.entries(props)) {
    const key = rawKey.toLowerCase().replace(/[-_]/g, "")
    const asText = raw === null || raw === undefined ? undefined : typeof raw === "string" ? raw : String(raw)
    const asNumber = (() => {
      if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined
      if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw)
      return undefined
    })()
    const asBool = typeof raw === "boolean" ? raw : raw === "true" ? true : raw === "false" ? false : undefined
    switch (key) {
      case "text":
        args.text = asText
        break
      case "value":
        args.value = asText
        break
      case "values":
        args.values = typeof raw === "string" ? raw : JSON.stringify(raw)
        break
      case "bold":
        args.bold = asBool
        break
      case "italic":
        args.italic = asBool
        break
      case "underline":
        args.underline = asBool
        break
      case "strike":
        args.strike = asBool
        break
      case "clear":
        args.clear = asBool
        break
      case "wrap":
        args.wrap = asBool
        break
      case "merge":
        args.merge = asBool
        break
      case "all":
        args.all = asBool
        break
      case "size":
        args.size = asNumber
        break
      case "color":
        args.color = asText
        break
      case "fill":
        args.fill = asText
        break
      case "highlight":
        args.highlight = asText
        break
      case "font":
        args.font = asText
        break
      case "style":
        args.style = asText
        break
      case "align":
        args.align = asText as Args["align"]
        break
      case "format":
        args.format = asText
        break
      case "border":
        args.border = asText
        break
      case "list":
        args.list = asText as Args["list"]
        break
      case "level":
        args.level = asNumber
        break
      case "linespacing":
        args.lineSpacing = asNumber
        break
      case "firstlineindent":
        args.firstLineIndent = asNumber
        break
      case "indent":
        args.indent = asNumber
        break
      case "start":
        args.start = asNumber
        break
      case "end":
        args.end = asNumber
        break
      case "replace":
        args.replace = asText
        break
      case "find":
        args.find = asText
        break
      case "rotation":
      case "rotate":
      case "degrees":
        args.degrees = asNumber
        args.rotation = asNumber
        break
      case "name":
        args.name = asText
        break
      case "layout":
        args.layout = asText
        break
      case "title":
        args.title = asText
        break
      case "body":
        args.body = asText
        break
      case "image":
        args.image = asText
        break
      case "from":
        args.from = asText
        break
      case "files":
        args.files = asText
        break
      case "imageindex":
        args.imageIndex = asNumber
        break
      case "x":
        args.x = asNumber
        break
      case "y":
        args.y = asNumber
        break
      case "w":
      case "width":
        args.width = asNumber
        break
      case "h":
      case "height":
        args.height = asNumber
        break
      case "rows":
        args.rows = typeof raw === "string" ? raw : JSON.stringify(raw)
        break
      case "cols":
        args.cols = asNumber
        break
      case "shape":
      case "kind":
        args.shape = asText
        break
      case "notes":
        args.notes = asText
        break
      case "hidden":
        args.hidden = asBool
        break
      case "tabcolor":
        args.tabColor = asText
        break
      default:
        throw new CliError("invalid_params", "不认识的属性：" + rawKey, "用 novaway office help props 看支持的属性")
    }
  }
  return args
}

/** 单文件的 batch：在内存里逐步套用，成功才写盘。 */
async function runFileBatch(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "batch 需要文件路径")
  const text =
    args.commands ?? (args.input !== undefined ? await readFile(resolveFile(args.input), "utf8") : await readStdin())
  const steps = fileStepsOf(text)
  let target = await open(args.file, args)
  const results: Array<Record<string, unknown>> = []
  let failed = 0
  let changed = false

  for (const [index, step] of steps.entries()) {
    const label = stepLabel(step)
    if (failed > 0 && !args.keepGoing) {
      results.push({ index: index + 1, command: label, status: "skipped" })
      continue
    }
    try {
      if (step.kind === "get") {
        const value = readAt(target.format, target.state, parsePath(step.path, target.state))
        results.push({ index: index + 1, command: label, status: "ok", result: value })
        continue
      }
      let ops: OfficeOp[]
      if (step.kind === "set") {
        ops = setOpsAt(target.format, target.state, step.path, argsFromProps(step.props, args))
      } else if (step.kind === "remove") {
        ops = [removeOpAt(target.format, target.state, step.path)]
      } else if (step.kind === "add") {
        const stepArgs = argsFromProps(step.props, { ...args, type: step.type })
        if (step.after !== undefined) {
          // 数字（或数字字符串）是「插到第 N 项之后」；路径是「插到它之前」。
          if (typeof step.after === "number") stepArgs.after = step.after
          else if (/^\d+$/.test(step.after.trim())) stepArgs.after = Number(step.after)
          else stepArgs.before = step.after
        }
        if (step.before !== undefined) stepArgs.before = step.before
        if (step.index !== undefined) stepArgs.index = step.index
        ops = [await addOpAt(target.format, target.state, step.parent, stepArgs)]
      } else if (step.kind === "command") {
        ops = [opOfId(step.id, step.params)]
      } else {
        ops = step.ops
      }
      const applied = await target.engine.apply(target.state, ops, target.bytes, engineOptions(args))
      if (!applied.ok) throw new CliError(applied.error.code, applied.error.message)
      target = { ...target, state: applied.data.state, bytes: applied.data.bytes }
      if (applied.data.changed.length > 0) changed = true
      results.push({ index: index + 1, command: label, status: "ok", changed: applied.data.changed })
    } catch (error) {
      failed += 1
      results.push({ index: index + 1, command: label, status: "failed", error: errorJson(error) })
    }
  }

  if (failed > 0) {
    const first = results.find((item) => item.status === "failed")
    const detail = first?.error as { message?: string; suggestion?: string } | undefined
    throw new CliError(
      "batch_failed",
      `${failed} / ${steps.length} 步失败；${args.file} 没有改写（第一处：第 ${first?.index} 步 ${detail?.message ?? ""}）`,
      detail?.suggestion,
    ).withDetails({ results })
  }

  const writeTo = args.out ? resolveFile(args.out) : target.absolute
  const saved = !args.dryRun && (changed || args.save === true)
  if (saved) await writeAtomic(writeTo, target.bytes)
  return {
    path: writeTo,
    source: target.absolute,
    steps: steps.length,
    results,
    saved,
    ...(args.dryRun ? { dryRun: true } : {}),
  }
}

async function openFromBytes(absolute: string, bytes: Uint8Array, options: { password?: string } = {}) {
  const format = officeFormatOf(absolute)
  if (!format) throw new CliError("unsupported_format", "不认识这种文件类型：" + absolute)
  const engine = engineFor(format)
  if (!engine) throw new CliError("unsupported_format", `${format} 还不能编辑：${absolute}`)
  const opened = await engine.open(bytes, options.password === undefined ? undefined : { password: options.password })
  if (!opened.ok) throw new CliError(opened.error.code, opened.error.message, opened.error.suggestion)
  return { absolute, format, bytes, engine, state: opened.data }
}

// ---------------------------------------------------------------------------
// 路径寻址：`/body/p[3]`、`/Sheet1/B2`、`/slide[2]/shape[1]`、`/page[4]`
// ---------------------------------------------------------------------------

/** 解析之后已经知道工作表名字的路径（不再有 /sheet[N]）。 */
type ResolvedPathTarget = Exclude<PathTarget, { kind: "sheetByIndex" }>

function parsePath(input: string | undefined, state?: unknown): ResolvedPathTarget {
  if (!input) throw new CliError("invalid_params", "需要一个内容路径，例如 /body/p[3] 或 /Sheet1/B2")
  const parsed = parseOfficePath(input)
  if (!parsed.ok) throw new CliError("invalid_path", parsed.error.message, parsed.error.suggestion)
  const target = parsed.data
  // /sheet[N] 按序号定位；解析时还不知道有几张表，拿到 state 后换成名字。
  if (target.kind === "sheetByIndex") {
    if (state === undefined) throw new CliError("invalid_params", "/sheet[N] 需要打开文件后才能定位")
    const sheets = sheetsOf(state)
    const sheet = sheets[target.index - 1]
    if (!sheet) {
      throw new CliError(
        "not_found",
        `没有第 ${target.index} 张工作表（共 ${sheets.length} 张）`,
        "用 view 看看有哪些工作表",
      )
    }
    return { kind: "sheet", name: sheet.name }
  }
  // /sheet[N]/B2 与 /sheet[N]/A1:C3：序号先在 state 里换成工作表名。
  if ((target.kind === "cell" || target.kind === "range") && target.sheetIndex !== undefined) {
    if (state === undefined) throw new CliError("invalid_params", "/sheet[N] 需要打开文件后才能定位")
    const sheets = sheetsOf(state)
    const sheet = sheets[target.sheetIndex - 1]
    if (!sheet) {
      throw new CliError(
        "not_found",
        `没有第 ${target.sheetIndex} 张工作表（共 ${sheets.length} 张）`,
        "用 view 看看有哪些工作表",
      )
    }
    return { ...target, sheet: sheet.name }
  }
  return target
}

/**
 * 文本类文件（Markdown / 纯文本）的「段落」：非空行，跳过 YAML front matter。
 *
 * 这样 `/body/p[1]` 指向读者看到的第一个段落，而不是 `---` 或空行；
 * 写回时仍然只替换那一行的字符区间，其余字节（包括 front matter）一个字都不动。
 */
function contentLines(state: unknown): Array<{ number: number; start: number; end: number; source: string }> {
  const text = (state as { text?: string }).text ?? ""
  const lines = splitMarkdownLines(text)
  let from = 0
  if (lines[0] && lines[0].source.trim() === "---") {
    const close = lines.findIndex(
      (line, index) => index > 0 && (line.source.trim() === "---" || line.source.trim() === "..."),
    )
    if (close > 0) from = close + 1
  }
  const result: Array<{ number: number; start: number; end: number; source: string }> = []
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index]!
    if (line.source.trim().length === 0) continue
    result.push({ number: result.length + 1, start: line.start, end: line.end, source: line.source })
  }
  return result
}

/** 删掉一行，同时吃掉它旁边的一个换行；其余行原样保留。 */
function removeLine(source: string, line: { start: number; end: number }): string {
  const lines = splitMarkdownLines(source)
  const at = lines.findIndex((item) => item.start === line.start && item.end === line.end)
  const next = at >= 0 ? lines[at + 1] : undefined
  if (next) return source.slice(0, line.start) + source.slice(next.start)
  const before = source.slice(0, line.start)
  const carriage = String.fromCharCode(13) + String.fromCharCode(10)
  if (before.endsWith(carriage)) return before.slice(0, -2)
  if (before.endsWith(String.fromCharCode(10))) return before.slice(0, -1)
  return before
}

/**
 * `value=1280` / `text=hello` → { key, value }；没有等号时当作裸值。
 * `values:=[[…]]` 里的 `:=` 表示右边是 JSON（列表 / 对象 / 强制类型）。
 */
function assignment(input: string | undefined): { key?: string; value: string; json?: boolean } | undefined {
  if (input === undefined) return undefined
  const match = /^([A-Za-z][\w-]*)(:?=)([\s\S]*)$/.exec(input)
  if (!match) return { value: input }
  return { key: match[1]!.toLowerCase(), value: match[3]!, json: match[2] === ":=" }
}

/** 把 `--bold`、`--size 18` 这些开关收成段落/形状的格式补丁。 */
function stylePatch(args: Args): ParagraphStylePatch | undefined {
  const patch: ParagraphStylePatch = {
    ...(args.bold !== undefined ? { bold: args.bold } : {}),
    ...(args.italic !== undefined ? { italic: args.italic } : {}),
    ...(args.underline !== undefined ? { underline: args.underline } : {}),
    ...(args.strike !== undefined ? { strike: args.strike } : {}),
    ...(args.size !== undefined ? { size: args.size } : {}),
    ...(args.color ? { color: args.color.replace(/^#/, "") } : {}),
    ...(args.highlight !== undefined ? { highlight: args.highlight.replace(/^#/, "") } : {}),
    ...(args.align ? { align: args.align } : {}),
    ...(args.font ? { font: args.font } : {}),
    ...(args.lineSpacing !== undefined ? { lineSpacing: args.lineSpacing } : {}),
    ...(args.firstLineIndent !== undefined ? { firstLineIndent: args.firstLineIndent } : {}),
    ...(args.indent !== undefined ? { indent: args.indent } : {}),
    ...(args.clear !== undefined ? { clear: args.clear } : {}),
    ...(args.style ? { paragraphStyle: args.style } : {}),
    ...(args.list ? { list: args.list } : {}),
    ...(args.level !== undefined ? { listLevel: args.level } : {}),
  }
  return Object.keys(patch).length > 0 ? patch : undefined
}

function paragraphsOf(state: unknown): Array<{ index: number; text: string; style?: string; inTable?: boolean }> {
  return (
    (state as { paragraphs?: Array<{ index: number; text: string; style?: string; inTable?: boolean }> }).paragraphs ??
    []
  )
}

function sheetsOf(state: unknown): Array<{
  name: string
  /** 标签颜色（AARRGGBB），没有就不带这个字段。 */
  tabColor?: string
  cells: Array<{
    ref: string
    row: number
    col: number
    text: string
    formula?: string
    value?: string | number | boolean
  }>
}> {
  const raw =
    (
      state as {
        sheets?: Array<{
          name: string
          cells?: Array<{ ref: string; row: number; col: number; text: string }>
          rows?: string[][]
        }>
      }
    ).sheets ?? []
  // 旧格式（ODS）的状态只有 rows；这里统一摊平成单元格，读/写的路径就共用一套。
  return raw.map((sheet) =>
    sheet.cells
      ? (sheet as {
          name: string
          tabColor?: string
          cells: Array<{ ref: string; row: number; col: number; text: string }>
        })
      : {
          name: sheet.name,
          cells: (sheet.rows ?? []).flatMap((row, rowIndex) =>
            row.map((text, colIndex) => ({ ref: refOf(rowIndex, colIndex), row: rowIndex, col: colIndex, text })),
          ),
        },
  )
}

/** 旧格式（ODT / ODP / RTF）的段落是纯字符串数组，没有样式对象。 */
function legacyParagraphsOf(state: unknown): string[] {
  return (state as { paragraphs?: string[] }).paragraphs ?? []
}

function nodesOf(state: unknown): Array<{
  slide: number
  shapeId: string
  shapeName?: string
  kind?: string
  paragraphs: string[]
  styles?: unknown[]
  box?: { x: number; y: number; w: number; h: number }
  cells?: Array<{ row: number; col: number; paragraphs: string[] }>
}> {
  return (
    (state as { nodes?: Array<{ slide: number; shapeId: string; shapeName?: string; paragraphs: string[] }> }).nodes ??
    []
  )
}

function pagesOf(state: unknown): Array<{ page: number; width: number; height: number; rotation: number }> {
  return (state as { pages?: Array<{ page: number; width: number; height: number; rotation: number }> }).pages ?? []
}

/** 幻灯片元数据（备注、隐藏）；旧状态没有这个字段时返回空数组。 */
function slidesOf(state: unknown): Array<{ index: number; hidden: boolean; notes?: string; layout?: string }> {
  return (state as { slides?: Array<{ index: number; hidden: boolean; notes?: string; layout?: string }> }).slides ?? []
}

/** 旧格式的演示文稿只有 text，页边界写在「## 第 N 页」标题里。 */
function legacySlide(state: unknown, index: number): string[] | undefined {
  const text = (state as { text?: string }).text ?? ""
  const sections = text.split("## 第 ").slice(1)
  if (sections.length === 0) return undefined
  const section = sections[index - 1]
  if (section === undefined) return undefined
  const lineEnd = section.indexOf(String.fromCharCode(10))
  const body = lineEnd === -1 ? "" : section.slice(lineEnd + 1)
  return body
    .split(String.fromCharCode(10))
    .map((line) => line.trim())
    .filter((line) => line !== "")
}

/** 按序号（1 起）/ id / 名字找幻灯片上的形状；三种写法对应同一条寻址语法。 */
function findShape(state: unknown, slide: number, target: { id?: string; name?: string; index?: number }) {
  const onSlide = nodesOf(state).filter((node) => node.slide === slide)
  if (target.id !== undefined) {
    const node = onSlide.find((item) => item.shapeId === target.id)
    if (!node)
      throw new CliError("not_found", `第 ${slide} 页没有 id=${target.id} 的形状`, "用 get /slide[N] 看形状列表")
    return node
  }
  if (target.name !== undefined) {
    const node = onSlide.find((item) => (item.shapeName ?? "") === target.name)
    if (!node)
      throw new CliError(
        "not_found",
        `第 ${slide} 页没有名为「${target.name}」的形状`,
        "名字要和文件里的一致（区分大小写）",
      )
    return node
  }
  const node = onSlide[(target.index ?? 1) - 1]
  if (!node) throw new CliError("not_found", `第 ${slide} 页没有第 ${target.index ?? 1} 个形状`)
  return node
}

/** 读一个路径上的值。只读，不改文件。 */
function readAt(format: OfficeFormat, state: unknown, target: ResolvedPathTarget): unknown {
  if (target.kind === "paragraph") {
    if (format === "legacy") {
      const text = legacyParagraphsOf(state)[target.index - 1]
      if (text === undefined) throw new CliError("not_found", `没有第 ${target.index} 段`)
      return { index: target.index, text }
    }
    if (format === "docx") {
      const paragraph = paragraphsOf(state).find((item) => item.index === target.index)
      if (!paragraph) throw new CliError("not_found", `没有第 ${target.index} 段`)
      return { index: paragraph.index, text: paragraph.text, style: paragraph.style, inTable: paragraph.inTable }
    }
    if (format === "html") {
      const blocks = (state as { blocks?: Array<{ index: number; tag: string; text: string }> }).blocks ?? []
      const block = blocks[target.index - 1]
      if (!block) throw new CliError("not_found", `没有第 ${target.index} 块`)
      return { index: block.index, tag: block.tag, text: block.text }
    }
    const line = contentLines(state)[target.index - 1]
    if (!line) throw new CliError("not_found", `没有第 ${target.index} 段`)
    return { index: target.index, text: line.source }
  }
  if (target.kind === "table") {
    const inTable = paragraphsOf(state).filter((item) => item.inTable)
    if (inTable.length === 0) throw new CliError("not_found", "文档里没有表格")
    return { table: target.index, paragraphs: inTable.map((item) => item.text) }
  }
  if (target.kind === "document") {
    if (format === "docx") {
      return {
        paragraphs: paragraphsOf(state).length,
        header: (state as { header?: string }).header,
        footer: (state as { footer?: string }).footer,
      }
    }
    if (format === "html") return { blocks: ((state as { blocks?: unknown[] }).blocks ?? []).length }
    if (format === "legacy") return { paragraphs: legacyParagraphsOf(state).length }
    return { text: (state as { text?: string }).text ?? "" }
  }
  if (target.kind === "sheet") {
    const sheet = sheetsOf(state).find((item) => item.name === target.name)
    if (!sheet) throw new CliError("not_found", "没有工作表：" + target.name, "用 view 看看有哪些工作表")
    return {
      name: sheet.name,
      ...(sheet.tabColor ? { tabColor: sheet.tabColor } : {}),
      rows: maxRow(sheet) + 1,
      cols: maxCol(sheet) + 1,
      cells: sheet.cells.map((cell) => ({
        ref: cell.ref,
        text: cell.text,
        ...(cell.formula ? { formula: cell.formula } : {}),
      })),
    }
  }
  if (target.kind === "cell" || target.kind === "range") {
    const sheet = sheetsOf(state).find((item) => item.name === target.sheet)
    if (!sheet) throw new CliError("not_found", "没有工作表：" + target.sheet)
    const cellOf = (row: number, col: number) => sheet.cells.find((cell) => cell.row === row && cell.col === col)
    if (target.kind === "cell") {
      const cell = cellOf(target.row, target.col)
      if (!cell) return { ref: refOf(target.row, target.col), text: "", empty: true }
      return {
        ref: cell.ref,
        text: cell.text,
        ...(cell.formula ? { formula: cell.formula } : {}),
        ...(cell.value !== undefined ? { value: cell.value } : {}),
      }
    }
    const rows: string[][] = []
    for (let row = target.start.row; row <= target.end.row; row += 1) {
      const line: string[] = []
      for (let col = target.start.col; col <= target.end.col; col += 1) line.push(cellOf(row, col)?.text ?? "")
      rows.push(line)
    }
    return {
      sheet: target.sheet,
      start: refOf(target.start.row, target.start.col),
      end: refOf(target.end.row, target.end.col),
      rows,
    }
  }
  if (target.kind === "slide" && format === "legacy") {
    const paragraphs = legacySlide(state, target.index)
    if (!paragraphs) throw new CliError("not_found", `没有第 ${target.index} 页`)
    return { slide: target.index, paragraphs }
  }
  if (target.kind === "page") {
    const page = pagesOf(state).find((item) => item.page === target.index)
    if (!page) throw new CliError("not_found", `没有第 ${target.index} 页`)
    return page
  }
  if (target.kind === "slide") {
    const meta = slidesOf(state).find((item) => item.index === target.index)
    return {
      slide: target.index,
      ...(meta
        ? {
            hidden: meta.hidden,
            ...(meta.notes ? { notes: meta.notes } : {}),
            ...(meta.layout ? { layout: meta.layout } : {}),
          }
        : {}),
      shapes: nodesOf(state)
        .filter((node) => node.slide === target.index)
        .map((node, index) => ({
          index: index + 1,
          shapeId: node.shapeId,
          name: node.shapeName,
          kind: node.kind,
          paragraphs: node.paragraphs,
        })),
    }
  }
  // shape
  if (target.index === undefined && target.id === undefined && target.name === undefined) {
    throw new CliError("invalid_params", "形状路径要写成 /slide[N]/shape[M] 或 shape[@id=…] / shape[@name=…]")
  }
  const node = findShape(state, target.slide, target)
  return {
    slide: target.slide,
    shapeId: node.shapeId,
    name: node.shapeName,
    kind: node.kind,
    box: node.box,
    paragraphs: node.paragraphs,
    ...(node.cells ? { cells: node.cells } : {}),
  }
}

function maxRow(sheet: { cells: Array<{ row: number }> }): number {
  return sheet.cells.reduce((max, cell) => Math.max(max, cell.row), -1)
}

function maxCol(sheet: { cells: Array<{ col: number }> }): number {
  return sheet.cells.reduce((max, cell) => Math.max(max, cell.col), -1)
}

function refOf(row: number, col: number): string {
  return columnRef(col) + String(row + 1)
}

/** 单元格值：`=SUM(A1:A2)` 当公式，数字当数字，其余当文本。 */
function cellValue(raw: string): string | number | { formula: string } {
  if (raw.startsWith("=")) return { formula: raw.slice(1) }
  const trimmed = raw.trim()
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed) && trimmed.length > 0) return Number(trimmed)
  return raw
}

function cellStylePatch(args: Args): import("@novaway/core/office/engine/contract").CellStylePatch | undefined {
  const patch: import("@novaway/core/office/engine/contract").CellStylePatch = {
    ...(args.bold !== undefined ? { bold: args.bold } : {}),
    ...(args.italic !== undefined ? { italic: args.italic } : {}),
    ...(args.underline !== undefined ? { underline: args.underline } : {}),
    ...(args.color ? { color: args.color.replace(/^#/, "") } : {}),
    ...(args.fill ? { fill: args.fill.replace(/^#/, "") } : {}),
    ...(args.size !== undefined ? { size: args.size } : {}),
    ...(args.format ? { format: args.format } : {}),
    ...(args.align ? { align: args.align === "l" ? "l" : args.align === "r" ? "r" : "ctr" } : {}),
    ...(args.wrap !== undefined ? { wrap: args.wrap } : {}),
    ...(args.merge !== undefined ? { merge: args.merge } : {}),
    ...(args.border ? { border: args.border } : {}),
  }
  return Object.keys(patch).length > 0 ? patch : undefined
}

/**
 * `values:=[[…]]` / `--values '[[…]]'`：从左上角开始的单元格矩阵。
 * 按 JSON 读，数字、布尔、以 `=` 开头的公式都按单元格值处理。
 */
function matrixOf(raw: string | undefined): string[][] | undefined {
  if (raw === undefined) return undefined
  const parsed = parseJson(raw, "values")
  if (!Array.isArray(parsed) || !parsed.every((row) => Array.isArray(row))) {
    throw new CliError("invalid_params", 'values 需要二维数组，例如 [["项目","金额"],["合计","120"]]')
  }
  return (parsed as unknown[][]).map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
  )
}

function matrixOps(sheet: string, start: { row: number; col: number }, rows: string[][]): OfficeOp[] {
  const ops: OfficeOp[] = []
  for (const [rowIndex, row] of rows.entries()) {
    for (const [colIndex, raw] of row.entries()) {
      ops.push({
        op: "setCellValue",
        sheet,
        ref: { row: start.row + rowIndex, col: start.col + colIndex },
        value: cellValue(raw),
      })
    }
  }
  return ops
}

/**
 * 把「路径 + 参数」翻译成引擎操作。set 可能一步产生多个 op（文字 + 格式）。
 */
function setOpsAt(format: OfficeFormat, state: unknown, pathText: string, args: Args): OfficeOp[] {
  const target = parsePath(pathText, state)
  const input = assignment(args.value ?? args.text)
  const patch = stylePatch(args)
  const value = input?.value
  const key = input?.key
  const matrix = matrixOf(args.values ?? (key === "values" ? value : undefined))

  if (target.kind === "document") {
    // 整篇查找替换（DOCX 正文 / Markdown / 纯文本）：`set 文件 /body find=X --replace Y`。
    const find = args.find ?? (key === "find" ? value : undefined)
    if (find !== undefined) {
      if (format !== "docx" && format !== "markdown" && format !== "text") {
        throw new CliError(
          "unsupported_format",
          format + " 暂时不支持整篇替换",
          "PDF 用 /page[N] find=…；表格请直接改单元格",
        )
      }
      if (find === "") throw new CliError("invalid_params", "要替换的文字不能为空")
      if (args.replace === undefined) {
        throw new CliError(
          "invalid_params",
          "替换文字需要 --replace 新文字",
          "例如 set 文件 /body find=Draft --replace Final",
        )
      }
      return [{ op: "replaceDocumentText", find, replace: args.replace }]
    }
  }
  if (target.kind === "document" && key && (key === "header" || key === "footer")) {
    if (format !== "docx") throw new CliError("invalid_params", "只有 DOCX 有页眉页脚")
    if (value === undefined) throw new CliError("invalid_params", "set 页眉需要 value=...")
    return [{ op: "setHeaderFooter", kind: key, text: value }]
  }
  if (target.kind === "paragraph" && (format === "docx" || format === "html" || format === "legacy")) {
    // 先确认这一段真的存在：引擎不该被一个越界下标静默忽略。
    if (format === "docx" && !paragraphsOf(state).some((item) => item.index === target.index)) {
      throw new CliError("not_found", `没有第 ${target.index} 段`)
    }
    if (format === "html") {
      const blocks = (state as { blocks?: unknown[] }).blocks ?? []
      if (!blocks[target.index - 1]) throw new CliError("not_found", `没有第 ${target.index} 块`)
    }
    if (format === "legacy" && legacyParagraphsOf(state)[target.index - 1] === undefined) {
      throw new CliError("not_found", `没有第 ${target.index} 段`)
    }
    const ops: OfficeOp[] = []
    if (value !== undefined && (key === undefined || key === "text" || key === "value")) {
      ops.push({ op: "setParagraphText", paragraph: target.index, text: value })
    }
    if (patch) {
      const range = args.start !== undefined && args.end !== undefined ? { start: args.start, end: args.end } : {}
      ops.push({ op: "setParagraphStyle", paragraph: target.index, style: patch, ...range })
    }
    if (ops.length === 0) throw new CliError("invalid_params", "set 需要值（value=... 或 --text）或格式参数")
    return ops
  }
  if (target.kind === "paragraph") {
    // Markdown / 纯文本没有「段落对象」，整篇替换但只改这一行，其余字节原样。
    if (value === undefined)
      throw new CliError("invalid_params", "文本文件只能 set 文字：set 文件 /body/p[N] value=...")
    if (patch) throw new CliError("invalid_params", "文本文件的段落不支持格式参数")
    const source = (state as { text?: string }).text ?? ""
    const line = contentLines(state)[target.index - 1]
    if (!line) throw new CliError("not_found", `没有第 ${target.index} 段`)
    return [{ op: "setText", text: replaceMarkdownRange(source, line.start, line.end, value) }]
  }

  if (target.kind === "cell") {
    const ops: OfficeOp[] = []
    if (matrix) {
      if (format === "legacy") throw new CliError("unsupported_format", "旧格式暂不支持批量写单元格")
      ops.push(...matrixOps(target.sheet, { row: target.row, col: target.col }, matrix))
    } else if (value !== undefined) {
      if (format === "legacy" && value.trimStart().startsWith("=")) {
        throw new CliError("unsupported_format", "旧格式暂不支持写公式", "请另存为 xlsx 后再写公式")
      }
      ops.push({
        op: "setCellValue",
        sheet: target.sheet,
        ref: { row: target.row, col: target.col },
        value: cellValue(value),
      })
    }
    const cellPatch = cellStylePatch(args)
    if (cellPatch && format === "legacy") {
      throw new CliError("unsupported_format", "旧格式暂不支持改单元格样式", "请另存为 xlsx 后再改样式")
    }
    if (cellPatch) {
      ops.push({
        op: "setCellStyle",
        sheet: target.sheet,
        range: { start: { row: target.row, col: target.col }, end: { row: target.row, col: target.col } },
        style: cellPatch,
      })
    }
    if (ops.length === 0) throw new CliError("invalid_params", "set 单元格需要 value=...、values:=[[…]] 或格式参数")
    return ops
  }
  if (target.kind === "range") {
    const ops: OfficeOp[] = []
    if (matrix) {
      if (format === "legacy") throw new CliError("unsupported_format", "旧格式暂不支持批量写单元格")
      ops.push(...matrixOps(target.sheet, target.start, matrix))
    } else if (value !== undefined) {
      throw new CliError(
        "invalid_params",
        "区域写值请用 values:=[[…]]",
        '例如 set 文件 /Sheet1/A1 \'values:=[["a","b"]]\'',
      )
    }
    const cellPatch = cellStylePatch(args)
    if (cellPatch && format === "legacy") {
      throw new CliError("unsupported_format", "旧格式暂不支持改单元格样式")
    }
    if (cellPatch) {
      ops.push({
        op: "setCellStyle",
        sheet: target.sheet,
        range: { start: target.start, end: target.end },
        style: cellPatch,
      })
    }
    if (ops.length === 0) throw new CliError("invalid_params", "区域需要 values:=[[…]] 或格式参数")
    return ops
  }
  if (target.kind === "sheet") {
    const name = args.name ?? (key === "name" ? value : undefined)
    const tabColor = args.tabColor ?? (key === "tabcolor" ? value : undefined)
    if (name) return [{ op: "renameSheet", sheet: target.name, name }]
    if (tabColor !== undefined) {
      // `tabColor=` 空值表示去掉颜色；setSheetTabColor 的 color 省略即清除。
      return [{ op: "setSheetTabColor", sheet: target.name, ...(tabColor ? { color: tabColor } : {}) }]
    }
    throw new CliError(
      "invalid_params",
      "工作表只支持 name=新名字 或 tabColor=RRGGBB",
      "改标签颜色：set 文件 /Sheet1 tabColor=4472C4（tabColor= 空值表示去掉）",
    )
  }
  if (target.kind === "shape") {
    const node = findShape(state, target.slide, target)
    const ops: OfficeOp[] = []
    if (value !== undefined) {
      ops.push({ op: "setParagraphText", slide: target.slide, shapeId: node.shapeId, paragraph: 0, text: value })
    }
    if (patch)
      ops.push({ op: "setParagraphStyle", slide: target.slide, shapeId: node.shapeId, paragraph: 0, style: patch })
    if (args.x !== undefined || args.y !== undefined || args.width !== undefined || args.height !== undefined) {
      const box = node.box ?? { x: 0, y: 0, w: 0, h: 0 }
      ops.push({
        op: "setShapeBox",
        slide: target.slide,
        shapeId: node.shapeId,
        box: {
          x: args.x ?? box.x,
          y: args.y ?? box.y,
          w: args.width ?? box.w,
          h: args.height ?? box.h,
        },
      })
    }
    if (args.degrees !== undefined) {
      if (!Number.isInteger(args.degrees)) throw new CliError("invalid_params", "旋转角度必须是整数")
      ops.push({ op: "rotateShape", slide: target.slide, shapeId: node.shapeId, degrees: args.degrees })
    }
    // name= 改的是形状名字（选择窗格里的名字），不是文字。
    const shapeName = args.name ?? (key === "name" ? value : undefined)
    if (shapeName !== undefined) {
      if (!shapeName.trim()) throw new CliError("invalid_params", "形状名字不能为空")
      ops.push({ op: "renameShape", slide: target.slide, shapeId: node.shapeId, name: shapeName })
    }
    if (ops.length === 0) {
      throw new CliError("invalid_params", "set 形状需要 value=...、name=新名字、x/y/w/h 或格式参数")
    }
    return ops
  }
  if (target.kind === "slide") {
    if (format !== "pptx") throw new CliError("invalid_params", "只有演示文稿有页面属性")
    const ops: OfficeOp[] = []
    const notes = args.notes ?? (key === "notes" ? value : undefined)
    if (notes !== undefined) ops.push({ op: "setSlideNotes", slide: target.index, text: notes })
    const hiddenArgs = args.hidden
    const hiddenRaw = hiddenArgs !== undefined ? String(hiddenArgs) : key === "hidden" ? value : undefined
    if (hiddenRaw !== undefined) {
      const hidden =
        hiddenRaw === ""
          ? true
          : hiddenRaw === "true" || hiddenRaw === "1"
            ? true
            : hiddenRaw === "false" || hiddenRaw === "0"
              ? false
              : undefined
      if (hidden === undefined) throw new CliError("invalid_params", "hidden 只能是 true / false")
      ops.push({ op: "setSlideHidden", slide: target.index, hidden })
    }
    const layout = args.layout ?? (key === "layout" ? value : undefined)
    if (layout !== undefined) {
      if (!layout.trim()) throw new CliError("invalid_params", "版式名不能为空")
      ops.push({ op: "setSlideLayout", slide: target.index, layout })
    }
    if (ops.length === 0) {
      throw new CliError(
        "invalid_params",
        "页面只支持 notes=备注文字、hidden=true/false、layout=版式",
        "改文字请定位到 /slide[N]/shape[M]",
      )
    }
    return ops
  }
  if (target.kind === "page") {
    // 调页面上已有的图片：--image-index 区分「改图片」和「转整页」。
    const imageIndex = args.imageIndex ?? (key === "image-index" || key === "imageindex" ? Number(value) : undefined)
    if (imageIndex !== undefined) {
      if (format !== "pdf") throw new CliError("unsupported_format", "只有 PDF 的页面上有可调整的图片")
      if (!Number.isInteger(imageIndex) || imageIndex < 1) {
        throw new CliError("invalid_params", "--image-index 必须是 1 起的整数", "1 = 这一页的第 1 张图片")
      }
      const rotation =
        args.rotation ??
        args.degrees ??
        (key === "rotation" || key === "rotate" || key === "degrees" ? Number(value) : undefined)
      if (
        args.x === undefined &&
        args.y === undefined &&
        args.width === undefined &&
        args.height === undefined &&
        rotation === undefined
      ) {
        throw new CliError(
          "invalid_params",
          "调图片需要 x / y / width / height / rotation 至少一项",
          "例如 set 文件 /page[1] --image-index 1 --x 200 --rotation 90",
        )
      }
      if (rotation !== undefined && !Number.isFinite(rotation)) {
        throw new CliError("invalid_params", "rotation 必须是数字")
      }
      return [
        {
          op: "setPageImageBox",
          page: target.index,
          index: imageIndex,
          ...(args.x !== undefined ? { x: args.x } : {}),
          ...(args.y !== undefined ? { y: args.y } : {}),
          ...(args.width !== undefined ? { width: args.width } : {}),
          ...(args.height !== undefined ? { height: args.height } : {}),
          ...(rotation !== undefined ? { rotation } : {}),
        },
      ]
    }
    const find = args.find ?? (key === "find" || key === "text" ? value : undefined)
    if (find !== undefined) {
      if (format !== "pdf") throw new CliError("invalid_params", "只有 PDF 能原地替换文字")
      if (find === "") throw new CliError("invalid_params", "要替换的文字不能为空")
      if (args.replace === undefined) {
        throw new CliError(
          "invalid_params",
          "替换文字需要 --replace 新文字",
          "例如 set 文件 /page[1] find=Draft --replace Final",
        )
      }
      return [
        {
          op: "replacePageText",
          page: target.index,
          find,
          replace: args.replace,
          ...(args.all ? { all: true } : {}),
        },
      ]
    }
    const degrees =
      args.rotation ??
      args.degrees ??
      (key === "rotation" || key === "rotate" || key === "degrees" ? Number(value) : undefined)
    if (degrees !== undefined) {
      if (!Number.isInteger(degrees) || degrees % 90 !== 0)
        throw new CliError("invalid_params", "rotation 必须是 90 的倍数")
      return [{ op: "rotatePage", page: target.index, degrees }]
    }
    throw new CliError("invalid_params", "PDF 页面只支持 rotation=90/180/270", "例如 set 文件 /page[2] rotation=90")
  }
  throw new CliError("invalid_params", "这个路径不支持 set：" + pathText)
}

/** add：在路径指向的位置之后插入内容。 */
/** `--type shape --kind rect` 之外的简写：--type ellipse 直接就是椭圆。 */
const SHAPE_ALIASES: Record<
  string,
  "rect" | "roundRect" | "ellipse" | "triangle" | "diamond" | "rightArrow" | "line" | "star5"
> = {
  shape: "rect",
  rect: "rect",
  roundrect: "roundRect",
  ellipse: "ellipse",
  circle: "ellipse",
  triangle: "triangle",
  diamond: "diamond",
  arrow: "rightArrow",
  line: "line",
  star: "star5",
}

/** `--before /路径` / `--index N` / `--after N` → 「插到第几项之后」（0 = 最前面）。 */
function insertionAfter(args: Args, state: unknown): number | undefined {
  if (args.before !== undefined) {
    const before = parsePath(args.before, state)
    if (before.kind === "paragraph" || before.kind === "slide" || before.kind === "page") return before.index - 1
    throw new CliError("invalid_params", "--before 需要指向段落 / 幻灯片 / 页", "例如 --before /body/p[3]")
  }
  if (args.index !== undefined) {
    if (!Number.isInteger(args.index) || args.index < 1) {
      throw new CliError("invalid_params", "--index 必须是 1 起的整数", "1 = 插到最前面")
    }
    return args.index - 1
  }
  return args.after
}

async function addOpAt(format: OfficeFormat, state: unknown, pathText: string, args: Args): Promise<OfficeOp> {
  // `/` 是根节点：用来「往文档末尾加一张表 / 一页 / 一页幻灯片」。
  const root = pathText.trim() === "/"
  const target = (root ? { kind: "root" } : parsePath(pathText, state)) as
    | ReturnType<typeof parsePath>
    | { kind: "root" }
  const position = insertionAfter(args, state)
  const typeOfPath =
    target.kind === "root"
      ? format === "pptx"
        ? "slide"
        : format === "pdf"
          ? "page"
          : format === "xlsx" || format === "csv"
            ? "sheet"
            : "paragraph"
      : target.kind === "sheet"
        ? "sheet"
        : target.kind === "slide"
          ? args.text !== undefined || args.value !== undefined
            ? "textbox"
            : "slide"
          : target.kind === "page"
            ? "text"
            : "paragraph"
  const type = args.type ?? typeOfPath

  if (type === "pages" || type === "pdfpages" || type === "pdf-pages") {
    if (format !== "pdf") throw new CliError("unsupported_format", "只有 PDF 能把另一份 PDF 的页面插进来")
    if (target.kind !== "page") {
      throw new CliError(
        "invalid_params",
        "插入页面要定位到 /page[N]",
        "例如 add 文件.pdf /page[1] --type pages --from 另一份.pdf",
      )
    }
    if (!args.from) throw new CliError("invalid_params", "插入页面需要 --from 源 PDF 路径")
    const source = resolveFile(args.from)
    if (officeFormatOf(source) !== "pdf") {
      throw new CliError("unsupported_format", "源文件不是 PDF：" + args.from, "先把源文档导出成 PDF 再插入")
    }
    const bytes = new Uint8Array(await readFile(source))
    const after = position ?? target.index
    const pages = args.pages ? parsePages(args.pages) : undefined
    return {
      op: "insertPdfPages",
      after,
      dataBase64: Buffer.from(bytes).toString("base64"),
      ...(pages ? { pages } : {}),
    }
  }

  if (type === "paragraph") {
    const text = args.text ?? args.value ?? ""
    const after =
      position ?? (target.kind === "paragraph" ? target.index : format === "docx" ? lastTopLevelParagraph(state) : -1)
    if (format === "docx") {
      const patch = stylePatch(args)
      return { op: "insertParagraph", after, text, ...(patch ? { style: patch } : {}) }
    }
    if (format === "html") {
      return {
        op: "insertBlock",
        after: after < 0 ? ((state as { blocks?: unknown[] }).blocks ?? []).length : after,
        text,
      }
    }
    if (format === "legacy") {
      const patch = stylePatch(args)
      // 旧格式的段落没有文档级样式名；after 以 1 起，0 / -1 表示插到最前。
      return { op: "insertParagraph", after: Math.max(after, 0), text, ...(patch ? { style: patch } : {}) }
    }
    if (format === "markdown" || format === "text") {
      if (stylePatch(args)) throw new CliError("invalid_params", "文本文件不支持段落格式")
      return insertTextLine(state, after, text)
    }
    throw new CliError("invalid_params", "这种文件不能插入段落")
  }
  if (type === "heading" || type === "title") {
    const level = type === "title" ? 1 : (args.level ?? 1)
    if (!Number.isInteger(level) || level < 1 || level > 9) {
      throw new CliError("invalid_params", "标题层级要在 1–9 之间", "例如 add 文件 /body --type heading level=2")
    }
    const text = args.text ?? args.value ?? ""
    const after =
      position ?? (target.kind === "paragraph" ? target.index : format === "docx" ? lastTopLevelParagraph(state) : -1)
    if (format === "docx") {
      const style = type === "title" ? "Title" : "Heading" + Math.min(level, 6)
      return { op: "insertParagraph", after, text, style: { paragraphStyle: style } }
    }
    if (format === "html") {
      const tag = (type === "title" ? "h1" : "h" + Math.min(level, 6)) as "h1"
      return {
        op: "insertBlock",
        after: after < 0 ? ((state as { blocks?: unknown[] }).blocks ?? []).length : after,
        text,
        tag,
      }
    }
    if (format === "markdown" || format === "text") {
      return insertTextLine(state, after, "#".repeat(Math.min(level, 6)) + " " + text)
    }
    throw new CliError("invalid_params", "这种文件不能插入标题")
  }
  if (type === "table") {
    if (format !== "docx") throw new CliError("invalid_params", "只有 DOCX 能插入表格")
    const cols = args.cols !== undefined ? Math.floor(args.cols) : undefined
    if (cols !== undefined && (cols < 1 || cols > 100)) throw new CliError("invalid_params", "--cols 要在 1–100 之间")
    const skeleton =
      cols && args.rows !== undefined && /^\d+$/.test(args.rows.trim())
        ? Array.from({ length: Math.max(1, Math.floor(Number(args.rows))) }, () =>
            Array.from({ length: cols }, () => ""),
          )
        : undefined
    const rows = parseRows(args.rows, args, skeleton)
    return { op: "addTable", after: position ?? lastTopLevelParagraph(state), rows }
  }
  if (type === "pagebreak" || type === "page-break" || type === "break") {
    if (format !== "docx") throw new CliError("invalid_params", "只有 DOCX 能插入分页符")
    return { op: "addPageBreak", after: position ?? lastTopLevelParagraph(state) }
  }
  if (type === "page") {
    if (format !== "pdf") throw new CliError("invalid_params", "只有 PDF 有独立页面", "PPTX 请用 --type slide")
    // `/` 加页 = 追加到最后一页之后；定位到 /page[N] 才是插在它后面。
    const after =
      position ?? (target.kind === "page" ? target.index : target.kind === "root" ? pagesOf(state).length : 0)
    return {
      op: "insertBlankPage",
      after,
      ...(args.width !== undefined ? { width: args.width } : {}),
      ...(args.height !== undefined ? { height: args.height } : {}),
    }
  }
  if (type === "text") {
    if (format === "pdf") {
      if (target.kind !== "page") throw new CliError("invalid_params", "PDF 叠字要定位到 /page[N]")
      return {
        op: "addPageText",
        page: target.index,
        text: args.text ?? args.value ?? "",
        x: args.x ?? 40,
        y: args.y ?? 40,
        ...(args.size !== undefined ? { size: args.size } : {}),
        ...(args.color ? { color: args.color.replace(/^#/, "") } : {}),
      }
    }
    // 文本文件：和 paragraph 一样是一行，只是不套任何块结构。
    if (format === "markdown" || format === "text") {
      return insertTextLine(state, position ?? -1, args.text ?? args.value ?? "")
    }
    throw new CliError("invalid_params", "这种文件不支持 --type text")
  }
  if (type === "image") {
    if (!args.image) throw new CliError("invalid_params", "插入图片需要 --image 路径")
    const source = resolveFile(args.image)
    const bytes = await readFile(source)
    if (format === "pdf") {
      if (target.kind !== "page") throw new CliError("invalid_params", "PDF 插图要定位到 /page[N]")
      return {
        op: "addPageImage",
        page: target.index,
        dataBase64: Buffer.from(bytes).toString("base64"),
        mime: mimeOf(source),
        x: args.x ?? 40,
        y: args.y ?? 40,
        width: args.width ?? 240,
        height: args.height ?? 160,
      }
    }
    if (format !== "docx") throw new CliError("invalid_params", "只有 DOCX / PDF 支持按路径插图")
    return {
      op: "addImage",
      after: position ?? lastTopLevelParagraph(state),
      dataBase64: Buffer.from(bytes).toString("base64"),
      mime: mimeOf(source),
      ...(args.width !== undefined ? { width: args.width } : {}),
      ...(args.height !== undefined ? { height: args.height } : {}),
    }
  }
  if (type === "textbox") {
    if (format !== "pptx") throw new CliError("invalid_params", "只有 PPTX 能加文本框")
    if (target.kind !== "slide" && target.kind !== "shape")
      throw new CliError("invalid_params", "文本框要加在 /slide[N] 上")
    const slide = target.kind === "slide" ? target.index : target.slide
    const patch = stylePatch(args)
    return {
      op: "addTextBox",
      slide,
      text: args.text ?? args.value ?? "",
      box: {
        x: args.x ?? 0,
        y: args.y ?? 0,
        w: args.width ?? 360,
        h: args.height ?? 80,
      },
      ...(patch ? { style: patch } : {}),
    }
  }
  if (
    type === "shape" ||
    type === "rect" ||
    type === "roundrect" ||
    type === "triangle" ||
    type === "diamond" ||
    type === "star" ||
    type === "ellipse" ||
    type === "arrow" ||
    type === "line" ||
    type === "circle"
  ) {
    if (format !== "pptx") throw new CliError("invalid_params", "只有 PPTX 能加形状")
    if (target.kind !== "slide" && target.kind !== "shape")
      throw new CliError("invalid_params", "形状要加在 /slide[N] 上")
    const slide = target.kind === "slide" ? target.index : target.slide
    const kind = SHAPE_ALIASES[(type === "shape" ? (args.shape ?? "rect") : type).toLowerCase()] ?? "rect"
    return {
      op: "addShape",
      slide,
      kind,
      box: { x: args.x ?? 0, y: args.y ?? 0, w: args.width ?? 240, h: args.height ?? 120 },
      ...(args.fill ? { fill: args.fill.replace(/^#/, "") } : {}),
      ...(args.color ? { line: args.color.replace(/^#/, "") } : {}),
      ...(args.text ? { text: args.text } : {}),
    }
  }
  if (type === "slide") {
    if (format !== "pptx") throw new CliError("invalid_params", "只有 PPTX 能加页")
    const after = position ?? (target.kind === "slide" ? target.index : undefined)
    return {
      op: "addSlide",
      ...(after !== undefined ? { after } : {}),
      ...(args.layout ? { layout: args.layout } : {}),
    }
  }
  if (type === "sheet") {
    if (format !== "xlsx" && format !== "csv") throw new CliError("invalid_params", "只有表格能加工作表")
    const name = target.kind === "sheet" ? target.name : (args.name ?? args.value ?? args.title)
    if (!name) throw new CliError("invalid_params", "加工作表需要名字", "add 文件 / --type sheet name=汇总")
    return { op: "addSheet", name }
  }
  throw new CliError(
    "invalid_params",
    "不认识的插入类型：" + type,
    "支持 paragraph / heading / title / table / pagebreak / text / image / page / pages / textbox / shape / slide / sheet",
  )
}

/** 在文本文件的第 after 段之后插一行（after < 0 表示插到末尾）。 */
function insertTextLine(state: unknown, after: number, text: string): OfficeOp {
  const source = (state as { text?: string }).text ?? ""
  const eol = source.includes("\r\n") ? "\r\n" : "\n"
  const line = after >= 1 ? contentLines(state)[after - 1] : undefined
  if (after === 0) {
    // 0 = 最前面：放在第一段之前，保留 front matter 原样在最上。
    const first = contentLines(state)[0]
    const at = first ? first.start : 0
    return { op: "setText", text: source.slice(0, at) + text + eol + source.slice(at) }
  }
  const at = line ? line.end : source.length
  const head = source.slice(0, at)
  const sep = head.length === 0 || head.endsWith("\n") ? "" : eol
  return { op: "setText", text: head + sep + text + source.slice(at) }
}

/** `--rows '[[…]]'`；`--rows 2 --cols 3` 则生成同样大小的空表格骨架。 */
function parseRows(raw: string | undefined, args?: Args, fallback?: string[][]): string[][] {
  if (!raw) {
    if (fallback) return fallback
    throw new CliError("invalid_params", "插入表格需要 --rows '<二维数组 JSON>'", "也可以写 --rows 2 --cols 3")
  }
  if (fallback && /^\d+$/.test(raw.trim())) {
    const rows = Number(raw)
    if (!Number.isInteger(rows) || rows < 1) throw new CliError("invalid_params", "--rows 行数必须是正整数")
    if (rows > 200) throw new CliError("invalid_params", "--rows 一次最多 200 行")
    if (fallback.length !== rows) {
      // 骨架按 --cols 建好的是 --rows 行；数量对不上说明调用方给错了，按行数裁齐。
      return Array.from({ length: rows }, (_, index) => fallback[index] ?? fallback[0] ?? [])
    }
    return fallback
  }
  const parsed = parseJson(raw, "rows")
  if (!Array.isArray(parsed) || !parsed.every((row) => Array.isArray(row))) {
    throw new CliError("invalid_params", "--rows 需要二维字符串数组")
  }
  return (parsed as unknown[][]).map((row) => row.map((cell) => String(cell ?? "")))
}

function lastTopLevelParagraph(state: unknown): number {
  const paragraphs = paragraphsOf(state).filter((item) => !item.inTable)
  return paragraphs.length > 0 ? paragraphs[paragraphs.length - 1]!.index : 0
}

function mimeOf(file: string): string {
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase()
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  if (ext === "gif") return "image/gif"
  if (ext === "webp") return "image/webp"
  if (ext === "svg") return "image/svg+xml"
  if (ext === "wmf") return "image/x-wmf"
  if (ext === "emf") return "image/x-emf"
  return "image/png"
}

/** remove：删除路径指向的内容。 */
function removeOpAt(format: OfficeFormat, state: unknown, pathText: string): OfficeOp {
  const target = parsePath(pathText, state)
  if (target.kind === "table") {
    if (format !== "docx") throw new CliError("invalid_params", "只有 DOCX 有正文表格")
    return { op: "deleteTable", table: target.index }
  }
  if (target.kind === "paragraph") {
    if (format === "docx") return { op: "deleteParagraph", paragraph: target.index }
    if (format === "html") return { op: "deleteBlock", block: target.index }
    if (format === "legacy") return { op: "deleteParagraph", paragraph: target.index }
    if (format === "markdown" || format === "text") {
      const source = (state as { text?: string }).text ?? ""
      const line = contentLines(state)[target.index - 1]
      if (!line) throw new CliError("not_found", `没有第 ${target.index} 段`)
      return { op: "setText", text: removeLine(source, line) }
    }
    throw new CliError("invalid_params", "这种文件没有可删除的段落")
  }
  if (target.kind === "slide") {
    if (format !== "pptx") throw new CliError("invalid_params", "只有 PPTX 有页")
    return { op: "deleteSlide", slide: target.index }
  }
  if (target.kind === "shape") {
    if (format !== "pptx") throw new CliError("invalid_params", "只有 PPTX 有形状")
    if (target.index === undefined && target.id === undefined && target.name === undefined) {
      throw new CliError("invalid_params", "形状路径要写成 /slide[N]/shape[M] 或 shape[@id=…] / shape[@name=…]")
    }
    const node = findShape(state, target.slide, target)
    return { op: "deleteShape", slide: target.slide, shapeId: node.shapeId }
  }
  if (target.kind === "sheet") {
    if (format !== "xlsx" && format !== "csv") throw new CliError("invalid_params", "只有表格有工作表")
    return { op: "deleteSheet", sheet: target.name }
  }
  if (target.kind === "cell" || target.kind === "range") {
    if (format !== "xlsx" && format !== "csv") {
      throw new CliError("invalid_params", "只有表格能按单元格区域清空")
    }
    // remove /Sheet1/A1:B2 清空这些单元格，不是删行删列。
    const range = target.kind === "cell" ? { start: target, end: target } : { start: target.start, end: target.end }
    return { op: "clearCells", sheet: target.sheet, range }
  }
  if (target.kind === "page") {
    if (format !== "pdf") throw new CliError("invalid_params", "只有 PDF 有页")
    return { op: "deletePage", page: target.index }
  }
  throw new CliError(
    "invalid_params",
    "这个路径不支持 remove：" + pathText,
    "支持 /body/p[N]、/body/table[N]、/slide[N]、/slide[N]/shape[M]、/SheetN、/Sheet1/A1:B2、/page[N]",
  )
}

async function applyOps(
  args: Args,
  ops: OfficeOp[],
  options: { pathText?: string } = {},
): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "需要文件路径")
  if (ops.length === 0) throw new CliError("invalid_params", "没有要执行的操作")
  const target = await open(args.file, args)
  const applied = await target.engine.apply(target.state, ops, target.bytes, engineOptions(args))
  if (!applied.ok) throw new CliError(applied.error.code, applied.error.message)
  const changed = applied.data.changed
  const writeTo = args.out ? resolveFile(args.out) : target.absolute
  // --dry-run 只演算；--save 即使没有改动也写盘。
  const saved = !args.dryRun && (changed.length > 0 || args.save === true)
  if (saved) await writeAtomic(writeTo, applied.data.bytes)
  const result: Record<string, unknown> = {
    path: writeTo,
    source: target.absolute,
    format: target.format,
    changed,
    applied: applied.data.applied.length,
    saved,
    ...(args.dryRun ? { dryRun: true } : {}),
  }
  // set / add 的回复里带改动后的节点，Agent 不用再读一次。
  if (options.pathText) {
    try {
      const reopened = await openFromBytes(target.absolute, applied.data.bytes, args)
      result.node = readAt(reopened.format, reopened.state, parsePath(options.pathText, reopened.state))
    } catch {
      // 删除 / 结构操作可能没有节点可回读，忽略即可。
    }
  }
  return result
}

/** `run` 的命令参数：`--params '{"…":…}'`。 */
function paramsOf(args: Args): Record<string, unknown> {
  if (args.params === undefined) return {}
  const parsed = parseJson(args.params, "--params")
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliError("invalid_params", "--params 需要 JSON 对象", '例如 --params \'{"paragraph":2,"text":"新一段"}\'')
  }
  return parsed as Record<string, unknown>
}

/** 命令 id → OfficeOp；参数和 AI 工具走同一份校验。 */
function opOfId(id: string, params: Record<string, unknown>): OfficeOp {
  const canonical = OP_NAMES.find((name) => name.toLowerCase() === id.toLowerCase())
  if (!canonical) {
    const near = closestMatch(id, OP_NAMES)
    throw new CliError(
      "unknown_command",
      "不认识的命令：" + id,
      near ? "你是想用 " + near + " 吗？" : "用 `novaway office commands <格式> <关键字>` 查命令和参数",
    ).withCandidates(closestMatches(id, OP_NAMES))
  }
  const converted = toOfficeOp({ ...params, op: canonical } as DocumentOpInput)
  if (!converted.ok) {
    throw new CliError("invalid_params", converted.message, `用 novaway office commands <格式> ${canonical} 看参数`)
  }
  return converted.op
}

/**
 * `run <文件> <命令> [--params JSON]`：执行一条引擎命令再保存。
 * 命令 id 就是引擎自己的操作名（`commands` 能查）。
 * 旧写法 `run <脚本>` 仍按 batch 处理。
 */
async function runCommand(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "run 需要文件路径")
  if (!args.target) return runBatch(args)
  const id = args.target
  // 常用参数的快捷写法，和路径写法共用同一份参数。
  const shortcut: Record<string, unknown> = {}
  if (args.text !== undefined) shortcut.text = args.text
  if (args.value !== undefined) shortcut.value = args.value
  if (args.after !== undefined) shortcut.after = args.after
  if (args.replace !== undefined) shortcut.replace = args.replace
  if (args.all) shortcut.all = true
  const op = opOfId(id, { ...shortcut, ...paramsOf(args) })
  const result = await applyOps(args, [op])
  return { ...result, command: op.op }
}

async function runGet(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "get 需要文件路径")
  const target = await open(args.file, args)
  const pathTarget = parsePath(args.target, target.state)
  const value = readAt(target.format, target.state, pathTarget)
  // PDF 页额外带上正文：get / page[N] 一次就能看到这一页写了什么。
  if (target.format === "pdf" && pathTarget.kind === "page") {
    try {
      const text = await readPdfPageText(target.bytes, pathTarget.index, args.password)
      if (text !== undefined && typeof value === "object" && value !== null) {
        return {
          path: target.absolute,
          format: target.format,
          target: args.target,
          value: { ...(value as Record<string, unknown>), text },
        }
      }
    } catch {
      // 读不出文字不影响页面结构信息。
    }
  }
  return { path: target.absolute, format: target.format, target: args.target, value }
}

async function runSetAt(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "set 需要文件路径")
  const target = await open(args.file, args)
  const ops = setOpsAt(target.format, target.state, args.target ?? "", args)
  return applyOps(args, ops, { pathText: args.target })
}

async function runAdd(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "add 需要文件路径")
  const target = await open(args.file, args)
  const op = await addOpAt(target.format, target.state, args.target ?? "", args)
  return applyOps(args, [op], { pathText: args.target })
}

async function runRemove(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "remove 需要文件路径")
  const target = await open(args.file, args)
  const op = removeOpAt(target.format, target.state, args.target ?? "")
  return applyOps(args, [op], { pathText: args.target })
}

async function runExport(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "export 需要源文件")
  if (!args.target) throw new CliError("invalid_params", "export 需要目标文件（按扩展名决定格式）")
  if (args.images) return extractImages(args)
  const kind = path.extname(args.target).replace(/^\./, "").toLowerCase()
  // PNG 是一次一页的位图（`export in.pdf page1.png --page 1`）；
  // `--pages` 的整段提取仍然只对 PDF → PDF 有效。
  if (kind !== "png" && (args.pages || args.page !== undefined)) return extract(args)
  const target = await open(args.file, args)
  if (kind === "png") return exportPng(args, target)
  if (!target.engine.export) throw new CliError("unsupported_format", target.format + " 不支持导出")
  if (!kind) throw new CliError("invalid_params", "导出目标要带扩展名，例如 out.md")
  const exported = await target.engine.export(target.state, kind, target.bytes, engineOptions(args))
  if (!exported.ok) throw new CliError(exported.error.code, exported.error.message, exported.error.suggestion)
  const out = resolveFile(args.target)
  await writeAtomic(out, exported.data)
  return { path: target.absolute, out, format: kind, bytes: exported.data.length }
}

/**
 * `export <文件> out.png [--page N]`：把一页画成 PNG。
 *
 * 非 PDF 先走引擎的 PDF 导出（和打印同一套排版），再交给位图渲染器；
 * PDF 源文件解密后直接画。一次一张，`--page` 指定页码。
 */
async function exportPng(args: Args, target: Awaited<ReturnType<typeof open>>): Promise<Record<string, unknown>> {
  const page = args.page === undefined ? 1 : singlePage(args.page)
  let pdfBytes: Uint8Array
  if (target.format === "pdf") {
    const opened = await openPdfBytes(target.bytes, args.password)
    if (!opened.ok) throw new CliError(opened.error.code, opened.error.message, opened.error.suggestion)
    pdfBytes = opened.data.bytes
  } else {
    if (!target.engine.export) throw new CliError("unsupported_format", target.format + " 不支持导出")
    const printed = await target.engine.export(target.state, "pdf", target.bytes, engineOptions(args))
    if (!printed.ok) throw new CliError(printed.error.code, printed.error.message, printed.error.suggestion)
    pdfBytes = printed.data
  }
  let rendered
  try {
    rendered = await rasterizePdf(pdfBytes, {
      pages: [page],
      ...(args.scale === undefined ? {} : { scale: args.scale }),
    })
  } catch (error) {
    if (error instanceof RasterError) throw new CliError(error.code, error.message)
    throw error
  }
  const out = resolveFile(args.target!)
  await writeAtomic(out, rendered[0].png)
  return {
    path: target.absolute,
    out,
    format: "png",
    page,
    width: rendered[0].width,
    height: rendered[0].height,
    bytes: rendered[0].png.length,
  }
}

/** `1-3,5` → [1,2,3,5]；页码从 1 开始。 */
function parsePages(input: string): number[] {
  const pages: number[] = []
  for (const part of input.split(",")) {
    const item = part.trim()
    if (!item) continue
    const range = /^(\d+)-(\d+)$/.exec(item)
    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from < 1 || to < from) throw new CliError("invalid_params", "页码范围不合法：" + item)
      for (let page = from; page <= to; page += 1) pages.push(page)
      continue
    }
    const page = Number(item)
    if (!Number.isInteger(page) || page < 1) throw new CliError("invalid_params", "页码不合法：" + item)
    pages.push(page)
  }
  return [...new Set(pages)]
}

/** `export in.pdf out.pdf --pages 1-3,5`：提取页面成一个新 PDF。 */
async function extract(args: Args): Promise<Record<string, unknown>> {
  const source = resolveFile(args.file!)
  const format = officeFormatOf(source)
  if (format !== "pdf") throw new CliError("invalid_params", "只有 PDF 支持 --pages 提取", "其它格式直接 export")
  const out = resolveFile(args.target!)
  if (path.extname(out).toLowerCase() !== ".pdf") throw new CliError("invalid_params", "提取页面请写成 out.pdf")
  const bytes = new Uint8Array(await readFile(source))
  const pages = args.pages ? parsePages(args.pages) : [singlePage(args.page)]
  const extracted = await extractPdfPages(bytes, pages, args.password)
  await writeAtomic(out, extracted)
  return { path: source, out, pages, bytes: extracted.length }
}

/** `--page N`：只取一页（1 起）。 */
function singlePage(page: number | undefined): number {
  if (page === undefined || !Number.isInteger(page) || page < 1)
    throw new CliError("invalid_params", "--page 是 1 起的页码")
  return page
}

/** `export in.pdf out-dir --images`：把内嵌图片逐张写出来（jpg / png / jp2）。 */
async function extractImages(args: Args): Promise<Record<string, unknown>> {
  const source = resolveFile(args.file!)
  if (officeFormatOf(source) !== "pdf") throw new CliError("invalid_params", "只有 PDF 能提取图片")
  const bytes = new Uint8Array(await readFile(source))
  const pages = args.pages ? parsePages(args.pages) : args.page !== undefined ? [singlePage(args.page)] : undefined
  const images = await extractPdfImages(bytes, pages, args.password)
  const base = args.target ? resolveFile(args.target) : path.dirname(source)
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/jp2": "jp2" } as const
  const files: Array<{ path: string; page: number; width: number; height: number; bytes: number }> = []
  for (const [index, image] of images.entries()) {
    const out = path.join(base, `image-${String(index + 1).padStart(2, "0")}.${extension[image.mime]}`)
    await writeAtomic(out, image.data)
    files.push({ path: out, page: image.page, width: image.width, height: image.height, bytes: image.data.length })
  }
  return { path: source, count: files.length, files }
}

/** `merge a.pdf b.pdf c.pdf --out merged.pdf`：按顺序把页面接起来。 */
async function runMerge(args: Args): Promise<Record<string, unknown>> {
  const inputs = [args.file, args.target, args.value]
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .concat(
      (args.files ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    )
  if (inputs.length < 2) {
    throw new CliError(
      "invalid_params",
      "merge 至少需要两份 PDF",
      "merge a.pdf b.pdf --out merged.pdf（也可以用 --files 'b.pdf,c.pdf'）",
    )
  }
  if (!args.out) throw new CliError("invalid_params", "merge 需要 --out 结果.pdf", "原文件不原地改写")
  const out = resolveFile(args.out)
  if (path.extname(out).toLowerCase() !== ".pdf") throw new CliError("invalid_params", "合并结果要写成 .pdf")
  const sources: string[] = []
  const bytes: Uint8Array[] = []
  for (const input of inputs) {
    const source = resolveFile(input)
    if (officeFormatOf(source) !== "pdf") {
      throw new CliError("unsupported_format", "只能合并 PDF：" + input, "先把源文档导出成 PDF")
    }
    sources.push(source)
    bytes.push(new Uint8Array(await readFile(source)))
  }
  let merged: Uint8Array
  try {
    merged = await mergePdfPages(bytes, args.password)
  } catch (error) {
    throw new CliError("invalid_params", error instanceof Error ? error.message : String(error))
  }
  await writeAtomic(out, merged)
  const pageCount = (await PDFDocument.load(merged, { updateMetadata: false })).getPageCount()
  return { out, sources, pages: pageCount, bytes: merged.length }
}

/** `split in.pdf out/prefix --every 5`：按每份页数切开。 */
async function runSplit(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "split 需要 PDF 路径")
  const source = resolveFile(args.file)
  if (officeFormatOf(source) !== "pdf") throw new CliError("invalid_params", "只有 PDF 能切分")
  const size = args.every ?? 1
  if (!Number.isInteger(size) || size < 1) throw new CliError("invalid_params", "--every 必须是正整数")
  const bytes = new Uint8Array(await readFile(source))
  const parts = await splitPdfPages(bytes, size, args.password)
  const target = args.target ? resolveFile(args.target) : source
  const extension = path.extname(target)
  const prefix = extension.toLowerCase() === ".pdf" ? target.slice(0, -extension.length) : target
  const files: Array<{ path: string; bytes: number }> = []
  for (const [index, part] of parts.entries()) {
    const out = `${prefix}-${index + 1}.pdf`
    await writeAtomic(out, part)
    files.push({ path: out, bytes: part.length })
  }
  return { path: source, every: size, files }
}

const OP_NAMES = [
  "setParagraphText",
  "setParagraphStyle",
  "insertParagraph",
  "deleteParagraph",
  "deleteTable",
  "addTable",
  "insertTableRow",
  "deleteTableRow",
  "insertTableColumn",
  "deleteTableColumn",
  "setTableCellText",
  "addPageBreak",
  "setHeaderFooter",
  "replaceDocumentText",
  "addImage",
  "setPageSetup",
  "deleteSlide",
  "moveSlide",
  "duplicateSlide",
  "addSlide",
  "addTextBox",
  "deleteShape",
  "renameShape",
  "setSlideLayout",
  "setSlideNotes",
  "setSlideHidden",
  "setShapeBox",
  "rotateShape",
  "replaceImage",
  "setCellValue",
  "setCellStyle",
  "clearCells",
  "insertRows",
  "deleteRows",
  "insertColumns",
  "deleteColumns",
  "addSheet",
  "renameSheet",
  "deleteSheet",
  "setSheetTabColor",
  "deletePage",
  "movePage",
  "rotatePage",
  "insertBlankPage",
  "insertPdfPages",
  "addPageText",
  "replacePageText",
  "addShape",
  "addPageImage",
  "replacePageImage",
  "setPageImageBox",
  "annotatePage",
  "cropPage",
  "fillForm",
  "setProperty",
  "deleteProperty",
  "setHeading",
  "toggleList",
  "toggleQuote",
  "toggleTask",
  "setBlockType",
  "setBlockAlign",
  "setBlockLineHeight",
  "setBlockIndent",
  "setBlockFirstLineIndent",
  "setBlockList",
  "formatRange",
  "setBlockHtml",
  "insertBlock",
  "deleteBlock",
  "setText",
  "sortLines",
  "uniqueLines",
  "reverseLines",
  "joinLines",
  "moveLines",
  "duplicateLines",
  "deleteLines",
  "trimTrailing",
  "changeCase",
  "convertIndent",
  "toggleComment",
  "formatJson",
] as const

/** 每种格式真正接受的操作；`commands <格式>` 用它过滤。 */
const OPS_BY_FORMAT: Record<OfficeFormat, readonly string[]> = {
  docx: [
    "setParagraphText",
    "setParagraphStyle",
    "insertParagraph",
    "deleteParagraph",
    "deleteTable",
    "addTable",
    "insertTableRow",
    "deleteTableRow",
    "insertTableColumn",
    "deleteTableColumn",
    "setTableCellText",
    "addPageBreak",
    "setHeaderFooter",
    "replaceDocumentText",
    "addImage",
    "setPageSetup",
  ],
  xlsx: [
    "setCellValue",
    "setCellStyle",
    "clearCells",
    "insertRows",
    "deleteRows",
    "insertColumns",
    "deleteColumns",
    "addSheet",
    "renameSheet",
    "deleteSheet",
    "setSheetTabColor",
  ],
  csv: ["setCellValue", "clearCells", "insertRows", "deleteRows", "insertColumns", "deleteColumns", "setText"],
  pptx: [
    "setParagraphText",
    "setParagraphStyle",
    "addSlide",
    "deleteSlide",
    "moveSlide",
    "duplicateSlide",
    "addTextBox",
    "addShape",
    "deleteShape",
    "renameShape",
    "setSlideLayout",
    "setSlideNotes",
    "setSlideHidden",
    "setShapeBox",
    "rotateShape",
    "replaceImage",
  ],
  pdf: [
    "deletePage",
    "movePage",
    "rotatePage",
    "insertBlankPage",
    "insertPdfPages",
    "addPageText",
    "addPageImage",
    "replacePageText",
    "replacePageImage",
    "setPageImageBox",
    "annotatePage",
    "cropPage",
    "fillForm",
  ],
  html: [
    "setParagraphText",
    "setBlockHtml",
    "insertBlock",
    "deleteBlock",
    "setBlockType",
    "setBlockAlign",
    "setBlockLineHeight",
    "setBlockIndent",
    "setBlockFirstLineIndent",
    "setBlockList",
    "formatRange",
    "setText",
  ],
  markdown: [
    "setText",
    "replaceDocumentText",
    "setSpanText",
    "setHeading",
    "toggleList",
    "toggleQuote",
    "toggleTask",
    "setProperty",
    "deleteProperty",
    "sortLines",
    "uniqueLines",
    "reverseLines",
    "joinLines",
    "moveLines",
    "duplicateLines",
    "deleteLines",
    "trimTrailing",
    "changeCase",
    "convertIndent",
    "toggleComment",
    "formatJson",
  ],
  text: [
    "setText",
    "replaceDocumentText",
    "setSpanText",
    "sortLines",
    "uniqueLines",
    "reverseLines",
    "joinLines",
    "trimTrailing",
    "changeCase",
    "convertIndent",
    "toggleComment",
    "formatJson",
  ],
  legacy: ["setParagraphText", "setParagraphStyle", "insertParagraph", "deleteParagraph", "setCellValue"],
}

/** 精确到某个操作时给一句参数提示（`commands word setParagraphText`）。 */
const OP_HINTS: Record<string, string> = {
  setParagraphText: "paragraph, text（PPTX 还要 slide + shapeId）",
  setParagraphStyle:
    "paragraph, style:{bold,italic,underline,strike,size,color,highlight,align,lineSpacing,indent,font,paragraphStyle,list,listLevel,clear}, start?, end?",
  insertParagraph: "after, text, style?",
  deleteParagraph: "paragraph",
  deleteTable: "table（文档里第几张表，1 起）",
  addTable: "after, rows:[[…]], header?",
  insertTableRow: "table, at, count?",
  deleteTableRow: "table, at, count?",
  insertTableColumn: "table, at, count?",
  deleteTableColumn: "table, at, count?",
  setTableCellText: "table, row, col, text",
  addPageBreak: "after",
  setHeaderFooter: 'kind:"header"|"footer", text',
  replaceDocumentText: "find, replace（整篇替换；保留命中 run 的格式）",
  moveLines: "direction:up|down, start?, end?（省略区间 = 第一行）",
  duplicateLines: "start?, end?（省略区间 = 第一行）",
  deleteLines: "start?, end?（省略区间 = 第一行）",
  addImage: "after, dataBase64, mime, width?, height?",
  setPageSetup: 'size, orientation:"portrait"|"landscape", margins:{top,right,bottom,left}',
  deleteSlide: "slide",
  moveSlide: "from, to",
  duplicateSlide: "slide",
  addSlide: "after?, layout?",
  addTextBox: "slide, text, box:{x,y,w,h}, style?",
  addShape:
    'slide, kind:"rect"|"roundRect"|"ellipse"|"triangle"|"diamond"|"rightArrow"|"line"|"star5", box?, fill?, line?, text?',
  deleteShape: "slide, shapeId",
  renameShape: "slide, shapeId|shapeName, name（改形状名字）",
  setSlideNotes: "slide, text（没有备注页时自动新建）",
  setSlideLayout: "slide, layout（显示名 / slideLayoutN.xml / 序号）",
  setSlideHidden: "slide, hidden:true|false（放映时隐藏）",
  setShapeBox: "slide, shapeId, box:{x,y,w,h}（pt）",
  rotateShape: "slide, shapeId, degrees",
  replaceImage: "slide, shapeId, data:Uint8Array, mime",
  setCellValue: "sheet, ref:{row,col}, value:string|number|{formula}",
  setCellStyle:
    "sheet, range:{start,end}, style:{bold,italic,underline,color,fill,size,format,align,wrap,merge,border}",
  clearCells: "sheet, range:{start,end}（清空区域里的单元格，行列为空时一并去掉）",
  insertRows: "sheet, at（1 起）, count?",
  deleteRows: "sheet, at, count?",
  insertColumns: "sheet, at（A=1）, count?",
  deleteColumns: "sheet, at, count?",
  addSheet: "name",
  renameSheet: "sheet, name",
  deleteSheet: "sheet",
  setSheetTabColor: "sheet, color?:RRGGBB|AARRGGBB（省略即去掉）",
  deletePage: "page（1 起）",
  movePage: "from, to",
  rotatePage: "page, degrees（90 的倍数）",
  insertBlankPage: "after（0 = 最前面）, width?, height?",
  insertPdfPages: "after（0 = 最前面）, dataBase64, pages?（1 起；省略 = 整份）",
  addPageText: "page, text, x, y, size?, color?",
  addPageImage: "page, dataBase64, mime, x, y, width, height",
  replacePageText: "page, find, replace, all?",
  replacePageImage: "page, index?, dataBase64, mime",
  setPageImageBox: "page, index?, x?, y?, width?, height?, rotation?（左上角原点，单位 pt）",
  annotatePage: "page, kind, x, y, width, height, color?, contents?, id?, replyTo?, fontSize?",
  cropPage: "page, top?, right?, bottom?, left?（pt）",
  fillForm: "fields:[{name,value}]",
  setProperty: "key, property（front matter）",
  deleteProperty: "key",
  setHeading: "level:1-6（0 取消）, start?, end?",
  toggleList: 'kind:"bullet"|"ordered"|"task", start?, end?',
  toggleQuote: "start?, end?",
  toggleTask: "start?, end?",
  setBlockType: "block, tag",
  setBlockAlign: "block, align",
  setBlockLineHeight: "block, value",
  setBlockIndent: "block, value（px）",
  setBlockFirstLineIndent: "block, value（px）",
  setBlockList: 'block, kind:"ul"|"ol"|"none"',
  formatRange: "block, start, end, patch",
  setBlockHtml: "block, html",
  insertBlock: "after, html?|text?, tag?",
  deleteBlock: "block",
  setText: "text（整篇）",
  sortLines: "descending?",
  uniqueLines: "{}",
  reverseLines: "{}",
  joinLines: "{}",
  trimTrailing: "keepHardBreaks?",
  changeCase: 'mode:"upper"|"lower"|"title"|"sentence"|"toggle", start?, end?',
  convertIndent: "toTabs, width?",
  toggleComment: "start?, end?",
  formatJson: "indent?",
}

/** `commands <kind>` 接受的名字（含 word / sheet / slides / pdf 别名）。 */
const KIND_ALIASES: Record<string, readonly OfficeFormat[]> = {
  word: ["docx", "markdown", "text", "html"],
  document: ["docx", "markdown", "text", "html"],
  docx: ["docx"],
  docm: ["docx"],
  doc: ["legacy"],
  odt: ["legacy"],
  rtf: ["legacy"],
  sheet: ["xlsx", "csv"],
  spreadsheet: ["xlsx", "csv"],
  xlsx: ["xlsx"],
  xlsm: ["xlsx"],
  xls: ["legacy"],
  ods: ["legacy"],
  csv: ["csv"],
  slides: ["pptx"],
  presentation: ["pptx"],
  pptx: ["pptx"],
  pptm: ["pptx"],
  ppt: ["legacy"],
  odp: ["legacy"],
  pdf: ["pdf"],
  markdown: ["markdown"],
  md: ["markdown"],
  text: ["text"],
  txt: ["text"],
  code: ["text"],
  html: ["html"],
  richtext: ["html"],
  legacy: ["legacy"],
}

function formatsOfKind(which: string): readonly OfficeFormat[] | undefined {
  const alias = KIND_ALIASES[which.toLowerCase()]
  if (alias) return alias
  const format = officeFormatOf(resolveFile(which))
  return format ? [format] : undefined
}

async function runCommands(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) {
    return {
      formats: Object.keys(OPS_BY_FORMAT),
      ops: OP_NAMES,
      commands: OP_NAMES.map((id) => ({ id, params: OP_HINTS[id] ?? "" })),
    }
  }
  const formats = formatsOfKind(args.file)
  if (!formats) {
    throw new CliError("usage", `「${args.file}」不是文档类型或文件`, "kinds: word, sheet, slides, pdf").withCandidates(
      Object.keys(KIND_ALIASES).slice(0, 8),
    )
  }
  const ops = [...new Set(formats.flatMap((format) => OPS_BY_FORMAT[format] ?? []))]
  const keyword = args.target?.toLowerCase()
  const format = formats.length === 1 ? formats[0] : formats
  if (keyword) {
    const exact = ops.find((name) => name.toLowerCase() === keyword)
    if (exact) {
      return {
        format,
        op: exact,
        params: OP_HINTS[exact] ?? "见 novaway office guide",
        usage: `novaway office run <文件> ${exact} --params '{…}'`,
      }
    }
    const list = ops.filter((name) => name.toLowerCase().includes(keyword))
    if (list.length === 0) {
      throw new CliError(
        "not_found",
        `没有匹配「${args.target}」的操作`,
        `用 novaway office commands ${args.file} 列出全部`,
      ).withCandidates(ops.slice(0, 8))
    }
    return {
      format,
      ops: list,
      hints: Object.fromEntries(list.map((name) => [name, OP_HINTS[name] ?? ""])),
      commands: list.map((id) => ({ id, params: OP_HINTS[id] ?? "" })),
    }
  }
  return { format, ops, commands: ops.map((id) => ({ id, params: OP_HINTS[id] ?? "" })) }
}

const AGENT_GUIDE = [
  "novaway office —— 给 Agent 的文档命令行",
  "",
  "路径寻址：/body/p[3]  /body/block[3]  /body/table[2]  /Sheet1/B2  /Sheet1/A1:C10  /sheet[2]",
  "          /slide[2]/shape[1]  /slide[2]/shape[@id=7]  /slide[2]/shape[@name=Title 1]  /page[4]",
  "",
  "create <文件>            新建（docx / xlsx / pptx / pdf / md / txt / html / csv；--title/--body/--kind/--template/--force）",
  "info <文件>              文件格式、字节数、结构摘要",
  "view <文件> [outline]    骨架：标题 / 幻灯片 / 工作表 / 页，带可直接 get 的路径",
  "view <文件> text         逐段 / 逐单元格 / 逐页的纯文本结构",
  "view <文件> json         完整可编辑状态（调试 / 备份用）",
  "get <文件> <路径>        读一个段落、单元格、形状或页面",
  "set <文件> <路径> value=… [--bold --size 18 --color 1F2937 --align ctr --style Heading1]",
  'set <文件> /Sheet1/A1 \'values:=[["项目","金额"],["合计",120]]\'   从左上角铺开写一片单元格',
  "set <文件> /body/p[2] --list bullet --level 0   给段落套项目符号（DOCX，自动补 numbering.xml）",
  "set <文件> /body --start 0 --end 3 --bold   只给选中的几个字加粗（DOCX）",
  "set <文件> /body header=内部资料            设置页眉（footer= 设置页脚）",
  "set <文件> /page[1] find=Draft --replace Final [--all]   原地替换 PDF 里的文字（保留字体与位置）",
  "set <文件> /page[1] --image-index 1 --x 200 --rotation 90   移动 / 缩放 / 旋转页面上已有的图片（序号见 get /page[N]）",
  "add <文件.pdf> /page[1] --type pages --from 另一份.pdf [--pages 1-3]   把另一份 PDF 的页面插进来",
  "set <文件> /slide[2] notes=讲者提示 hidden=true layout=1   幻灯片备注 / 隐藏页 / 换版式",
  "set <文件> /slide[2]/shape[1] name=主标题   改形状名字（选择窗格里的名字）",
  "set <文件> --ops '<JSON>'   直接提交 OfficeOp 数组（面板/AI 同一套）",
  "add <文件> <父路径> --type paragraph|heading|title|table|pagebreak|text|image|page|textbox|slide|sheet|shape",
  "add <文件> / --type slide|sheet|page   根路径 = 往末尾加一页 / 一张表 / 一页 PDF（不用先知道页码）",
  "          --text … --rows '<JSON>' 或 --rows 2 --cols 3 --image 路径 --after N / --before 路径 / --index N",
  "add <PPTX> /slide[2] --type shape --shape ellipse --width 240 --height 120 --fill 4472C4   插入预设形状（rect/roundRect/ellipse/triangle/diamond/rightArrow/line/star5）",
  '表格结构：set <文件> /body --ops \'[{"op":"insertTableRow","table":1,"at":2},{"op":"setTableCellText","table":1,"row":2,"col":2,"text":"256"}]\'',
  "remove <文件> <路径>     删除段落 / 表格 / 页 / 形状 / 工作表 / PDF 页；remove <文件> /Sheet1/A1:B2 清空单元格",
  "export <文件> <目标文件>  按目标扩展名导出（pdf/md/txt/html/csv/tsv/docx/xlsx/pptx/png）；",
  "          PNG 是一页一张图：export deck.pptx slide2.png --page 2；PDF 还能 --pages 1-3,5 提取成新 PDF",
  "export <文件> <目录> --images  把 PDF 里的内嵌图片逐张写出来",
  "export <旧格式> <目标.docx>      odt/rtf/doc → docx，ods/xls → xlsx，odp/ppt → pptx（另存为）",
  "旧格式：doc/xls/ppt/odt/ods/odp/rtf 都能 view / get / export；ODF 还能 set / add / remove",
  "add <文件> /slide[N] --type slide --layout 两栏内容   新建页时选版式（名称 / slideLayoutN.xml / 序号）",
  "split <PDF> [前缀]        按 --every N 切成多个 PDF（默认一页一个）",
  "加密 PDF：任何命令后面加 --password <密码>；没给或给错会返回 password_required",
  "merge <a.pdf> <b.pdf> … --out 结果.pdf   按顺序合并多份 PDF（可用 --files 'c.pdf,d.pdf' 追加）",
  "batch <文件> --commands '[…]'   在一个文件上执行一串步骤（set / add / remove / get / command）；全有或全无",
  "batch <脚本.json>         多文件脚本 {steps:[{path,ops}]}；全有或全无",
  "run <文件> <命令> --params '{…}'   执行一条引擎命令（命令名用 commands 查）",
  "commands [格式|文件] [关键字]     列出该格式支持的操作；给完整命令名时附带参数说明",
  "help [agent|paths|props|<命令>]  帮助：Agent 指南 / 路径语法 / set·add 属性 / 单条命令",
  "所有命令都接受 --out 文件（写到副本）、--dry-run（不写盘）、--json。",
  "加密 PDF 加 --password <密码>（用户密码或所有者密码都行）；另存后文件不再加密。",
  "",
  "所有命令都接受 --json，输出一行 {ok,data|error}。",
].join("\n")

const PATH_GUIDE = [
  "novaway office —— 路径寻址",
  "",
  "路径都以 / 开头，序号从 1 开始；/ 是整篇文档（add 文件 / --type slide|sheet|page 往末尾加）。",
  "",
  "文档：/body、/body/p[3]、/body/block[3]（和 p 同义）、/body/table[2]",
  "表格：/Sheet1、/sheet[2]（第 2 张工作表）、/Sheet1/B2、/Sheet1/A1:C10",
  "演示：/slide[2]、/slide[2]/shape[1]、/slide[2]/shape[@id=7]、/slide[2]/shape[@name=Title 1]",
  "      /slide[N] 还支持 notes（备注）和 hidden（放映时隐藏）",
  "PDF：/page[4]",
  "",
  "view <文件> outline 会把每个节点的路径列出来，可以直接喂给 get / set / remove。",
].join("\n")

const PROPS_GUIDE = [
  "novaway office —— set / add 支持的属性",
  "",
  "段落 /body/p[N]      text style align bold italic underline strike font size color highlight",
  "                     lineSpacing firstLineIndent indent clear start end",
  "add /body --type     paragraph / heading（level=1..9）/ title / table（rows + cols）/ pagebreak / image",
  "单元格 /Sheet1/A1     value（文本、数字或 =公式）、values:=[[…]]（从左上角铺开）、",
  "                     bold italic underline color fill size format align wrap merge border",
  "区域 /Sheet1/A1:C3   values:=[[…]] 或上面那组格式属性",
  "工作表 /Sheet1       name（改名）、tabColor（标签颜色 RRGGBB，空值去掉）；add / --type sheet name=汇总",
  "幻灯片 /slide[N]     notes（备注页正文）、hidden=true/false（放映时隐藏）、layout（换版式）",
  "形状 /slide[N]/shape[M] text name bold italic underline font size color align fill x y w h rotate",
  "PDF 页 /page[N]      rotate（90 的倍数）、find=旧文字 + replace=新文字（原地替换）、",
  "                     --image-index N + x y width height rotation（调整已有图片；序号见 get /page[N] 的 images）",
  "add /page[N] --type  text（x y size）、image（--image 路径 + x y 宽高）、page（插入空白页）、pages（--from 源 PDF [--pages 1-3]）",
  "",
  "颜色写 RRGGBB 或 #RRGGBB；尺寸和坐标单位是 pt。",
].join("\n")

const COMMAND_HELP: Record<string, string> = {
  create:
    "create <文件> [--template 名字|文档路径] [--title 标题] [--body 正文] [--force]\n按扩展名决定格式；已有文件加 --force 才覆盖。",
  info: "info <文件>\n格式、字节数和结构摘要，只读。",
  view: "view <文件> [outline|text|json]\n默认 outline（骨架 + 路径），text 是逐段/逐单元格/逐页列表，json 是完整状态。",
  get: "get <文件> <路径>\n读一个段落 / 单元格 / 区域 / 形状 / 页面；PDF 页还会列出 images（序号 + 左上角框 + 角度）。",
  set: "set <文件> <路径> value=… [--bold --size 18 --color 1F2937 --align ctr --style Heading1]\nset <文件> <路径> 'values:=[[…]]'   批量写单元格\nset <文件> /page[1] --image-index 1 --x 200 --rotation 90   移动 / 缩放 / 旋转已有图片\nset <文件> --ops '<JSON>'            直接提交 OfficeOp 数组",
  add: "add <文件> <父路径> --type 类型 [--text …] [--after N | --before 路径 | --index N]\n类型：paragraph / heading / title / table / pagebreak / text / image / page / pages / textbox / shape / slide / sheet",
  remove:
    "remove <文件> <路径>\n删除段落 / 表格 / 工作表 / 幻灯片 / 形状 / PDF 页；表格定位到区域（/Sheet1/A1:B2）时清空这些单元格。",
  commands:
    "commands [格式|文件] [关键字|完整命令名]\n格式：word / sheet / slides / pdf（也接受 docx / xlsx / pptx / md …）。",
  run: "run <文件> <命令> [--params '{\"…\":…}']\n执行一条引擎命令再保存；命令名用 `commands <格式>` 查。",
  batch:
    'batch <文件> --commands \'[…]\'   或 --input 步骤.json   或从标准输入读\n步骤：{"set":路径,"props":{…}}、{"add":父路径,"type":…,"props":{…}}、{"remove":路径}、{"get":路径}、{"command":命令id,"params":{…}}\n任何一步失败都不写盘；--keep-going 继续执行剩下的步骤并汇总；--dry-run 只演算；--out 写到副本。',
  export:
    "export <文件> <输出文件> [--page N | --pages 1-3,5] [--images]\n按目标扩展名导出 pdf / md / txt / html / csv / tsv / docx / xlsx / pptx / png；PDF 源可另存为副本或提取页面 / 内嵌图片。\nPNG 一次一张：export in.pdf page1.png --page 1（非 PDF 先按打印排版再画），默认第 1 页、2 倍分辨率。",
  split: "split <PDF> [输出前缀] [--every N]\n按每份页数切分，默认一页一份。",
  merge:
    "merge <a.pdf> <b.pdf> [更多…] --out 结果.pdf\n按顺序把多份 PDF 的页面接起来；源文件只读。--files 'c.pdf,d.pdf' 追加源文件。",
  help: "help [agent|paths|props|<命令>]\nagent 是完整 Agent 指南；paths 是路径语法；props 是 set/add 属性表。",
}

async function runHelp(args: Args): Promise<Record<string, unknown>> {
  // `help paths` 时 yargs 把主题放在 file；`help --target paths` 也能用。
  const topic = (args.target ?? args.file ?? "agent").toLowerCase()
  if (topic === "agent" || topic === "guide" || topic === "all") return { topic: "agent", guide: AGENT_GUIDE }
  if (topic === "paths" || topic === "path") return { topic: "paths", guide: PATH_GUIDE }
  if (topic === "props" || topic === "properties" || topic === "attributes")
    return { topic: "props", guide: PROPS_GUIDE }
  const command = COMMAND_HELP[topic]
  if (command) return { topic, guide: command }
  throw new CliError(
    "usage",
    "不认识的帮助主题：" + String(args.target),
    "可选 agent / paths / props 或一条命令",
  ).withCandidates(["agent", "paths", "props", ...Object.keys(COMMAND_HELP)])
}

async function runInfo(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "info 需要文件路径")
  const target = await open(args.file, args)
  const state = target.state as { encrypted?: boolean; protection?: string }
  return {
    path: target.absolute,
    format: target.format,
    bytes: target.bytes.length,
    ...(state.encrypted ? { encrypted: true, protection: state.protection } : {}),
    summary: summarize(target.format, target.state),
  }
}

async function runCreate(args: Args): Promise<Record<string, unknown>> {
  if (!args.file) throw new CliError("invalid_params", "create 需要文件路径")
  const absolute = resolveFile(args.file)
  if (!args.force) {
    const existing = await readFile(absolute).then(
      () => true,
      () => false,
    )
    if (existing) throw new CliError("exists", "文件已存在：" + absolute + "（加 --force 覆盖）")
  }
  const body = args.body === "-" ? await readStdin() : args.body
  // --template：从一份现有文档开始（样式 / 结构照抄），不是另造一份空白包。
  if (args.template && args.template.toLowerCase() !== "blank" && args.template !== "") {
    const templatePath = resolveFile(args.template)
    const bytes = new Uint8Array(await readFile(templatePath)).slice()
    if (officeFormatOf(templatePath) !== officeFormatOf(absolute)) {
      throw new CliError(
        "invalid_params",
        `模板格式和新建目标不一致：${templatePath} → ${absolute}`,
        "让目标扩展名和模板一致，例如 .docx 模板新建 .docx",
      )
    }
    const filled = await fillTemplate(absolute, bytes, { title: args.title, body })
    await writeAtomic(absolute, filled)
    return { path: absolute, kind: kindOfPath(absolute), bytes: filled.length, template: templatePath }
  }
  const created = await createDocumentAsync(absolute, { kind: args.kind as never, title: args.title, body })
  await writeAtomic(absolute, created.bytes)
  return { path: absolute, kind: created.kind, bytes: created.bytes.length }
}

/**
 * `--template` 里再给 `--title` / `--body` 时，把内容写进模板：
 * 文档替换第一段，演示文稿替换第一页第一个形状，表格写 A1；正文逐行追加。
 */
async function fillTemplate(
  absolute: string,
  bytes: Uint8Array,
  options: { title?: string; body?: string },
): Promise<Uint8Array> {
  if (!options.title && (options.body === undefined || options.body === "")) return bytes
  const opened = await openFromBytes(absolute, bytes)
  const ops: OfficeOp[] = []
  const format = opened.format
  const lines = (options.body ?? "").split(/\r?\n/).filter((line) => line.trim().length > 0)

  if (options.title) {
    if (format === "docx" || format === "legacy" || format === "html") {
      ops.push({ op: "setParagraphText", paragraph: 1, text: options.title } as OfficeOp)
    } else if (format === "pptx") {
      const first = nodesOf(opened.state).find((node) => node.slide === 1)
      if (first)
        ops.push({ op: "setParagraphText", slide: 1, shapeId: first.shapeId, paragraph: 0, text: options.title })
      else ops.push({ op: "addTextBox", slide: 1, text: options.title, box: { x: 48, y: 48, w: 600, h: 60 } })
    } else if (format === "xlsx" || format === "csv") {
      const sheet = sheetsOf(opened.state)[0]?.name ?? "Sheet1"
      ops.push({ op: "setCellValue", sheet, ref: { row: 0, col: 0 }, value: options.title })
    } else if (format === "pdf") {
      ops.push({ op: "addPageText", page: 1, text: options.title, x: 48, y: 48, size: 18 })
    }
  }

  if (lines.length > 0) {
    if (format === "docx" || format === "legacy") {
      const after = lastTopLevelParagraph(opened.state)
      // 同一个锚点从后往前插，最后的顺序才是正的（引擎按原始段落号校验）。
      for (const line of [...lines].reverse()) ops.push({ op: "insertParagraph", after, text: line })
    } else if (format === "html") {
      const after = ((opened.state as { blocks?: unknown[] }).blocks ?? []).length
      for (const line of [...lines].reverse()) ops.push({ op: "insertBlock", after, text: line })
    } else if (format === "pptx") {
      ops.push({
        op: "addTextBox",
        slide: 1,
        text: lines.join("\n"),
        box: { x: 48, y: 140, w: 600, h: 360 },
      })
    } else if (format === "xlsx" || format === "csv") {
      const sheet = sheetsOf(opened.state)[0]?.name ?? "Sheet1"
      ops.push(
        ...matrixOps(
          sheet,
          { row: 1, col: 0 },
          lines.map((line) => [line]),
        ),
      )
    } else if (format === "pdf") {
      for (const [index, line] of lines.entries()) {
        ops.push({ op: "addPageText", page: 1, text: line, x: 48, y: 88 + index * 18, size: 12 })
      }
    } else {
      const existing = (opened.state as { text?: string }).text ?? ""
      ops.push({ op: "setText", text: existing.replace(/\n*$/, "") + "\n" + lines.join("\n") + "\n" })
    }
  }

  if (ops.length === 0) return bytes
  const applied = await opened.engine.apply(opened.state, ops, bytes)
  if (!applied.ok) throw new CliError(applied.error.code, applied.error.message, applied.error.suggestion)
  return applied.data.bytes
}

const ACTION_CHOICES: readonly Actions[] = [
  "create",
  "info",
  "view",
  "get",
  "set",
  "add",
  "remove",
  "batch",
  "run",
  "export",
  "split",
  "merge",
  "commands",
  "guide",
  "help",
]

export const OfficeCommand = cmd<object, Args>({
  command: "office <action> [file] [target] [value]",
  describe:
    "查看 / 修改 / 新建 Office 文档（create info view get set add remove batch run export split merge commands help）",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        type: "string",
        demandOption: true,
        describe:
          "create 新建、info/view 查看、get/set/add/remove 按路径改、batch/run 批量、export 导出、commands 列能力、help 帮助",
      })
      .positional("file", {
        type: "string",
        describe: "文档路径；batch 时是脚本路径，- 表示从标准输入读",
      })
      .positional("target", {
        type: "string",
        describe:
          "内容路径（/body/p[3]、/Sheet1/B2、/slide[2]/shape[1]、/page[4]）、view 的模式（outline/text/json）、run 的命令名或 export 的目标文件",
      })
      .positional("value", {
        type: "string",
        describe: "set 的值；也可以写 value=1280、text=...、rotation=90、values:=[[1,2],[3,4]]",
      })
      .option("ops", {
        type: "string",
        describe: "set 的操作数组（JSON），- 表示从标准输入读",
      })
      .option("kind", {
        type: "string",
        choices: KINDS,
        describe: "create 的文件类型；省略时按扩展名推断",
      })
      .option("title", { type: "string", describe: "create 的标题" })
      .option("body", { type: "string", describe: "create 的正文（Markdown / 文本；- 表示从标准输入读）" })
      .option("template", {
        type: "string",
        describe: "create 的起始模板：内置名字，或一份现有文档的路径（复制它的样式和结构）",
      })
      .option("force", { type: "boolean", default: false, describe: "create 时覆盖已存在的文件" })
      .option("type", {
        type: "string",
        describe:
          "add 的插入类型：paragraph / heading / title / table / pagebreak / text / image / page / pages / textbox / slide / sheet / shape",
      })
      .option("text", { type: "string", describe: "add 的正文或 set 的文字" })
      .option("rows", {
        type: "string",
        describe: "add --type table 的二维数组 JSON；也可以写 --rows 2 --cols 3 生成空表",
      })
      .option("cols", { type: "number", describe: "add --type table 生成空表时的列数" })
      .option("values", {
        type: "string",
        describe: "set 单元格区域的二维数组 JSON（等价于 values:=[[…]]）",
      })
      .option("image", { type: "string", describe: "add --type image 的图片路径" })
      .option("from", { type: "string", describe: "add --type pages 的源 PDF 路径" })
      .option("files", { type: "string", describe: "merge 的其余源文件（逗号分隔）" })
      .option("width", { type: "number", describe: "图片 / 文本框宽度（pt）" })
      .option("height", { type: "number", describe: "图片 / 文本框高度（pt）" })
      .option("x", { type: "number", describe: "PDF 叠字 / 图片的横坐标（pt，原点在左上角）" })
      .option("y", { type: "number", describe: "PDF 叠字 / 图片的纵坐标（pt，原点在左上角）" })
      .option("after", { type: "number", describe: "插入位置（段落号 / 页号；0 = 最前面）" })
      .option("before", { type: "string", describe: "插入到某个节点之前（用它的路径）" })
      .option("index", { type: "number", describe: "插入到第 N 个位置（1 起，和 --after N 等价）" })
      .option("page", { type: "number", describe: "export 时只导出这一页（PDF 提取 / PNG 出图，1 起）" })
      .option("layout", { type: "string", describe: "add --type slide 的版式（名称或 slideLayoutN.xml）" })
      .option("degrees", { type: "number", describe: "旋转角度（90 的倍数）" })
      .option("bold", { type: "boolean", describe: "加粗（--no-bold 取消）" })
      .option("italic", { type: "boolean", describe: "斜体（--no-italic 取消）" })
      .option("underline", { type: "boolean", describe: "下划线（--no-underline 取消）" })
      .option("strike", { type: "boolean", describe: "删除线（--no-strike 取消）" })
      .option("size", { type: "number", describe: "字号（pt）" })
      .option("color", { type: "string", describe: "文字颜色 RRGGBB" })
      .option("highlight", { type: "string", describe: "文字高亮底色 RRGGBB（空串去掉）" })
      .option("line-spacing", { type: "number", describe: "行距倍数（1 / 1.5 / 2）" })
      .option("first-line-indent", { type: "number", describe: "首行缩进（pt）" })
      .option("indent", { type: "number", describe: "左缩进（pt）" })
      .option("clear", { type: "boolean", describe: "清除格式（DOCX 段落）" })
      .option("fill", { type: "string", describe: "单元格 / 形状填充色 RRGGBB" })
      .option("shape", {
        type: "string",
        describe:
          "add --type shape 的形状：rect / roundRect / ellipse / triangle / diamond / rightArrow / line / star5",
      })
      .option("align", { type: "string", choices: ["l", "ctr", "r", "just"] as const, describe: "对齐" })
      .option("font", { type: "string", describe: "字体名" })
      .option("style", { type: "string", describe: "段落样式名（Heading1 / Title …）" })
      .option("list", {
        type: "string",
        choices: ["bullet", "number", "none"] as const,
        describe: "列表：bullet 项目符号 / number 编号 / none 取消（DOCX）",
      })
      .option("level", { type: "number", describe: "列表层级，0 起" })
      .option("border", {
        type: "string",
        describe: "单元格边框：thin / medium / thick / dashed / dotted / double / none",
      })
      .option("format", { type: "string", describe: "单元格数字格式" })
      .option("wrap", { type: "boolean", describe: "单元格自动换行（--no-wrap 取消）" })
      .option("merge", { type: "boolean", describe: "合并单元格（--no-merge 取消）" })
      .option("start", { type: "number", describe: "set 段落格式时的起始字符（选中文字）" })
      .option("end", { type: "number", describe: "set 段落格式时的结束字符（不含）" })
      .option("replace", { type: "string", describe: "set /page[N] find=旧文字 时的新文字" })
      .option("find", { type: "string", describe: "set /page[N] 时要原地替换的旧文字" })
      .option("name", { type: "string", describe: "工作表 / 形状的新名字" })
      .option("tab-color", { type: "string", describe: "工作表标签颜色（RRGGBB / AARRGGBB；空串去掉）" })
      .option("rotation", { type: "number", describe: "PDF 页 / PPTX 形状的旋转角度（配 --image-index 时为图片角度）" })
      .option("image-index", { type: "number", describe: "set PDF 页时要移动 / 缩放的图片序号（1 起）" })
      .option("all", { type: "boolean", default: false, describe: "替换整页所有匹配（默认只换第一处）" })
      .option("params", { type: "string", describe: "run 的命令参数（JSON 对象，- 表示从标准输入读）" })
      .option("input", { type: "string", describe: "batch 的步骤 JSON 文件（- 表示从标准输入读）" })
      .option("commands", { type: "string", describe: 'batch 的步骤 JSON 文本，例如 \'[{"set":"/body/p[1]",…}]\'' })
      .option("out", { type: "string", describe: "写到另一个文件，不覆盖原文件" })
      .option("dry-run", { type: "boolean", default: false, describe: "只演算，不写盘" })
      .option("keep-going", { type: "boolean", default: false, describe: "batch 某一步失败后继续执行剩下的步骤" })
      .option("save", { type: "boolean", default: false, describe: "即使没有改动也写盘（刷新时间戳）" })
      .option("pages", { type: "string", describe: "export PDF 时提取的页码，例如 1-3,5" })
      .option("scale", { type: "number", describe: "export PNG 时的缩放倍数（1 = 72 dpi，默认 2）" })
      .option("images", { type: "boolean", default: false, describe: "export PDF 时导出内嵌图片（写到目标目录）" })
      .option("every", { type: "number", describe: "split 时每份的页数（默认 1）" })
      .option("password", { type: "string", describe: "加密 PDF 的密码（用户密码或所有者密码）" })
      .option("json", { type: "boolean", default: false, describe: "只输出一行 JSON：{ok,data|error}" }),
  handler: async (args) => {
    try {
      const data = await runAction(args)
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data }))
        return
      }
      printHuman(args, data)
    } catch (error) {
      const cli = error instanceof CliError ? error : undefined
      const envelope: Envelope = {
        ok: false,
        error: {
          code: cli ? cli.code : "engine",
          message: error instanceof Error ? error.message : String(error),
          ...(cli?.suggestion ? { suggestion: cli.suggestion } : {}),
          // 候选命令 / 逐步结果都原样带给调用方，脚本才能自己纠正。
          ...(cli?.candidates && cli.candidates.length > 0 ? { candidates: cli.candidates } : {}),
          ...(cli?.details ? { details: cli.details } : {}),
        },
      }
      if (args.json) console.log(JSON.stringify(envelope))
      else {
        console.error(
          "失败：" + envelope.error.message + (envelope.error.suggestion ? "\n提示：" + envelope.error.suggestion : ""),
        )
        if (envelope.error.candidates) console.error("候选：" + envelope.error.candidates.join(" / "))
        for (const item of ((envelope.error.details as { results?: Array<Record<string, unknown>> } | undefined)
          ?.results ?? []) as Array<Record<string, unknown>>) {
          console.error(`  ${item.status} ${item.index}. ${item.command}`)
        }
      }
      process.exitCode = 1
    }
  },
})

async function runAction(args: Args): Promise<Record<string, unknown>> {
  switch (args.action) {
    case "create":
      return runCreate(args)
    case "info":
      return runInfo(args)
    case "view":
      return runView(args)
    case "get":
      return runGet(args)
    case "set":
      // 两种写法共用一条 apply 路径：--ops 直接交 OfficeOp，路径写法由 CLI 翻译。
      return args.ops !== undefined ? runSet(args) : runSetAt(args)
    case "add":
      return runAdd(args)
    case "remove":
      return runRemove(args)
    case "batch":
      return runBatch(args)
    case "run":
      return runCommand(args)
    case "export":
      return runExport(args)
    case "split":
      return runSplit(args)
    case "merge":
      return runMerge(args)
    case "commands":
      return runCommands(args)
    case "guide":
    case "help":
      return runHelp(args)
    default: {
      const input = String(args.action)
      const near = closestMatch(input, ACTION_CHOICES)
      throw new CliError(
        "unknown_command",
        "不认识的命令：" + input,
        near
          ? "你是想用 `" + near + "` 吗？"
          : "用 `novaway office commands` 看能力清单，或 `novaway office guide` 看用法",
      ).withCandidates(closestMatches(input, ACTION_CHOICES))
    }
  }
}

function fmtOf(value: unknown): string {
  return Array.isArray(value) ? value.join(" / ") : String(value)
}

function printHuman(args: Args, data: Record<string, unknown>): void {
  if (args.action === "guide" || args.action === "help") {
    console.log(String(data.guide))
    return
  }
  if (args.action === "commands") {
    if (data.op) {
      console.log(`${data.op}  ${data.format ? `(${fmtOf(data.format)})` : ""}`)
      console.log("参数：" + data.params)
      if (data.usage) console.log("用法：" + data.usage)
      return
    }
    if (data.formats) console.log("格式：" + fmtOf(data.formats))
    const ops = (data.ops as string[] | undefined) ?? []
    const hints = (data.hints as Record<string, string> | undefined) ?? {}
    console.log("操作：")
    for (const name of ops) {
      const hint = hints[name]
      console.log("  " + name + (hint ? "  " + hint : ""))
    }
    return
  }
  if (args.action === "info") {
    console.log(`${data.path}（${data.format}，${data.bytes} 字节）`)
    console.log(String(data.summary))
    return
  }
  if (args.action === "view") {
    console.log(String(data.summary))
    return
  }
  if (args.action === "get") {
    const value = data.value
    console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2))
    return
  }
  if (args.action === "create") {
    console.log(`已新建 ${data.path}（${data.kind}，${data.bytes} 字节）`)
    return
  }
  if (args.action === "export") {
    if (data.files) {
      const files = data.files as Array<{ path: string }>
      console.log(`已导出 ${files.length} 张图片：`)
      for (const file of files) console.log("- " + file.path)
      return
    }
    console.log(
      data.pages
        ? `已提取第 ${(data.pages as number[]).join(", ")} 页到 ${data.out}`
        : `已导出 ${data.out}（${data.format}，${data.bytes} 字节）`,
    )
    return
  }
  if (args.action === "split") {
    const files = data.files as Array<{ path: string }>
    console.log(`已切成 ${files.length} 份：`)
    for (const file of files) console.log("- " + file.path)
    return
  }
  if (args.action === "batch" && data.results) {
    // 单文件 batch：逐步列出 ok / failed / skipped（失败时这条走不到，错误里也有同样的表）。
    const results = data.results as Array<{ index: number; command: string; status: string }>
    console.log(
      `${results.length} 步${data.saved ? (data.dryRun ? "（演算）" : `，已写入 ${data.path}`) : "（未写盘）"}：`,
    )
    for (const item of results) {
      const mark = item.status === "ok" ? "✓" : item.status === "skipped" ? "–" : "✗"
      console.log(`${mark} ${item.index}. ${item.command}`)
    }
    return
  }
  if (args.action === "batch") {
    const files = data.files as Array<{ path: string; changed: string[] }>
    console.log(`完成 ${data.steps} 步，涉及 ${files.length} 个文件：`)
    for (const file of files) console.log(`- ${file.path}（重写 ${file.changed.join(", ") || "无"}）`)
    return
  }
  const changed = (data.changed as string[] | undefined) ?? []
  const where = String(data.path ?? "")
  const suffix = data.command ? `（${data.command}）` : ""
  if (data.dryRun) {
    console.log(
      changed.length > 0 ? `演算完成${suffix}：会重写 ${changed.join(", ")}` : `演算完成${suffix}：内容没有变化`,
    )
    return
  }
  if (!data.saved && changed.length === 0) {
    console.log(`内容没有变化${suffix}`)
    return
  }
  console.log(
    changed.length > 0 ? `已修改 ${where}${suffix}（重写 ${changed.join(", ")}）` : `已保存 ${where}${suffix}`,
  )
  if (data.node !== undefined) console.log(JSON.stringify(data.node, null, 2))
}
