/**
 * 富文本引擎：HTML 文件本身就是文档。
 *
 * 这一点和 Weave 的 `RichApp` 完全一致：设计视图和源码视图编辑的是同一份
 * HTML 文本，不存在「设计态模型 → 导出 HTML」的第二条路径，所以两个视图
 * 永远不可能对不上。没改动的文件保存后逐字节不变；改过的文件按原编码写回。
 */

import type { ApplyOutcome, OfficeEngine, OfficeOp, OfficeResult } from "../engine/contract"
import { fail, ok } from "../engine/contract"
import { decodeText, encodeText, looksBinary, type TextFormat } from "../text/format"
import {
  formatRange,
  setBlockAlign,
  setBlockIndent,
  setBlockHtml,
  setBlockLineHeight,
  setBlockText,
  setBlockType,
} from "./commands"
import { parseRichBlocks, type RichBlock } from "./model"

export type RichState = {
  /** 唯一的事实来源：HTML 文本。 */
  html: string
  /** 原文件的编码 / BOM / 换行符。 */
  format: TextFormat
  blocks: RichBlock[]
}

export function readRich(html: string, format: TextFormat): RichState {
  return { html, format, blocks: parseRichBlocks(html) }
}

function applyOne(html: string, op: OfficeOp): OfficeResult<string> {
  switch (op.op) {
    case "setParagraphText":
    case "setSpanText":
      return setBlockText(html, op.paragraph, op.text)
    case "setBlockType":
      return setBlockType(html, op.block, op.tag)
    case "setBlockAlign":
      return setBlockAlign(html, op.block, op.align)
    case "setBlockLineHeight":
      return setBlockLineHeight(html, op.block, op.value)
    case "setBlockIndent":
      return setBlockIndent(html, op.block, op.value)
    case "formatRange":
      return formatRange(html, op.block, op.start, op.end, op.patch)
    case "setBlockHtml":
      return setBlockHtml(html, op.block, op.html)
    // 源码视图保存：整篇 HTML 替换。HTML 文件本身就是文本，这和文本编辑器一致。
    case "setText":
      return ok(op.text)
    default:
      return fail("unsupported_format", op.op + " 不适用于富文本")
  }
}

export const richEngine: OfficeEngine<RichState> = {
  format: "html",

  async open(bytes) {
    const decoded = decodeText(bytes)
    if (looksBinary(decoded.text)) return fail("open_failed", "这个文件看起来不是文本文件")
    return ok(readRich(decoded.text, decoded.format))
  },

  async apply(state, ops, bytes) {
    if (ops.length === 0) return fail("invalid_params", "没有要执行的操作")
    const decoded = decodeText(bytes)

    let html = decoded.text
    const applied: Array<{ op: string }> = []
    for (const op of ops) {
      const step = applyOne(html, op)
      if (!step.ok) return step
      html = step.data
      applied.push({ op: op.op })
    }

    // 命令没有实际改变内容：返回空 changed，让会话层按「没有改动」处理，
    // 不要把一份一模一样的文件重新编码（那会白白改掉换行符和 BOM）。
    if (html === decoded.text) {
      const outcome: ApplyOutcome<RichState> = { state, bytes, changed: [], applied }
      return ok(outcome)
    }

    const next = encodeText(html, decoded.format)
    const reopened = await richEngine.open(next)
    if (!reopened.ok) return reopened
    return ok({ state: reopened.data, bytes: next, changed: ["html"], applied })
  },
}
