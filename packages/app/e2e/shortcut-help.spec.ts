import { expect, test } from "@playwright/test"

/**
 * 快捷键帮助浮层（对齐 VS Code 的「键盘快捷方式」）：从文件预览头部
 * 「⋯」菜单的「帮助」组打开，列出所有真的绑了快捷键的命令，可搜索，Esc 关闭。
 */
test.use({ channel: "chrome", video: "off", trace: "off" })

test.describe("快捷键帮助浮层", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/fixtures/shortcut-help.html")
  })

  test("点「打开」出现浮层，列表里命令都带快捷键 chip", async ({ page }) => {
    await expect(page.locator('[data-component="shortcut-help"]')).toHaveCount(0)
    await page.locator('[data-action="shortcut-help-open"]').click()
    const help = page.locator('[data-component="shortcut-help"]')
    await expect(help).toBeVisible()
    // 夹具补的两条命令一定在速查表里，且各带一个 kbd 快捷键。
    await expect(help.getByText("问候")).toBeVisible()
    await expect(help.getByText("总结")).toBeVisible()
    const rows = help.locator(".flex.items-center.gap-3.px-4")
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThanOrEqual(2)
    await expect(rows.first().locator("kbd")).toBeVisible()
  })

  test("搜索能过滤，清空恢复", async ({ page }) => {
    await page.locator('[data-action="shortcut-help-open"]').click()
    const help = page.locator('[data-component="shortcut-help"]')
    const input = page.locator('[data-action="shortcut-help-search"]')
    await input.fill("总结")
    await expect(help.getByText("总结")).toBeVisible()
    await expect(help.getByText("问候")).toHaveCount(0)
    await input.fill("")
    await expect(help.getByText("问候")).toBeVisible()
  })

  test("Esc 关闭浮层", async ({ page }) => {
    await page.locator('[data-action="shortcut-help-open"]').click()
    await expect(page.locator('[data-component="shortcut-help"]')).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.locator('[data-component="shortcut-help"]')).toHaveCount(0)
  })

  test("点关闭按钮关闭浮层", async ({ page }) => {
    await page.locator('[data-action="shortcut-help-open"]').click()
    await expect(page.locator('[data-component="shortcut-help"]')).toBeVisible()
    await page.locator('[data-action="shortcut-help-close"]').click()
    await expect(page.locator('[data-component="shortcut-help"]')).toHaveCount(0)
  })
})
