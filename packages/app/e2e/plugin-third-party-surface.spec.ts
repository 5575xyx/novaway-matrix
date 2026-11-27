import { expect, test } from "@playwright/test"

const directory = process.env.SURFACE_E2E_DIRECTORY ?? ""
const slug = Buffer.from(directory, "utf8")
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "")
const backend = () => `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4220"}`

function rendererMessages(sessionID: string) {
  const created = Date.now()
  const userID = `surface-user-${created}`
  const assistantID = `surface-assistant-${created}`
  return [
    {
      info: {
        id: userID,
        sessionID,
        role: "user",
        time: { created },
        agent: "build",
        model: { providerID: "fixture", modelID: "fixture" },
      },
      parts: [{ id: `surface-text-${created}`, sessionID, messageID: userID, type: "text", text: "Render fixture" }],
    },
    {
      info: {
        id: assistantID,
        sessionID,
        role: "assistant",
        time: { created, completed: created + 1 },
        parentID: userID,
        modelID: "fixture",
        providerID: "fixture",
        mode: "build",
        agent: "build",
        path: { cwd: directory, root: directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        {
          id: `surface-tool-${created}`,
          sessionID,
          messageID: assistantID,
          type: "tool",
          callID: `surface-call-${created}`,
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "printf surface-renderer" },
            output: "surface-renderer",
            title: "surface renderer",
            metadata: {},
            time: { start: created, end: created + 1 },
          },
        },
      ],
    },
  ]
}

test.skip(!directory, "SURFACE_E2E_DIRECTORY is not configured")

test("third-party Surface complete Chromium golden path", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(
    ({ directory }) => {
      const value = JSON.stringify({
        list: [],
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: {},
      })
      localStorage.setItem("novaway.global.dat:server", value)
      localStorage.setItem("novaway.global.dat:server.v3", value)
    },
    { directory },
  )
  await page.route("https://example.test/surface-e2e.html", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<button id="refresh" onclick="parent.postMessage({type:'novaway.plugin.action',pluginID:'surface-e2e',command:'refresh'},'*')">Refresh</button>`,
    }),
  )
  await page.goto(`/${slug}/session`)
  const sidebar = page.locator('[data-component="sidebar-rail-item"][aria-label="Third-party Dashboard"]').first()
  await expect(sidebar).toBeVisible({ timeout: 20_000 })
  await page.route("https://example.test/surface-preview.html", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<div id="preview">Third-party preview</div>`,
    }),
  )
  await page.route("https://example.test/surface-renderer.html", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<div id="renderer">Third-party renderer</div>`,
    }),
  )
  const listed = await page.request.get(`${backend()}/plugin`, {
    headers: { "x-novaway-directory": directory },
  })
  expect(listed.status()).toBe(200)
  const pluginInfo = (await listed.json()).instances.find((item: { id: string }) => item.id === "surface-e2e")
  expect(pluginInfo.status).toBe("installed")
  expect(pluginInfo.runtimeStatus).toBe("active")
  await sidebar.click()
  const iframe = page.locator('[data-component="plugin-surface-view"] iframe')
  await expect(iframe).toBeVisible({ timeout: 15_000 })
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts")
  await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer")
  await expect(iframe.contentFrame().locator("#refresh")).toBeVisible()

  await page.goto(`/${slug}/session`)
  await page.getByRole("button", { name: "Workspace files", exact: true }).click()
  const fixtureFile = page.locator('[role="treeitem"]').filter({ hasText: "surface-e2e.surface-e2e" }).first()
  await expect(fixtureFile).toBeVisible({ timeout: 15_000 })
  await fixtureFile.click({ force: true })
  const previewer = page.locator('[data-slot="plugin-file-previewer"][data-previewer-id="surface"]')
  await expect(previewer).toBeVisible({ timeout: 15_000 })
  await expect(previewer.locator("iframe").contentFrame().locator("#preview")).toBeVisible()

  await page.goto(`/${slug}/session`)
  const panel = page.locator('[data-plugin-slot="session.panel"]')
  await expect(panel).toContainText("Refresh third-party")
  await panel.getByRole("button", { name: "Refresh third-party" }).click()
  await expect(page.locator('[contenteditable="true"]').first()).toContainText("/refresh")

  const settings = page.locator('button[aria-label="Settings"]:visible').last()
  await expect(settings).toBeVisible({ timeout: 15_000 })
  await settings.click()
  await page.locator('[data-action="rail-menu-open-settings"]').click()
  const pluginsTab = page.getByRole("tab", { name: /Plugins|插件/i })
  await expect(pluginsTab).toBeVisible({ timeout: 10_000 })
  await pluginsTab.click()
  await expect(page.getByText("Plugin settings", { exact: true })).toBeVisible({ timeout: 15_000 })
  await page.getByLabel("Token", { exact: true }).fill("plain-text-token")
  await expect
    .poll(async () => {
      const response = await page.request.get(`${backend()}/config`, {
        headers: { "x-novaway-directory": directory },
      })
      const body = await response.json()
      return body.plugins?.config?.["surface-e2e"]?.token
    })
    .toBe("plain-text-token")
  await page.reload()
  const settingsAfterReload = page.locator('button[aria-label="Settings"]:visible').last()
  await expect(settingsAfterReload).toBeVisible({ timeout: 15_000 })
  await settingsAfterReload.click()
  await page.locator('[data-action="rail-menu-open-settings"]').click()
  const pluginsTabAfterReload = page.getByRole("tab", { name: /Plugins|插件/i })
  await expect(pluginsTabAfterReload).toBeVisible({ timeout: 15_000 })
  await pluginsTabAfterReload.click()
  await expect(page.getByLabel("Token", { exact: true })).toHaveValue("plain-text-token")

  const session = await page.request.post(`${backend()}/session`, {
    headers: { "x-novaway-directory": directory },
    data: { title: "Surface renderer fixture" },
  })
  expect(session.status()).toBe(200)
  const sessionBody = await session.json()
  const sessionID = sessionBody.id ?? sessionBody.data?.id
  expect(typeof sessionID).toBe("string")
  await page.route(`**/session/${sessionID}/message**`, async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rendererMessages(sessionID)),
    })
  })
  await page.goto(`/${slug}/session/${sessionID}`)
  await expect(page.locator("iframe").contentFrame().locator("#renderer")).toBeVisible({ timeout: 20_000 })

  const disableStarted = performance.now()
  const disabled = await page.request.patch(`${backend()}/plugin/surface-e2e`, {
    headers: { "x-novaway-directory": directory },
    data: { enabled: false, scope: "project" },
  })
  expect(disabled.status()).toBe(200)
  await expect(sidebar).toHaveCount(0, { timeout: 20_000 })
  await expect(page.locator('[data-plugin-slot="session.panel"]')).toHaveCount(0)
  expect(performance.now() - disableStarted).toBeLessThan(300)
})
