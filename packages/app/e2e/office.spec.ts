import { expect, test } from "./office-test"
import type { Page } from "@playwright/test"

async function enterZenOffice(page: Page) {
  await page.goto("/")
  // titlebar 模式切换：Trigger aria-label 为 mode.switch.ariaLabel（zh「切换工作模式」/ en "Switch work mode"）
  await page
    .getByRole("button", { name: /切换工作模式|Switch work mode/ })
    .first()
    .click()
  // 菜单项文案为 mode.shortName（zen = 「办公」，硬编码不走 i18n）
  await page.getByRole("menuitem", { name: "办公" }).click()
  await page.waitForTimeout(500)
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

test("办公首页的场景切换器选择场景且保留统一提示词输入框", async ({ page }) => {
  await enterZenOffice(page)

  const prompt = page.getByRole("textbox", { name: /Ask NovaWay|请输入|描述/ })
  await expect(prompt).toBeVisible()
  for (const scene of ["文档整理", "PPT生成", "AI 资料库", "表格分析", "视觉设计", "网页看板"]) {
    const tab = page.getByRole("tab", { name: scene })
    await tab.click()
    await expect(tab).toHaveAttribute("aria-selected", "true")
    await expect(prompt).toBeVisible()
  }
})

test("办公首页可从附加菜单打开真实 PPT 模板预览并选择模板", async ({ page }) => {
  await enterZenOffice(page)
  await page.getByRole("tab", { name: "PPT生成" }).click()

  const form = page.locator("form")
  await form
    .getByRole("button", { name: /更多|More/i })
    .first()
    .click()
  await page.getByRole("menuitem", { name: /模板|template/i }).click()
  const picker = page.getByRole("dialog").last()
  const title = picker.getByText("Swiss Grid 瑞士网格", { exact: true })
  await expect(title).toBeVisible()
  const card = title.locator("xpath=ancestor::div[contains(@class,'group')]").first()
  await card.hover()
  await card.getByRole("button").last().click()
  const preview = page.getByRole("dialog").last()
  await expect(preview).toContainText("Swiss Grid 瑞士网格 预览")
  await expect(preview.getByText("真实 PPTX 模板页面")).toBeVisible()
  await expect(preview.getByRole("img")).toHaveCount(6)
  await page.keyboard.press("Escape")

  await form
    .getByRole("button", { name: /更多|More/i })
    .first()
    .click()
  await page.getByRole("menuitem", { name: /模板|template/i }).click()
  const pickerAgain = page.getByRole("dialog").last()
  await pickerAgain.getByText("Swiss Grid 瑞士网格", { exact: true }).click()
  await expect(page.getByText("Swiss Grid 瑞士网格", { exact: true }).last()).toBeVisible()
})

test("办公首页切换场景时保留用户已输入的提示词", async ({ page }) => {
  await enterZenOffice(page)
  const prompt = page.locator("form textarea")
  await prompt.fill("为客户准备一份简洁的方案")
  await page.getByRole("tab", { name: "PPT生成" }).click()
  await page.getByRole("tab", { name: "表格分析" }).click()
  await expect(prompt).toHaveValue("为客户准备一份简洁的方案")
})

test("办公会话通过查询参数锁定 PPT 模板，重新进入时仍优先于持久化默认值", async ({ page }) => {
  await enterZenOffice(page)
  const { resolve } = await import("node:path")
  const slug = base64UrlEncode(resolve(process.cwd(), "..", ".."))
  await page.goto(`/${slug}/session?office=ppt&pptTemplate=pptx-swiss-grid`)
  const template = page.locator('[data-action="prompt-office-ppt-template"]')
  await expect(template).toBeVisible({ timeout: 30_000 })
  await expect(template).toContainText("Swiss Grid 瑞士网格")
  // Navigate to another requested template, then back: URL selections must win over storage.
  await page.goto(`/${slug}/session?office=ppt&pptTemplate=auto`)
  await expect(template).not.toContainText("Swiss Grid 瑞士网格")
  await page.goto(`/${slug}/session?office=ppt&pptTemplate=pptx-swiss-grid`)
  await expect(template).toContainText("Swiss Grid 瑞士网格")
})

test("设置页可以打开 Provider 配置界面", async ({ page }) => {
  const openProviderDialog = async () => {
    await enterZenOffice(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page
      .getByRole("button", { name: /^(Open settings|Settings|设置)$/ })
      .first()
      .click()
    await page.getByRole("tab", { name: "Providers" }).click()
    await expect(page.getByText("Connected providers", { exact: true })).toBeVisible()
    const addProvider = page.getByRole("button", { name: "Add Provider" }).first()
    await expect(addProvider).toBeVisible()
    await addProvider.click()
    const dialog = page.getByRole("dialog").last()
    await expect(dialog).toBeVisible()
    return dialog
  }

  const lightDialog = await openProviderDialog()
  const readDialogPaint = (dialog: ReturnType<typeof page.getByRole>) =>
    dialog.evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, foreground: style.color, border: style.borderColor }
    })
  const light = await readDialogPaint(lightDialog)
  expect(light.background).not.toBe("rgba(0, 0, 0, 0)")

  await page.evaluate(() => localStorage.setItem("novaway-color-scheme", "dark"))
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  const darkDialog = await openProviderDialog()
  const dark = await readDialogPaint(darkDialog)
  expect(dark.background).not.toBe(light.background)
  expect(dark.foreground).not.toBe(light.foreground)
  expect(dark.border).not.toBe(light.border)

  // provider tag "custom"：settings.providers.tag.custom（en "Custom"）
  await darkDialog.getByRole("button", { name: /Custom/ }).click()
  // 自定义供应商对话框：provider.custom.field.provider.customOption（en "Custom Provider"）
  await expect(page.getByRole("dialog").last()).toContainText("Custom Provider")
})

