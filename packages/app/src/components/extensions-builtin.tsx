import { createMemo, For, Show, type Component } from "solid-js"
import { Icon, type IconProps } from "@novaway/ui/icon"
import { Switch } from "@novaway/ui/switch"
import { Tag } from "@novaway/ui/tag"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { SettingsGroup } from "./settings-parts"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

type BuiltinExtension = {
  id: string
  name: string
  description: string
  /** 内置扩展卡片的图标；直接沿用 Icon 的合法名字，避免每加一个能力就改类型。 */
  icon: IconProps["name"]
  components: string[]
  /** 开关落点：mcp.browser / memory / 一组技能（写 config.skills.disabled）。 */
  toggle?: "browser" | "memory" | "skills"
  /** toggle=skills 时，这个扩展包含哪些内置技能。 */
  skills?: string[]
  /** 本产品是否真的具备该能力；false 时条目仍展示并说明原因。 */
  available?: boolean
  unavailableReason?: string
}

export const BUILTIN_EXTENSIONS: BuiltinExtension[] = [
  // 目录口径对齐 ZCode 的官方内置插件（official-plugin-definitions）。
  // 每一行都有开关：技能型扩展写 config.skills.disabled（关掉只是隐藏，不删文件）；
  // 浏览器 / 记忆写各自的配置项。暂未内置执行引擎的条目保留开关但禁用，详情说明原因。
  {
    id: "pdf",
    name: "PDF",
    description: "创建、编辑与审阅 PDF。",
    icon: "review",
    components: ["skill"],
    available: false,
    unavailableReason: "当前版本未内置 PDF 生成/解析引擎，可以先让 AI 生成 HTML 后另存为 PDF。",
  },
  {
    id: "presentations",
    name: "演示文档",
    description: "创建、编辑与审阅演示文档（PPTX）。",
    icon: "review",
    components: ["skill"],
    toggle: "skills",
    skills: ["office-ppt"],
  },
  {
    id: "spreadsheets",
    name: "电子表格",
    description: "创建、编辑与审阅电子表格（XLSX）。",
    icon: "table",
    components: ["skill"],
    toggle: "skills",
    skills: ["office-data"],
  },
  {
    id: "documents",
    name: "Word 文档",
    description: "创建、编辑与审阅 Word 文档（DOCX）。",
    icon: "review",
    components: ["skill"],
    toggle: "skills",
    skills: ["office-document"],
  },
  {
    id: "visualize",
    name: "交互视图",
    description: "在对话中创建交互图表、数据看板与单页演示页面。",
    icon: "chart",
    components: ["skill"],
    toggle: "skills",
    skills: ["office-web"],
  },
  {
    id: "browser-use",
    name: "浏览器操作",
    description: "操作真实浏览器：打开网页、点击、输入、截图并校验页面结果。",
    icon: "mcp",
    components: ["mcp"],
    toggle: "browser",
  },
  {
    id: "computer-use",
    name: "电脑控制",
    description: "读取本机应用界面并执行点击、键入、滚动等桌面操作。",
    icon: "autopilot",
    components: ["skill"],
    available: false,
    unavailableReason: "当前版本未内置电脑控制执行引擎（需要桌面自动化运行时）。",
  },
  {
    id: "skill-tools",
    name: "技能与插件创建",
    description: "帮助发现、安装并编写 Agent 技能与插件，把重复流程沉淀下来。",
    icon: "checklist",
    components: ["skill"],
    toggle: "skills",
    skills: ["find-skills", "skill-creator"],
  },
  {
    id: "wxgzh-ops",
    name: "公众号运营",
    description: "公众号选题、写作、排版与发布流程的内置技能。",
    icon: "review",
    components: ["skill"],
    toggle: "skills",
    skills: ["wxgzh-ops"],
  },
  {
    id: "xiaohongshu-ops",
    name: "小红书运营",
    description: "小红书认证登录、内容发布、搜索发现、社交互动与数据分析的内置技能。",
    icon: "review",
    components: ["skill"],
    toggle: "skills",
    skills: ["xiaohongshu-ops"],
  },
  {
    id: "memory-service",
    name: "持久记忆",
    description: "跨会话记住偏好、项目约定与决策，并在后续对话里按需召回。",
    icon: "brain",
    components: ["memory"],
    toggle: "memory",
  },
]

