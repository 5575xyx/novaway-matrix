import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

// e2e 环境为无持久 locale 的干净浏览器，navigator.languages 为空 → detectLocale 回退 "en"。
// 选择器按 en 字典文案为主，必要时保留 zh 兼容（见注释）。

function workspaceRootSlug() {
  // 与 office.spec 保持一致：Node 端 process.cwd() 为 packages/app，向上两级为仓库根
  const workspaceRoot = resolve(process.cwd(), "..", "..")
  return Buffer.from(workspaceRoot, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

test("侧栏规格：264px + 整宽入口 + 文件树 slide-over", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
  await expect(sidebar).toBeVisible({ timeout: 15_000 })

  // A7：宽度规格 default = min = 264（对齐 ZCode）
  const box = await sidebar.boundingBox()
  expect(box, "sidebar no bbox").not.toBeNull()
  expect(Math.round(box.width)).toBe(264)

  // A8：两个整宽入口 + 视图分段（对齐 ZCode 侧栏那排胶囊分段，用户反馈缺「文件树切换」）
  await expect(sidebar.getByRole("button", { name: /New task|新建任务/ }).first()).toBeVisible()
  await expect(sidebar.getByRole("button", { name: /Search|搜索/ }).first()).toBeVisible()
  await expect(sidebar.getByRole("button", { name: /^(Tasks|任务)$/ }).first()).toBeVisible()
  await expect(sidebar.getByRole("button", { name: /^(Files|文件)$/ }).first()).toBeVisible()

  // A9：文件树是侧栏内整层 slide-over（translate-x 切换），不是同一列替换
  const treeLayer = sidebar.locator("div.absolute.transition-transform").nth(1)
  await expect(treeLayer).toHaveAttribute("aria-hidden", "true")

  const projectFolder = sidebar.locator('button[aria-label="Files"]').first()
  if ((await projectFolder.count()) === 0) {
    // e2e 是干净环境：没有已打开的项目，没有可打开的文件树目标。断言静态部分后跳过交互部分。
    return
  }
  const hiddenX = (await treeLayer.boundingBox()).x
  await projectFolder.click()
  await expect(treeLayer).toHaveAttribute("aria-hidden", "false")
  const shownX = (await treeLayer.boundingBox()).x
  expect(shownX, "slide-over did not move into view").toBeLessThan(hiddenX)

  // 返回条切回任务列表
  await sidebar
    .getByRole("button", { name: /Back to tasks|返回任务/ })
    .first()
    .click()
  await expect(treeLayer).toHaveAttribute("aria-hidden", "true")
})

test("侧栏分组结构与项目菜单可达", async ({ page }) => {
  const slug = workspaceRootSlug()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${slug}/session`)
  await expect(page.locator('[data-component="sidebar-nav-desktop"]')).toBeVisible({ timeout: 15_000 })
  const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')

  // 旧的 workspace 头部折叠按钮应消失（en 文案 "Collapse workspace panel"，由 sidebar.workspacePanel.collapse 提供；
  // 该 aria-label 只出现在被删除的旧头部里，是稳定且不可复现于新结构的标记）
  expect(await sidebar.locator('[aria-label="Collapse workspace panel"]').count()).toBe(0)

  // 顶带：窗口拖拽区 + 品牌标记（回首页）
  expect(await sidebar.locator("[data-window-drag]").count()).toBe(1)
  await expect(sidebar.locator('[aria-label="Open home"], [aria-label="打开首页"]').first()).toBeVisible()

  // 两个整宽入口
  await expect(sidebar.getByRole("button", { name: /New task|新建任务/ }).first()).toBeVisible()
  await expect(sidebar.getByRole("button", { name: /Search|搜索/ }).first()).toBeVisible()

  // 空态：无项目时显示 title / description / 打开项目 按钮
  await expect(sidebar.getByText("No projects open")).toBeVisible()
  await expect(sidebar.getByText("Open a project to get started")).toBeVisible()
  await expect(sidebar.getByRole("button", { name: /Open project|打开项目/ }).first()).toBeVisible()

  // footer：模式与主题入口沉底（原来挤在顶部那圈竖排菜单里）
  await expect(sidebar.getByRole("button", { name: /Switch work mode|切换模式/ }).first()).toBeVisible()
  await expect(
    sidebar.getByRole("button", { name: /^(Dark mode|Light mode|深色模式|浅色模式)$/ }).first(),
  ).toBeVisible()
})

test("WorkspaceHeader 与 Side Pane 开关", async ({ page }) => {
  const slug = workspaceRootSlug()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${slug}/session`)
  // 会话页打开后，WorkspaceHeader 单行渲染：未命名任务 fallback 为 workspace.header.untitled（en "Untitled task"）
  const workspaceHeaderTitle = page.locator("text=未命名任务").first().or(page.locator("text=Untitled task").first())
  await expect(workspaceHeaderTitle).toBeVisible({ timeout: 15_000 })

  // Side Pane 开关按钮：workspace.header.sidePane（en "Toggle side pane"）
  const sidePaneToggle = page.getByRole("button", { name: /Toggle side pane|切换 Side Pane/ }).first()
  await expect(sidePaneToggle).toBeVisible()

  // 当前为展开状态（默认 sidePane.opened = true），点击后收起
  const expandedBefore = await sidePaneToggle.getAttribute("aria-expanded")
  await sidePaneToggle.click()
  await page.waitForTimeout(300)
  const expandedAfter = await sidePaneToggle.getAttribute("aria-expanded")
  expect(expandedBefore).not.toBe(expandedAfter)
})

