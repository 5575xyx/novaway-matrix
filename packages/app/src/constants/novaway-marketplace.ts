import { BUILTIN_EXTENSIONS } from "@novaway/core/builtin-extensions"

/**
 * 随应用内置的插件市场条目。
 *
 * 远程市场（ZCode / Claude 官方）解决「有什么可装」，但有些插件我们更清楚它值不值得装，
 * 也有明确的适配方式 —— 这类条目直接写在应用里，离线可用，不需要等目录更新。
 *
 * 安装仍然走内核 `extension/marketplace/install`：和远程市场是同一套下载、记录、
 * 加载流程，装完在「已安装扩展」里能卸载、能看贡献。
 *
 * 条目定义在 `@novaway/core/builtin-extensions`：内核启动时也读同一份清单做自动安装，
 * 两边不会漂移。
 */
export type BuiltinMarketEntry = {
  name: string
  version?: string
  /** 兜底描述（远程/离线场景）；有 descriptionKey 时以 i18n 文案为准。 */
  description?: string
  descriptionKey?: string
  /** 远程目录不可用时仍能展示官方插件头像。 */
  icon?: string
  url: string
  ref?: string
  subdir?: string
  kind: "git" | "zip"
  keywords?: string[]
  /** 内核启动时自动安装（联网即可）。 */
  autoInstall: boolean
}

const OFFICIAL_PLUGIN_ICONS: Record<string, string> = {
  "com.novaway.agency-agents":
    "https://gitee.com/NovaWay-AI/novaway-plugins/raw/main/plugins/com.novaway.agency-agents/assets/icon.svg",
  "com.novaway.mcp-suite":
    "https://gitee.com/NovaWay-AI/novaway-plugins/raw/main/plugins/com.novaway.mcp-suite/assets/icon.svg",
  "com.novaway.office-suite":
    "https://gitee.com/NovaWay-AI/novaway-plugins/raw/main/plugins/com.novaway.office-suite/assets/icon.svg",
  "com.novaway.powersnexus":
    "https://gitee.com/NovaWay-AI/novaway-plugins/raw/main/plugins/com.novaway.powersnexus/assets/icon.svg",
}

export const NOVAWAY_MARKETPLACE_ENTRIES: BuiltinMarketEntry[] = BUILTIN_EXTENSIONS.map((entry) => ({
  name: entry.name,
  ...(entry.version ? { version: entry.version } : {}),
  description: entry.description,
  ...(entry.descriptionKey ? { descriptionKey: entry.descriptionKey } : {}),
  ...(OFFICIAL_PLUGIN_ICONS[entry.name] ? { icon: OFFICIAL_PLUGIN_ICONS[entry.name] } : {}),
  url: entry.url,
  ...(entry.ref ? { ref: entry.ref } : {}),
  ...(entry.subdir ? { subdir: entry.subdir } : {}),
  kind: entry.kind,
  ...(entry.keywords ? { keywords: entry.keywords } : {}),
  autoInstall: entry.autoInstall,
}))
