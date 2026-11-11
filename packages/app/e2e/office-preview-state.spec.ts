import { expect, test, type Page } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

// 聊天区点 .pptx 一直「加载中...」的回归测试：预览通道读不到时必须停下来说话，
// 而不是把失败折成空内容和「还在加载」共用一张脸（pending / failure / doc）。
async function runScenario(page: Page, id: string) {
  await page.evaluate(async (scenario) => {
    const preview = (window as unknown as { __preview: { run: (id: string) => Promise<void> } }).__preview
    await preview.run(scenario)
  }, id)
}

test.describe("Office 预览三态", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/fixtures/office-preview-state.html")
    // 没发请求 = 加载中，骨架屏是兜底态。
    await expect(page.locator('[data-e2e="skeleton"]')).toBeVisible()
    await expect(page.locator('[data-component="office-preview-failure"]')).toHaveCount(0)
  })

  test("文件不存在：报「文件不存在」，骨架屏消失", async ({ page }) => {
    await runScenario(page, "notFound")
    const card = page.locator('[data-component="office-preview-failure"]')
    await expect(card).toHaveCount(1)
    await expect(card).toHaveAttribute("data-code", "not_found")
    await expect(card.locator('[data-e2e="title"]')).toHaveText("文件不存在")
    await expect(card.locator('[data-e2e="message"]')).toHaveText("找不到这个文件")
    await expect(card.locator('[data-e2e="path"]')).toHaveText("output/deck.pptx")
    await expect(page.locator('[data-e2e="skeleton"]')).toHaveCount(0)
  })

  test("越界与不支持格式各说各的原因，不共用一句「加载失败」", async ({ page }) => {
    await runScenario(page, "outside")
    await expect(page.locator('[data-component="office-preview-failure"]')).toHaveAttribute(
      "data-code",
      "path_outside_workspace",
    )
    await expect(page.locator('[data-e2e="title"]')).toHaveText("这个文件在项目目录之外，面板不读")

    await runScenario(page, "unsupported")
    await expect(page.locator('[data-component="office-preview-failure"]')).toHaveAttribute(
      "data-code",
      "unsupported_type",
    )
    await expect(page.locator('[data-e2e="title"]')).toHaveText("这种格式不能预览")
  })

  test("服务端返回空内容也是失败，不能继续转圈", async ({ page }) => {
    await runScenario(page, "empty")
    await expect(page.locator('[data-component="office-preview-failure"]')).toHaveAttribute("data-code", "empty")
    await expect(page.locator('[data-e2e="skeleton"]')).toHaveCount(0)
  })

  test("读取抛异常收成失败态，不会把面板崩成白屏", async ({ page }) => {
    await runScenario(page, "rejected")
    const card = page.locator('[data-component="office-preview-failure"]')
    await expect(card).toHaveAttribute("data-code", "read_failed")
    await expect(card.locator('[data-e2e="message"]')).toHaveText("连接中断")
    await expect(page.locator('[data-e2e="panel"]')).toBeVisible()
  })

  test("读到字节才渲染内容", async ({ page }) => {
    await runScenario(page, "ok")
    await expect(page.locator('[data-e2e="content"]')).toHaveText("UEsDBA==")
    await expect(page.locator('[data-component="office-preview-failure"]')).toHaveCount(0)
    await expect(page.locator('[data-e2e="skeleton"]')).toHaveCount(0)
  })

  test("迟到的结果不能盖掉当前文件", async ({ page }) => {
    await page.evaluate(() => {
      const preview = (window as unknown as { __preview: { run: (id: string) => Promise<void> } }).__preview
      void preview.run("slow")
      void preview.run("fast")
    })
    await expect(page.locator('[data-e2e="content"]')).toHaveText("FAST")
    await page.waitForTimeout(900)
    await expect(page.locator('[data-e2e="content"]')).toHaveText("FAST")
  })
})
