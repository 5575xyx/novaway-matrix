import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

test("review card supports review, approval persistence and narrow layouts", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/e2e/fixtures/turn-review.html")
  const card = page.locator('[data-component="session-turn-diffs-group"]')
  await expect(card).toContainText("已编辑 2 个文件")
  expect(
    await card.evaluate((el) => {
      const parent = el.parentElement!
      const style = getComputedStyle(parent)
      return Math.abs(
        el.getBoundingClientRect().width -
          parent.clientWidth +
          parseFloat(style.paddingLeft) +
          parseFloat(style.paddingRight),
      )
    }),
  ).toBeLessThanOrEqual(1)
  await expect(card.locator('[data-slot="session-turn-diffs-total"]')).toContainText("+17")
  await card.locator('[data-action="turn-diffs-review"]').click()
  await expect(page.locator("output")).toContainText("file-preview-header.tsx")
  await expect(page.locator("output")).toContainText("file-tabs.tsx")
  await card.locator('[data-slot="session-turn-diff-trigger"]').last().click()
  await expect(page.locator("output")).toHaveText("packages/app/src/pages/session/file-tabs.tsx")
  await page.screenshot({ path: testInfo.outputPath("review-card.png"), fullPage: true })
  await card.locator('[data-action="turn-diffs-approve"]').click()
  await expect(card).toHaveAttribute("data-approved", "true")
  await page.reload()
  await expect(card).toHaveAttribute("data-approved", "true")
  await card.locator('[data-action="turn-diffs-undo-approve"]').click()
  await expect(card).not.toHaveAttribute("data-approved")
  await card.locator('[data-action="turn-diffs-approve"]').click()
  await page.locator('[data-action="change-patch"]').click()
  await expect(card).not.toHaveAttribute("data-approved")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(card.locator('[data-action="turn-diffs-review"]')).toBeVisible()
  expect(await card.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath("review-card-mobile.png"), fullPage: true })
  expect(errors).toEqual([])
})
