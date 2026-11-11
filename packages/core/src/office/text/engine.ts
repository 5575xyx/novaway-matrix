/**
 * 纯文本 / 代码 / Markdown 引擎。
 *
 * 行为约定：
 *   - 内存里统一用 \n，保存时恢复原文件的换行符；
 *   - 编码和 BOM 原样保留（GBK 的中文文件不能变成乱码）；
 *   - 没有改动就不重新编码，保存后逐字节不变；
 *   - 行命令（排序、去重、注释、格式化 JSON）和 UI / AI 共用一份实现。
 */

import type { ApplyOutcome, OfficeEngine, OfficeOp, OfficeResult } from "../engine/contract"
import { docxFromBlocks, type DocxBlock } from "../create"
import { printToPdf } from "../pdf/print"
import { fail, ok } from "../engine/contract"
import {
  applyTextEdit,
  caret,
  changeCase,
  convertIndent,
  formatJson,
  joinLines,
  moveLines,
  duplicateLines,
  deleteLines,
  reverseLines,
  sortLines,
  commentTokens,
  toggleComment,
  trimTrailing,
  uniqueLines,
  type Selection,
  type TextEdit,
} from "./commands"
import { setHeading, toggleList, toggleQuote, toggleTask, type HeadingLevel } from "./markdown"
import { updateFrontMatter } from "./front-matter"
import { decodeText, encodeText, looksBinary, type TextFormat } from "./format"

export type TextState = {
  text: string
  format: TextFormat
  lines: number
}

export function readText(text: string, format: TextFormat): TextState {
  return { text, format, lines: text.split("\n").length }
}

/** 偏移区间：省略就覆盖整篇（模型没有光标，整篇是最合理的默认）。 */
function spanOf(text: string, start?: number, end?: number): OfficeResult<Selection> {
  const from = start ?? 0
  const to = end ?? text.length
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > text.length) {
    return fail(
      "invalid_params",
      `start / end 必须是 0 到 ${text.length} 之间的偏移，且 start ≤ end`,
      "省略 start/end 即可作用于整篇",
    )
  }
  return ok({ anchor: from, head: to })
}

