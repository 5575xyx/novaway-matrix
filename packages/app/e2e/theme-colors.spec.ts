import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

test.describe("主题品牌色与工具语义色", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/fixtures/theme-colors.html")
    await expect(page.locator('[data-e2e="theme-colors"]')).toBeVisible()
    await expect.poll(() => page.locator("html").getAttribute("data-color-scheme")).toBe("light")
  })

  const readColors = async (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const color = (selector: string) => getComputedStyle(document.querySelector(selector)!).color
      return {
        background: getComputedStyle(document.documentElement).getPropertyValue("--background-base").trim(),
        providers: [...document.querySelectorAll('[data-component="provider-icon"]')].map(
          (el) => getComputedStyle(el).color,
        ),
        models: [...document.querySelectorAll("[data-model-brand]")].map((el) => getComputedStyle(el).color),
        platform: color('[data-component="platform-icon"]'),
        platformMark: getComputedStyle(document.querySelector('[data-component="platform-icon"] svg path')!).fill,
        interactiveUtility: color('[data-theme-component="interactive-text-utility"]'),
        interactiveReference: color('[data-theme-reference="interactive-icon"]'),
        semantic: ["success", "warning", "critical", "info", "interactive"].map((name) =>
          color(`[data-semantic="${name}"]`),
        ),
        semanticUtilities: ["success", "warning", "critical"].map((name) => color(`[data-semantic-utility="${name}"]`)),
        semanticReferences: ["success", "warning", "critical"].map((name) =>
          color(`[data-semantic-reference="${name}"]`),
        ),
        toastIcons: ["success", "error", "loading"].map((variant) => color(`[data-toast-icon="${variant}"]`)),
        toastProgress: ["success", "error", "loading"].map(
          (variant) => getComputedStyle(document.querySelector(`[data-toast-progress="${variant}"]`)!).backgroundColor,
        ),
        errorCard: color("[data-theme-error-card]"),
        components: [
          getComputedStyle(document.querySelector('[data-theme-component="primary-button"]')!).backgroundColor,
          getComputedStyle(
            document.querySelector(
              '[data-theme-component="info-card"] [data-slot="card-title-icon"] [data-component="icon"]',
            )!,
          ).color,
          getComputedStyle(document.querySelector('[data-theme-component="tag"]')!).backgroundColor,
          color('[data-theme-component="interactive-text-utility"]'),
          getComputedStyle(document.querySelector('[data-component="input"] [data-slot="input-wrapper"]')!)
            .backgroundColor,
          getComputedStyle(document.querySelector('[data-component="input"] [data-slot="input-wrapper"]')!)
            .borderTopColor,
          getComputedStyle(
            document.querySelector('[data-theme-component="checkbox"] [data-slot="checkbox-checkbox-control"]')!,
          ).backgroundColor,
        ],
      }
    })

  test("light and dark modes update brand SVGs and preserve distinct semantic tool colors", async ({
    page,
  }, testInfo) => {
    const light = await readColors(page)
    await page.screenshot({ path: testInfo.outputPath("theme-light.png"), fullPage: true })
    expect(light.providers[0]).not.toBe(light.providers[1])
    expect(light.models[0]).not.toBe(light.models[1])
    expect(new Set(light.semantic).size).toBeGreaterThanOrEqual(4)
    expect(light.components).toHaveLength(7)
    expect(light.components.every((value) => value && value !== "rgba(0, 0, 0, 0)")).toBe(true)
    expect(light.background).not.toBe("")
    expect(light.platform).not.toBe("")
    expect(light.platformMark).not.toBe(light.platform)
    expect(light.interactiveUtility).toBe(light.interactiveReference)
    expect(light.semanticUtilities).toEqual(light.semanticReferences)
    expect(light.toastIcons).toEqual([light.semantic[0], light.semantic[2], light.semantic[3]])
    expect(light.toastProgress).toEqual([light.semantic[0], light.semantic[2], light.semantic[3]])
    expect(light.errorCard).toBe(light.semantic[2])

    await page.locator('[data-action="dark"]').click()
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
    const dark = await readColors(page)
    await page.screenshot({ path: testInfo.outputPath("theme-dark.png"), fullPage: true })
    expect(dark.background).not.toBe(light.background)
    expect(dark.components).not.toEqual(light.components)
    expect(dark.providers[0]).not.toBe(light.providers[0])
    expect(dark.models[0]).not.toBe("")
    expect(dark.models[1]).not.toBe("")
    expect(dark.platform).not.toBe(light.platform)
    expect(new Set(dark.semantic).size).toBeGreaterThanOrEqual(4)
    expect(dark.semantic).not.toEqual(light.semantic)
    expect(dark.interactiveUtility).toBe(dark.interactiveReference)
    expect(dark.semanticUtilities).toEqual(dark.semanticReferences)
    expect(dark.toastIcons).toEqual([dark.semantic[0], dark.semantic[2], dark.semantic[3]])
    expect(dark.toastProgress).toEqual([dark.semantic[0], dark.semantic[2], dark.semantic[3]])
    expect(dark.errorCard).toBe(dark.semantic[2])

    await page.locator('[data-action="light"]').click()
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
    await expect.poll(async () => (await readColors(page)).components).toEqual(light.components)
    expect(await readColors(page)).toEqual(light)

    await page.locator('[data-action="everforest"]').click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "everforest")
    const everforest = await readColors(page)
    await page.screenshot({ path: testInfo.outputPath("theme-everforest.png"), fullPage: true })
    expect(everforest.background).not.toBe(light.background)
    expect(everforest.providers[0]).not.toBe(light.providers[0])
    expect(everforest.models).not.toEqual(light.models)
    expect(everforest.platformMark).not.toBe(everforest.platform)
    expect(everforest.interactiveUtility).toBe(everforest.interactiveReference)
    expect(everforest.semanticUtilities).toEqual(everforest.semanticReferences)
    expect(everforest.toastIcons).toEqual([everforest.semantic[0], everforest.semantic[2], everforest.semantic[3]])
    expect(everforest.toastProgress).toEqual([everforest.semantic[0], everforest.semantic[2], everforest.semantic[3]])
    expect(everforest.errorCard).toBe(everforest.semantic[2])
    expect(new Set(everforest.semantic).size).toBeGreaterThanOrEqual(4)
  })
})
