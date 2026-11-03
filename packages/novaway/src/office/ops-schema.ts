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

export const DocumentOpStyle = Schema.Struct({
  bold: Schema.optional(Schema.Boolean),
  italic: Schema.optional(Schema.Boolean),
  underline: Schema.optional(Schema.Boolean),
  size: Schema.optional(Schema.Number),
  color: Schema.optional(Schema.String),
  align: Schema.optional(Schema.Literals(["l", "ctr", "r", "just"])),
  font: Schema.optional(Schema.String),
})

export const DocumentFormatPatch = Schema.Struct({
  bold: Schema.optional(Schema.Boolean),
  italic: Schema.optional(Schema.Boolean),
  underline: Schema.optional(Schema.Boolean),
  strikethrough: Schema.optional(Schema.Boolean),
  color: Schema.optional(Schema.String),
  highlight: Schema.optional(Schema.String),
  size: Schema.optional(Schema.Number),
  clear: Schema.optional(Schema.Boolean),
})

export const DocumentOp = Schema.Struct({
  op: Schema.String,
  paragraph: Schema.optional(Schema.Number),
  block: Schema.optional(Schema.Number),
  text: Schema.optional(Schema.String),
  style: Schema.optional(DocumentOpStyle),
  tag: Schema.optional(Schema.String),
  align: Schema.optional(Schema.String),
  value: Schema.optional(Schema.Number),
  start: Schema.optional(Schema.Number),
  end: Schema.optional(Schema.Number),
  patch: Schema.optional(DocumentFormatPatch),
  html: Schema.optional(Schema.String),
  descending: Schema.optional(Schema.Boolean),
  keepHardBreaks: Schema.optional(Schema.Boolean),
  marker: Schema.optional(Schema.String),
  indent: Schema.optional(Schema.String),
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
      return { ok: true, op: { op: "setParagraphStyle", paragraph, style: input.style as ParagraphStylePatch } }
    }
    case "setText": {
      const text = needString("text")
      if (text === undefined) return missing("text")
      return { ok: true, op: { op: "setText", text } }
    }
    case "sortLines":
      return { ok: true, op: { op: "sortLines", ...(input.descending !== undefined ? { descending: input.descending } : {}) } }
    case "uniqueLines":
      return { ok: true, op: { op: "uniqueLines" } }
    case "reverseLines":
      return { ok: true, op: { op: "reverseLines" } }
    case "joinLines":
      return { ok: true, op: { op: "joinLines" } }
    case "trimTrailing":
      return {
        ok: true,
        op: { op: "trimTrailing", ...(input.keepHardBreaks !== undefined ? { keepHardBreaks: input.keepHardBreaks } : {}) },
      }
    case "toggleComment":
      return { ok: true, op: { op: "toggleComment", ...(input.marker !== undefined ? { marker: input.marker } : {}) } }
    case "formatJson":
      return { ok: true, op: { op: "formatJson", ...(input.indent !== undefined ? { indent: input.indent } : {}) } }
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
    case "setBlockIndent": {
      const block = needNumber("block")
      const value = needNumber("value")
      if (block === undefined || value === undefined) return missing("block 和 value")
      return { ok: true, op: { op: input.op, block, value } }
    }
    case "setBlockHtml": {
      const block = needNumber("block")
      const html = needString("html")
      if (block === undefined || html === undefined) return missing("block 和 html")
      return { ok: true, op: { op: "setBlockHtml", block, html } }
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
    default:
      return { ok: false, message: "不支持的操作：" + input.op }
  }
}

function missing(fields: string): { ok: false; message: string } {
  return { ok: false, message: "缺少字段：" + fields }
}
