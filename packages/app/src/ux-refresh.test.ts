import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dir, path), "utf8")

const tailwindThemeSource = read("../../ui/src/styles/tailwind/index.css")
const statusPanelSource = read("pages/session/status-panel/status-panel.tsx")
const layoutSource = read("pages/layout.tsx")
const settingsListSource = read("components/settings-list.tsx")
const settingsGeneralSource = read("components/settings-general.tsx")
const workspaceHeaderSource = read("components/session/workspace-header.tsx")
const messageTimelineSource = read("pages/session/message-timeline.tsx")
const sessionSource = read("pages/session.tsx")

// 圆角刻度用 Tailwind 默认 4/6/8/12/16。
// 旧版是 Aurora 的 6/8/12/16/20，整体偏大一级；主题样式不覆盖 --radius-*，
// 容器层级规则全部基于 Tailwind 默认刻度。
// 注意 @theme 位于 import 之后会盖掉 theme.css 的 :root 值，两处必须同步。
describe("radius scale matches Tailwind defaults", () => {
  test("the tailwind theme block carries the Tailwind scale", () => {
    expect(tailwindThemeSource).toContain("--radius-sm: 0.25rem")
    expect(tailwindThemeSource).toContain("--radius-md: 0.375rem")
    expect(tailwindThemeSource).toContain("--radius-lg: 0.5rem")
    expect(tailwindThemeSource).toContain("--radius-xl: 0.75rem")
  })

  // xs 是唯一没有对应设计值的一档,删掉会让 dialog-select-server 里那处 rounded-xs 失效。
  test("radius-xs survives", () => {
    expect(tailwindThemeSource).toContain("--radius-xs: 0.125rem")
  })
})

describe("conversation canvas stays neutral under accent themes", () => {
  test("the chat workspace uses the neutral panel surface", () => {
    expect(sessionSource).toContain('data-component="conv-frame"')
    expect(sessionSource).toContain(
      "rounded-[var(--workspace-panel-radius)] border border-border bg-panel overflow-hidden",
    )
    const appCss = read("index.css")
    const sessionAurora = appCss
      .split('[data-component="session-new-aurora"]::before')[1]
      ?.split('[data-component="session-new-aurora"]::after')[0]
    expect(sessionAurora).toBeDefined()
    expect(sessionAurora).not.toMatch(/(?:icon|surface)-(?:agent-|interactive)/)
    const sessionGrid = appCss
      .split('[data-component="session-new-aurora"]::after')[1]
      ?.split("@keyframes session-new-aurora")[0]
    expect(sessionGrid).toBeDefined()
    expect(sessionGrid).not.toContain("border-interactive")
  })
})

// 右栏五段原本靠 border-t hairline 连成一片,现在各自是独立圆角卡片。
// 后续无标题胶囊改版把卡片间距收紧到 gap-1.5、卡片本身换成半透明底
// (rounded-xl bg-background/85 + shadow),外层不再有 p-2 padding。
describe("right panel sections become separate cards", () => {
  test("the hairline separator is replaced by per-card borders and gaps", () => {
    expect(statusPanelSource).not.toContain("border-t border-border")
    expect(statusPanelSource).toContain("rounded-xl bg-background/85")
    expect(statusPanelSource).toContain("flex flex-col gap-1.5")
  })
})

