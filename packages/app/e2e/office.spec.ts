import { expect, test, type Page } from "@playwright/test"
import { resolve } from "node:path"

async function enterZenOffice(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: /禅意模式/ }).click()
  await expect(page.getByText("NovaWay 办公助手")).toBeVisible()
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

test("办公首页可以进入 PPT 场景并展示生成配置", async ({ page }) => {
  await enterZenOffice(page)

  await page.getByRole("tab", { name: "PPT生成" }).click()
  await expect(page.getByRole("heading", { name: "PPT生成" })).toBeVisible()

  for (const label of ["角色", "使用场景", "目标受众", "页数", "素材"]) {
    await expect(page.getByLabel(label)).toBeVisible()
  }
  await expect(page.getByText("任务追踪", { exact: true })).toBeVisible()

  for (const scene of ["文档整理", "AI 资料库", "表格分析", "视觉设计", "网页看板"]) {
    await page.getByRole("tab", { name: scene }).click()
    await expect(page.getByRole("heading", { name: scene })).toBeVisible()
  }
})

test("办公首页可以选中真实模板并打开真实逐页预览", async ({ page }) => {
  await enterZenOffice(page)
  await page.getByRole("tab", { name: "PPT生成" }).click()

  const card = page
    .locator('img[alt*="Swiss Grid 瑞士网格"]')
    .locator('xpath=ancestor::div[contains(@class,"group")]')
    .first()
  await expect(card).toBeVisible()
  expect(await page.locator('img[alt*="模板缩略图"]').count()).toBeGreaterThanOrEqual(20)

  await card.click()
  await expect(page.getByText("已选择", { exact: true }).first()).toBeVisible()

  await card.hover()
  await card.getByRole("button", { name: "预览", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("Swiss Grid 瑞士网格 预览")
  await expect(dialog.getByText("真实 PPTX 模板页面")).toBeVisible()
  await expect(dialog.getByRole("img")).toHaveCount(6)

  const image = dialog.getByRole("img").first()
  await expect(image).toBeVisible()
  await expect(image).toHaveJSProperty("complete", true)
})

test("办公会话可以通过查询参数锁定真实模板", async ({ page }) => {
  await enterZenOffice(page)

  const workspaceRoot = resolve(process.cwd(), "..", "..")
  const slug = base64UrlEncode(workspaceRoot)
  await page.goto(`/${slug}/session?office=ppt&pptTemplate=pptx-swiss-grid`)

  await expect(page.getByRole("heading", { name: "PPT生成" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "PPT生成" })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("button", { name: /Swiss Grid 瑞士网格/ }).first()).toBeVisible()
})

test("设置页可以打开 Provider 配置界面", async ({ page }) => {
  await enterZenOffice(page)
  await page.getByRole("button", { name: "Open settings" }).click()
  await page.getByRole("tab", { name: "Providers" }).click()
  await expect(page.getByText("Connected providers", { exact: true })).toBeVisible()
  await expect(page.getByText("Add Provider", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Add Provider" }).click()
  const providerDialog = page.getByRole("dialog").last()
  await expect(providerDialog).toBeVisible()
  await providerDialog.getByRole("button", { name: /Custom/ }).click()
  await expect(page.getByRole("dialog").last()).toContainText("Custom Provider")
})

test("办公首页可以打开项目目录选择界面", async ({ page }) => {
  await enterZenOffice(page)
  await page.getByRole("button", { name: "选择项目目录" }).click()
  await expect(page.getByRole("dialog").last()).toBeVisible()
})

test("移动端模板卡片无需 hover 也可以直接预览", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enterZenOffice(page)
  await page.getByRole("tab", { name: "PPT生成" }).click()

  const card = page
    .locator('img[alt*="Swiss Grid 瑞士网格"]')
    .locator('xpath=ancestor::div[contains(@class,"group")]')
    .first()
  await expect(card.getByRole("button", { name: "预览", exact: true })).toBeVisible()
})