function runCommand(text: string, op: OfficeOp, format: "text" | "markdown"): OfficeResult<string> {
  let edit: TextEdit | undefined
  switch (op.op) {
    case "setText":
      return ok(op.text)
    case "replaceDocumentText": {
      // 整篇查找替换：和 DOCX 的 replaceDocumentText 同名同语义。
      if (!op.find) return fail("invalid_params", "要替换的文字不能为空")
      return ok(text.split(op.find).join(op.replace))
    }
    case "setSpanText":
      // 文本文件没有段落概念：setSpanText 视为整篇替换（和 DOCX 的 1 起下标一致）。
      if (op.paragraph !== 1) return fail("invalid_params", "文本文件只有第 1 段（整篇）", "把 paragraph 设为 1")
      return ok(op.text)
    case "sortLines":
      edit = sortLines(text, caret(0), op.descending ?? false)
      break
    case "uniqueLines":
      edit = uniqueLines(text, caret(0))
      break
    case "reverseLines":
      edit = reverseLines(text, caret(0))
      break
    case "joinLines":
      edit = joinLines(text, caret(0))
      break
    case "moveLines":
    case "duplicateLines":
    case "deleteLines": {
      // 行命令省略区间时只作用于第一行（和「光标在开头」一致）：
      // 照搬「省略即整篇」会把全文删掉或复制一倍，不是任何人想要的。
      const span =
        op.start === undefined && op.end === undefined
          ? ({ ok: true, data: caret(0) } as const)
          : spanOf(text, op.start, op.end)
      if (!span.ok) return span
      if (op.op === "moveLines") {
        if (op.direction !== "up" && op.direction !== "down") {
          return fail("invalid_params", "移动方向只能是 up 或 down")
        }
        edit = moveLines(text, span.data, op.direction === "up" ? -1 : 1)
        // 已经在最上面 / 最下面：没有可移动的空间，明确告诉调用方。
        if (!edit && op.direction === "up") return fail("invalid_params", "选中的行已经在最上面")
        if (!edit) return fail("invalid_params", "选中的行已经在最下面")
      } else if (op.op === "duplicateLines") {
        edit = duplicateLines(text, span.data)
      } else {
        edit = deleteLines(text, span.data)
      }
      break
    }
    case "trimTrailing":
      edit = trimTrailing(text, caret(0), op.keepHardBreaks ?? false)
      break
    case "changeCase": {
      const span = spanOf(text, op.start, op.end)
      if (!span.ok) return span
      edit = changeCase(text, span.data, op.mode)
      break
    }
    case "convertIndent": {
      const width = op.width ?? 2
      if (!Number.isInteger(width) || width < 1 || width > 8) {
        return fail("invalid_params", "缩进宽度必须是 1 到 8", "常用的值是 2 或 4")
      }
      const span = spanOf(text, op.start, op.end)
      if (!span.ok) return span
      edit = convertIndent(text, span.data, op.toTabs, width)
      break
    }
    case "toggleComment":
      // 不传 marker 时按语言给默认值：Markdown 的 # 是标题，注释要用 <!-- -->。
      edit = toggleComment(text, caret(0), op.marker ?? (format === "markdown" ? commentTokens("md")! : "//"))
      break
    case "formatJson":
      try {
        edit = formatJson(text, caret(0), op.indent)
      } catch (error) {
        return fail("invalid_params", error instanceof Error ? error.message : "JSON 解析失败")
      }
      break
    case "setHeading": {
      if (format !== "markdown") {
        return fail("unsupported_format", "标题只适用于 Markdown", "纯文本请用 toggleList / toggleQuote 或直接改文字")
      }
      if (!Number.isInteger(op.level) || op.level < 0 || op.level > 6) {
        return fail("invalid_params", "标题级别必须是 0 到 6", "0 表示取消标题")
      }
      const span = spanOf(text, op.start, op.end)
      if (!span.ok) return span
      edit = setHeading(text, span.data, op.level as HeadingLevel)
      break
    }
    case "toggleList": {
      if (op.kind !== "bullet" && op.kind !== "ordered" && op.kind !== "task") {
        return fail("invalid_params", "列表类型只能是 bullet / ordered / task")
      }
      const span = spanOf(text, op.start, op.end)
      if (!span.ok) return span
      edit = toggleList(text, span.data, op.kind)
      break
    }
    case "toggleQuote": {
      const span = spanOf(text, op.start, op.end)
      if (!span.ok) return span
      edit = toggleQuote(text, span.data)
      break
    }
    case "toggleTask": {
      const span = spanOf(text, op.start, op.end)
      if (!span.ok) return span
      edit = toggleTask(text, span.data)
      // 选区里没有任务项：明确告诉调用方，而不是静默成功。
      if (!edit) return fail("invalid_params", "选中的行里没有任务项", "任务项的写法是 - [ ] 或 - [x]")
      break
    }
    case "setProperty":
    case "deleteProperty": {
      if (format !== "markdown") {
        return fail("unsupported_format", "属性区只存在于 Markdown", "纯文本文件请直接改内容")
      }
      if (!op.key.trim()) return fail("invalid_params", "属性名不能为空")
      // 删除 = 写入 undefined；更新时只动这一行，其余 YAML 原样保留。
      const value = op.op === "setProperty" ? op.value : undefined
      return ok(updateFrontMatter(text, { [op.key]: value }))
    }
    default:
      return fail("unsupported_format", op.op + " 不适用于纯文本")
  }
  if (!edit) return ok(text)
  return ok(applyTextEdit(text, edit))
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** Markdown 的块级结构 → 文档段落（标题给命名层级，代码块逐行）。 */
function markdownToBlocks(text: string): DocxBlock[] {
  const blocks: DocxBlock[] = []
  let inCode = false
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inCode = !inCode
      continue
    }
    if (inCode) {
      if (raw.trim() !== "") blocks.push({ text: raw })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw)
    if (heading) blocks.push({ text: heading[2]!, heading: heading[1]!.length })
    else if (raw.trim() !== "") blocks.push({ text: raw })
  }
  return blocks
}