test("办公首页项目选择弹窗支持浅色和深色主题", async ({ page }) => {
  const openProjectDialog = async () => {
    await enterZenOffice(page)
    await page
      .getByRole("button", { name: /Open project|打开项目/ })
      .last()
      .click()
    const dialog = page.getByRole("dialog").last()
    await expect(dialog).toBeVisible()
    return dialog
  }
  const readDialogPaint = (dialog: ReturnType<typeof page.getByRole>) =>
    dialog.evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, foreground: style.color, border: style.borderColor }
    })

  const lightDialog = await openProjectDialog()
  const light = await readDialogPaint(lightDialog)
  expect(light.background).not.toBe("rgba(0, 0, 0, 0)")

  await page.evaluate(() => localStorage.setItem("novaway-color-scheme", "dark"))
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  const darkDialog = await openProjectDialog()
  const dark = await readDialogPaint(darkDialog)
  expect(dark.background).not.toBe(light.background)
  expect(dark.foreground).not.toBe(light.foreground)
  expect(dark.border).not.toBe(light.border)
})

test("移动端无需 hover 可直接预览并选择真实模板", async ({ page }) => {
  await enterZenOffice(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("tab", { name: "PPT生成" }).click()

  const form = page.locator("form")
  await form
    .getByRole("button", { name: /更多|More/i })
    .first()
    .click()
  await page.getByRole("menuitem", { name: /模板|template/i }).click()
  const picker = page.getByRole("dialog").last()
  await expect(picker.getByText("Swiss Grid 瑞士网格", { exact: true })).toBeVisible()
  const previewButton = picker.getByRole("button", { name: "预览 Swiss Grid 瑞士网格", exact: true })
  await expect(previewButton).toHaveCSS("opacity", "1")
  await previewButton.click()
  const preview = page.getByRole("dialog").last()
  await expect(preview).toContainText("Swiss Grid 瑞士网格 预览")
  await expect(preview.getByRole("img")).toHaveCount(6)
  await expect(preview.getByRole("img").first()).toHaveJSProperty("complete", true)
  await page.keyboard.press("Escape")
  await form
    .getByRole("button", { name: /更多|More/i })
    .first()
    .click()
  await page.getByRole("menuitem", { name: /模板|template/i }).click()
  await page.getByRole("dialog").last().getByText("Swiss Grid 瑞士网格", { exact: true }).click()
  await expect(page.getByText("Swiss Grid 瑞士网格", { exact: true }).last()).toBeVisible()
})
