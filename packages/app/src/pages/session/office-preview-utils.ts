/**
 * 预览用的轻量判断与解码工具。
 *
 * 单独放一个模块，是为了让 DOCX / XLSX 这些渲染器不必经由
 * `office-file-preview.tsx` 拿到 `base64ToBytes` —— 那个分发器会静态
 * 引入 PPTX 预览（连带 prompt/sdk 上下文），单测里导入渲染器就会被拽进
 * 「只能在客户端运行」的链路。
 */

export const OFFICE_EXTENSIONS = [".docx", ".pptx", ".xlsx", ".pdf"] as const

export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".svg"] as const

/** HTML 走富文本编辑器（设计 + 源码），不属于 base64 预览通道。 */
export const RICH_TEXT_EXTENSIONS = [".html", ".htm", ".xhtml", ".shtml"] as const

export function isOfficePreviewPath(path: string | undefined) {
  if (!path) return false
  const lower = path.toLowerCase()
  return OFFICE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function isImagePreviewPath(path: string | undefined) {
  if (!path) return false
  const lower = path.toLowerCase()
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
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
