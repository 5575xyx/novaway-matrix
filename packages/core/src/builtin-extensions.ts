/**
 * 随应用内置的扩展/技能市场条目。
 *
 * 这里同时服务两个地方：
 * - 渲染层（`NOVAWAY_MARKETPLACE_ENTRIES`）拿它渲染「插件 → 市场 → NovaWay 内置」；
 * - 内核启动时按它自动安装（`extension/provision.ts`）。
 *
 * 两边共用同一份定义，避免「市场里点装的是 A 版本、后台自动装的是 B 版本」。
 *
 * 自动安装只要求**能联网**：没有 git 走托管平台归档下载，没有 Python 走 uv 托管运行时。
 * 用户手动卸载过的条目会在本地记下 `dismissed`，不会在下次启动时偷偷装回来。
 */
export type BuiltinExtensionKind = "git" | "zip"

export type BuiltinExtension = {
  name: string
  version?: string
  /** 离线时的兜底描述；有 descriptionKey 时以 i18n 文案为准。 */
  description: string
  descriptionKey?: string
  kind: BuiltinExtensionKind
  url: string
  ref?: string
  subdir?: string
  keywords?: string[]
  /**
   * 首次启动自动安装。
   * - `true`：联网就装（用户卸载后不再自动装回）；
   * - `false`：只在市场里展示，用户点了才装。
   */
  autoInstall: boolean
}

export const BUILTIN_EXTENSIONS: readonly BuiltinExtension[] = [
  {
    name: "ppt-master",
    version: "6.8.0",
    description: "Generate native, fully editable PPTX from documents, web pages and images (SVG → DrawingML).",
    descriptionKey: "settings.market.builtin.pptMaster.description",
    url: "https://github.com/hugohe3/ppt-master",
    ref: "main",
    subdir: "skills",
    kind: "git",
    keywords: ["pptx", "presentation", "svg", "powerpoint", "office"],
    autoInstall: true,
  },
]

/** 需要在启动时自动装的条目。 */
export function autoInstallExtensions(): readonly BuiltinExtension[] {
  return BUILTIN_EXTENSIONS.filter((entry) => entry.autoInstall)
}