describe("sidebar rail labels and footer", () => {
  test("rail actions use interactive color, not Agent or status roles", () => {
    const railItems = layoutSource.split("const railItems = (): SidebarRailItem[] => {")[1]?.split("\n  const ")[0]
    expect(railItems).toBeDefined()
    expect(railItems).toContain('tone: "var(--icon-interactive-base)"')
    expect(railItems).not.toMatch(/--icon-(?:agent-|success|warning|info|critical)/)
    expect(read("components/theme-scheme-toggle.tsx")).toContain('color: "var(--icon-interactive-base)"')
    expect(read("components/theme-scheme-toggle.tsx")).not.toContain("--icon-agent-plan-base")
    expect(read("components/theme-scheme-toggle.tsx")).not.toContain("--icon-warning-base")
  })

  test("Agent identity and tool-category palettes stay independent", () => {
    const agentSource = read("utils/agent.ts").split("const palette = [")[1]?.split("]")[0]
    const toolAccentSource = read("components/settings-parts.tsx").split("const rowAccentPalette = [")[1]?.split("]")[0]
    const uiMessagePart = read("../../ui/src/components/message-part.tsx")
    const uiAgentPalette = uiMessagePart.split("const agentPalette = [")[1]?.split("]")[0]
    expect(agentSource).toContain("--icon-agent-ask-base")
    expect(agentSource).toContain("--icon-agent-plan-base")
    expect(agentSource).not.toMatch(/--(?:syntax-|diff-|icon-(?:warning|success|critical|info))/)
    expect(toolAccentSource).toContain("--tool-category-0")
    expect(toolAccentSource).toContain("--tool-category-3")
    expect(toolAccentSource).not.toMatch(/--(?:icon-agent-|icon-brand-|icon-success|icon-warning)/)
    expect(uiAgentPalette).toContain("--icon-agent-ask-base")
    expect(uiAgentPalette).not.toContain("--icon-brand-base")
    expect(uiMessagePart).toContain("text-[var(--tool-category-2)]")
    expect(uiMessagePart).not.toContain(
      "var(--icon-agent-docs-base) 16%, transparent) 0%, color-mix(in srgb, var(--icon-brand-base)",
    )
  })

  test("team and work-mode identities use their own theme palettes", () => {
    const teamAvatar = read("components/team-avatar.tsx")
    const layout = read("context/layout.tsx")
    const themeCss = read("../../ui/src/styles/theme.css")
    expect(teamAvatar).toContain("--team-category-${category()}")
    expect(teamAvatar).not.toMatch(/(?:surface|text)-agent-|surface-brand-base/)
    for (const mode of ["forge", "zen", "spark", "future"]) {
      expect(layout).toContain(`--app-mode-${mode}`)
      expect(themeCss).toContain(`--app-mode-${mode}:`)
      expect(themeCss).toContain(`--app-mode-${mode}-foreground:`)
    }
    expect(layout).not.toMatch(/surface-(?:success|warning|brand)-base/)
  })

  test("generic app icons use tool-category hues rather than brand or status colors", () => {
    const appIcon = read("components/app-icon.tsx")
    const tonePalette = appIcon.split("const THEME_TONES = [")[1]?.split("] as const")[0]
    expect(tonePalette).toContain("--tool-category-0")
    expect(tonePalette).toContain("--tool-category-5")
    expect(tonePalette).not.toMatch(/--(?:surface|text-on)-(?:brand|success|warning|info|critical|interactive)/)
    expect(appIcon).toContain("color-mix(in oklab, var(${token}) 18%, var(--surface))")
  })

  test("file icon colors stay in the file-category palette", () => {
    const fileIcon = read("../../ui/src/components/file-icon.tsx")
    const legacyFileTokens = read("../../ui/src/theme/novaway-tokens.ts")
    expect(fileIcon).toContain('code: "var(--icon-file-category-0)"')
    expect(fileIcon).toContain('doc: "var(--icon-file-category-1)"')
    expect(fileIcon).toContain('data: "var(--icon-file-category-2)"')
    expect(fileIcon).not.toMatch(/--icon-(?:agent-|warning|info|interactive)/)
    expect(legacyFileTokens).not.toContain('"file-icon-doc": "var(--icon-agent-docs-base)"')
    expect(legacyFileTokens).not.toContain('"file-icon-shell": "var(--icon-agent-build-base)"')
    expect(legacyFileTokens).not.toContain('"file-icon-style": "var(--terminal-bright-magenta)"')
  })

  test("model capabilities and thinking effort do not borrow Agent identity hues", () => {
    const modelCapabilities = read("components/model-capability-summary.tsx")
    const thinkingEffort = read("components/thinking-effort-color.ts")
    expect(modelCapabilities).not.toContain("text-agent-plan-base")
    expect(thinkingEffort).not.toContain("icon-agent-plan-base")
    expect(thinkingEffort).toContain("var(--icon-interactive-base)")
  })

  test("data visualizations use graph-lane colors, not Agent or status colors", () => {
    const relationNodePalette = read("components/settings-memory.tsx")
      .split("function relationNodeColor")[1]
      ?.split("const RelationGraph")[0]
    const evalTrend = read("components/knowledge/eval-trend.tsx")
    expect(relationNodePalette).toContain("--graph-lane-0")
    expect(relationNodePalette).toContain("--graph-lane-3")
    expect(relationNodePalette).not.toMatch(/--icon-(?:agent-|success|warning|info|critical)/)
    expect(evalTrend).toContain('stroke="var(--graph-lane-0)"')
    expect(evalTrend).toContain('stroke="var(--graph-lane-1)"')
    expect(evalTrend).not.toMatch(/--icon-(?:success|interactive)-base/)
  })

  test("file preview cards use file-category colors instead of Agent or status colors", () => {
    const previewTones = read("index.css")
      .split("/* 文件类型在独立的 file-category 调色板中归类")[1]
      ?.split('[data-component="session-turn-preview"] [data-preview-tone="offline"]')[0]
    expect(previewTones).toBeDefined()
    expect(previewTones).toContain("--icon-file-category-0")
    expect(previewTones).toContain("--icon-file-category-1")
    expect(previewTones).toContain("--icon-file-category-2")
    expect(previewTones).toContain("--icon-file-category-3")
    expect(previewTones).not.toMatch(/--icon-(?:agent-|brand-|success|warning|info|critical)/)
  })

  // 菜单标签直接叫目标名词,不带"打开"前缀;主题切换显示要切过去的那个模式名(浅色时是深色模式)。
  // command.* 那两个 key 仍归命令面板用,那里"打开设置"配分类"设置"才不重复。
  test("labels are plain nouns and the theme toggle names its target scheme", () => {
    const zhSource = read("i18n/zh.ts")
    const enSource = read("i18n/en.ts")
    expect(zhSource).toContain('"sidebar.database": "数据库"')
    expect(zhSource).toContain('"sidebar.settings": "设置"')
    expect(zhSource).toContain('"theme.toggle.dark": "深色模式"')
    expect(zhSource).toContain('"theme.toggle.light": "浅色模式"')
    expect(enSource).toContain('"sidebar.database": "Database"')
    expect(enSource).toContain('"sidebar.settings": "Settings"')
    expect(enSource).toContain('"theme.toggle.dark": "Dark mode"')
    expect(enSource).toContain('"theme.toggle.light": "Light mode"')
  })

  // 桌面端这几行已经收进最左侧图标条（theme 在品牌下方、导航之上），面板 footer 只剩移动端抽屉
  // 那一排图标；两组都靠一条上边框与列表分开，仍然不上整组底色。
  test("the footer groups the rows with a hairline instead of a flat group background", () => {
    expect(layoutSource).toContain('class="shrink-0 border-t border-border p-2"')
    expect(layoutSource).not.toContain("border-border bg-surface p-1")
    // 主题切换在 rail 里是图标形态（名称走 tooltip）。
    expect(layoutSource).toContain('<ThemeSchemeToggle variant="icon" />')
  })
})

