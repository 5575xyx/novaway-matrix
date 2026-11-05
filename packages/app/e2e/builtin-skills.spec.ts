import { expect, test, type Page } from "@playwright/test"
import { resolve } from "node:path"

// 本机没有下载 Playwright 自带 Chromium 时用系统 Chrome（与其它 spec 一致）。
test.use({ channel: "chrome", video: "off", trace: "off" })

const OPS_SKILLS = ["自媒体运营", "选题雷达", "去 AI 味", "数据复盘"]

function workspaceRootSlug() {
  return Buffer.from(resolve(process.cwd(), "..", ".."), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

async function openExtensions(page: Page) {
  await page.goto(`/${workspaceRootSlug()}/session`)
  // e2e 是干净浏览器 → detectLocale 回退英文，rail 读作 Extensions。
  const rail = page.locator('[data-component="sidebar-rail-item"][aria-label="Extensions"]').first()
  await expect(rail).toBeVisible({ timeout: 20_000 })
  await rail.click()
  await expect(page.locator('[data-component="builtin-extension-row"]').first()).toBeVisible({ timeout: 15_000 })
}

test("内置扩展里能看到调研来的四个运营技能，且各自独立开关", async ({ page }) => {
  await openExtensions(page)

  const rows = page.locator('[data-component="builtin-extension-row"]')
  for (const name of OPS_SKILLS) {
    // 按标题精确匹配：描述里也会出现"数据复盘"这类词，hasText 会多算一行。
    const row = rows.filter({ has: page.getByText(name, { exact: true }) })
    await expect(row, `缺少内置扩展：${name}`).toHaveCount(1)
    // 每行都有开关，说明可以单独关掉（关掉只写 config.skills.disabled，不删文件）。
    await expect(row.getByRole("switch")).toBeVisible()
  }
})
