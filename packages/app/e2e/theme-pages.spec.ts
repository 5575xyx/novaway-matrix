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

async function dismissTransientErrors(page: import("@playwright/test").Page) {
  const closeButtons = page.locator('[data-component="toast"] [data-slot="toast-close-button"]')
  for (let attempt = 0; attempt < 10 && (await closeButtons.count()) > 0; attempt++) {
    try {
      await closeButtons.first().click({ force: true, timeout: 1_000 })
    } catch {
      break
    }
    await page.waitForTimeout(120)
  }
}

async function toggleTheme(page: import("@playwright/test").Page) {
  const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
  const menuTrigger = sidebar.locator('[data-action="rail-menu-trigger"]')
  await menuTrigger.evaluate((element) => (element as HTMLButtonElement).click())
  const appearanceTrigger = page.locator('[data-action="rail-appearance-trigger"]')
  await expect(appearanceTrigger).toBeVisible()
  await appearanceTrigger.evaluate((element) => (element as HTMLButtonElement).click())
  const current = await page.locator("html").getAttribute("data-color-scheme")
  const target = current === "dark" ? "light" : "dark"
  const scheme = page.locator(`[data-quick-scheme="${target}"]`)
  await expect(scheme).toBeVisible()
  await scheme.evaluate((element) => (element as HTMLButtonElement).click())
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", target)
  await page.keyboard.press("Escape")
}

test.use({ channel: "chrome", video: "off", trace: "off" })
test("major workspace pages retain themed surfaces in light and dark modes", async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const slug = workspaceRootSlug()
  await page.goto(`/${slug}/session`)
  await expect(page.locator('[data-component="workspace-header"]')).toBeVisible({ timeout: 15_000 })
  const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
  if ((await page.locator("html").getAttribute("data-color-scheme")) !== "light") {
    await toggleTheme(page)
  }
  const canvas = page.locator('[data-component="conv-frame"]')
  const readCanvasBackground = () => canvas.evaluate((element) => getComputedStyle(element).backgroundColor)
  const sessionLight = await readCanvasBackground()
  await page.screenshot({ path: testInfo.outputPath("session-light.png") })
  await toggleTheme(page)
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  await page.waitForTimeout(3_500)
  await page.evaluate(() => window.scrollTo(0, 0))
  expect(await readCanvasBackground()).not.toBe(sessionLight)
  await page.screenshot({ path: testInfo.outputPath("session-dark.png") })

  const pages = [
    { name: "Settings", button: "Settings" },
    { name: "Database", button: "Database" },
    { name: "Knowledge", button: "Knowledge" },
    { name: "Teams", button: "Teams" },
    { name: "Arena", button: "Arena" },
    { name: "Extensions", button: "Extensions" },
    { name: "Scheduled tasks", button: "Scheduled tasks" },
  ]

  for (const [index, item] of pages.entries()) {
    await page.goto(`/${slug}/session`)
    await expect(page.locator('[data-component="sidebar-nav-desktop"]')).toBeVisible({ timeout: 15_000 })
    const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
    if ((await page.locator("html").getAttribute("data-color-scheme")) !== "light") {
      await toggleTheme(page)
    }
    if (item.button === "Settings") {
      await sidebar
        .locator('[data-action="rail-menu-trigger"]')
        .evaluate((element) => (element as HTMLButtonElement).click())
      const openSettings = page.locator('[data-action="rail-menu-open-settings"]')
      await expect(openSettings).toBeVisible()
      await openSettings.evaluate((element) => (element as HTMLButtonElement).click())
    } else {
      await sidebar.getByRole("button", { name: item.button, exact: true }).first().click()
    }
    const panel = page.locator('section[data-panel-transition][data-state="open"]').first()
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await panel.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)))

    const readPanelPaint = () =>
      panel.evaluate((element) => {
        const style = getComputedStyle(element)
        const foregrounds = Array.from(element.querySelectorAll<HTMLElement>("*"))
          .filter((child) => {
            const rect = child.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 && (child.textContent?.trim().length ?? 0) > 0
          })
          .map((child) => getComputedStyle(child).color)
          .sort()
        return { background: style.backgroundColor, foreground: style.color, foregrounds }
      })
    const light = await readPanelPaint()
    expect(light.background).not.toBe("rgba(0, 0, 0, 0)")
    await dismissTransientErrors(page)
    await page.screenshot({
      path: testInfo.outputPath(`${index}-${item.name.toLowerCase().replaceAll(" ", "-")}-light.png`),
    })

    await toggleTheme(page)
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
    await page.waitForTimeout(3_500)
    await page.evaluate(() => window.scrollTo(0, 0))
    const dark = await readPanelPaint()
    expect(dark.background, `${item.name} panel surface should change with the theme`).not.toBe(light.background)
    expect(dark.foreground, `${item.name} panel foreground should change with the theme`).not.toBe(light.foreground)
    expect(dark.foregrounds, `${item.name} visible content colors should follow the theme`).not.toEqual(
      light.foregrounds,
    )
    await dismissTransientErrors(page)
    await page.screenshot({
      path: testInfo.outputPath(`${index}-${item.name.toLowerCase().replaceAll(" ", "-")}-dark.png`),
    })
  }
})