// 设置项：单卡片分组 + 行分隔线，左侧标题/说明，右侧控件。
// 旧实现是「每项一张竖排卡片」的响应式网格，和列表观感不一致。
describe("settings pages lay out as list rows", () => {
  test("the shared group card renders rows with dividers instead of standalone cards", () => {
    const settingsPartsSource = read("components/settings-parts.tsx")
    expect(settingsPartsSource).toContain("border-t border-border/80 px-4 py-4")
    expect(settingsPartsSource).toContain("first:border-t-0")
    expect(settingsPartsSource).toContain("grid-cols-1 sm:grid-cols-[minmax(0,1fr)_192px]")
  })

  test("general settings pages compose the shared row template", () => {
    expect(settingsGeneralSource).toContain("<SettingsGroup>")
    expect(settingsGeneralSource).toContain("<SettingsRow")
    expect(settingsGeneralSource).not.toContain("rounded-lg border border-border bg-surface p-3")
  })

  test("runtime and notifications lists use the same row template", () => {
    expect(read("components/settings-runtime.tsx")).toContain("first:border-t-0")
    expect(read("components/settings-notifications.tsx")).toContain("first:border-t-0")
    expect(read("components/settings-memory.tsx")).toContain('from "./settings-parts"')
  })

  // min-h-16 只出现在 runtime 的两处,是那两块卡片明显高于其他的直接原因。
  test("the stray min-height that broke alignment is gone", () => {
    expect(read("components/settings-runtime.tsx")).not.toContain("min-h-16 rounded-lg border")
  })
})

// 桌面端会话区顶部压着两行:conv-frame 的顶行(workspace-header:标题/分支/模型选择/终端与侧栏开关)
// 和消息区里的 sticky 标题栏(改名/父会话跳转/存为工作流)。两行都去掉,聊天内容顶到最上。
// 门控用运行平台而非视口宽度:e2e 跑在浏览器(platform="web"),WorkspaceHeader 那条断言不受影响。
// Round 1 改版后口径反转：全局标题栏没了，会话帧内的 WorkspaceHeader 成为唯一顶行，
// 桌面端也必须渲染（原来那句「桌面端 return null」正是靠全局标题栏顶着的）。
describe("the desktop session pane owns its own top bar", () => {
  test("workspace header renders on every platform now", () => {
    expect(workspaceHeaderSource).toContain("usePlatform")
    expect(workspaceHeaderSource).not.toContain('platform.platform === "desktop") return null')
    expect(workspaceHeaderSource).toContain("data-window-drag")
  })

  test("the sticky session title bar stays web/mobile only", () => {
    expect(messageTimelineSource).toContain('platform.platform !== "desktop" && !!(titleValue() || parentID())')
  })
})
