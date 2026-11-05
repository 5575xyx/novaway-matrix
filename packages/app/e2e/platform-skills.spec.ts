import { expect, test, type Page } from "@playwright/test"
import { resolve } from "node:path"

test.use({ channel: "chrome", video: "off", trace: "off" })

/**
 * 运营技能端到端：设置 → 技能 里列出的，就是内核真正加载、模型能 `skill` 工具取到的。
 *
 * 这条链路（磁盘上的 SKILL.md → 技能注册表 → HTTP /settings/skills → 界面）任何一环
 * 断了，这里都会红 —— 单测只能证明各段自己没问题。
 */
const EXPECTED = ["自媒体运营技能", "选题雷达技能", "去 AI 味技能", "数据复盘技能"]

function workspaceRootSlug() {
  return Buffer.from(resolve(process.cwd(), "..", ".."), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

async function openSkillsSettings(page: Page) {
  await page.goto(`/${workspaceRootSlug()}/session`)
  await expect(page.locator('[data-component="sidebar-nav-desktop"]')).toBeVisible({ timeout: 20_000 })
  // e2e 是干净浏览器：navigator.languages 为空 → detectLocale 回退英文（与其它 spec 一致）。
  await page.locator('[data-component="sidebar-rail-item"][aria-label="Settings"]').first().click()
  // 设置是整帧页面（不是弹窗）：左侧标签栏里点 Skills。
  const tab = page.getByRole("tab", { name: /技能|Skills/ })
  await expect(tab).toBeVisible({ timeout: 15_000 })
  await tab.click()
  // 列表按技能 id 排序，中文名是渲染层映射的；四行不一定相邻，所以按名字找行。
  const title = page.locator("span.truncate.text-13-medium").first()
  await expect(title).toBeVisible({ timeout: 20_000 })
  return page
}

test("内核技能列表里有四个运营技能，并且带描述", async ({ page }) => {
  const dialog = await openSkillsSettings(page)

  for (const label of EXPECTED) {
    await expect(page.getByText(label, { exact: true }), `技能列表缺少 ${label}`).toBeVisible()
  }
  // 描述来自 SKILL.md 的 frontmatter：解析不到的话模型就选不中这个技能。
  await expect(page.getByText(/Use when the user runs social media accounts/)).toBeVisible()
  await expect(page.getByText(/Use when the user needs social media topic ideas/)).toBeVisible()
  await expect(page.getByText(/Use when the user wants copy rewritten to sound human/)).toBeVisible()
  await expect(page.getByText(/Use when the user wants to review social media account performance/)).toBeVisible()
})

test("打开技能详情能看到正文，并且指向 references/ 里的配套资料", async ({ page }) => {
  await openSkillsSettings(page)

  // media-ops 的正文里点名了平台手册；打不开说明 location 不对（模型也就读不到资料）。
  // 技能行：左侧图标 + 标题 + 标签 + 描述 + 右侧操作。按标题定位到这一行，不要用外层容器。
  const row = page
    .locator("div.border-t.border-border.px-4.py-3")
    .filter({ has: page.getByText("自媒体运营技能", { exact: true }) })
  await expect(row).toHaveCount(1)
  await row.getByRole("button", { name: /View|查看/ }).first().click()

  const detail = page.locator('[data-component="dialog"]').last()
  await expect(detail).toBeVisible({ timeout: 10_000 })
  // 正文在 textarea 里（不是文本节点），要读 value。
  const content = await detail.locator("textarea").last().inputValue()
  expect(content).toContain("references/platform-playbook.md")
  expect(content).toContain("references/precheck-rules.md")
  expect(content).toContain("topic-radar")
})
