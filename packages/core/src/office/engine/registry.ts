/**
 * 文件类型识别与引擎注册。
 *
 * 扩展名决定「用哪个编辑器」，
 * 而不是靠内容嗅探。未知扩展名当纯文本处理，交给文本编辑器。
 */

import type { OfficeFormat } from "./contract"
import { csvEngine } from "../csv/engine"
import { docxEngine } from "./docx"
import { pdfEngine } from "../pdf/engine"
import { legacyEngine } from "../legacy/engine"
import { pptxEngine } from "./pptx"
import { xlsxEngine } from "./xlsx"
import { richEngine } from "../rich/engine"
import { markdownEngine, textEngine } from "../text/engine"
import type { OfficeEngine } from "./contract"

export type DocumentKind = "document" | "spreadsheet" | "presentation" | "pdf" | "markdown" | "plaintext" | "richtext"

const KIND_BY_EXTENSION: Record<string, DocumentKind> = {
  docx: "document",
  docm: "document",
  dotx: "document",
  dotm: "document",
  doc: "document",
  odt: "document",
  rtf: "document",
  xlsx: "spreadsheet",
  xlsm: "spreadsheet",
  xltx: "spreadsheet",
  xltm: "spreadsheet",
  xls: "spreadsheet",
  ods: "spreadsheet",
  csv: "spreadsheet",
  pptx: "presentation",
  pptm: "presentation",
  potx: "presentation",
  potm: "presentation",
  ppsx: "presentation",
  ppsm: "presentation",
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

export type OfficeEngineRegistration = {
  format: string
  kind: DocumentKind
  extensions: string[]
  aliases?: Record<string, string>
  engine: OfficeEngine<unknown>
}

const ENGINE_REGISTRY = new Map<string, OfficeEngineRegistration>()
const EXTENSION_REGISTRY = new Map<string, string>()

export function registerOfficeEngine(registration: OfficeEngineRegistration): { dispose: () => void } {
  const normalized = {
    ...registration,
    extensions: registration.extensions.map((extension) => extension.replace(/^\./, "").toLowerCase()),
  }
  const previous = ENGINE_REGISTRY.get(registration.format)
  ENGINE_REGISTRY.set(registration.format, normalized)
  for (const extension of normalized.extensions) EXTENSION_REGISTRY.set(extension, registration.format)
  for (const [alias, format] of Object.entries(normalized.aliases ?? {})) {
    EXTENSION_REGISTRY.set(alias.replace(/^\./, "").toLowerCase(), format)
  }
  return {
    dispose() {
      if (ENGINE_REGISTRY.get(registration.format) !== normalized) return
      ENGINE_REGISTRY.delete(registration.format)
      for (const [extension, format] of EXTENSION_REGISTRY) {
        if (format === registration.format) EXTENSION_REGISTRY.delete(extension)
      }
      if (previous) {
        ENGINE_REGISTRY.set(registration.format, previous)
        for (const extension of previous.extensions) EXTENSION_REGISTRY.set(extension, registration.format)
        for (const [alias, format] of Object.entries(previous.aliases ?? {})) {
          EXTENSION_REGISTRY.set(alias.replace(/^\./, "").toLowerCase(), format)
        }
      }
    },
  }
}

function registerBuiltIn(format: string, kind: DocumentKind, extensions: string[], engine: OfficeEngine<unknown>, aliases?: Record<string, string>) {
  registerOfficeEngine({ format, kind, extensions, aliases, engine })
}

export function extensionOf(path: string): string {
  const name = path.split(/[\/]/).pop() ?? path
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase()
}

export function kindOfPath(path: string): DocumentKind {
  const extension = extensionOf(path)
  const builtinKind = KIND_BY_EXTENSION[extension]
  if (builtinKind) return builtinKind
  const dynamic = EXTENSION_REGISTRY.get(extension)
  if (dynamic) return ENGINE_REGISTRY.get(dynamic)?.kind ?? "plaintext"
  return "plaintext"
}

/** 新建文档时的默认扩展名。 */
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
 * 已实现的编辑引擎。
 * PDF 走页面级编辑（删页 / 调序 / 旋转 / 叠加文字图片 / 批注 / 填表），
 * 不改正文里已有的字 —— PDF 没有段落模型，原地改字会破坏排版。
 */
export function engineFor(format: OfficeFormat | string): OfficeEngine<unknown> | undefined {
  return ENGINE_REGISTRY.get(format)?.engine
}

/**
 * 带宏 / 模板的 OOXML 变体：包的内部结构和 docx / xlsx / pptx 完全一致，
 * 只多一个 vbaProject.bin（或少几张示例页）。直接复用同一条引擎 ——
 * 宏那部分我们一个字节都不碰，原样复制回去。
 */
const OOXML_ALIASES: Record<string, OfficeFormat> = {
  docm: "docx",
  dotx: "docx",
  dotm: "docx",
  xlsm: "xlsx",
  xltx: "xlsx",
  xltm: "xlsx",
  pptm: "pptx",
  potx: "pptx",
  potm: "pptx",
  ppsx: "pptx",
  ppsm: "pptx",
}

/** 只读的旧格式：解析器认识，但没有写出引擎。 */
const LEGACY_EXTENSIONS = new Set(["odt", "ods", "odp", "rtf", "doc", "xls", "ppt"])

export function officeFormatOf(path: string): OfficeFormat | undefined {
  const extension = extensionOf(path)
  const registered = EXTENSION_REGISTRY.get(extension)
  if (registered) return registered as OfficeFormat
  const alias = OOXML_ALIASES[extension]
  if (alias) return alias
  const kind = kindOfPath(path)
  if (kind === "document" && extension === "docx") return "docx"
  if (kind === "presentation" && extension === "pptx") return "pptx"
  if (kind === "spreadsheet" && extension === "xlsx") return "xlsx"
  // CSV 也归「表格」：一行一条记录，AI 需要按 A1 坐标改某个格子。
  if (kind === "spreadsheet" && extension === "csv") return "csv"
  if (kind === "pdf") return "pdf"
  if (LEGACY_EXTENSIONS.has(extension)) return "legacy"
  if (kind === "richtext") return "html"
  if (kind === "markdown") return "markdown"
  if (kind === "plaintext") return "text"
  return undefined
}

// Keep the historical built-in behavior in the same registry used by plugins.
registerBuiltIn("docx", "document", ["docx", "docm", "dotx", "dotm"], docxEngine as unknown as OfficeEngine<unknown>)
registerBuiltIn("xlsx", "spreadsheet", ["xlsx", "xlsm", "xltx", "xltm"], xlsxEngine as unknown as OfficeEngine<unknown>)
registerBuiltIn("pptx", "presentation", ["pptx", "pptm", "potx", "potm", "ppsx", "ppsm"], pptxEngine as unknown as OfficeEngine<unknown>)
registerBuiltIn("pdf", "pdf", ["pdf"], pdfEngine as unknown as OfficeEngine<unknown>)
registerBuiltIn("legacy", "document", ["odt", "ods", "odp", "rtf", "doc", "xls", "ppt"], legacyEngine as unknown as OfficeEngine<unknown>)
registerBuiltIn("csv", "spreadsheet", ["csv"], csvEngine as unknown as OfficeEngine<unknown>)
registerBuiltIn("html", "richtext", ["html", "htm", "xhtml", "shtml"], richEngine as unknown as OfficeEngine<unknown>)
registerBuiltIn("markdown", "markdown", ["md", "markdown", "mdown", "mkd", "mdx"], markdownEngine as unknown as OfficeEngine<unknown>)
registerBuiltIn("text", "plaintext", ["txt"], textEngine as unknown as OfficeEngine<unknown>)