test("四 frame：4px 间隙 + 平台圆角 + 窗口根分层", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const slug = workspaceRootSlug()
  await page.goto(`/${slug}/session`)
  // 等待侧栏 nav 出现
  await expect(page.locator('[data-component="sidebar-nav-desktop"]')).toBeVisible({ timeout: 15_000 })
  // 测量两个元素之间的横向间隙（返回原始浮点值，不做四舍五入）
  const gapX = async (a: string, b: string) =>
    page.evaluate(
      ([x, y]) => {
        const els = (s: string) => document.querySelectorAll(s)
        if (els(x).length !== 1 || els(y).length !== 1) return null
        const r = els(x)[0]!.getBoundingClientRect()
        const s = els(y)[0]!.getBoundingClientRect()
        return s.x - r.right
      },
      [a, b] as const,
    )
  // 侧栏 frame 与 会话 frame 横向间隙 = 4
  expect(await gapX('[data-component="sidebar-nav-desktop"]', '[data-component="conv-frame"]')).toBeCloseTo(4, 1)
  // 会话 frame 与 侧栏 pane 横向间隙 = 4
  expect(await gapX('[data-component="conv-frame"]', '[data-component="side-pane-frame"]')).toBeCloseTo(4, 1)
  // 终端 frame 上边距 = 4（先打开终端：Ctrl+`）
  await page.keyboard.press("Control+`")
  await expect(page.locator('[data-component="terminal-frame"]')).toBeVisible()
  const vertical = await page.evaluate(() => {
    const c = document.querySelectorAll('[data-component="conv-frame"]')
    const t = document.querySelectorAll('[data-component="terminal-frame"]')
    if (c.length !== 1 || t.length !== 1) return null
    return t[0]!.getBoundingClientRect().top - c[0]!.getBoundingClientRect().bottom
  })
  expect(vertical).toBeCloseTo(4, 1)
  // A2/A3：三个「帧」按平台圆角（e2e 跑在 Web → 12px = xl）+ 1px solid 边框。
  // 侧栏不在其中：它对齐 ZCode 是 flush 的（左侧/上下贴窗口边，无边框无圆角），
  // 只有右侧主工作区的那三块才是独立帧。
  for (const sel of [
    '[data-component="conv-frame"]',
    '[data-component="side-pane-frame"]',
    '[data-component="terminal-frame"]',
  ]) {
    const r = await page.evaluate((s) => {
      const els = document.querySelectorAll(s)
      if (els.length !== 1) return null
      const cs = getComputedStyle(els[0]!)
      return { radius: cs.borderRadius, border: cs.borderStyle, width: cs.borderTopWidth }
    }, sel)
    expect(r.radius).toBe("12px")
    expect(r.border).toBe("solid")
    expect(r.width).toBe("1px")
  }

  // 侧栏：flush —— 圆角 0、无边框，底色用 --sidebar
  const sidebar = await page.evaluate(() => {
    const el = document.querySelector('[data-component="sidebar-nav-desktop"]')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { radius: cs.borderRadius, width: cs.borderTopWidth, bg: cs.backgroundColor }
  })
  expect(sidebar).not.toBeNull()
  expect(sidebar.radius).toBe("0px")
  expect(sidebar.width).toBe("0px")
  expect(sidebar.bg).not.toBe("rgba(0, 0, 0, 0)")

  // A5：窗口根底色与帧底色分层（4px 留白/间隙才看得见）
  const surfaces = await page.evaluate(() => {
    const root = document.querySelector("[data-workspace-panel-radius]")
    const conv = document.querySelector('[data-component="conv-frame"]')
    if (!root || !conv) return null
    return {
      rootBg: getComputedStyle(root).backgroundColor,
      convBg: getComputedStyle(conv).backgroundColor,
      radiusVar: root.style.getPropertyValue("--workspace-panel-radius").trim(),
    }
  })
  expect(surfaces).not.toBeNull()
  expect(surfaces.rootBg).not.toBe(surfaces.convBg)
  expect(surfaces.radiusVar).toBe("12px")
  // 关闭终端后，border-top-width 和 border-bottom-width 应为 0px
  await page.keyboard.press("Control+`")
  await expect(page.locator('[data-component="terminal-frame"]')).not.toBeVisible()
  const closedBorder = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-component="terminal-frame"]')
    if (els.length !== 1) return null
    const cs = getComputedStyle(els[0])
    return { top: cs.borderTopWidth, bottom: cs.borderBottomWidth }
  })
  expect(closedBorder.top).toBe("0px")
  expect(closedBorder.bottom).toBe("0px")
})

