import { expect, test, type Page } from "@playwright/test"
import { resolve } from "node:path"

// The local app may use the system Chrome when Playwright's bundled browser is absent.
test.use({ channel: "chrome", video: "off", trace: "off" })
test.describe.configure({ timeout: 120_000, retries: 1 })

function workspaceRootSlug() {
  return Buffer.from(resolve(process.cwd(), "..", ".."), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

async function openGoalMenu(page: Page) {
  const url = `/${workspaceRootSlug()}/session`
  await page.goto(url, { waitUntil: "commit", timeout: 60_000 })
  await expect(page.locator('[data-component="prompt-input"]')).toBeVisible({ timeout: 60_000 })
  const add = page.locator('[data-action="prompt-add"]')
  await expect(add).toBeVisible({ timeout: 30_000 })
  await add.click()
  const goal = page.locator('[data-action="prompt-goal-mode"]')
  await expect(goal).toBeVisible()
  return goal
}

test("目标模式：可以从加号菜单开启并显示配置入口", async ({ page }) => {
  const goal = await openGoalMenu(page)
  await goal.click()

  await expect(page.locator('[data-action="prompt-goal-config"]')).toBeVisible()
  await expect(page.locator('[data-action="prompt-add"]')).toBeVisible()

  await page.getByRole("button", { name: /移除目标模式|Remove goal mode/ }).click()
  await expect(page.locator('[data-action="prompt-goal-config"]')).toBeHidden()
})

test("专家选择器：从加号菜单悬停打开并选择专家", async ({ page }) => {
  await page.route(/\/team\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "team-research", name: "研究团队", autoEligible: true, memberCount: 2 }]),
    })
  })
  await page.route("**/team/employee**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "employee-research", name: "研究专家", job: "风险研究员", archived: false }]),
    })
  })

  await page.goto(`/${workspaceRootSlug()}/session`, { waitUntil: "commit", timeout: 60_000 })
  await expect(page.locator('[data-component="prompt-input"]')).toBeVisible({ timeout: 60_000 })
  const add = page.locator('[data-action="prompt-add"]')
  await expect(add).toBeVisible({ timeout: 30_000 })
  await add.click()

  const expert = page.locator('[data-action="prompt-expert"]')
  await expect(expert).toBeVisible()
  await expert.hover()

  const panel = page.locator('[data-component="hover-card-content"]')
  await expect(panel).toBeVisible()
  await expect(panel.getByText("研究专家")).toBeVisible()
  await expect(panel.getByText("研究团队")).toBeVisible()
  await expect(page.locator('[data-component="team-mode-select"]')).toHaveCount(0)

  await panel.getByRole("button", { name: /研究专家/ }).click()
  await expect(panel.getByRole("button", { name: /研究专家/ })).toBeVisible()
})

test("专家选择器：只有 Profile 专家团时也保留按需委派入口", async ({ page }) => {
  let profileRequested = false
  await page.route("**/team?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  })
  await page.route("**/team/employee**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  })
  await page.route("**/team/profile**", async (route) => {
    profileRequested = true
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "profile-review", name: "代码审查团", autoEligible: true, memberCount: 5 }]),
    })
  })
  await page.route("**/kernel***", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ features: [{ id: "team_orchestration", enabled: true }] }),
    })
  })

  await page.goto(`/${workspaceRootSlug()}/session`, { waitUntil: "commit", timeout: 60_000 })
  await expect(page.locator('[data-component="prompt-input"]')).toBeVisible({ timeout: 60_000 })
  const add = page.locator('[data-action="prompt-add"]')
  await expect(add).toBeVisible({ timeout: 30_000 })
  await add.click()
  const expert = page.locator('[data-action="prompt-expert"]')
  await expect(expert).toBeVisible()
  await expert.hover()

  const panel = page.locator('[data-component="hover-card-content"]')
  await expect(panel).toBeVisible()
  await expect.poll(() => profileRequested).toBe(true)
  await expect(panel.getByRole("button", { name: /Delegate when needed|按需/ })).toBeVisible()
  await panel.getByRole("button", { name: /Delegate when needed|按需/ }).click()
  await expect(page.getByText("代码审查团")).toBeVisible()
})
test("执行者选择器：可以显式切回仅主助手并隐藏协作授权", async ({ page }) => {
  await page.route("**/team?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "team-review", name: "审查团队", autoEligible: true, memberCount: 1 }]),
    })
  })
  await page.route("**/team/employee**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "employee-review", name: "审查专家", job: "review", archived: false }]),
    })
  })
  await page.route("**/team/profile**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  })
  await page.route("**/kernel*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ features: [{ id: "team_orchestration", enabled: true }] }),
    })
  })

  await page.goto(`/${workspaceRootSlug()}/session`, { waitUntil: "commit", timeout: 60_000 })
  await expect(page.locator('[data-component="prompt-input"]')).toBeVisible({ timeout: 60_000 })
  const add = page.locator('[data-action="prompt-add"]')
  await expect(add).toBeVisible({ timeout: 30_000 })
  await add.click()
  const expert = page.locator('[data-action="prompt-expert"]')
  await expect(expert).toBeVisible()
  await expert.hover()

  const panel = page.locator('[data-component="hover-card-content"]')
  await expect(panel).toBeVisible()
  const off = panel.locator('[data-action="team-mode-off"]')
  await expect(off).toBeVisible()
  await off.click()
  await expect(off).toHaveAttribute("data-selected", "true")

  // Explicit off is a real authorization change, not merely a visual label.
  await expect(panel.getByText(/不启用专家协作|without expert collaboration/)).toBeVisible()
})

test("总控关闭时：主助手输入区不显示协作入口", async ({ page }) => {
  await page.route("**/team?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "team-review", name: "审查团队", autoEligible: true, memberCount: 1 }]),
    })
  })
  await page.route("**/team/employee**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "employee-review", name: "审查专家", job: "review", archived: false }]),
    })
  })
  await page.route("**/team/profile**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  })
  await page.route("**/kernel*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ features: [{ id: "team_orchestration", enabled: false }] }),
    })
  })

  await page.goto(`/${workspaceRootSlug()}/session`, { waitUntil: "commit", timeout: 60_000 })
  await expect(page.locator('[data-component="prompt-input"]')).toBeVisible({ timeout: 60_000 })
  const add = page.locator('[data-action="prompt-add"]')
  await expect(add).toBeVisible({ timeout: 30_000 })
  await add.click()
  await expect(page.locator('[data-action="prompt-expert"]')).toHaveCount(0)
})

test("目标模式：长期任务配置可以打开验收标准和工具预算", async ({ page }) => {
  const goal = await openGoalMenu(page)
  await goal.click()

  const config = page.locator('[data-action="prompt-goal-config"]')
  await config.click()
  await expect(page.locator('[data-action="prompt-goal-long-task"]')).toBeVisible()
  await page.locator('[data-action="prompt-goal-long-task"]').click()

  await expect(
    page.locator('textarea[placeholder*="完成后运行测试"], textarea[placeholder*="run tests"]'),
  ).toBeVisible()
  const budget = page.locator('button[aria-haspopup="listbox"]').last()
  await expect(budget).toBeVisible()
  await budget.click()
  await expect(page.getByRole("option").first()).toBeVisible()
  await budget.press("ArrowDown")
  await budget.press("Enter")
  await expect(budget).toContainText(/20/)
})
