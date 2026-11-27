import { expect, test } from "@playwright/test"

test.use({ channel: "chrome", video: "off", trace: "off" })

test.describe("主题品牌色与工具语义色", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/fixtures/theme-colors.html")
    await expect(page.locator('[data-e2e="theme-colors"]')).toBeVisible()
    await expect.poll(() => page.locator("html").getAttribute("data-color-scheme")).toBe("light")
  })

  test("retired themes migrate to NovaWay while color schemes remain switchable", async ({ page }, testInfo) => {
    await page.locator('[data-action="parchment"]').click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "novaway")
    const light = await readColors(page)
    await page.screenshot({ path: testInfo.outputPath("migrated-theme-light.png"), fullPage: true })
    await page.locator('[data-action="dark"]').click()
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
    const dark = await readColors(page)
    expect(dark.background).not.toBe(light.background)
    expect(dark.semantic).not.toEqual(light.semantic)
    await page.screenshot({ path: testInfo.outputPath("migrated-theme-dark.png"), fullPage: true })
    await page.evaluate(() => localStorage.setItem("novaway-theme-id", "everforest"))
    await page.reload()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "novaway")
    await expect.poll(() => page.evaluate(() => localStorage.getItem("novaway-theme-id"))).toBe("novaway")
  })

  const expectCardStripes = (stripes: string[], colors: string[]) => {
    expect(stripes).toHaveLength(colors.length)
    stripes.forEach((stripe, index) => expect(stripe).toContain(colors[index]!))
  }

  const readColors = async (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const color = (selector: string) => getComputedStyle(document.querySelector(selector)!).color
      const resolveColor = (value: string) => {
        const element = document.createElement("span")
        element.style.color = value
        document.body.append(element)
        const resolved = getComputedStyle(element).color
        element.remove()
        return resolved
      }
      return {
        background: getComputedStyle(document.documentElement).getPropertyValue("--background-base").trim(),
        providers: [...document.querySelectorAll('[data-component="provider-icon"]')].map(
          (el) => getComputedStyle(el).color,
        ),
        models: [...document.querySelectorAll("[data-model-brand]")].map((el) => getComputedStyle(el).color),
        platform: color('[data-component="platform-icon"]'),
        platformMark: getComputedStyle(document.querySelector('[data-component="platform-icon"] svg path')!).fill,
        interactiveUtility: color('[data-theme-component="interactive-text-utility"]'),
        interactiveReference: color('[data-theme-reference="interactive-text"]'),
        interactiveIconUtility: color('[data-theme-component="interactive-icon-utility"]'),
        interactiveIconReference: color('[data-theme-reference="interactive-icon"]'),
        interactiveBorderUtility: getComputedStyle(
          document.querySelector('[data-theme-component="interactive-border-utility"]')!,
        ).borderTopColor,
        interactiveBorderReference: getComputedStyle(
          document.querySelector('[data-theme-reference="interactive-border"]')!,
        ).borderTopColor,
        semantic: ["success", "warning", "critical", "info", "interactive"].map((name) =>
          color(`[data-semantic="${name}"]`),
        ),
        semanticUtilities: ["success", "warning", "critical"].map((name) => color(`[data-semantic-utility="${name}"]`)),
        statusDots: ["success", "warning", "critical", "interactive"].map(
          (name) => getComputedStyle(document.querySelector(`[data-theme-status-dot="${name}"]`)!).backgroundColor,
        ),
        semanticReferences: ["success", "warning", "critical"].map((name) =>
          color(`[data-semantic-reference="${name}"]`),
        ),
        toastIcons: ["success", "error", "loading"].map((variant) => color(`[data-toast-icon="${variant}"]`)),
        toastProgress: ["success", "error", "loading"].map(
          (variant) => getComputedStyle(document.querySelector(`[data-toast-progress="${variant}"]`)!).backgroundColor,
        ),
        errorCard: color("[data-theme-error-card]"),
        semanticCards: ["success", "warning", "error"].map((variant) =>
          color(`[data-theme-component="${variant}-card"] [data-slot="card-title-icon"] [data-component="icon"]`),
        ),
        semanticCardAccents: ["success", "warning", "error"].map((variant) =>
          resolveColor(
            getComputedStyle(document.querySelector(`[data-theme-component="${variant}-card"]`)!).getPropertyValue(
              "--card-accent",
            ),
          ),
        ),
        semanticCardStripes: ["success", "warning", "error"].map(
          (variant) =>
            getComputedStyle(document.querySelector(`[data-theme-component="${variant}-card"]`)!, "::before")
              .backgroundImage,
        ),
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
    expect(light.interactiveIconUtility).toBe(light.interactiveIconReference)
    expect(light.interactiveIconUtility).toBe(light.semantic[4])
    expect(light.interactiveBorderUtility).toBe(light.interactiveBorderReference)
    expect(light.semanticUtilities).toEqual(light.semanticReferences)
    expect(light.statusDots).toEqual([light.semantic[0], light.semantic[1], light.semantic[2], light.semantic[4]])
    expect(light.toastIcons).toEqual([light.semantic[0], light.semantic[2], light.semantic[3]])
    expect(light.toastProgress).toEqual([light.semantic[0], light.semantic[2], light.semantic[3]])
    expect(light.errorCard).toBe(light.semantic[2])
    expect(light.semanticCards).toEqual([light.semantic[0], light.semantic[1], light.semantic[2]])
    expect(light.semanticCardAccents).toEqual(light.semanticCards)
    expectCardStripes(light.semanticCardStripes, light.semanticCards)

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
    expect(dark.interactiveIconUtility).toBe(dark.interactiveIconReference)
    expect(dark.interactiveIconUtility).toBe(dark.semantic[4])
    expect(dark.interactiveBorderUtility).toBe(dark.interactiveBorderReference)
    expect(dark.semanticUtilities).toEqual(dark.semanticReferences)
    expect(dark.statusDots).toEqual([dark.semantic[0], dark.semantic[1], dark.semantic[2], dark.semantic[4]])
    expect(dark.toastIcons).toEqual([dark.semantic[0], dark.semantic[2], dark.semantic[3]])
    expect(dark.toastProgress).toEqual([dark.semantic[0], dark.semantic[2], dark.semantic[3]])
    expect(dark.errorCard).toBe(dark.semantic[2])
    expect(dark.semanticCards).toEqual([dark.semantic[0], dark.semantic[1], dark.semantic[2]])
    expect(dark.semanticCardAccents).toEqual(dark.semanticCards)
    expectCardStripes(dark.semanticCardStripes, dark.semanticCards)

    await page.locator('[data-action="light"]').click()
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
    await expect.poll(async () => (await readColors(page)).components).toEqual(light.components)
    expect(await readColors(page)).toEqual(light)

    await page.locator('[data-action="parchment"]').click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "novaway")
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
    expect(await readColors(page)).toEqual(light)
  })
})
