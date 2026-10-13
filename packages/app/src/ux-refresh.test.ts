import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dir, path), "utf8")

const tailwindThemeSource = read("../../ui/src/styles/tailwind/index.css")
const statusPanelSource = read("pages/session/status-panel/status-panel.tsx")
const sidebarMenuRowSource = read("components/sidebar-menu-row.tsx")
const layoutSource = read("pages/layout.tsx")
const settingsListSource = read("components/settings-list.tsx")
const settingsGeneralSource = read("components/settings-general.tsx")
const workspaceHeaderSource = read("components/session/workspace-header.tsx")
const messageTimelineSource = read("pages/session/message-timeline.tsx")

// 圆角此前从未生效:@theme 位于 import 之后,其内硬编码的 Tailwind 默认值把 theme.css 里那套
// Aurora 设计值整个盖掉,实际跑的是 4/6/8/10px 而非 6/8/12/16px。
describe("aurora radius tokens actually take effect", () => {
  test("the tailwind theme block carries the design values instead of the defaults", () => {
    expect(tailwindThemeSource).toContain("--radius-sm: 6px")
    expect(tailwindThemeSource).toContain("--radius-md: 8px")
    expect(tailwindThemeSource).toContain("--radius-lg: 12px")
    expect(tailwindThemeSource).toContain("--radius-xl: 16px")
  })

  // xs 是唯一没有对应设计值的一档,删掉会让 dialog-select-server 里那处 rounded-xs 失效。
  test("radius-xs survives", () => {
    expect(tailwindThemeSource).toContain("--radius-xs: 0.125rem")
  })
})

// 右栏五段原本靠 border-t hairline 连成一片,现在各自是独立圆角卡片。
describe("right panel sections become separate cards", () => {
  test("the hairline separator is replaced by per-card borders and gaps", () => {
    expect(statusPanelSource).not.toContain("border-t border-border-weak-base")
    expect(statusPanelSource).toContain("rounded-lg border border-border-weak-base bg-background-base")
    expect(statusPanelSource).toContain("flex flex-col gap-2 p-2")
  })
})

// 侧栏顶部原本是四个 icon-only 按钮挤在一行,只能靠 tooltip 认功能。
describe("sidebar header becomes a labelled vertical menu", () => {
  test("rows stack vertically and carry a visible text label", () => {
    expect(sidebarMenuRowSource).toContain("flex w-full items-center gap-2")
    expect(sidebarMenuRowSource).toContain("flex-1 truncate text-left")
  })

  test("layout renders database and settings as labelled rows", () => {
    expect(layoutSource).toContain("<SidebarMenuRow")
    expect(layoutSource).toContain('label={language.t("sidebar.database")}')
    expect(layoutSource).toContain('label={language.t("sidebar.settings")}')
  })

  // 字号/字重/颜色一起提:原来 caption + text-base 在浅色底上太轻,三行菜单读起来是灰的。
  test("rows use a bigger bolder darker label", () => {
    expect(sidebarMenuRowSource).toContain("text-ui-base font-medium text-text-strong")
    expect(read("components/theme-scheme-toggle.tsx")).toContain("text-ui-base font-medium text-text-strong")
    expect(read("components/mode-switch.tsx")).toContain("text-ui-base font-medium text-text-strong")
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

  // 这几行现在沉在侧栏 footer：用一条上边框把动作区与列表分开，仍然不上整组底色。
  test("the footer groups the rows with a hairline instead of a flat group background", () => {
    expect(layoutSource).toContain('class="shrink-0 border-t border-border-weaker-base p-2 flex flex-col gap-0.5"')
    expect(layoutSource).not.toContain("border-border-weak-base bg-surface-base p-1")
  })
})

// 设置页原本是一长条列表,每项之间用 border-b 分隔。
describe("settings pages lay out as card grids", () => {
  test("the list container is a responsive grid rather than a stacked block", () => {
    expect(settingsListSource).toContain("grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3")
    expect(settingsListSource).not.toContain("bg-surface-base px-4 rounded-lg")
  })

  test("each row is its own bordered card instead of a list item", () => {
    expect(settingsGeneralSource).toContain("rounded-lg border border-border-weak-base bg-surface-base p-3")
    expect(settingsGeneralSource).not.toContain("border-b border-border-weak-base last:border-none")
  })

  // 其余标签页各有自己的局部 Row 组件、互不导出。原先各写各的布局:有的 items-center 横排、
  // 有的 flex-col 竖排、runtime 那两处还额外带 min-h-16,塞进同一网格后卡片高度和内部结构
  // 都对不上,看起来就是"排得乱"。这里统一成同一个模板。
  // providers 不参与:它是 group 变体,外层本就是 block、内层是合理的单行 provider 行。
  test("every settings tab shares one card template", () => {
    const tabs = [
      "settings-general",
      "settings-notifications",
      "settings-runtime",
      "settings-models",
      "settings-memory",
      "settings-evolution",
      "settings-keybinds",
    ]
    const template = "flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-base p-3"
    for (const tab of tabs) {
      expect(read(`components/${tab}.tsx`)).toContain(template)
    }
  })

  // min-h-16 只出现在 runtime 的两处,是那两块卡片明显高于其他的直接原因。
  test("the stray min-height that broke alignment is gone", () => {
    expect(read("components/settings-runtime.tsx")).not.toContain("min-h-16 rounded-lg border")
  })
})

// 桌面端会话区顶部压着两行:conv-frame 的顶行(workspace-header:标题/分支/模型选择/终端与侧栏开关)
// 和消息区里的 sticky 标题栏(改名/父会话跳转/存为工作流)。两行都去掉,聊天内容顶到最上。
// 门控用运行平台而非视口宽度:e2e 跑在浏览器(platform="web"),WorkspaceHeader 那条断言不受影响。
// Round 1 对齐 ZCode 后口径反转：全局标题栏没了，会话帧内的 WorkspaceHeader 成为唯一顶行，
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
