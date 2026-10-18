import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const panelDir = import.meta.dir
const read = (path: string) => readFileSync(join(panelDir, path), "utf8")

const workspaceHeaderSource = read("../../../components/session/workspace-header.tsx")
const sessionHeaderSource = read("../../../components/session/session-header.tsx")
const layoutSource = read("../../layout.tsx")
const sessionSource = read("../../session.tsx")
const contextSectionSource = read("./context-section.tsx")

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

  test("mode, theme, database and settings sink to the sidebar footer", () => {
    expect(layoutSource).toContain("<ModeSwitchButton")
    expect(layoutSource).toContain("<ThemeSchemeToggle")
    expect(layoutSource).toContain("<SidebarMenuRow")
    expect(layoutSource).toContain('label={language.t("sidebar.database")}')
    expect(layoutSource).toContain('label={language.t("sidebar.settings")}')
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

describe("right panel absorbs cache", () => {
  // 上下文与缓存命中率合并成一张卡片（用户反馈：两张卡在右上角互相挤，展开后信息重复）。
  test("cache hits are merged into the context card instead of a separate section", () => {
    expect(sessionSource).not.toContain("useCacheSection")
    expect(sessionSource).toContain("useContextSection()")
    expect(contextSectionSource).toContain("useSessionCacheUsage()")
    expect(contextSectionSource).toContain("cache.hit.rate")
  })

  // 「记忆与进化」是全局能力，不再占会话状态面板的位置（用户反馈）。
  // 这条断言防的是"顺手又把它加回去"。
  test("memory & evolution stays out of the session status panel", () => {
    expect(sessionSource).not.toContain("memorySection")
    expect(sessionSource).not.toContain("useMemorySection")
  })

  test("the merged card only shows cache stats when there are calls", () => {
    expect(contextSectionSource).toContain("cache.metrics().calls > 0")
    expect(contextSectionSource).toContain("cache.hitRate()")
  })

  test("status cards cannot be squeezed by the flex container", () => {
    const panelSource = read("./status-panel.tsx")
    expect(panelSource).toContain("shrink-0 overflow-hidden rounded-lg")
  })

})
