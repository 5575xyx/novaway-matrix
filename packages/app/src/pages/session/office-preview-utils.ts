/**
 * 预览用的轻量判断与解码工具。
 *
 * 单独放一个模块，是为了让 DOCX / XLSX 这些渲染器不必经由
 * `office-file-preview.tsx` 拿到 `base64ToBytes` —— 那个分发器会静态
 * 引入 PPTX 预览（连带 prompt/sdk 上下文），单测里导入渲染器就会被拽进
 * 「只能在客户端运行」的链路。
 */

/**
 * 走 base64 / 二进制的 Office 预览通道。
 * 带宏和模板的变体（docm/xlsm/pptm…）包结构和正式格式一致，
 * 由 core registry 的别名表映射到同一个引擎。
 */
export const OFFICE_EXTENSIONS = [
  ".docx",
  ".docm",
  ".dotx",
  ".dotm",
  ".pptx",
  ".pptm",
  ".potx",
  ".potm",
  ".ppsx",
  ".ppsm",
  ".xlsx",
  ".xlsm",
  ".xltx",
  ".xltm",
  ".pdf",
] as const

export const LEGACY_EXTENSIONS = [".odt", ".ods", ".odp", ".rtf", ".doc", ".xls", ".ppt"] as const
export const OFFICE_DOCUMENT_EXTENSIONS = [...OFFICE_EXTENSIONS, ...LEGACY_EXTENSIONS, ".csv"] as const
export const OOXML_EDITOR_EXTENSIONS = OFFICE_EXTENSIONS.filter((extension) => extension !== ".pdf")

/**
 * Open/save/export sit behind one host. NovaWay keeps that host
 * boundary and converts legacy bytes to the modern OOXML editor format before
 * mounting it; saving creates a modern sibling copy and never rewrites legacy bytes.
 */
export type OfficeDocumentCapability =
  | "native-edit"
  | "converted-edit"
  | "pdf-edit"
  | "limited-edit"
  | "read-only-export"

const OFFICE_DOCUMENT_CAPABILITIES: Record<(typeof OFFICE_DOCUMENT_EXTENSIONS)[number], OfficeDocumentCapability> = {
  ".docx": "native-edit",
  ".docm": "native-edit",
  ".dotx": "native-edit",
  ".dotm": "native-edit",
  ".pptx": "native-edit",
  ".pptm": "native-edit",
  ".potx": "native-edit",
  ".potm": "native-edit",
  ".ppsx": "native-edit",
  ".ppsm": "native-edit",
  ".xlsx": "native-edit",
  ".xlsm": "native-edit",
  ".xltx": "native-edit",
  ".xltm": "native-edit",
  ".pdf": "pdf-edit",
  ".odt": "converted-edit",
  ".ods": "converted-edit",
  ".odp": "converted-edit",
  ".rtf": "converted-edit",
  ".doc": "converted-edit",
  ".xls": "converted-edit",
  ".ppt": "converted-edit",
  ".csv": "native-edit",
}

export function officeDocumentCapability(path: string | undefined): OfficeDocumentCapability | undefined {
  if (!path) return undefined
  const lower = path.toLowerCase()
  const extension = OFFICE_DOCUMENT_EXTENSIONS.find((item) => lower.endsWith(item))
  return extension ? OFFICE_DOCUMENT_CAPABILITIES[extension] : undefined
}

/** Legacy-format editing target: legacy Office bytes enter the modern editor and save as OOXML. */
export function modernOfficeExtensionForLegacy(path: string | undefined): "docx" | "xlsx" | "pptx" | undefined {
  if (!path) return undefined
  const lower = path.toLowerCase()
  if ([".doc", ".rtf", ".odt"].some((extension) => lower.endsWith(extension))) return "docx"
  if ([".xls", ".ods"].some((extension) => lower.endsWith(extension))) return "xlsx"
  if ([".ppt", ".odp"].some((extension) => lower.endsWith(extension))) return "pptx"
  return undefined
}

export function isLegacyPreviewPath(path: string | undefined) {
  if (!path) return false
  const lower = path.toLowerCase()
  return LEGACY_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".svg"] as const

/** HTML 走富文本编辑器（设计 + 源码），不属于 base64 预览通道。 */
export const RICH_TEXT_EXTENSIONS = [".html", ".htm", ".xhtml", ".shtml"] as const