test("Side Pane and its workspace tree follow light and dark themes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => localStorage.setItem("novaway-color-scheme", "light"))
  await page.goto(`/${workspaceRootSlug()}/session`)
  await expect(page.locator('[data-component="workspace-header"]')).toBeVisible({ timeout: 15_000 })

  const frame = page.locator('[data-component="side-pane-frame"]')
  await expect(frame).toBeVisible()
  const readPaint = (element: ReturnType<typeof page.locator>) =>
    element.evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        background: style.backgroundColor,
        foreground: style.color,
        descendants: Array.from(node.querySelectorAll<HTMLElement>("*"))
          .filter((child) => {
            const rect = child.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 && (child.textContent?.trim().length ?? 0) > 0
          })
          .map((child) => getComputedStyle(child).color)
          .sort(),
      }
    })
  const lightFrame = await readPaint(frame)

  await frame.locator('[data-component="side-pane-launcher-workspace-tree"]').click()
  const tree = frame.locator('[data-component="side-pane-file-tree"]')
  await expect(tree).toBeVisible()
  const lightTree = await readPaint(tree)
  await dismissTransientErrors(page)

  await toggleTheme(page)
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  await page.waitForTimeout(3_500)
  const darkFrame = await readPaint(frame)
  const darkTree = await readPaint(tree)
  expect(darkFrame.background).not.toBe(lightFrame.background)
  expect(darkFrame.foreground).not.toBe(lightFrame.foreground)
  expect(darkFrame.descendants).not.toEqual(lightFrame.descendants)
  expect(darkTree.foreground).not.toBe(lightTree.foreground)
  expect(darkTree.descendants).not.toEqual(lightTree.descendants)
  await dismissTransientErrors(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath("side-pane-dark.png") })
  await frame.screenshot({ path: testInfo.outputPath("side-pane-frame-dark.png") })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('[data-component="workspace-header"]')).toBeVisible()
  const mobileCanvas = page.locator('[data-component="conv-frame"]')
  const darkMobileCanvas = await readPaint(mobileCanvas)
  await dismissTransientErrors(page)
  await page.screenshot({ path: testInfo.outputPath("session-mobile-dark.png"), fullPage: true })
  await page.evaluate(() => localStorage.setItem("novaway-color-scheme", "light"))
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  const lightMobileCanvas = await readPaint(page.locator('[data-component="conv-frame"]'))
  expect(darkMobileCanvas.background).not.toBe(lightMobileCanvas.background)
  await dismissTransientErrors(page)
  await page.screenshot({ path: testInfo.outputPath("session-mobile-light.png"), fullPage: true })
})

