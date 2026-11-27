/**
 * 引擎注册表：把「格式」绑到具体的读写实现上。
 *
 * 只做判断、不需要引擎的场景（附件 / 拖拽 / 图标 / 标签）请用 `./formats`：
 * 本模块会静态引入 docx / xlsx / pptx / pdf / legacy 等引擎，其中 pdf 引擎连带
 * 整包 pdf-lib（约 750KB）。渲染进程的入口包不该为了「查个扩展名」付这笔钱。
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
import {
  deleteExtensionsOfFormat,
  deleteFormatKind,
  setExtensionFormat,
  setFormatKind,
  type DocumentKind,
} from "./contract"

export type { DocumentKind }
export { defaultExtension, extensionOf, kindOfPath, officeFormatOf } from "./contract"

export type OfficeEngineRegistration = {
  format: string
  kind: DocumentKind
  extensions: string[]
  aliases?: Record<string, string>
  engine: OfficeEngine<unknown>
}

const ENGINE_REGISTRY = new Map<string, OfficeEngineRegistration>()

export function registerOfficeEngine(registration: OfficeEngineRegistration): { dispose: () => void } {
  const normalized = {
    ...registration,
    extensions: registration.extensions.map((extension) => extension.replace(/^\./, "").toLowerCase()),
  }
  const previous = ENGINE_REGISTRY.get(registration.format)
  ENGINE_REGISTRY.set(registration.format, normalized)
  setFormatKind(registration.format, normalized.kind)
  for (const extension of normalized.extensions) setExtensionFormat(extension, registration.format)
  for (const [alias, format] of Object.entries(normalized.aliases ?? {})) setExtensionFormat(alias, format)
  return {
    dispose() {
      if (ENGINE_REGISTRY.get(registration.format) !== normalized) return
      ENGINE_REGISTRY.delete(registration.format)
      deleteFormatKind(registration.format)
      deleteExtensionsOfFormat(registration.format)
      if (previous) {
        ENGINE_REGISTRY.set(registration.format, previous)
        setFormatKind(registration.format, previous.kind)
        for (const extension of previous.extensions) setExtensionFormat(extension, registration.format)
        for (const [alias, format] of Object.entries(previous.aliases ?? {})) setExtensionFormat(alias, format)
      }
    },
  }
}

function registerBuiltIn(
  format: string,
  kind: DocumentKind,
  extensions: string[],
  engine: OfficeEngine<unknown>,
  aliases?: Record<string, string>,
) {
  registerOfficeEngine({ format, kind, extensions, aliases, engine })
}

/**
 * 已实现的编辑引擎。
 * PDF 走页面级编辑（删页 / 调序 / 旋转 / 叠加文字图片 / 批注 / 填表），
 * 不改正文里已有的字 —— PDF 没有段落模型，原地改字会破坏排版。
 */
export function engineFor(format: OfficeFormat | string): OfficeEngine<unknown> | undefined {
  return ENGINE_REGISTRY.get(format)?.engine
}

// Keep the historical built-in behavior in the same registry used by plugins.
registerBuiltIn("docx", "document", ["docx", "docm", "dotx", "dotm"], docxEngine as unknown as OfficeEngine<unknown>)
registerBuiltIn("xlsx", "spreadsheet", ["xlsx", "xlsm", "xltx", "xltm"], xlsxEngine as unknown as OfficeEngine<unknown>)
registerBuiltIn(
  "pptx",
  "presentation",
  ["pptx", "pptm", "potx", "potm", "ppsx", "ppsm"],
  pptxEngine as unknown as OfficeEngine<unknown>,
)
registerBuiltIn("pdf", "pdf", ["pdf"], pdfEngine as unknown as OfficeEngine<unknown>)
registerBuiltIn(
  "legacy",
  "document",
  ["odt", "ods", "odp", "rtf", "doc", "xls", "ppt"],
  legacyEngine as unknown as OfficeEngine<unknown>,
)
registerBuiltIn("csv", "spreadsheet", ["csv"], csvEngine as unknown as OfficeEngine<unknown>)
registerBuiltIn("html", "richtext", ["html", "htm", "xhtml", "shtml"], richEngine as unknown as OfficeEngine<unknown>)
registerBuiltIn(
  "markdown",
  "markdown",
  ["md", "markdown", "mdown", "mkd", "mdx"],
  markdownEngine as unknown as OfficeEngine<unknown>,
)
registerBuiltIn("text", "plaintext", ["txt"], textEngine as unknown as OfficeEngine<unknown>)
