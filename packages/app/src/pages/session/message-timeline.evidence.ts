/**
 * 轮尾「验证结果」的收集规则。
 *
 * 单独一个模块（不依赖渲染层）是因为它必须能被单测直接 import：
 * message-timeline.data.ts 会带进 @novaway/ui/message-part → solid/kobalte，
 * 在 bun test 里会撞上 "Client-only API called on the server side"。
 */
import { SCREENSHOT_TOOLS } from "@novaway/core/tool-media"

export interface EvidenceImage {
  /** 可直接给 `<img src>` 用的地址(data URL 或 file:// 路径)。 */
  url: string
  name?: string
  /** 产生这张图的工具名,用来在卡片上标注来源(browser_screenshot 等)。 */
  tool: string
}

/**
 * 哪些工具产出的图片算「验证结果」。
 *
 * 只认截图类工具 —— 它们存在的意义就是把渲染结果给人看。
 *
 * 早先这里收的是「所有带 image 附件的工具」，于是 `read` 一张原型图 / PDF 页、
 * `webfetch` 抓到配图、notebook 里渲染出的图表，统统被当成「验证结果」铺在回复末尾
 * （用户只是让它整理资料，消息流里却冒出一张"验证截图"，完全对不上）。
 * 回归用例见 message-timeline.evidence.test.ts。
 */
export const VERIFICATION_TOOLS: ReadonlySet<string> = new Set(SCREENSHOT_TOOLS)

export function isVerificationTool(name: string | undefined): boolean {
  return !!name && VERIFICATION_TOOLS.has(name)
}

/**
 * 从一轮里的工具结果中挑出可以当「验证结果」展示的图片。
 *
 * 只看工具名，不看结果里有没有图 —— 白名单之外的附件一律不展示，
 * 调研过程读进来的图片不该冒充验证证据。
 */
export function collectEvidenceImages(parts: ReadonlyArray<{ tool: string; state: unknown }>): EvidenceImage[] {
  const images: EvidenceImage[] = []
  for (const part of parts) {
    if (!isVerificationTool(part.tool)) continue
    const attachments = (part.state as { attachments?: unknown } | null | undefined)?.attachments
    if (!Array.isArray(attachments)) continue
    for (const item of attachments) {
      if (!item || typeof item !== "object") continue
      const file = item as { mime?: unknown; url?: unknown; filename?: unknown }
      if (typeof file.mime !== "string" || !file.mime.startsWith("image/")) continue
      if (typeof file.url !== "string" || !file.url) continue
      images.push({
        url: file.url,
        name: typeof file.filename === "string" ? file.filename : undefined,
        tool: part.tool,
      })
    }
  }
  return images
}
