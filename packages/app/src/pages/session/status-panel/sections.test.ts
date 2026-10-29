import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const panelDir = import.meta.dir
const read = (path: string) => readFileSync(join(panelDir, path), "utf8")

const workspaceHeaderSource = read("../../../components/session/workspace-header.tsx")
const sessionHeaderSource = read("../../../components/session/session-header.tsx")
const layoutSource = read("../../layout.tsx")
const sessionSource = read("../../session.tsx")
const promptInputSource = read("../../../components/prompt-input.tsx")

// 全局标题栏已移除（Round 1 对齐 ZCode）：入口不能跟着一起消失，必须各自落到新位置。
describe("top bar removal keeps every entry reachable", () => {
  test("there is no global titlebar component any more", async () => {
    const appSource = read("../../layout.tsx")
    expect(appSource).not.toMatch(/<Titlebar[\s/>]/)
    // 组件文件本身也已删除（Bun.file 对不存在的路径会抛错）。
    const gone = await Bun.file(join(panelDir, "../../../components/titlebar.tsx"))
      .text()
      .then(() => false)
      .catch(() => true)
    expect(gone).toBe(true)
  })

  test("home, nav history and mobile menu live in the sidebar top band / shell layer", () => {
    // 侧栏顶带：品牌标记回首页（data-window-drag 那一条带子）。
    expect(layoutSource).toContain('aria-label={language.t("command.home.open")}')
    expect(layoutSource).toContain("data-window-drag")
    // 前进/后退改为外壳层注册的命令。
    expect(layoutSource).toContain("common.goBack")
    expect(layoutSource).toContain("common.goForward")
    expect(layoutSource).toContain("backPath")
  })

  test("mode and theme stay in the sidebar footer, global pages sink into the left rail", () => {
    expect(layoutSource).toContain("<ModeSwitchButton")
    expect(layoutSource).toContain("<ThemeSchemeToggle")
    // 数据库 / 知识库 / 自动化 / 扩展 / 设置从"每项一整行"的底部菜单收进最左侧窄图标条，
    // 只留图标 + hover 提示，把垂直空间还给任务列表（对齐 Codex 的 activity rail）。
    expect(layoutSource).not.toContain("<SidebarMenuRow")
    expect(layoutSource).toContain("items={railItems()}")
    expect(layoutSource).toContain("footer={railFooter()}")
    const railSource = read("../../layout/sidebar-rail.tsx")
    expect(railSource).toContain('data-component="sidebar-rail"')
    expect(railSource).toContain("<Tooltip")
    expect(railSource).toContain('placement="right"')
  })

  // Side Pane 开关与搜索原先挂在标题栏的两个 Portal 槽位上。标题栏没了，槽位也随之消失，
  // 这些入口改为在会话帧 Header 内就地渲染。
  test("search, status and the side pane toggle render inline in the workspace header", () => {
    expect(workspaceHeaderSource).toContain("<SessionHeader />")
    expect(sessionHeaderSource).toContain("layout.sidePane.toggle()")
    expect(sessionHeaderSource).toContain('icon="layout-right"')
    expect(sessionHeaderSource).not.toContain("NovaWay-titlebar-right")
    expect(sessionHeaderSource).not.toContain("<Portal")
  })

  test("the mobile menu entry moved to the workspace header", () => {
    expect(workspaceHeaderSource).toContain("layout.mobileSidebar.toggle")
  })
})

describe("context usage lives in the composer, not the status panel", () => {
  // 对齐 ZCode 的 ChatContextUsage：占用触发器挂在输入框工具条上，状态面板里
  // 不再有 context 卡（干净的面板 = 只有活内容，空闲期整块消失）。
  test("the context card left the status panel and its entry moved to the composer toolbar", () => {
    expect(sessionSource).not.toContain("useContextSection")
    expect(promptInputSource).toContain("<SessionContextUsage />")
    // 明细弹层复用缓存统计面板，不再有孤儿组件。
    const usageSource = read("../../../components/session-context-usage.tsx")
    expect(usageSource).toContain("CacheUsageBody")
    // 触发器经由 Popover 的 triggerProps 挂 data-action，源码里是对象键写法
    expect(usageSource).toContain('"data-action": "prompt-context-usage"')
  })

  // 「记忆与进化」是全局能力，不再占会话状态面板的位置（用户反馈）。
  // 这条断言防的是"顺手又把它加回去"。
  test("memory & evolution stays out of the session status panel", () => {
    expect(sessionSource).not.toContain("memorySection")
    expect(sessionSource).not.toContain("useMemorySection")
  })

  test("status cards cannot be squeezed by the flex container", () => {
    const panelSource = read("./status-panel.tsx")
    expect(panelSource).toContain("shrink-0 overflow-hidden rounded-xl")
  })
})
