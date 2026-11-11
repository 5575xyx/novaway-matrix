import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

test("ODT 可在预览中编辑段落并调用宿主写回回调", async ({ page }) => {
  await page.goto("/e2e/fixtures/legacy-office-preview.html?format=odt")
  await page.getByText("ODT 段落").click()
  const editor = page.locator('[data-action="legacy-edit-paragraph"]')
  await editor.fill("已编辑段落")
  await editor.press("Enter")
  await expect(page.locator('[data-slot="legacy-save"]')).toContainText('{"paragraph":1,"text":"已编辑段落"}')
})

test("ODS 网格编辑回调包含工作表与 A1 坐标", async ({ page }) => {
  await page.goto("/e2e/fixtures/legacy-office-preview.html?format=ods")
  await page.getByText("ODS 单元格").click()
  const editor = page.locator('[data-action="legacy-edit-cell"]')
  await editor.fill("新值")
  await editor.press("Enter")
  await expect(page.locator('[data-slot="legacy-save"]')).toContainText('{"sheet":"数据","cell":"A1","value":"新值"}')
})

test("ODP 预览显示幻灯片内容", async ({ page }) => {
  await page.goto("/e2e/fixtures/legacy-office-preview.html?format=odp")
  await expect(page.getByText("ODP 幻灯片")).toBeVisible()
  await expect(page.locator('[data-component="office-ribbon"]')).toBeVisible()
})

test("RTF 标记为只读，且不会进入 ODF 段落编辑", async ({ page }) => {
  await page.goto("/e2e/fixtures/legacy-office-preview.html?format=rtf")
  await expect(page.locator('[data-component="office-ribbon"]')).toContainText("只读预览（旧格式）")
  await expect(page.getByText("RTF preview")).toBeVisible()
  await page.getByText("RTF preview").click()
  await expect(page.locator('[data-action="legacy-edit-paragraph"]')).toHaveCount(0)
})
