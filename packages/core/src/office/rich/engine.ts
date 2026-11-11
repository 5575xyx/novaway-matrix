/**
 * 富文本引擎：HTML 文件本身就是文档。
 *
 * 关键设计：设计视图和源码视图编辑的是同一份
 * HTML 文本，不存在「设计态模型 → 导出 HTML」的第二条路径，所以两个视图
 * 永远不可能对不上。没改动的文件保存后逐字节不变；改过的文件按原编码写回。
 */

import type { ApplyOutcome, OfficeEngine, OfficeOp, OfficeResult } from "../engine/contract"
import { fail, ok } from "../engine/contract"
import { printToPdf } from "../pdf/print"
import { decodeText, encodeText, looksBinary, type TextFormat } from "../text/format"
import {
  deleteBlock,
  formatRange,
  insertBlock,
  setBlockAlign,
  setBlockFirstLineIndent,
  setBlockIndent,
  setBlockHtml,
  setBlockLineHeight,
  setBlockList,
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
    case "setBlockList":
      return setBlockList(html, op.block, op.kind)
    case "setBlockAlign":
      return setBlockAlign(html, op.block, op.align)
    case "setBlockLineHeight":
      return setBlockLineHeight(html, op.block, op.value)
    case "setBlockIndent":
      return setBlockIndent(html, op.block, op.value)
    case "setBlockFirstLineIndent":
      return setBlockFirstLineIndent(html, op.block, op.value)
    case "formatRange":
      return formatRange(html, op.block, op.start, op.end, op.patch)
    case "setBlockHtml":
      return setBlockHtml(html, op.block, op.html)
    case "insertBlock":
      return insertBlock(html, op.after, { html: op.html, text: op.text, tag: op.tag })
    case "deleteBlock":
      return deleteBlock(html, op.block)
    // 源码视图保存：整篇 HTML 替换。HTML 文件本身就是文本，这和文本编辑器一致。
    case "setText":
      return ok(op.text)
    default:
      return fail("unsupported_format", op.op + " 不适用于富文本")
  }
}

/** Markdown 里需要反斜杠转义的字符（只处理会改变结构的那些）。 */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, "\\$1")
}

/**
 * 块 → Markdown 行内文本：加粗 / 斜体 / 删除线 / 链接。
 *
 * 下划线在 Markdown 里没有通用记法（`__` 是加粗），所以丢掉；
 * 颜色和字号也一样 —— 它们是表现，导出成 md 时本来就不该存在。
 */
function markdownInline(block: RichBlock): string {
  return block.runs
    .map((run) => {
      // 块内换行在 Markdown 的单行里没有对应，按空格压平。
      let text = escapeMarkdown(run.text).split(String.fromCharCode(10)).join(" ")
      // 纯空白 run 只负责词间空格，不能被包上 `**`。
      if (text.trim().length === 0) return text
      if (run.bold) text = "**" + text + "**"
      if (run.italic) text = "*" + text + "*"
      if (run.strikethrough) text = "~~" + text + "~~"
      if (run.href) text = "[" + text + "](" + run.href + ")"
      return text
    })
    .join("")
    .trim()
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

  /** 导出：html 原样输出，md 保留层级与行内格式，txt 只留文字。 */
  async export(state, target) {
    const kind = target.toLowerCase().replace(/^\./, "")
    const encoder = new TextEncoder()
    if (kind === "html" || kind === "htm") return ok(encoder.encode(state.html))

    // 标题与列表在 Markdown 里有对应记法，导出时保留层级；txt 只留文字。
    const paragraphs = state.blocks.map((block) => ({
      text: block.text.trim(),
      markdown: markdownInline(block),
      heading: /^h[1-6]$/.test(block.tag) ? Number(block.tag.slice(1)) : undefined,
      list: block.tag === "li",
    }))
    if (kind === "md" || kind === "markdown") {
      const lines = paragraphs
        .filter((paragraph) => paragraph.text.length > 0)
        .map((paragraph) => {
          if (paragraph.heading) return "#".repeat(paragraph.heading) + " " + paragraph.markdown
          return paragraph.list ? "- " + paragraph.markdown : paragraph.markdown
        })
      return ok(encoder.encode(lines.join("\n\n")))
    }
    if (kind === "txt" || kind === "text") {
      return ok(
        encoder.encode(
          paragraphs
            .map((paragraph) => paragraph.text)
            .filter(Boolean)
            .join("\n\n"),
        ),
      )
    }
    if (kind === "pdf") return ok(await printToPdf("html", state))
    return fail("unsupported_format", "HTML 不能导出成 " + target, "支持 pdf / txt / md / html")
  },
}
