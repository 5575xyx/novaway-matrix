import { expect, test } from "@playwright/test"

/**
 * 检查器抽屉的样式/交互约束。
 *
 * 它是「一行工具条 + 检查器抽屉」这套设计的另一半：数值输入从工具条搬进来，
 * 所以这里钉住三件事 —— 工具条不再藏数字框、抽屉是浮层而不是挤压文档、Esc 只收自己。
 */
test.use({ channel: "chrome", video: "off", trace: "off" })

const toggle = 'button[data-action="pane-inspector-toggle"]'

test.describe("检查器抽屉", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/fixtures/pane-inspector.html")
    await expect(page.locator(toggle)).toBeVisible()
  })

  test("默认收起，工具条那一行只有命令没有数字框", async ({ page }) => {
    await expect(page.locator('[data-component="pane-inspector"]')).toHaveCount(0)
    const row = page.locator('[data-component="ribbon-row"]')
    const box = await row.boundingBox()
    expect(box?.height).toBeLessThanOrEqual(41)
    await expect(row.locator("input")).toHaveCount(0)
  })

  test("打开后贴在面板右缘，且不挤压文档宽度", async ({ page }) => {
    await page.locator(toggle).click()
    const drawer = page.locator('[data-component="pane-inspector"]')
    await expect(drawer).toBeVisible()
    const panel = await page.locator('[data-e2e="panel"]').boundingBox()
    const rect = await drawer.boundingBox()
    expect(rect?.width).toBe(256)
    // 浮层：右边缘对齐面板内缘（各留 1px 边框）。
    expect(Math.abs(rect!.x + rect!.width - (panel!.x + panel!.width))).toBeLessThanOrEqual(2)
    const doc = await page.locator('[data-e2e="document"]').boundingBox()
    expect(Math.abs(doc!.width - panel!.width)).toBeLessThanOrEqual(3)
  })

  test("字段纵向排开：一个字段一行，标签在左控件在右", async ({ page }) => {
    await page.locator(toggle).click()
    const drawer = page.locator('[data-component="pane-inspector"]')
    const x = await drawer.locator('[data-action="pdf-image-x"]').boundingBox()
    const width = await drawer.locator('[data-action="pdf-image-width"]').boundingBox()
    // 「x」在上、「宽」在下，且不重叠 —— 数字框不再横向铺成一整排。
    expect(width!.y).toBeGreaterThan(x!.y + x!.height - 1)
    // 同一字段里标签与控件并排：微调按钮和「微调」两字在同一行。
    const nudge = await drawer.locator('[data-action="pdf-image-left"]').boundingBox()
    const labels = drawer.locator("label")
    const indent = await labels.filter({ hasText: "微调" }).boundingBox()
    expect(Math.abs(nudge!.y + nudge!.height / 2 - (indent!.y + indent!.height / 2))).toBeLessThanOrEqual(6)
    // 控件确实排在标签右边，而不是换到下一行。
    expect(nudge!.x).toBeGreaterThan(indent!.x)
  })

  test("Esc 只收抽屉，不冒泡到面板", async ({ page }) => {
    await page.locator(toggle).click()
    await page.locator('[data-action="pdf-crop-input"]').focus()
    await page.keyboard.press("Escape")
    await expect(page.locator('[data-component="pane-inspector"]')).toHaveCount(0)
    await expect(page.locator('[data-slot="state"]')).toHaveText("toggle,close")
  })

  test("抽屉里的动作按钮保留 data-action，测试与命令面板都还能定位", async ({ page }) => {
    await page.locator(toggle).click()
    await page.locator('[data-action="pdf-image-left"]').click()
    await page.locator('[data-action="pdf-image-apply"]').click()
    await expect(page.locator('[data-slot="state"]')).toHaveText("toggle,left,apply")
  })

  test("关掉再打开不丢已填的值", async ({ page }) => {
    await page.locator(toggle).click()
    await page.locator('[data-action="pdf-image-x"]').fill("120")
    await page.locator(toggle).click()
    await expect(page.locator('[data-component="pane-inspector"]')).toHaveCount(0)
    await page.locator(toggle).click()
    await expect(page.locator('[data-action="pdf-image-x"]')).toHaveValue("120")
  })
})
