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

test("侧栏任务/文件视图切换", async ({ page }) => {
  await page.goto("/")
  const sidebar = page.getByRole("navigation").first()
  const tasksSegment = sidebar.getByRole("button", { name: /Tasks|任务/ }).first()
  const filesSegment = sidebar.getByRole("button", { name: /Files|文件/ }).first()

  // 默认处于任务视图，任务段为激活态（segment 激活样式 bg-text-interactive-base / bg-bg-panel-active）
  await expect(tasksSegment).toHaveClass(/bg-text-interactive-base|bg-bg-panel-active/)

  // 切到文件视图：文件段激活、任务段失活
  await filesSegment.click()
  await expect(filesSegment).toHaveClass(/bg-text-interactive-base|bg-bg-panel-active/)
  await expect(tasksSegment).not.toHaveClass(/bg-text-interactive-base|bg-bg-panel-active/)

  // 切回任务视图
  await tasksSegment.click()
  await expect(tasksSegment).toHaveClass(/bg-text-interactive-base|bg-bg-panel-active/)
  await expect(filesSegment).not.toHaveClass(/bg-text-interactive-base|bg-bg-panel-active/)
})

test("侧栏分组结构与项目菜单可达", async ({ page }) => {
  const slug = workspaceRootSlug()
  await page.goto(`/${slug}/session`)
  await expect(page.locator('[data-component="sidebar-nav-desktop"]')).toBeVisible({ timeout: 15_000 })
  const sidebar = page.getByRole("navigation").first()

  // 旧的 workspace 头部折叠按钮应消失（en 文案 "Collapse workspace panel"，由 sidebar.workspacePanel.collapse 提供；
  // 该 aria-label 只出现在被删除的旧头部里，是稳定且不可复现于新结构的标记）
  expect(await sidebar.locator('[aria-label="Collapse workspace panel"]').count()).toBe(0)

  // 顶部 segmented：新结构的两个 segment 按钮
  const tasksSegment = sidebar.getByRole("button", { name: /Tasks|任务/ }).first()
  const filesSegment = sidebar.getByRole("button", { name: /Files|文件/ }).first()
  expect(await tasksSegment.count()).toBeGreaterThan(0)
  expect(await filesSegment.count()).toBeGreaterThan(0)
  expect(await sidebar.locator('[aria-label="Search"]').count()).toBeGreaterThan(0)
  expect(await sidebar.locator('[aria-label="New task"]').count()).toBeGreaterThan(0)

  // 空态：无项目时显示 title / description / 打开项目 按钮
  await expect(sidebar.getByText("No projects open")).toBeVisible()
  await expect(sidebar.getByText("Open a project to get started")).toBeVisible()
  await expect(sidebar.getByRole("button", { name: /Open project|打开项目/ }).first()).toBeVisible()

  // 切换视图不报错（segment 激活态切换）
  await filesSegment.click()
  await expect(filesSegment).toHaveClass(/bg-text-interactive-base|bg-bg-panel-active/)

  // 文件视图的返回按钮可见（原型 #sb-treefilters 中的 ← 返回任务），点击返回任务视图
  const backToTasks = page.getByRole("button", { name: /Back to tasks|返回任务/ }).first()
  await expect(backToTasks).toBeVisible()
  await backToTasks.click()
  await expect(tasksSegment).toHaveClass(/bg-text-interactive-base/)

  await tasksSegment.click()
  await expect(tasksSegment).toHaveClass(/bg-text-interactive-base|bg-bg-panel-active/)
})

test("WorkspaceHeader 与 Side Pane 开关", async ({ page }) => {
  const slug = workspaceRootSlug()
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

test("四 frame 4px 间隙与 8px 圆角", async ({ page }) => {
  await page.goto("/")
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
  // 四个 frame 的圆角与边框
  for (const sel of [
    '[data-component="sidebar-nav-desktop"]',
    '[data-component="conv-frame"]',
    '[data-component="side-pane-frame"]',
    '[data-component="terminal-frame"]',
  ]) {
    const r = await page.evaluate((s) => {
      const els = document.querySelectorAll(s)
      if (els.length !== 1) return null
      const cs = getComputedStyle(els[0]!)
      return { radius: cs.borderRadius, border: cs.borderStyle }
    }, sel)
    expect(r.radius).toBe("8px")
    expect(r.border).toBe("solid")
  }
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

test("Side Pane tab 标签不折行 + 折叠按钮", async ({ page }) => {
  const slug = workspaceRootSlug()
  await page.goto(`/${slug}/session`)
  // 侧栏 nav 出现即视为页面就绪；side pane 默认展开（store.sidePane?.opened ?? true）
  await expect(page.locator('[data-component="sidebar-nav-desktop"]')).toBeVisible({ timeout: 15_000 })
  const tabRow = page.locator('[data-component="side-pane-frame"] div:has(> button:has-text("Preview"))').first()
  await expect(tabRow).toBeVisible()

  // 六个 tab 标签必须都存在（Preview / Terminal / Files / Git / Review / Context）
  const labels = ["Preview", "Terminal", "Files", "Git", "Review", "Context"]
  for (const label of labels) {
    const tab = tabRow.locator("button").filter({ hasText: label }).first()
    expect(await tab.count(), `tab "${label}" missing`).toBeGreaterThan(0)
    // 每个 tab 按钮的 white-space 应为 nowrap，禁止标签被强制折行
    const whiteSpace = await tab.evaluate((el) => getComputedStyle(el).whiteSpace)
    expect(whiteSpace, `tab "${label}" wraps`).toBe("nowrap")
    // 按钮高 h-7 = 28px；label 若折行会顶高按钮 >30
    const box = await tab.boundingBox()
    expect(box, `tab "${label}" no bbox`).not.toBeNull()
    expect(box!.height, `tab "${label}" height ${box!.height}`).toBeLessThanOrEqual(30)
    // 图标 shrink-0，不能挤压
    const iconShrink = await tab.locator("svg").first().evaluate((el) => getComputedStyle(el).flexShrink)
    expect(iconShrink, `tab "${label}" icon shrinks`).toBe("0")
  }

  // tab 行整体不超过 37px（h-9 = 36 + border）
  const rowBoxBefore = await tabRow.boundingBox()
  expect(rowBoxBefore!.height).toBeLessThanOrEqual(37)

  // 缩小视口至 900（pane width 仍 clamp 到默认 360）——tab 行仍不折行
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 800 }
  await page.setViewportSize({ width: 900, height: 900 })
  await expect(tabRow).toBeVisible()
  const rowBoxAfter = await tabRow.boundingBox()
  expect(rowBoxAfter!.height).toBeLessThanOrEqual(37)
  for (const label of labels) {
    const tab = tabRow.locator("button").filter({ hasText: label }).first()
    const box = await tab.boundingBox()
    expect(box!.height).toBeLessThanOrEqual(30)
  }
  await page.setViewportSize(originalViewport)
  await expect(tabRow).toBeVisible()

  // 折叠按钮：位于 tab 行最右，aria-label 匹配英文文案，点击后 tab 行消失
  const collapse = tabRow.locator('button[aria-label*="Collapse side pane"], button[aria-label*="折叠侧栏"]').first()
  expect(await collapse.count(), "collapse button missing").toBeGreaterThan(0)
  const collapseLabel = (await collapse.getAttribute("aria-label")) ?? ""
  expect(collapseLabel).toMatch(/Collapse side pane|折叠侧栏/)
  await collapse.click()
  await expect(tabRow).not.toBeVisible()
})
