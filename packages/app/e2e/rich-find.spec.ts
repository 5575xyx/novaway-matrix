import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

test("头部「查找」是富文本唯一的查找入口，按下就落到源码查找条", async ({ page }) => {
  await page.goto("/e2e/fixtures/rich-find.html")

  await expect(page.getByText("第一段文字").first()).toBeVisible({ timeout: 30_000 })

  // 编辑器内部不再自己摆一颗「查找」：入口只有头部那一颗。
  await expect(page.locator('[data-action="rich-source-find"]')).toHaveCount(0)

  await page.locator('[data-e2e="header-find"]').click()

  const query = page.locator('[data-action="rich-source-find-query"]')
  await expect(query).toBeVisible()
  await query.fill("第二段")
  await expect(page.locator('[data-action="rich-source-find-next"]')).toBeEnabled()
})