test("mobile settings navigation and panel follow light and dark themes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    if (!localStorage.getItem("novaway-color-scheme")) localStorage.setItem("novaway-color-scheme", "light")
  })
  await page.goto(`/${workspaceRootSlug()}/session`)
  await expect(page.locator('[data-component="workspace-header"]')).toBeVisible({ timeout: 15_000 })

  const openSettings = async () => {
    await page
      .locator('[data-component="workspace-header"]')
      .getByRole("button", { name: /^(Toggle menu|切换菜单)$/ })
      .click()
    const mobileNav = page.locator('[data-component="sidebar-nav-mobile"]')
    await expect(mobileNav).toBeVisible()
    await mobileNav.getByRole("button", { name: "Settings", exact: true }).first().click()
    const panel = page.locator('section[data-panel-transition][data-state="open"]').first()
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await expect(panel).toContainText("Appearance")
    return { mobileNav, panel }
  }
  const readPaint = (element: ReturnType<typeof page.locator>) =>
    element.evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        background: style.backgroundColor,
        foreground: style.color,
        textColors: Array.from(node.querySelectorAll<HTMLElement>("*"))
          .filter((child) => {
            const rect = child.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 && (child.textContent?.trim().length ?? 0) > 0
          })
          .map((child) => getComputedStyle(child).color)
          .sort(),
      }
    })

  const light = await openSettings()
  const lightNavPaint = await readPaint(light.mobileNav)
  const lightPanelPaint = await readPaint(light.panel)
  await page.evaluate(() => localStorage.setItem("novaway-color-scheme", "dark"))
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  const dark = await openSettings()
  const darkNavPaint = await readPaint(dark.mobileNav)
  const darkPanelPaint = await readPaint(dark.panel)
  expect(darkNavPaint.textColors).not.toEqual(lightNavPaint.textColors)
  expect(darkPanelPaint.background).not.toBe(lightPanelPaint.background)
  expect(darkPanelPaint.foreground).not.toBe(lightPanelPaint.foreground)
})

test("permission mode popover surface follows both color schemes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/${workspaceRootSlug()}/session`)
  const trigger = page.locator('[data-action="prompt-permission-mode"]')
  await expect(trigger).toBeVisible({ timeout: 15_000 })

  const openMenu = async () => {
    await trigger.click()
    const menu = page.getByRole("menu").last()
    await expect(menu).toBeVisible()
    await expect(menu.getByRole("menuitem").first()).toBeVisible()
    return menu
  }
  const readMenuPaint = (menu: ReturnType<typeof page.getByRole>) =>
    menu.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        background: style.backgroundColor,
        foreground: style.color,
        border: style.borderColor,
        items: Array.from(element.querySelectorAll<HTMLElement>("[role='menuitem']"))
          .map((item) => {
            const itemStyle = getComputedStyle(item)
            return `${itemStyle.color}|${itemStyle.backgroundColor}|${itemStyle.borderColor}`
          })
          .sort(),
      }
    })
  const lightMenu = await openMenu()
  const light = await readMenuPaint(lightMenu)
  expect(light.background).not.toBe("rgba(0, 0, 0, 0)")
  await page.keyboard.press("Escape")

  await page.evaluate(() => localStorage.setItem("novaway-color-scheme", "dark"))
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  const darkMenu = await openMenu()
  const dark = await readMenuPaint(darkMenu)
  expect(dark.background).not.toBe(light.background)
  expect(dark.foreground).not.toBe(light.foreground)
  expect(dark.border).not.toBe(light.border)
  expect(dark.items).not.toEqual(light.items)
})

test("mobile permission mode popover remains themed and usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/${workspaceRootSlug()}/session`)
  const trigger = page.locator('[data-action="prompt-permission-mode"]')
  await expect(trigger).toBeVisible({ timeout: 15_000 })
  const openMenu = async () => {
    await trigger.click()
    const menu = page.getByRole("menu").last()
    await expect(menu).toBeVisible()
    await expect(menu.getByRole("menuitem").first()).toBeVisible()
    return menu
  }
  const readPaint = (menu: ReturnType<typeof page.getByRole>) =>
    menu.evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, foreground: style.color }
    })
  const lightMenu = await openMenu()
  const light = await readPaint(lightMenu)
  await page.keyboard.press("Escape")
  await page.evaluate(() => localStorage.setItem("novaway-color-scheme", "dark"))
  await page.reload()
  await expect(trigger).toBeVisible()
  const darkMenu = await openMenu()
  const dark = await readPaint(darkMenu)
  expect(dark.background).not.toBe(light.background)
  expect(dark.foreground).not.toBe(light.foreground)
})