/**
 * 内置扩展。
 *
 * 这些能力随应用提供（内置技能 / 浏览器 MCP / 记忆服务），不是从市场下载的，
 * 因此单独成组：开关只写对应配置项（`skills.disabled` / `mcp.browser.enabled` /
 * `memory.enabled`），关掉只是隐藏，不删任何文件。
 *
 * 暂无执行引擎的条目保留开关但禁用，并说明原因 —— 让"点得动却什么都不发生"
 * 变成"看得见为什么用不了"。
 */
export const BuiltinExtensions: Component = () => {
  const language = useLanguage()
  const globalSync = useGlobalSync()

  const disabledSkills = createMemo(() => new Set(globalSync.data.config.skills?.disabled ?? []))

  const enabled = (item: BuiltinExtension) => {
    if (item.toggle === "skills") {
      const disabled = disabledSkills()
      return (item.skills ?? []).every((name) => !disabled.has(name))
    }
    if (item.toggle === "browser") {
      const mcp = globalSync.data.config.mcp
      const browser = isRecord(mcp) && isRecord(mcp.browser) ? mcp.browser : undefined
      return browser?.enabled !== false
    }
    if (item.toggle === "memory") return globalSync.data.config.memory?.enabled !== false
    return true
  }

  const set = (item: BuiltinExtension, value: boolean) => {
    const config = globalSync.data.config
    if (item.toggle === "skills") {
      const current = new Set(config.skills?.disabled ?? [])
      for (const name of item.skills ?? []) {
        if (value) current.delete(name)
        else current.add(name)
      }
      void globalSync.updateConfig({ skills: { ...(config.skills ?? {}), disabled: [...current] } } as never)
      return
    }
    if (item.toggle === "browser") {
      const mcp = isRecord(config.mcp) ? config.mcp : {}
      const browser = isRecord(mcp.browser) ? mcp.browser : {}
      void globalSync.updateConfig({ mcp: { ...mcp, browser: { ...browser, enabled: value } } } as never)
      return
    }
    if (item.toggle === "memory") {
      void globalSync.updateConfig({ memory: { ...(config.memory ?? {}), enabled: value } } as never)
    }
  }

  return (
    <SettingsGroup>
      <div class="flex items-center gap-2 border-b border-border px-4 py-2">
        <div class="min-w-0 flex-1">
          <div class="text-13-medium text-foreground">{language.t("settings.extensions.builtin")}</div>
          <div class="mt-0.5 text-12-regular text-foreground-subtle">
            {language.t("settings.extensions.builtinHint")}
          </div>
        </div>
      </div>
      <For each={BUILTIN_EXTENSIONS}>
        {(item) => (
          <div class="flex min-w-0 items-start gap-3 rounded-lg px-3 py-2 hover:bg-hover">
            <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface">
              <Icon name={item.icon} size="small" class="text-foreground-subtle" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <span class="truncate text-ui-base text-foreground">{item.name}</span>
                <Show when={item.available === false}>
                  <Tag>{language.t("settings.extensions.unavailable")}</Tag>
                </Show>
              </div>
              <div class="mt-0.5 text-ui-xs text-foreground-subtle">{item.description}</div>
              <Show when={item.available === false && item.unavailableReason}>
                {(reason) => <div class="mt-0.5 text-ui-xs text-foreground-subtlest">{reason()}</div>}
              </Show>
            </div>
            <Switch
              checked={enabled(item)}
              disabled={item.available === false}
              onChange={(value) => set(item, value)}
              hideLabel
            >
              {item.name}
            </Switch>
          </div>
        )}
      </For>
    </SettingsGroup>
  )
}
