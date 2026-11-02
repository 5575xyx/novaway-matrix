// 「哪个平台支持哪种内容形式」的渲染层副本。
//
// 真值在主进程的 publish/drivers.ts（决定实际怎么操作页面）。这里只负责界面：
// 提前把不支持的组合置灰，避免用户选完账号、点了发布才发现"这个平台不支持文章"。
// 两份表都要改的时候，先改主进程那份，再同步这里（已在测试里钉住当前矩阵）。

export type PublishKind = "video" | "image_text" | "article"

export const PUBLISH_KIND_LABEL: Record<PublishKind, string> = {
  video: "视频",
  image_text: "图文",
  article: "文章",
}

// 只列**已经验证过**能跑通的组合。B站文章、快手图文虽然平台本身支持，
// 但提交按钮文案与上传交互还没验证，先不放开 —— 界面上宁可直接置灰，
// 也不要用户选完账号等半天才看到「不支持」。
const MATRIX: Record<string, PublishKind[]> = {
  xhs: ["video", "image_text"],
  douyin: ["video", "image_text"],
  bilibili: ["video"],
  kwai: ["video"],
  wxSph: ["video", "image_text"],
  wxGzh: ["article"],
  xianyu: ["image_text"],
}

export function supportsPublish(platform: string, kind: PublishKind): boolean {
  return MATRIX[platform]?.includes(kind) ?? false
}

/** 把一批账号按支持的发布类型切开：可用的 / 需要跳过的。 */
export function splitByCapability<T extends { platform: string }>(
  accounts: T[],
  kind: PublishKind,
): { ready: T[]; unsupported: T[] } {
  const ready: T[] = []
  const unsupported: T[] = []
  for (const account of accounts) {
    if (supportsPublish(account.platform, kind)) ready.push(account)
    else unsupported.push(account)
  }
  return { ready, unsupported }
}