test("global chat route canvas follows light and dark schemes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => localStorage.setItem("novaway-color-scheme", "light"))
  await page.goto("/global-chat/session")
  const canvas = page.locator('[data-component="conv-frame"]')
  await expect(canvas).toBeVisible({ timeout: 20_000 })
  const light = await canvas.evaluate((element) => getComputedStyle(element).backgroundColor)
  await dismissTransientErrors(page)

  await toggleTheme(page)
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  await page.waitForTimeout(3_500)
  const dark = await canvas.evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(dark).not.toBe(light)
  await dismissTransientErrors(page)
})

test("theme swatches apply only on click and custom accents persist", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    if (sessionStorage.getItem("theme-preset-test-initialized")) return
    localStorage.setItem("novaway-color-scheme", "light")
    localStorage.setItem("novaway-theme-id", "novaway")
    localStorage.removeItem("novaway-theme-custom-interactive")
    sessionStorage.setItem("theme-preset-test-initialized", "true")
  })
  await page.goto(`/${workspaceRootSlug()}/session`)
  const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
  await expect(sidebar).toBeVisible({ timeout: 15_000 })
  await sidebar
    .locator('[data-action="rail-menu-trigger"]')
    .evaluate((element) => (element as HTMLButtonElement).click())
  const openSettings = page.locator('[data-action="rail-menu-open-settings"]')
  await expect(openSettings).toBeVisible()
  await openSettings.evaluate((element) => (element as HTMLButtonElement).click())

  const presets = page.locator('[data-action="settings-color-theme"]')
  await expect(presets).toBeVisible({ timeout: 15_000 })
  const expected = ["#0066cc", "#237f72", "#a8631f", "#c4513d"]
  const buttons = presets.locator("[data-theme-preset]")
  await expect
    .poll(() =>
      buttons.evaluateAll((items) =>
        items.map((item) => (item as HTMLElement).style.getPropertyValue("--theme-swatch")),
      ),
    )
    .toEqual(expected)
  await expect(buttons).toHaveCount(expected.length)
  const amber = presets.locator('[data-theme-preset="gruvbox"]')
  const themeBeforeHover = await page.locator("html").getAttribute("data-theme")
  const accentBeforeHover = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--interactive-base"),
  )
  await expect(amber).toHaveAttribute("title", "Cozy and earthy, with a retro warmth.")
  await amber.hover()
  await page.waitForTimeout(150)
  await expect(page.locator("html")).toHaveAttribute("data-theme", themeBeforeHover!)
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--interactive-base")),
  ).toBe(accentBeforeHover)
  await amber.click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "gruvbox")
  const brandBeforeCustom = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--surface-brand-base"),
  )
  const successBeforeCustom = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--surface-success-base"),
  )

  const custom = presets.locator("[data-theme-custom]")
  const input = presets.locator('input[type="color"]')
  await custom.click()
  const customAccent = "#aa44cc"
  await input.evaluate((element, value) => {
    const color = element as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(color, value)
    color.dispatchEvent(new Event("input", { bubbles: true }))
    color.dispatchEvent(new Event("change", { bubbles: true }))
  }, customAccent)
  await expect(custom).toHaveAttribute("aria-pressed", "true")
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("novaway-theme-custom-interactive")))
    .toBe(customAccent)
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--interactive-base")))
    .not.toBe(accentBeforeHover)
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--surface-brand-base")),
  ).toBe(brandBeforeCustom)
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--surface-success-base")),
  ).toBe(successBeforeCustom)

  const customAccentAfterChange = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--interactive-base"),
  )
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "gruvbox")
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--interactive-base")))
    .toBe(customAccentAfterChange)
  await expect(sidebar).toBeVisible({ timeout: 15_000 })
  await sidebar
    .locator('[data-action="rail-menu-trigger"]')
    .evaluate((element) => (element as HTMLButtonElement).click())
  const openSettingsAgain = page.locator('[data-action="rail-menu-open-settings"]')
  await expect(openSettingsAgain).toBeVisible()
  await openSettingsAgain.evaluate((element) => (element as HTMLButtonElement).click())
  await expect(presets.locator("[data-theme-custom]")).toHaveAttribute("aria-pressed", "true")

  await presets.locator('[data-theme-preset="novaway"]').click()
  await expect(custom).toHaveAttribute("aria-pressed", "false")
  await expect.poll(() => page.evaluate(() => localStorage.getItem("novaway-theme-custom-interactive"))).toBeNull()
})

