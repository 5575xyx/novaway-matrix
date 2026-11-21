import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

const directory = resolve(process.cwd(), "..", "..")
const workspaceSlug = () =>
  Buffer.from(directory, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

test("builtin sidebar surface and declarative settings surface render in Chromium", async ({ page }) => {
  await page.route("**/extension/marketplace*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        installed: [],
        sources: [
          {
            id: "novaway-official",
            name: "NovaWay Official",
            type: "novaway",
            url: "https://example.test/catalog.json",
            enabled: true,
            trust: "official",
            builtin: true,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        novaway: [
          {
            packageId: "com.novaway.e2e-smoke",
            name: "Browser Marketplace Smoke",
            version: "0.1.0",
            description: "Marketplace browser fixture",
            url: "https://example.test/smoke.zip",
            kind: "zip",
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            runtimeTargets: ["novaway-v2"],
            capabilities: ["skills"],
          },
        ],
        zcode: [],
        claude: [],
        updates: [],
        errors: [],
      }),
    }),
  )
  await page.route("**/plugin/contributions**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          pluginID: "novaway-ui",
          kind: "surface",
          name: "novaway.home",
          localName: "home",
          scope: "builtin",
          origin: "extension",
          adapter: "v2",
          status: "active",
          slot: "sidebar.item",
          title: "NovaWay Home",
          action: { type: "view", viewId: "novaway.home" },
        },
      ]),
    }),
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    if (!localStorage.getItem("novaway-theme-id")) localStorage.setItem("novaway-theme-id", "novaway")
    if (!localStorage.getItem("novaway-color-scheme")) localStorage.setItem("novaway-color-scheme", "light")
  })
  await page.goto(`/${workspaceSlug()}/session`)

  const home = page.locator('[data-component="sidebar-rail-item"][aria-label="NovaWay Home"]').first()
  await expect(home).toBeVisible({ timeout: 20_000 })
  await home.click()
  const view = page.locator('[data-component="plugin-surface-view"]')
  await expect(view).toBeVisible({ timeout: 15_000 })
  await expect(view).toHaveAttribute("data-plugin-id", "novaway-ui")
  await expect(view).toHaveAttribute("data-view-id", "novaway.home")
  await expect(view.locator("h1")).toHaveCSS("color", /rgb\(/)
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  const lightTitleColor = await view.locator("h1").evaluate((element) => getComputedStyle(element).color)

  await page.evaluate(() => localStorage.setItem("novaway-color-scheme", "dark"))
  await page.reload()
  await expect(view).toBeVisible({ timeout: 15_000 })
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  const darkTitleColor = await view.locator("h1").evaluate((element) => getComputedStyle(element).color)
  expect(darkTitleColor).not.toBe(lightTitleColor)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(view).toBeVisible()
  const viewBounds = await view.boundingBox()
  expect(viewBounds).not.toBeNull()
  expect(viewBounds!.x + viewBounds!.width).toBeLessThanOrEqual(390)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${workspaceSlug()}/session`)
  const settings = page
    .locator('button[aria-label="Settings"]:not([data-component]), button[aria-label="设置"]:not([data-component])')
    .last()
  await expect(settings).toBeVisible({ timeout: 15_000 })
  await settings.click()
  await page.locator('[data-action="rail-menu-open-settings"]').click()
  const settingsPanel = page.locator("[data-panel-transition][aria-label]")
  await expect(settingsPanel).toBeVisible({ timeout: 15_000 })

  const pluginsTab = page.getByRole("tab", { name: /Plugins|插件/i })
  await expect(pluginsTab).toBeVisible({ timeout: 10_000 })
  await pluginsTab.click()
  await expect(settingsPanel).toContainText("Configured plugins")
  await expect(settingsPanel).toContainText("Add plugin")

  const extensions = page
    .locator(
      '[data-component="sidebar-rail-item"][aria-label="Extensions"]:visible, [data-component="sidebar-rail-item"][aria-label="扩展"]:visible',
    )
    .last()
  await expect(extensions).toBeVisible({ timeout: 15_000 })
  await extensions.click()
  await expect(page.getByText(/Extensions|扩展/).first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole("button", { name: /Marketplace|市场/ }).click()
  await expect(page.getByText(/Marketplace sources|市场源/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText("NovaWay Official", { exact: true })).toBeVisible()
  await expect(page.getByText("Browser Marketplace Smoke", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: /Add source|添加源/ })).toBeVisible()
})