test("Side Pane 空态按需创建 + tab 标签不折行 + 折叠按钮", async ({ page }) => {
  const slug = workspaceRootSlug()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${slug}/session`)
  // 侧栏 nav 出现即视为页面就绪；side pane 默认展开（DEFAULT_SIDE_PANE_STATE.opened = true），
  // 默认零 tab → 右栏显示空态，不隐式创建任何 tab。
  await expect(page.locator('[data-component="sidebar-nav-desktop"]')).toBeVisible({ timeout: 15_000 })
  const frame = page.locator('[data-component="side-pane-frame"]')
  await expect(frame).toBeVisible()
  // tabRow = 外层 tab 条（含 border-b）；折叠按钮是它的直接子节点，位于最右端，
  // 不随内层滚动隐藏。空态与内容区是 tabRow 的兄弟节点，不占 tab 条高度。
  const tabRow = frame.locator("> div.border-b").first()
  await expect(tabRow).toBeVisible()

  // 空态：标题 + 恰好三个按需入口（Preview / Terminal / Review）。
  // Round 3 已废除六个常驻 tab，Files / Git / Context 不再作为入口出现。
  const empty = frame.locator('[data-component="side-pane-empty"]')
  await expect(empty).toBeVisible()
  await expect(empty).toContainText(/Open tab|打开标签页/)
  const options = empty.locator("button")
  expect(await options.count(), "expected exactly 3 on-demand options").toBe(3)
  for (const label of ["Preview", "Terminal", "Review"]) {
    await expect(options.filter({ hasText: label }).first(), `on-demand option "${label}" missing`).toBeVisible()
  }
  for (const legacy of ["Files", "Git", "Context"]) {
    expect(await options.filter({ hasText: legacy }).count(), `legacy tab "${legacy}" present`).toBe(0)
  }
  // 空态下 tab 条内没有任何 tab 标签按钮
  expect(
    await tabRow
      .locator("button")
      .filter({ hasText: /Preview|Terminal|Review|预览|终端|审查/ })
      .count(),
    "tabs created implicitly",
  ).toBe(0)

  // 点击按需入口创建 tab：空态消失，tab 标签出现在 tab 条内
  await options.filter({ hasText: "Preview" }).first().click()
  await expect(empty).not.toBeVisible()
  const tab = tabRow.locator("button").filter({ hasText: "Preview" }).first()
  await expect(tab).toBeVisible()

  // tab 按钮的 white-space 应为 nowrap，禁止标签被强制折行
  const whiteSpace = await tab.evaluate((el) => getComputedStyle(el).whiteSpace)
  expect(whiteSpace, 'tab "Preview" wraps').toBe("nowrap")
  // 按钮高 h-7 = 28px；label 若折行会顶高按钮 >30
  const box = await tab.boundingBox()
  expect(box, 'tab "Preview" no bbox').not.toBeNull()
  expect(box!.height, `tab "Preview" height ${box!.height}`).toBeLessThanOrEqual(30)
  // 图标 shrink-0，不能挤压
  const iconShrink = await tab
    .locator("svg")
    .first()
    .evaluate((el) => getComputedStyle(el).flexShrink)
  expect(iconShrink, 'tab "Preview" icon shrinks').toBe("0")

  // tab 行整体不超过 37px（h-9 = 36 + border）
  const rowBoxBefore = await tabRow.boundingBox()
  expect(rowBoxBefore, "tabRow no bbox").not.toBeNull()
  expect(rowBoxBefore!.height).toBeLessThanOrEqual(37)

  // 折叠按钮：位于 tab 行最右，aria-label 匹配英文文案，点击后 tab 行消失
  const collapse = tabRow.locator('button[aria-label*="Collapse side pane"], button[aria-label*="折叠侧栏"]').first()
  expect(await collapse.count(), "collapse button missing").toBeGreaterThan(0)
  const collapseLabel = (await collapse.getAttribute("aria-label")) ?? ""
  expect(collapseLabel).toMatch(/Collapse side pane|折叠侧栏/)
  // 折叠按钮在点击前必须可见，且其右缘必须位于外层 tab 行右缘之内（防止被内层滚动条隐藏）
  await expect(collapse).toBeVisible()
  const collapseBox = await collapse.boundingBox()
  const rowBox = await tabRow.boundingBox()
  expect(collapseBox, "collapse button no bbox").not.toBeNull()
  expect(rowBox, "tabRow no bbox").not.toBeNull()
  expect(collapseBox!.x + collapseBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1)

  // 缩小视口至 900（pane width 仍 clamp 到默认 360）——tab 行仍不折行，折叠按钮仍可见
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 800 }
  try {
    await page.setViewportSize({ width: 900, height: 900 })
    await expect(tabRow).toBeVisible()
    const rowBoxAfter = await tabRow.boundingBox()
    expect(rowBoxAfter, "tabRow no bbox").not.toBeNull()
    expect(rowBoxAfter!.height).toBeLessThanOrEqual(37)
    const tabBox = await tab.boundingBox()
    expect(tabBox, 'tab "Preview" no bbox').not.toBeNull()
    expect(tabBox!.height).toBeLessThanOrEqual(30)
    await expect(collapse).toBeVisible()
  } finally {
    await page.setViewportSize(originalViewport)
  }
  await expect(tabRow).toBeVisible()

  // 收起后：面板改为「常驻 + 宽度过渡」（对齐 ZCode 的 AnimatedSidePanePanel），
  // 所以不能再断言 tab 行「不可见」——它仍在 DOM 里，只是面板宽度归 0 被裁掉。
  // 这里断言真正改变的东西：data-open 翻转 + 宽度过完后为 0。
  await collapse.click()
  await expect(frame).toHaveAttribute("data-open", "false")
  await expect.poll(async () => (await frame.boundingBox())?.width ?? -1, { timeout: 5_000 }).toBe(0)
})

test("首页任务中心信息密度", async ({ page }) => {
  await page.goto("/")
  // 搜索框（可点击入口，role=button 由 <button type="button"> 隐式提供，aria-label 走 taskCenter.search）
  const searchBox = page.getByRole("button", { name: /搜索任务|Search tasks/ }).first()
  await expect(searchBox).toBeVisible()

  // 五标签，均为 underline 变体的 role=tab
  const tabMatchers = [/最近|Recent/, /运行中|Running/, /待确认|Waiting/, /已归档|Archived/, /项目|Projects/]
  for (const matcher of tabMatchers) {
    await expect(page.getByRole("tab", { name: matcher }).first()).toBeVisible()
  }

  // 虚线起始行
  const starterRow = page.getByText(/从项目或本地目录|Start from a project/).first()
  await expect(starterRow).toBeVisible()
})

test("WorkspaceHeader 单行且不溢出", async ({ page }) => {
  const slug = workspaceRootSlug()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${slug}/session`)
  const header = page.locator('[data-component="workspace-header"]').first()
  await expect(header).toBeVisible({ timeout: 15_000 })
  const headerBox = await header.boundingBox()
  expect(headerBox, "header no bbox").not.toBeNull()
  // A10：对齐 ZCode 的 h-12（h-12 = 48px 内容盒 + 1px 下边框；设备像素比下会有小数抖动，
  // 因此用「约等于 48~49」而不是精确相等）
  expect(headerBox!.height, `header height ${headerBox!.height}`).toBeGreaterThanOrEqual(47.5)
  expect(headerBox!.height, `header height ${headerBox!.height}`).toBeLessThanOrEqual(49.5)
  const model = page.locator('[data-component="workspace-model"]').first()
  await expect(model).toBeVisible()
  const modelBox = await model.boundingBox()
  expect(modelBox, "model no bbox").not.toBeNull()
  expect(modelBox!.x + modelBox!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width)
})