test("Arena workspace follows light and dark themes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => localStorage.setItem("novaway-color-scheme", "light"))
  await page.goto(`/${workspaceRootSlug()}/session`)
  const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
  await expect(sidebar).toBeVisible({ timeout: 15_000 })
  await sidebar.getByRole("button", { name: "Arena", exact: true }).click()

  const workspace = page.locator('section[data-panel-transition][data-state="open"][aria-label="Arena"]')
  await expect(workspace).toBeVisible({ timeout: 15_000 })
  const light = await workspace.evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, foreground: style.color }
  })

  await toggleTheme(page)
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  await page.waitForTimeout(3_500)
  const dark = await workspace.evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, foreground: style.color }
  })
  expect(dark.background).not.toBe(light.background)
  expect(dark.foreground).not.toBe(light.foreground)
})

test("Browser, Terminal, and Review Side Pane tools use themed content surfaces", async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => localStorage.setItem("novaway-color-scheme", "light"))
  await page.goto(`/${workspaceRootSlug()}/session`)
  await expect(page.locator('[data-component="workspace-header"]')).toBeVisible({ timeout: 15_000 })

  const frame = page.locator('[data-component="side-pane-frame"]')
  await expect(frame.locator('[data-component="side-pane-empty"]')).toBeVisible()
  const readSurface = (surface: ReturnType<typeof page.locator>) =>
    surface.evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        background: style.backgroundColor,
        foreground: style.color,
        textColors: Array.from(node.querySelectorAll<HTMLElement>("*"))
          .filter((child) => {
            const rect = child.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 && (child.textContent?.trim().length ?? 0) > 0
          })
          .map((child) => getComputedStyle(child).color)
          .sort(),
      }
    })
  const selectTool = async (label: string, initial = false) => {
    if (initial) {
      await frame.locator('[data-component="side-pane-empty"]').getByRole("button", { name: label }).click()
    } else {
      await frame.getByRole("button", { name: "Add panel tab" }).click()
      const menu = page.getByRole("menu").last()
      await expect(menu).toBeVisible()
      await menu.getByRole("menuitem", { name: label, exact: true }).click()
    }
    const pane = frame.locator(".side-pane-content").first()
    await expect(pane).toBeVisible()
    await expect(frame.locator("[data-component='side-pane-empty']")).toHaveCount(0)
    return pane
  }

  for (const [index, label] of ["Browser", "Terminal", "Review"].entries()) {
    const pane = await selectTool(label, index === 0)
    await page.waitForTimeout(250)
    const light = await readSurface(pane)
    await toggleTheme(page)
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
    await page.waitForTimeout(3_500)
    const dark = await readSurface(pane)
    expect(dark.foreground, `${label} surface foreground`).not.toBe(light.foreground)
    if (light.textColors.length > 0 || dark.textColors.length > 0) {
      expect(dark.textColors, `${label} visible text colors`).not.toEqual(light.textColors)
    }
    await dismissTransientErrors(page)
    await toggleTheme(page)
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
    await page.waitForTimeout(3_500)
  }
})
