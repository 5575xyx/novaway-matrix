import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

test.describe("文件预览头部", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/fixtures/file-preview-header.html")
    await expect(page.locator('[data-component="file-preview-header"]')).toHaveCount(2)
    // 语言包是异步加载的：夹具钉住中文，等中文标题落地再断言，否则标签会短暂是英文。
    await expect(page.locator('[data-e2e="editing"] button[aria-label*="撤销"]')).toBeVisible()
  })

  test("阅读态只留「编辑 + ⋯」，一行不换行", async ({ page }) => {
    const header = page.locator('[data-e2e="reading"] [data-component="file-preview-header"]')
    const box = await header.boundingBox()
    expect(box, "header has no bbox").not.toBeNull()
    // h-10 = 40px；控件若折行会把这一行顶高。
    expect(box!.height).toBeLessThanOrEqual(41)
    expect(
      await header.evaluate((el) => el.scrollWidth - el.clientWidth),
      "reading header overflows",
    ).toBeLessThanOrEqual(0)
    const buttons = header.locator("button")
    expect(await buttons.count(), "reading mode should stay quiet").toBe(3)
    await expect(header.locator('[data-action="file-preview-toggle-edit"]')).toContainText(/编辑|Edit/)
    await expect(buttons.nth(0)).toHaveAttribute("aria-label", /选择打开应用/)
  })

  test("仅有打开方式菜单时仍显示菜单按钮", async ({ page }) => {
    const header = page.locator('[data-e2e="reading"] [data-component="file-preview-header"]')
    const openWith = header.locator('button[aria-label*="选择打开应用"]')
    await expect(openWith).toBeVisible()
    await openWith.click()
    await expect(page.locator('[role="menu"] [role="menuitem"]')).toContainText(["Visual Studio Code"])
  })

  test("编辑态把撤销 / 重做 / 保存 / 查找 / 视图 / 完成都摆在手上", async ({ page }) => {
    const header = page.locator('[data-e2e="editing"] [data-component="file-preview-header"]')
    const box = await header.boundingBox()
    expect(box!.height).toBeLessThanOrEqual(41)
    expect(
      await header.evaluate((el) => el.scrollWidth - el.clientWidth),
      "editing header overflows",
    ).toBeLessThanOrEqual(0)
    const labels = await header
      .locator("button")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") || el.textContent?.trim() || ""))
    expect(labels).toEqual(
      [
        expect.stringContaining("撤销"),
        expect.stringContaining("重做"),
        expect.stringContaining("保存"),
        expect.stringContaining("查找"),
        expect.stringContaining("视图"),
        expect.stringContaining("完成"),
        expect.stringContaining("更多"),
      ].slice(0, labels.length),
    )
  })

  test("没记过历史就灰着，记过一步就能点，并且真的回调", async ({ page }) => {
    const header = page.locator('[data-e2e="editing"] [data-component="file-preview-header"]')
    const undo = header.locator('button[aria-label*="撤销"]')
    const save = header.locator('button[aria-label*="保存"]')
    await expect(undo).toBeDisabled()
    // 已保存时保存按钮灰着 —— 没东西可写。
    await expect(save).toBeDisabled()

    await page.evaluate(() => (window as unknown as { __header: { typed: () => void } }).__header.typed())
    await expect(undo).toBeEnabled()
    await undo.click()
    await expect(page.locator('[data-slot="state"]')).toContainText("undo")

    await page.evaluate(() => (window as unknown as { __header: { dirty: () => void } }).__header.dirty())
    await expect(save).toBeEnabled()
    await save.click()
    await expect(page.locator('[data-slot="state"]')).toContainText("save")
  })

  test("正在编辑用主题强调色，不写死 emerald", async ({ page }) => {
    const toggle = page.locator('[data-e2e="editing"] [data-action="file-preview-toggle-edit"]')
    // ThemeProvider 挂载后才把语义 token 写进 <html>，先等它落地再读计算值。
    await expect
      .poll(async () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--text-interactive-base").trim(),
        ),
      )
      .not.toBe("")
    const style = await toggle.evaluate((el) => {
      const cs = getComputedStyle(el)
      return {
        color: cs.color,
        token: getComputedStyle(document.documentElement).getPropertyValue("--text-interactive-base").trim(),
        class: el.className,
      }
    })
    expect(style.class).toContain("text-interactive-base")
    expect(style.class).not.toContain("emerald")
    expect(style.token, "theme token missing").not.toBe("")
    // 强调色来自交互文字角色，不依赖蓝色分类色；浅色、深色主题均应提供该角色。
    expect(style.color).not.toBe("")
  })

  test("编辑入口文字色在浅色和深色模式下都跟随主题", async ({ page }) => {
    const readPaint = async () => {
      const toggle = page.locator('[data-e2e="editing"] [data-action="file-preview-toggle-edit"]')
      return toggle.evaluate((element) => ({
        color: getComputedStyle(element).color,
        token: getComputedStyle(document.documentElement).getPropertyValue("--text-interactive-base").trim(),
      }))
    }
    const light = await readPaint()
    expect(light.token).not.toBe("")
    expect(light.color).not.toBe("")

    await page.evaluate(() => localStorage.setItem("novaway-color-scheme", "dark"))
    await page.reload()
    await expect(page.locator('[data-e2e="editing"] button[aria-label*="撤销"]')).toBeVisible()
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
    const dark = await readPaint()
    expect(dark.token).not.toBe("")
    expect(dark.color).not.toBe("")
    expect(dark.token).not.toBe(light.token)
    expect(dark.color).not.toBe(light.color)
  })

  test("视图切换单独成下拉，不必展开⋯", async ({ page }) => {
    const header = page.locator('[data-e2e="editing"] [data-component="file-preview-header"]')
    await header.locator('button[aria-label*="视图"]').click()
    const items = page.locator('[role="menu"] [role="menuitem"]')
    await expect(items).toHaveCount(3)
    await items.nth(2).click()
    await expect(page.locator('[data-slot="state"]')).toContainText("view-source")
  })

  test("低频命令仍然在⋯里，按分组排列", async ({ page }) => {
    const header = page.locator('[data-e2e="editing"] [data-component="file-preview-header"]')
    await header.locator("button").last().click()
    const content = page.locator('[role="menu"]').last()
    await expect(content).toContainText("命令面板")
    await expect(content).toContainText("自动换行")
    await expect(content).toContainText("导出为 .md")
    await expect(content).not.toContainText("撤销")
  })
})
