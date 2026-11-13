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

test.use({ channel: "chrome", video: "off", trace: "off" })
test("major workspace pages retain themed surfaces in light and dark modes", async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const slug = workspaceRootSlug()
  await page.goto(`/${slug}/session`)
  await expect(page.locator('[data-component="workspace-header"]')).toBeVisible({ timeout: 15_000 })
  const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
  const themeToggle = sidebar.getByRole("button", { name: /^(Dark mode|Light mode)$/ }).first()
  if ((await page.locator("html").getAttribute("data-color-scheme")) !== "light") {
    await themeToggle.click()
    await page.waitForTimeout(3_500)
  }
  const canvas = page.locator('[data-component="conv-frame"]')
  const readCanvasBackground = () => canvas.evaluate((element) => getComputedStyle(element).backgroundColor)
  const sessionLight = await readCanvasBackground()
  await page.screenshot({ path: testInfo.outputPath("session-light.png") })
  await themeToggle.click()
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
    { name: "Extensions", button: "Extensions" },
    { name: "Kernel", button: "Kernel" },
    { name: "Operations", button: "Operations" },
    { name: "Scheduled tasks", button: "Scheduled tasks" },
  ]

  for (const [index, item] of pages.entries()) {
    await page.goto(`/${slug}/session`)
    await expect(page.locator('[data-component="sidebar-nav-desktop"]')).toBeVisible({ timeout: 15_000 })
    const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
    const toggle = sidebar.getByRole("button", { name: /^(Dark mode|Light mode)$/ }).first()
    if ((await page.locator("html").getAttribute("data-color-scheme")) !== "light") {
      await toggle.click()
      await page.waitForTimeout(3_500)
    }
    await sidebar.getByRole("button", { name: item.button, exact: true }).first().click()
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

    await toggle.click()
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
  const themeToggle = page
    .locator('[data-component="sidebar-nav-desktop"]')
    .getByRole("button", { name: /^(Dark mode|Light mode)$/ })
    .first()
  const lightFrame = await readPaint(frame)

  await frame.locator('[data-component="side-pane-launcher-workspace-tree"]').click()
  const tree = frame.locator('[data-component="side-pane-file-tree"]')
  await expect(tree).toBeVisible()
  const lightTree = await readPaint(tree)
  await dismissTransientErrors(page)

  await themeToggle.click()
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

  const toggle = page
    .locator('[data-component="sidebar-nav-desktop"]')
    .getByRole("button", { name: /^(Dark mode|Light mode)$/ })
    .first()
  await toggle.click()
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
  await sidebar.getByRole("button", { name: "Settings", exact: true }).first().click()

  const presets = page.locator('[data-action="settings-color-theme"]')
  await expect(presets).toBeVisible({ timeout: 15_000 })
  const expected = ["#0066cc", "#855c0d", "#1faa90", "#076678", "#EC5B2B"]
  const buttons = presets.locator("[data-theme-preset]")
  await expect
    .poll(() =>
      buttons.evaluateAll((items) =>
        items.map((item) => (item as HTMLElement).style.getPropertyValue("--theme-swatch")),
      ),
    )
    .toEqual(expected)
  await expect(buttons).toHaveCount(expected.length)
  const parchment = presets.locator('[data-theme-preset="parchment"]')
  const themeBeforeHover = await page.locator("html").getAttribute("data-theme")
  const accentBeforeHover = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--interactive-base"),
  )
  await expect(parchment).toHaveAttribute("title", "Warm and gentle, for a relaxed pace.")
  await parchment.hover()
  await page.waitForTimeout(150)
  await expect(page.locator("html")).toHaveAttribute("data-theme", themeBeforeHover!)
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--interactive-base")),
  ).toBe(accentBeforeHover)
  await parchment.click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "parchment")
  const brandBeforeCustom = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--surface-brand-base"),
  )
  const successBeforeCustom = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--surface-success-base"),
  )

  const custom = presets.locator("[data-theme-custom]")
  const input = presets.locator('input[type="color"]')
  await input.evaluate((element) => {
    Object.defineProperty(element, "showPicker", {
      configurable: true,
      value: () => element.setAttribute("data-picker-opened", "true"),
    })
  })
  await custom.click()
  await expect(input).toHaveAttribute("data-picker-opened", "true")
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
  await expect(page.locator("html")).toHaveAttribute("data-theme", "parchment")
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--interactive-base")))
    .toBe(customAccentAfterChange)
  await expect(sidebar).toBeVisible({ timeout: 15_000 })
  await sidebar.getByRole("button", { name: "Settings", exact: true }).first().click()
  await expect(presets.locator("[data-theme-custom]")).toHaveAttribute("aria-pressed", "true")

  await presets.locator('[data-theme-preset="novaway"]').click()
  await expect(custom).toHaveAttribute("aria-pressed", "false")
  await expect.poll(() => page.evaluate(() => localStorage.getItem("novaway-theme-custom-interactive"))).toBeNull()
})

