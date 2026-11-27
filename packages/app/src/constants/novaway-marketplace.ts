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
  displayName?: string
  displayNameI18n?: Record<string, string>
  version?: string
  /** 兜底描述（远程/离线场景）；有 descriptionKey 时以 i18n 文案为准。 */
  description?: string
  descriptionKey?: string
  /** 远程目录不可用时仍能展示官方插件头像。 */
  icon?: string
  /** 官方包的来源和摘要，用于后台自动安装时的完整性校验。 */
  sourceId?: string
  sha256?: string
  url: string
  ref?: string
  subdir?: string
  kind: "git" | "zip"
  keywords?: string[]
  /** 内核启动时自动安装（联网即可）。 */
  autoInstall: boolean
}

const OFFICIAL_PLUGIN_DISPLAY_NAMES: Record<string, string> = {
  "com.novaway.agency-agents": "Agency AI 员工",
  "com.novaway.mcp-suite": "MCP 基础连接器",
  "com.novaway.office-suite": "办公工作台",
  "com.novaway.powersnexus": "PowersNexus 工程技能库",
  "com.novaway.operations-suite": "运营工作台",
}

const OFFICIAL_PLUGIN_DISPLAY_NAME_I18N: Record<string, Record<string, string>> = {
  "com.novaway.agency-agents": {
    "zh-CN": "Agency AI 员工",
    "zh-TW": "Agency AI 員工",
    en: "Agency AI Employees",
  },
  "com.novaway.mcp-suite": {
    "zh-CN": "MCP 基础连接器",
    "zh-TW": "MCP 基礎連接器",
    en: "MCP Suite",
  },
  "com.novaway.office-suite": {
    "zh-CN": "办公工作台",
    "zh-TW": "辦公工作台",
    en: "Office Workbench",
  },
  "com.novaway.powersnexus": {
    "zh-CN": "PowersNexus 工程技能库",
    "zh-TW": "PowersNexus 工程技能庫",
    en: "PowersNexus Engineering Skills",
  },
  "com.novaway.operations-suite": {
    "zh-CN": "运营工作台",
    "zh-TW": "營運工作台",
    en: "Operations Workbench",
  },
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
  "com.novaway.operations-suite":
    "https://gitee.com/NovaWay-AI/novaway-plugins/raw/main/plugins/com.novaway.operations-suite/assets/icon.svg",
}

type BuiltinArtifact = { sourceId?: string; sha256?: string }

export const NOVAWAY_MARKETPLACE_ENTRIES: BuiltinMarketEntry[] = BUILTIN_EXTENSIONS.map((entry) => {
  // Keep compatibility with an older workspace package symlink while the core
  // source already exposes these integrity fields.
  const artifact = entry as typeof entry & BuiltinArtifact
  return {
    name: entry.name,
    ...(OFFICIAL_PLUGIN_DISPLAY_NAMES[entry.name] ? { displayName: OFFICIAL_PLUGIN_DISPLAY_NAMES[entry.name] } : {}),
    ...(OFFICIAL_PLUGIN_DISPLAY_NAME_I18N[entry.name]
      ? { displayNameI18n: OFFICIAL_PLUGIN_DISPLAY_NAME_I18N[entry.name] }
      : {}),
    ...(entry.version ? { version: entry.version } : {}),
    description: entry.description,
    ...(entry.descriptionKey ? { descriptionKey: entry.descriptionKey } : {}),
    ...(OFFICIAL_PLUGIN_ICONS[entry.name] ? { icon: OFFICIAL_PLUGIN_ICONS[entry.name] } : {}),
    url: entry.url,
    ...(artifact.sourceId ? { sourceId: artifact.sourceId } : {}),
    ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
    ...(entry.ref ? { ref: entry.ref } : {}),
    ...(entry.subdir ? { subdir: entry.subdir } : {}),
    kind: entry.kind,
    ...(entry.keywords ? { keywords: entry.keywords } : {}),
    autoInstall: entry.autoInstall,
  }
})
