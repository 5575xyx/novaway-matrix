import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

const directory = resolve(process.cwd(), "..", "..")
const workspaceSlug = () =>
  Buffer.from(directory, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

test("builtin sidebar surface and declarative settings surface render in Chromium", async ({ page }) => {
  await page.goto(`/${workspaceSlug()}/session`)

  const home = page.locator('[data-component="sidebar-rail-item"][aria-label="NovaWay Home"]').first()
  await expect(home).toBeVisible({ timeout: 20_000 })
  await home.click()
  const view = page.locator('[data-component="plugin-surface-view"]')
  await expect(view).toBeVisible({ timeout: 15_000 })
  await expect(view).toHaveAttribute("data-plugin-id", "novaway-ui")
  await expect(view).toHaveAttribute("data-view-id", "novaway.home")

  await page.goto(`/${workspaceSlug()}/session`)
  const settings = page
    .locator(
      '[data-component="sidebar-rail-item"][aria-label="Settings"], [data-component="sidebar-rail-item"][aria-label="设置"]',
    )
    .first()
  await expect(settings).toBeVisible({ timeout: 15_000 })
  await settings.click()
  const settingsPanel = page.locator("[data-panel-transition][aria-label]")
  await expect(settingsPanel).toBeVisible({ timeout: 15_000 })

  const pluginsTab = page.getByRole("tab", { name: /Plugins|插件/i })
  await expect(pluginsTab).toBeVisible({ timeout: 10_000 })
  await pluginsTab.click()
  await expect(settingsPanel).toContainText("NovaWay Runtime")
  await expect(settingsPanel).toContainText("Enable runtime")
})
