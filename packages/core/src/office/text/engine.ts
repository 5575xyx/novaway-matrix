/**
 * 纯文本 / 代码 / Markdown 引擎。
 *
 * 对齐 Weave 的 `crates/text-editor`：
 *   - 内存里统一用 \n，保存时恢复原文件的换行符；
 *   - 编码和 BOM 原样保留（GBK 的中文文件不能变成乱码）；
 *   - 没有改动就不重新编码，保存后逐字节不变；
 *   - 行命令（排序、去重、注释、格式化 JSON）和 UI / AI 共用一份实现。
 */

import type { ApplyOutcome, OfficeEngine, OfficeOp, OfficeResult } from "../engine/contract"
import { fail, ok } from "../engine/contract"
import {
  applyTextEdit,
  caret,
  formatJson,
  joinLines,
  reverseLines,
  sortLines,
  toggleComment,
  trimTrailing,
  uniqueLines,
  type TextEdit,
} from "./commands"
import { decodeText, encodeText, looksBinary, type TextFormat } from "./format"

export type TextState = {
  text: string
  format: TextFormat
  lines: number
}

export function readText(text: string, format: TextFormat): TextState {
  return { text, format, lines: text.split("\n").length }
}

function runCommand(text: string, op: OfficeOp): OfficeResult<string> {
  let edit: TextEdit | undefined
  switch (op.op) {
    case "setText":
      return ok(op.text)
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
    case "trimTrailing":
      edit = trimTrailing(text, caret(0), op.keepHardBreaks ?? false)
      break
    case "toggleComment":
      edit = toggleComment(text, caret(0), op.marker ?? "//")
      break
    case "formatJson":
      try {
        edit = formatJson(text, caret(0), op.indent)
      } catch (error) {
        return fail("invalid_params", error instanceof Error ? error.message : "JSON 解析失败")
      }
      break
    default:
      return fail("unsupported_format", op.op + " 不适用于纯文本")
  }
  if (!edit) return ok(text)
  return ok(applyTextEdit(text, edit))
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
        const step = runCommand(text, op)
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
  }
  return engine
}

export const textEngine = createTextEngine("text")
export const markdownEngine = createTextEngine("markdown")
