import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

const FIXTURE = "/e2e/fixtures/comment-card.html"

async function open(page: import("@playwright/test").Page) {
  await page.goto(FIXTURE)
  const cards = page.locator('[data-slot="message-comment-card"]')
  await expect(cards.first()).toBeVisible({ timeout: 20_000 })
  return cards
}

test("选元素的备注发送后是紧凑卡片，不是一整段源码", async ({ page }) => {
  const cards = await open(page)
  expect(await cards.count()).toBe(4)

  const card = cards.first()
  await expect(card).toContainText("ai-tool-prototype.html")
  // 卡片上给出「说的是哪个元素」和用户写的那一句。
  await expect(card).toContainText("div.user-card")
  await expect(card).toContainText("这里可以扩展一下别的功能")
  // 拼给模型的元素细节不展示（只在 title 里）。
  await expect(card).not.toContainText("CSS 路径")
  await expect(card).not.toContainText("background-color")
  expect(await card.getAttribute("title")).toContain("CSS 路径")
})

test("卡片高度被正文限制住：三张并排也就一行高", async ({ page }) => {
  const cards = await open(page)
  const boxes = await Promise.all([0, 1, 2].map(async (index) => (await cards.nth(index).boundingBox())!))
  for (const box of boxes) {
    // 一屏能放下三张：卡片高度只够「文件名 + 元素名 + 两行字」。
    expect(box.height).toBeLessThan(110)
  }
  // 三张在同一行（顶边对齐），不会因为内容长短错位成台阶。
  expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(1)
})

test("长评论只显示两行，多出来的靠 title 看全文", async ({ page }) => {
  const cards = await open(page)
  const last = cards.last()
  await expect(last).toContainText("file-tabs.tsx")
  await expect(last).toContainText(":42-48")

  const summary = last.locator('[data-slot="message-comment-summary"]')
  const metrics = await summary.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      lineHeight: Number.parseFloat(style.lineHeight),
      height: element.clientHeight,
      overflowHeight: element.scrollHeight,
    }
  })
  // 两行封顶：可见高度不超过两行，内容确实被截断了。
  expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight * 2 + 2)
  expect(metrics.overflowHeight).toBeGreaterThan(metrics.height)
  expect(await last.getAttribute("title")).toContain("顺便把注释补一下")
})
