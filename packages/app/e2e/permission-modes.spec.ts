import { expect, test, type Page } from "@playwright/test"
import { resolve } from "node:path"

// 本机没有下载 Playwright 自带的 Chromium 时用系统 Chrome。
test.use({ channel: "chrome", video: "off", trace: "off" })

const TRIGGER = '[data-action="prompt-permission-mode"]'
const MENU = '[data-component="dropdown-menu-content"]'

/** 与 layout.spec 一致：Node 端 cwd 是 packages/app，向上两级是仓库根。 */
function workspaceRootSlug() {
  return Buffer.from(resolve(process.cwd(), "..", ".."), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/** 打开权限档位选单：把仓库根当成项目目录，进它的新会话草稿页才有标准输入框。 */
async function openSelector(page: Page) {
  await page.goto(`/${workspaceRootSlug()}/session`)
  await expect(page.locator(TRIGGER)).toBeVisible({ timeout: 20_000 })
  await page.locator(TRIGGER).click()
  await expect(page.locator(MENU)).toBeVisible()
}

test("权限选单：计划模式在最上、无人值守在最下，各用分割线隔开", async ({ page }) => {
  await openSelector(page)
  const menu = page.locator(MENU)

  const items = menu.getByRole("menuitem")
  await expect(items).toHaveCount(5)

  // 顺序即分组：只读 → 松紧三档 → 完全无人。
  const labels = await items.evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector("span.text-13-medium")?.textContent?.trim() ?? ""),
  )
  expect(labels).toHaveLength(5)
  expect(labels[0]).toMatch(/计划模式|Plan mode/)
  expect(labels[1]).toMatch(/每次确认|Ask every time/)
  expect(labels[2]).toMatch(/自主模式|Autonomous/)
  expect(labels[3]).toMatch(/跳过所有确认|Bypass permissions/)
  expect(labels[4]).toMatch(/无人值守|Unattended/)

  // 两个分割线：计划模式之后、无人值守之前。
  const separators = menu.getByRole("separator")
  await expect(separators).toHaveCount(2)
  const planBox = (await items.nth(0).boundingBox())!
  const confirmBox = (await items.nth(1).boundingBox())!
  const fullBox = (await items.nth(3).boundingBox())!
  const unattendedBox = (await items.nth(4).boundingBox())!
  const first = (await separators.nth(0).boundingBox())!
  const second = (await separators.nth(1).boundingBox())!
  expect(first.y).toBeGreaterThan(planBox.y)
  expect(first.y).toBeLessThan(confirmBox.y)
  expect(second.y).toBeGreaterThan(fullBox.y)
  expect(second.y).toBeLessThan(unattendedBox.y)
})

test("选中无人值守后，触发器显示该档位", async ({ page }) => {
  await openSelector(page)
  const menu = page.locator(MENU)
  await menu.getByRole("menuitem", { name: /无人值守|Unattended/ }).click()
  await expect(page.locator(TRIGGER)).toContainText(/无人值守|Unattended/)

  // 选单里当前项应打勾，且说明文字存在。
  await page.locator(TRIGGER).click()
  await expect(page.locator(MENU)).toContainText(/完全自动|fully automatic/)
})