test("Operations workspace columns and account dialog follow light and dark themes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => localStorage.setItem("novaway-color-scheme", "light"))
  await page.goto(`/${workspaceRootSlug()}/session`)
  const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
  await expect(sidebar).toBeVisible({ timeout: 15_000 })
  await sidebar.getByRole("button", { name: "Operations", exact: true }).click()

  const workspace = page.locator('section[aria-label="Operations workspace"]')
  await expect(workspace).toBeVisible({ timeout: 15_000 })
  const readPaint = (element: ReturnType<typeof page.locator>) =>
    element.evaluate((node) => {
      const style = getComputedStyle(node)
      return { background: style.backgroundColor, foreground: style.color, border: style.borderColor }
    })
  const chatColumn = workspace.locator("[data-slot='pulse-chat-column']")
  const lightWorkspace = await readPaint(workspace)
  const lightChat = await readPaint(chatColumn)
  const lightAccountManager = workspace.getByRole("button", { name: "账号管理器", exact: true })
  await lightAccountManager.click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  const lightDialog = await readPaint(dialog)
  await page.keyboard.press("Escape")

  const toggle = sidebar.getByRole("button", { name: /^(Dark mode|Light mode)$/ }).first()
  await toggle.click()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  await page.waitForTimeout(3_500)
  const darkWorkspace = await readPaint(workspace)
  const darkChat = await readPaint(chatColumn)
  expect(darkWorkspace.background).not.toBe(lightWorkspace.background)
  expect(darkWorkspace.foreground).not.toBe(lightWorkspace.foreground)
  expect(darkChat.background).not.toBe(lightChat.background)
  expect(darkChat.border).not.toBe(lightChat.border)

  await workspace.getByRole("button", { name: "账号管理器", exact: true }).click()
  const darkDialog = page.getByRole("dialog")
  await expect(darkDialog).toBeVisible()
  const dark = await readPaint(darkDialog)
  expect(dark.background).not.toBe(lightDialog.background)
  expect(dark.foreground).not.toBe(lightDialog.foreground)
  await expect(darkDialog.getByRole("button").first()).toBeVisible()
  await page.keyboard.press("Escape")

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(workspace).toBeVisible()
  const chatToggle = workspace.getByRole("button", { name: "Show/hide chat", exact: true })
  await expect(chatToggle).toBeVisible()
  await chatToggle.click()
  await expect(chatColumn).toBeHidden()
  await chatToggle.click()
  await expect(chatColumn).toBeVisible()
  const mobileDark = await readPaint(workspace)
  const mobileDarkChat = await readPaint(chatColumn)

  await page.setViewportSize({ width: 1440, height: 900 })
  await workspace.getByRole("button", { name: "Back", exact: true }).click()
  await expect(workspace).toHaveAttribute("data-state", "closed")
  await toggle.click()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  await page.waitForTimeout(3_500)
  await sidebar.getByRole("button", { name: "Operations", exact: true }).click()
  await expect(workspace).toBeVisible()
  await workspace.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)))
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileLight = await readPaint(workspace)
  const mobileLightChat = await readPaint(chatColumn)
  expect(mobileDark.background).not.toBe(mobileLight.background)
  expect(mobileDark.foreground).not.toBe(mobileLight.foreground)
  expect(mobileDarkChat.background).not.toBe(mobileLightChat.background)
  expect(mobileDarkChat.border).not.toBe(mobileLightChat.border)
})

test("Browser, Terminal, and Review Side Pane tools use themed content surfaces", async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => localStorage.setItem("novaway-color-scheme", "light"))
  await page.goto(`/${workspaceRootSlug()}/session`)
  await expect(page.locator('[data-component="workspace-header"]')).toBeVisible({ timeout: 15_000 })

  const frame = page.locator('[data-component="side-pane-frame"]')
  await expect(frame.locator('[data-component="side-pane-empty"]')).toBeVisible()
  const themeToggle = page
    .locator('[data-component="sidebar-nav-desktop"]')
    .getByRole("button", { name: /^(Dark mode|Light mode)$/ })
    .first()
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
    await themeToggle.click()
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
    await page.waitForTimeout(3_500)
    const dark = await readSurface(pane)
    expect(dark.foreground, `${label} surface foreground`).not.toBe(light.foreground)
    expect(dark.textColors, `${label} visible text colors`).not.toEqual(light.textColors)
    await dismissTransientErrors(page)
    await themeToggle.click()
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
    await page.waitForTimeout(3_500)
  }
})