function titleOfMarkdown(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const heading = /^#\s+(.*)$/.exec(line)
    if (heading) return heading[1]!.trim().slice(0, 80) || "文档"
  }
  const first = text.split(/\r?\n/).find((line) => line.trim() !== "" && !/^---+$/.test(line.trim()))
  return (
    first
      ?.replace(/^#+\s*/, "")
      .trim()
      .slice(0, 60) || "文档"
  )
}

/** 一个够用的 Markdown → HTML：标题、列表、代码块、段落。 */
function markdownToHtml(text: string): string {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let list: string[] = []
  let code: string[] = []
  let inCode = false
  const flushList = () => {
    if (list.length === 0) return
    out.push("<ul>" + list.map((item) => "<li>" + item + "</li>").join("") + "</ul>")
    list = []
  }
  const flushCode = () => {
    if (code.length === 0) return
    out.push("<pre>" + escapeHtml(code.join(String.fromCharCode(10))) + "</pre>")
    code = []
  }
  let start = 0
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
    if (close > 0) start = close + 1
  }
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]!
    if (/^\s*(```|~~~)/.test(line)) {
      if (inCode) flushCode()
      inCode = !inCode
      continue
    }
    if (inCode) {
      code.push(line)
      continue
    }
    if (line.trim() === "") {
      flushList()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushList()
      const level = heading[1]!.length
      out.push(`<h${level}>${escapeHtml(heading[2]!)}</h${level}>`)
      continue
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      list.push(escapeHtml(bullet[1]!))
      continue
    }
    flushList()
    out.push(`<p>${escapeHtml(line)}</p>`)
  }
  flushList()
  flushCode()
  return (
    '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    out.join(String.fromCharCode(10)) +
    "</body></html>"
  )
}

function createTextEngine(format: "text" | "markdown"): OfficeEngine<TextState> {
  const engine: OfficeEngine<TextState> = {
    format,

    async open(bytes) {
      const decoded = decodeText(bytes)
      if (looksBinary(decoded.text)) return fail("open_failed", "这个文件看起来不是文本文件")
      return ok(readText(decoded.text, decoded.format))
    },

    async apply(state, ops, bytes) {
      if (ops.length === 0) return fail("invalid_params", "没有要执行的操作")
      const decoded = decodeText(bytes)

      let text = decoded.text
      const applied: Array<{ op: string }> = []
      for (const op of ops) {
        const step = runCommand(text, op, format)
        if (!step.ok) return step
        text = step.data
        applied.push({ op: op.op })
      }

      if (text === decoded.text) {
        const outcome: ApplyOutcome<TextState> = { state, bytes, changed: [], applied }
        return ok(outcome)
      }

      const next = encodeText(text, decoded.format)
      const reopened = await engine.open(next)
      if (!reopened.ok) return reopened
      return ok({ state: reopened.data, bytes: next, changed: ["text"], applied })
    },

    /**
     * 文本文件本身是最终产物；txt / md 原样输出。
     * 另外 Markdown 能借文档引擎出纸（docx / html / pdf），
     * 这样笔记也能直接打印或用 `export note.md note.pdf` 交给别人。
     */
    async export(state, target) {
      const kind = target.toLowerCase().replace(/^\./, "")
      if (kind === "txt" || kind === "text" || kind === "md" || kind === "markdown") {
        return ok(encodeText(state.text, state.format))
      }
      if (kind === "pdf") return ok(await printToPdf(format, state))
      if (kind === "html" || kind === "htm") {
        return ok(new TextEncoder().encode(markdownToHtml(state.text)))
      }
      if (kind === "docx") return ok(docxFromBlocks(titleOfMarkdown(state.text), markdownToBlocks(state.text)))
      return fail("unsupported_format", format + " 不能导出成 " + target, "支持 txt / md / html / docx / pdf")
    },
  }
  return engine
}

export const textEngine = createTextEngine("text")
export const markdownEngine = createTextEngine("markdown")
