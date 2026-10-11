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
