import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

function workspaceRootSlug() {
  const workspaceRoot = resolve(process.cwd(), "..", "..")
  return Buffer.from(workspaceRoot, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

test.use({ channel: "chrome", video: "off", trace: "off" })
test("app-mode and team-category tokens are injected for both color schemes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${workspaceRootSlug()}/session`)
  await expect(page.locator('[data-component="workspace-header"]')).toBeVisible({ timeout: 15_000 })

  const readTokens = () =>
    page.evaluate(() => ({
      appMode: getComputedStyle(document.documentElement).getPropertyValue("--app-mode-forge").trim(),
      appModeForeground: getComputedStyle(document.documentElement)
        .getPropertyValue("--app-mode-forge-foreground")
        .trim(),
      teamCategory: getComputedStyle(document.documentElement).getPropertyValue("--team-category-0").trim(),
      teamCategoryForeground: getComputedStyle(document.documentElement)
        .getPropertyValue("--team-category-0-foreground")
        .trim(),
      injected:
        document.getElementById("novaway-theme")?.textContent?.includes("--app-mode-forge:") === true &&
        document.getElementById("novaway-theme")?.textContent?.includes("--team-category-0:") === true,
    }))
  if ((await page.locator("html").getAttribute("data-color-scheme")) !== "light") {
    await page.evaluate(() => localStorage.setItem("novaway-color-scheme", "light"))
    await page.reload()
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  }
  const light = await readTokens()
  expect(light.appMode).toMatch(/^#[\da-f]{6}$/i)
  expect(light.appModeForeground).toMatch(/^#[\da-f]{6}$/i)
  expect(light.teamCategory).toMatch(/^#[\da-f]{6}$/i)
  expect(light.teamCategoryForeground).toMatch(/^#[\da-f]{6}$/i)
  expect(light.injected).toBe(true)

  await page.evaluate(() => localStorage.setItem("novaway-color-scheme", "dark"))
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  await expect.poll(readTokens).toMatchObject({ injected: true })
  const dark = await readTokens()
  expect(dark.appMode).toMatch(/^#[\da-f]{6}$/i)
  expect(dark.appModeForeground).toMatch(/^#[\da-f]{6}$/i)
  expect(dark.teamCategory).toMatch(/^#[\da-f]{6}$/i)
  expect(dark.teamCategoryForeground).toMatch(/^#[\da-f]{6}$/i)
  expect(dark.appMode).not.toBe(light.appMode)
  expect(dark.appModeForeground).not.toBe(light.appModeForeground)
  expect(dark.teamCategory).not.toBe(light.teamCategory)
  expect(dark.teamCategoryForeground).not.toBe(light.teamCategoryForeground)
})

test("alternate theme palettes override semantic tokens in light and dark schemes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${workspaceRootSlug()}/session`)
  await expect(page.locator('[data-component="workspace-header"]')).toBeVisible({ timeout: 15_000 })

  const themeTokens = () =>
    page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        theme: document.documentElement.dataset.theme,
        scheme: document.documentElement.dataset.colorScheme,
        background: style.getPropertyValue("--background-base").trim(),
        surface: style.getPropertyValue("--surface-base").trim(),
        interactive: style.getPropertyValue("--surface-interactive-base").trim(),
        injected:
          document.getElementById("novaway-theme")?.textContent?.includes("--surface-interactive-base:") === true,
      }
    })
  if ((await page.locator("html").getAttribute("data-color-scheme")) !== "light") {
    await page.evaluate(() => localStorage.setItem("novaway-color-scheme", "light"))
    await page.reload()
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  }
  const defaultLight = await themeTokens()
  await page.evaluate(() => localStorage.setItem("novaway-theme-id", "parchment"))
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "novaway")
  const alternateLight = await themeTokens()
  expect(alternateLight.injected).toBe(true)
  expect(alternateLight.background).toBe(defaultLight.background)
  expect(alternateLight.surface).toBe(defaultLight.surface)
  expect(alternateLight.interactive).toBe(defaultLight.interactive)

  await page.evaluate(() => localStorage.setItem("novaway-color-scheme", "dark"))
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  const alternateDark = await themeTokens()
  expect(alternateDark.injected).toBe(true)
  expect(alternateDark.background).not.toBe(alternateLight.background)
  expect(alternateDark.surface).not.toBe(alternateLight.surface)
  expect(alternateDark.interactive).not.toBe(alternateLight.interactive)
})
