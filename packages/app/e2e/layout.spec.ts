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

  // 默认处于任务视图，任务段为激活态（segment 激活样式 text-text-strong / bg-bg-panel-active）
  await expect(tasksSegment).toHaveClass(/text-text-strong|bg-bg-panel-active/)

  // 切到文件视图：文件段激活、任务段失活
  await filesSegment.click()
  await expect(filesSegment).toHaveClass(/text-text-strong|bg-bg-panel-active/)
  await expect(tasksSegment).not.toHaveClass(/text-text-strong|bg-bg-panel-active/)

  // 切回任务视图
  await tasksSegment.click()
  await expect(tasksSegment).toHaveClass(/text-text-strong|bg-bg-panel-active/)
  await expect(filesSegment).not.toHaveClass(/text-text-strong|bg-bg-panel-active/)
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
    const cs = getComputedStyle(els[0]!)
    return { top: cs.borderTopWidth, bottom: cs.borderBottomWidth }
  })
  expect(closedBorder.top).toBe("0px")
  expect(closedBorder.bottom).toBe("0px")
})
