import { expect, test } from "@playwright/test"

/**
 * 统一底部状态栏：每种文件都只在这一行放缩放，
 * 不再各自在工具条 / 检查器里再摆一套。
 */
test.use({ channel: "chrome", video: "off", trace: "off" })

test.describe("统一底部状态栏", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/fixtures/pane-status-bar.html")
    await expect(page.locator('[data-component="pane-status-bar"]')).toBeVisible()
  })

  test("信息区、动作区、缩放控件一行排开不换行", async ({ page }) => {
    const bar = page.locator('[data-component="pane-status-bar"]')
    const info = await bar.locator('[data-e2e="info"]').boundingBox()
    const zoom = await bar.locator('[data-action="pane-zoom-reset"]').boundingBox()
    const extra = await bar.locator('[data-e2e="extra"]').boundingBox()
    expect(zoom!.y).toBeLessThan(info!.y + info!.height - 1)
    expect(extra!.y).toBeLessThan(zoom!.y + zoom!.height - 1)
    // 控件都在同一行内：三者 y 相差不超过一行高度。
    expect(Math.abs(info!.y - zoom!.y)).toBeLessThanOrEqual(8)
  })

  test("− / % / ＋ 齐全，点击会涨落并复位", async ({ page }) => {
    const percent = page.locator('[data-action="pane-zoom-reset"]')
    await expect(percent).toHaveText("100%")
    await page.locator('[data-action="pane-zoom-in"]').click()
    await expect(percent).toHaveText("110%")
    await page.locator('[data-action="pane-zoom-in"]').click()
    await expect(percent).toHaveText("120%")
    await page.locator('[data-action="pane-zoom-out"]').click()
    await expect(percent).toHaveText("110%")
    await percent.click()
    await expect(percent).toHaveText("100%")
    await expect(page.locator('[data-slot="state"]')).toHaveText("in,in,out,reset")
  })

  test("有 fitLabel 才显示「适应」，点它走 onFit", async ({ page }) => {
    const fit = page.locator('[data-action="pane-zoom-fit"]')
    await expect(fit).toBeVisible()
    await expect(fit).toHaveText("适应")
    await page.locator('[data-action="pane-zoom-in"]').click()
    await expect(page.locator('[data-action="pane-zoom-reset"]')).toHaveText("110%")
    await fit.click()
    await expect(page.locator('[data-action="pane-zoom-reset"]')).toHaveText("100%")
    await expect(page.locator('[data-slot="state"]')).toHaveText("in,fit")
  })
})