export function hasPathExtension(path: string | undefined, extensions: readonly string[] | undefined) {
  if (!path || !extensions || extensions.length === 0) return false
  const lower = path.toLowerCase()
  return extensions.some((extension) => {
    const normalized = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`
    return lower.endsWith(normalized)
  })
}

export type PluginFilePreviewer = {
  pluginID: string
  localName: string
  viewId?: string
  render?: { type: "builtin"; component: string } | { type: "iframe"; url: string }
  priority: number
  readOnly: boolean
}

/** Select the active Runtime Host previewer for a path; highest declared priority wins. */
export function pluginFilePreviewer(
  path: string | undefined,
  contributions:
    | ReadonlyArray<{
        kind?: string
        status?: string
        pluginID?: string
        localName?: string
        viewId?: string
        render?: unknown
        priority?: number | string
        readOnly?: boolean
        match?: unknown
      }>
    | undefined,
): PluginFilePreviewer | undefined {
  if (!path || !contributions) return undefined
  const candidates = contributions.flatMap((item) => {
    if (item.kind !== "previewer" || item.status !== "active" || !item.pluginID || !item.localName) return []

    if (!isRecord(item.match)) return []
    const extensionValue = item.match.extension
    const extensionItems = typeof extensionValue === "string" ? [extensionValue] : extensionValue
    if (!Array.isArray(extensionItems)) return []
    const extensions = extensionItems.filter((extension): extension is string => typeof extension === "string")
    if (extensions.length !== extensionItems.length || !hasPathExtension(path, extensions)) return []
    const render = isRecord(item.render)
      ? item.render.type === "iframe" && typeof item.render.url === "string"
        ? { type: "iframe" as const, url: item.render.url }
        : item.render.type === "builtin" && typeof item.render.component === "string"
          ? { type: "builtin" as const, component: item.render.component }
          : undefined
      : undefined
    if (!item.viewId && !render) return []
    return [
      {
        pluginID: item.pluginID,
        localName: item.localName,
        ...(item.viewId ? { viewId: item.viewId } : {}),
        ...(render ? { render } : {}),
        priority: typeof item.priority === "number" && Number.isFinite(item.priority) ? item.priority : 0,
        readOnly: item.readOnly === true,
      },
    ]
  })
  return candidates.sort((left, right) => right.priority - left.priority)[0]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Extensions exposed by active Runtime Host Office contributions. */
export function pluginOfficeExtensions(
  contributions: ReadonlyArray<{ kind?: string; extensions?: readonly string[] }> | undefined,
): string[] {
  if (!contributions) return []
  return contributions.filter((item) => item.kind === "office-engine").flatMap((item) => item.extensions ?? [])
}

export function isPluginOfficePath(
  path: string | undefined,
  contributions: ReadonlyArray<{ kind?: string; extensions?: readonly string[] }> | undefined,
) {
  return hasPathExtension(path, pluginOfficeExtensions(contributions))
}

export function isOfficePreviewPath(path: string | undefined) {
  if (!path) return false
  return OFFICE_DOCUMENT_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext))
}

export function isOfficeBinaryPreviewPath(path: string | undefined) {
  return !!path && isOfficePreviewPath(path) && !path.toLowerCase().endsWith(".csv")
}

export function isImagePreviewPath(path: string | undefined) {
  if (!path) return false
  const lower = path.toLowerCase()
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** 纯文本 / 代码编辑器的后缀；和 core 的 registry 口径一致。 */
export const TEXT_EXTENSIONS = [
  ".txt",
  ".log",
  ".csv",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".env",
] as const

/** 能导出成另一种文本格式的文件（和 core 各引擎的 export 对齐）。 */
export const EXPORTABLE_EXTENSIONS = [
  ".docx",
  ".docm",
  ".pptx",
  ".pptm",
  ".xlsx",
  ".xlsm",
  ".html",
  ".htm",
  ".xhtml",
  ".shtml",
  ".md",
  ".markdown",
] as const

/**
 * 有导出按钮的文件。
 *
 * 导出是只读源文件通道：旧格式通过转换编辑桥进入现代副本，导出按钮仍然不会覆盖旧源文件。 */
export function isExportableDocumentPath(path: string | undefined) {
  if (!path) return false
  const lower = path.toLowerCase()
  return (
    isEditableDocumentPath(lower) ||
    isLegacyPreviewPath(lower) ||
    EXPORTABLE_EXTENSIONS.some((ext) => lower.endsWith(ext))
  )
}

/**
 * 由宿主维护撤销栈的文件：DOCX / PPTX / XLSX / PDF / CSV / HTML / Markdown / 纯文本。
 *
 * 宿主历史属于现代编辑副本；旧格式源路径本身不进入这条路径，但打开时会转换为现代副本编辑。 */
export function isEditableDocumentPath(path: string | undefined) {
  if (!path) return false
  const lower = path.toLowerCase()
  if (isLegacyPreviewPath(lower)) return false
  if (OFFICE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true
  return (
    RICH_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext)) ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".mdx") ||
    TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))
  )
}

/**
 * 带宏 / 模板的 OOXML 变体：和正式格式同构，直接交给同一个引擎编辑。
 * 宏本身（vbaProject.bin）我们不解析，写回时原样复制。
 */
const MACRO_EXTENSIONS = [
  ".docm",
  ".dotx",
  ".dotm",
  ".xlsm",
  ".xltx",
  ".xltm",
  ".pptm",
  ".potx",
  ".potm",
  ".ppsx",
  ".ppsm",
] as const

export function isMacroOfficePath(path: string | undefined) {
  if (!path) return false
  const lower = path.toLowerCase()
  return MACRO_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function isRichTextPath(path: string | undefined) {
  if (!path) return false
  const lower = path.toLowerCase()
  return RICH_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 反向：把二进制交回主进程保存（PDF 拆分一次产出多个文件）。分块避免爆栈。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

/** 二进制逐字节比较：保存前用它判断磁盘版本是否仍是编辑器打开时的那一份。 */
export function sameDocumentBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false
  }
  return true
}

/** SHA-256 token used by the workspace save endpoint for compare-and-swap protection. */
export async function documentBytesSha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes)
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")
}
