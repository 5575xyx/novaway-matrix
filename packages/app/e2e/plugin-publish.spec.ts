import { expect, test, type Page } from "@playwright/test"
import { resolve } from "node:path"

const workspaceRootSlug = () =>
  Buffer.from(resolve(process.cwd(), "..", ".."), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

async function openPublishDialog(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).api = {
      ...(window as any).api,
      platform: {
        getAccounts: async () => [],
        getGroups: async () => [],
        refreshProfiles: async () => ({ accounts: [] }),
        onPublishProgress: () => () => {},
        onPublishFinished: () => () => {},
        getPublishBatches: async () => [],
      },
    }
  })
  await page.goto(`/${workspaceRootSlug()}/session`)
  const workbench = page.getByRole("combobox", { name: /Switch work mode|切换工作台|切换模式/ })
  await expect(workbench).toBeVisible({ timeout: 20_000 })
  await workbench.click()
  const operations = page.getByRole("option", { name: /Operations|运营/ }).first()
  if ((await operations.count()) === 0) {
    test.skip(true, "operations workbench plugin is not installed in this E2E environment")
  }
  await operations.click()
  const publish = page.locator('[data-slot="pulse-publish-entry"]')
  await expect(publish).toBeVisible({ timeout: 15_000 })
  await publish.click()
  const dialog = page.locator('[data-component="dialog"]')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

test("builtin publish driver is visible, stores an account and executes through the Host bridge", async ({ page }) => {
  const dialog = await openPublishDialog(page)
  const driverPanel = dialog.locator('[data-slot="plugin-publish-drivers"]')
  await expect(driverPanel).toBeVisible({ timeout: 15_000 })
  await expect(driverPanel).toContainText(/NovaWay Fixture Publish|fixture-publish/)
  await expect(driverPanel).toContainText("image_text")

  await driverPanel.locator('[data-slot="plugin-publish-account-label"]').fill("Browser release account")
  await driverPanel.locator('[data-slot="plugin-publish-add-account"]').click()
  await expect(driverPanel).toContainText("Browser release account")
  await expect(driverPanel).toContainText("账号已保存到当前项目")

  await driverPanel.locator('[data-slot="plugin-publish-execute"]').click()
  await expect(driverPanel).toContainText("插件发布执行成功")

  const directory = resolve(process.cwd(), "..", "..")
  const toggle = async (enabled: boolean) => {
    const response = await page.request.patch(
      `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}/plugin/novaway-ui`,
      {
        headers: { "x-novaway-directory": directory },
        data: { enabled, scope: "builtin" },
      },
    )
    return { status: response.status(), body: await response.text() }
  }

  expect((await toggle(false)).status).toBe(200)
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await page.locator('[data-slot="pulse-publish-entry"]').click()
  const disabledDialog = page.locator('[data-component="dialog"]')
  await expect(disabledDialog).toBeVisible()
  await expect(disabledDialog.locator('[data-slot="plugin-publish-drivers"]')).toHaveCount(0)

  expect((await toggle(true)).status).toBe(200)
  await page.keyboard.press("Escape")
  await expect(disabledDialog).toBeHidden()
  await page.locator('[data-slot="pulse-publish-entry"]').click()
  const restoredDialog = page.locator('[data-component="dialog"]')
  await expect(restoredDialog.locator('[data-slot="plugin-publish-drivers"]')).toBeVisible({ timeout: 15_000 })
  await expect(restoredDialog.locator('[data-slot="plugin-publish-drivers"]')).toContainText("Browser release account")
})
