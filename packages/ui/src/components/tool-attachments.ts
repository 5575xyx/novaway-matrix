import { isScreenshotTool } from "@novaway/core/tool-media"

/**
 * 工具结果里的图片附件（`part.state.attachments` 的子集）。
 *
 * 这些规则单独放一个不依赖渲染层的模块：既给 BasicTool 用，也能被单测直接 import
 * （message-part.tsx 会拉进 solid/kobalte，在 bun test 里会撞
 * "Client-only API called on the server side"）。
 */
export interface ToolAttachment {
  mime?: string
  url?: string
  filename?: string
}

/**
 * 这次调用应该在**工具行里**展示哪些图片。
 *
 * 截图类工具（browser_screenshot / computer_screenshot）不在此列：它们的图片是
 * 「验证结果」，由时间线统一挂在每轮回复末尾。同一条回复里出现两遍，读者会以为
 * 模型截了两次图。
 *
 * 其余工具（read 一张原型图 / PDF 页、webfetch 抓到配图、MCP 返回图片）的图片
 * 只属于这一行 —— 用户要核对"模型到底看到了什么"，就得在这里能点开。
 */
export function toolImageAttachments(tool: string, state: unknown): ToolAttachment[] {
  if (isScreenshotTool(tool)) return []
  const attachments = (state as { attachments?: unknown } | null | undefined)?.attachments
  if (!Array.isArray(attachments)) return []
  return attachments.length ? imageAttachmentsOf(attachments) : []
}

/**
 * 从附件列表里挑出真能渲染的图片。
 *
 * 只认 `image/*` + 非空 url：PDF / 文本附件展开成缩略图没有意义，
 * 它们的正文已经在工具输出里。
 */
export function imageAttachmentsOf(attachments: readonly (ToolAttachment | null | undefined)[] | undefined) {
  return (attachments ?? []).flatMap((item) => {
    if (!item || typeof item !== "object") return []
    if (typeof item.mime !== "string" || !item.mime.startsWith("image/")) return []
    if (typeof item.url !== "string" || !item.url) return []
    return [{ url: item.url, filename: typeof item.filename === "string" ? item.filename : undefined }]
  })
}
