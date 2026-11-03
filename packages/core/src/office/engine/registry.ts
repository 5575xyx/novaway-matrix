/**
 * 文件类型识别与引擎注册。
 *
 * 对齐 Weave 的 `DocumentKind::from_path`：扩展名决定「用哪个编辑器」，
 * 而不是靠内容嗅探。未知扩展名当纯文本处理，交给文本编辑器。
 */

import type { OfficeFormat } from "./contract"
import { docxEngine } from "./docx"
import { pptxEngine } from "./pptx"
import { xlsxEngine } from "./xlsx"
import { richEngine } from "../rich/engine"
import { markdownEngine, textEngine } from "../text/engine"
import type { OfficeEngine } from "./contract"

export type DocumentKind = "document" | "spreadsheet" | "presentation" | "pdf" | "markdown" | "plaintext" | "richtext"

const KIND_BY_EXTENSION: Record<string, DocumentKind> = {
  docx: "document",
  docm: "document",
  doc: "document",
  odt: "document",
  rtf: "document",
  xlsx: "spreadsheet",
  xlsm: "spreadsheet",
  xls: "spreadsheet",
  ods: "spreadsheet",
  csv: "spreadsheet",
  pptx: "presentation",
  pptm: "presentation",
  ppt: "presentation",
  odp: "presentation",
  pdf: "pdf",
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  mkd: "markdown",
  mdx: "markdown",
  html: "richtext",
  htm: "richtext",
  xhtml: "richtext",
  shtml: "richtext",
}

export function extensionOf(path: string): string {
  const name = path.split(/[\/]/).pop() ?? path
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase()
}

export function kindOfPath(path: string): DocumentKind {
  return KIND_BY_EXTENSION[extensionOf(path)] ?? "plaintext"
}

/** 新建文档时的默认扩展名（和 Weave 的 default_extension 一致）。 */
export function defaultExtension(kind: DocumentKind): string {
  switch (kind) {
    case "document":
      return "docx"
    case "spreadsheet":
      return "xlsx"
    case "presentation":
      return "pptx"
    case "pdf":
      return "pdf"
    case "markdown":
      return "md"
    case "richtext":
      return "html"
    default:
      return "txt"
  }
}

/**
 * 已实现的「按节点编辑」引擎。
 * PDF 还没接进来：它的写入路径是对象级的，在实现之前不要假装支持 ——
 * 调用方拿到 undefined 就该退回只读预览（Chromium 内嵌阅读器）。
 */
export function engineFor(format: OfficeFormat): OfficeEngine<unknown> | undefined {
  if (format === "docx") return docxEngine as unknown as OfficeEngine<unknown>
  if (format === "pptx") return pptxEngine as unknown as OfficeEngine<unknown>
  if (format === "xlsx") return xlsxEngine as unknown as OfficeEngine<unknown>
  if (format === "html") return richEngine as unknown as OfficeEngine<unknown>
  if (format === "markdown") return markdownEngine as unknown as OfficeEngine<unknown>
  if (format === "text") return textEngine as unknown as OfficeEngine<unknown>
  return undefined
}

export function officeFormatOf(path: string): OfficeFormat | undefined {
  const kind = kindOfPath(path)
  if (kind === "document" && extensionOf(path) === "docx") return "docx"
  if (kind === "presentation" && extensionOf(path) === "pptx") return "pptx"
  if (kind === "spreadsheet" && extensionOf(path) === "xlsx") return "xlsx"
  if (kind === "richtext") return "html"
  if (kind === "markdown") return "markdown"
  if (kind === "plaintext") return "text"
  return undefined
}