test("顶栏移除后的入口归属（A1）", async ({ page }) => {
  const slug = workspaceRootSlug()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${slug}/session`)

  // A1：全局没有独立标题栏；会话帧内 Header 承担顶行
  expect(await page.locator("body > div > header, #root header").count()).toBe(0)
  const header = page.locator('[data-component="workspace-header"]')
  await expect(header).toBeVisible({ timeout: 15_000 })
  expect(
    await page.evaluate(() => {
      const conv = document.querySelector('[data-component="conv-frame"]')
      const head = document.querySelector('[data-component="workspace-header"]')
      return !!(conv && head && conv.contains(head))
    }),
    "workspace header must live inside the conversation frame",
  ).toBe(true)

  // 拖拽属性（Electron 下 app-region 生效；Web 构建里 Chromium 同样解析该属性）
  const drag = await page.evaluate(() => {
    const el = document.querySelector("[data-window-drag]")
    if (!el) return null
    const cs = getComputedStyle(el)
    return cs.getPropertyValue("app-region") || cs.getPropertyValue("-webkit-app-region")
  })
  expect(drag).toBe("drag")

  // 原标题栏承载的入口现在各自可达：首页 / 模式 / 主题 / 设置 / Side Pane 开关 / 移动端菜单
  await expect(page.getByLabel(/Open home|打开首页/).first()).toBeVisible()
  await expect(page.getByLabel(/Switch work mode|切换模式/).first()).toBeVisible()
  await expect(page.getByLabel(/^(Dark mode|Light mode|深色模式|浅色模式)$/).first()).toBeVisible()
  await expect(header.getByRole("button", { name: /Toggle side pane|切换 Side Pane/ }).first()).toBeVisible()
})

test("设置/数据库面板：主帧内覆盖 + 进出场过渡 + 返回按钮可点", async ({ page }) => {
  const slug = workspaceRootSlug()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${slug}/session`)
  await expect(page.locator('[data-component="workspace-header"]')).toBeVisible({ timeout: 15_000 })

  // —— 设置 ——
  await page.getByRole("button", { name: /^(Settings|设置)$/ }).first().click()
  const settings = page.locator('section[aria-label]').filter({ hasText: /General|通用/ }).first()
  const panel = page.locator("section[data-panel-transition]").first()
  await expect(panel).toHaveAttribute("data-state", "open")

  // 1) 面板不是「接管整窗」：左侧栏仍然可见、仍在主帧起点之后
  const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
  await expect(sidebar).toBeVisible()
  const panelBox = (await panel.boundingBox())!
  const sidebarBox = (await sidebar.boundingBox())!
  expect(panelBox.x, "设置是主帧内的覆盖面板，不能盖住左侧栏").toBeGreaterThanOrEqual(
    Math.round(sidebarBox.x + sidebarBox.width) - 2,
  )
  // 面板要与会话帧对齐：左边贴侧栏留 4px，右边留出与 conv-frame 相同的外留白
  const convBox = (await page.locator('[data-component="conv-frame"]').boundingBox())!
  expect(Math.abs(panelBox.x - convBox.x), "面板左边要与会话帧对齐").toBeLessThanOrEqual(2)
  // 面板覆盖的是整个「工作区帧」区域（含 Side Pane 的位置），右/下仍要留出窗口根色的外留白。
  const viewport = page.viewportSize()!
  expect(panelBox.x + panelBox.width, "面板要盖住 Side Pane 所在的工作区").toBeGreaterThanOrEqual(
    convBox.x + convBox.width,
  )
  const rightGutter = viewport.width - (panelBox.x + panelBox.width)
  expect(rightGutter, "右侧要留窗口根色外留白").toBeGreaterThan(2)
  expect(rightGutter, "外留白不能比帧间距大太多").toBeLessThan(20)
  const bottomGutter = viewport.height - (panelBox.y + panelBox.height)
  expect(bottomGutter, "底部要留窗口根色外留白").toBeGreaterThan(2)
  expect(bottomGutter, "底部外留白不能比帧间距大太多").toBeLessThan(20)
  // 面板自身是带圆角的帧
  const radius = await panel.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)
  expect(parseFloat(radius)).toBeGreaterThan(0)

  // 2) 进场是动画（不是瞬间出现）
  const anim = await panel.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { name: cs.animationName, dur: cs.animationDuration }
  })
  expect(anim.name).toBe("panel-overlay-in")
  expect(parseFloat(anim.dur)).toBeGreaterThan(0.5)

  // 3) 「返回」按钮在切换 tab 的遮挡层期间依然可点（此前被 z-30 遮挡层吃掉点击）
  await page.getByRole("tab", { name: /^(Models|模型)$/ }).first().click()
  const back = page.getByRole("button", { name: /^(Back|Navigate back|返回)$/ }).first()
  const backBox = (await back.boundingBox())!
  const topmost = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y)
      return el ? `${el.tagName}` : null
    },
    [backBox.x + backBox.width / 2, backBox.y + backBox.height / 2],
  )
  expect(topmost, "返回按钮不能被遮挡层覆盖").toBe("BUTTON")

  // 4) 关闭是动画：先进入 closed 态跑退场，动画结束才从 DOM 移除
  await back.click()
  await expect(panel).toHaveAttribute("data-state", "closed")
  const out = await panel.evaluate((el) => getComputedStyle(el).animationName)
  expect(out).toBe("panel-overlay-out")
  await expect(page.locator("section[data-panel-transition]")).toHaveCount(0, { timeout: 5_000 })

  // —— 数据库 ——
  await page.getByRole("button", { name: /^(Database|数据库)$/ }).first().click()
  const dbPanel = page.locator("section[data-panel-transition]").first()
  await expect(dbPanel).toHaveAttribute("data-state", "open")
  await expect(sidebar).toBeVisible()
  await page.getByRole("button", { name: /^(Back|Navigate back|返回)$/ }).first().click()
  await expect(page.locator("section[data-panel-transition]")).toHaveCount(0, { timeout: 5_000 })
})
