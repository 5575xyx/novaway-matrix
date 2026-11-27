import { expect, test } from "@playwright/test"

test.describe.configure({ timeout: 120_000 })

const mockServer = "http://127.0.0.1:4474"
const active = "/startup-primary"
const other = "/startup-other"
const slug = Buffer.from(active).toString("base64url")
const primary = "ses_startup_primary"
const next = "ses_startup_next"
const now = Date.now()
const row = (id: string, title: string, directory = active) => ({
  id,
  title,
  directory,
  projectID: directory.substring(1),
  version: "test",
  slug: id,
  time: { created: now, updated: now },
})
const rows = [row(primary, "Startup first task"), row(next, "Startup second task")]

function barrier() {
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { release, wait }
}

test("first-screen lists and messages beat warmups; navigation and cached rows do not wait", async ({ page }) => {
  const list = barrier()
  const messages = barrier()
  const provider = barrier()
  const refresh = barrier()
  const librarySwitch = barrier()
  const sessionModule = barrier()
  let sessionModuleRequests = 0
  const calls: Array<{ path: string; directory: string }> = []
  let reloading = false
  let library = "primary-library"
  await page.addInitScript(
    ({ mockServer, active, other }) => {
      localStorage.setItem("novaway.settings.dat:defaultServerUrl", mockServer)
      localStorage.setItem(
        "novaway.global.dat:server",
        JSON.stringify({
          list: [{ type: "http", http: { url: mockServer } }],
          projects: {
            local: [
              { worktree: active, expanded: true },
              { worktree: other, expanded: true },
            ],
          },
        }),
      )
    },
    { mockServer, active, other },
  )
  await page.route("**/src/pages/session.tsx*", async (route) => {
    sessionModuleRequests++
    await sessionModule.wait
    await route.continue()
  })
  await page.route(`${mockServer}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const directory = url.searchParams.get("directory") ?? request.headers()["x-novaway-directory"] ?? ""
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": request.headers()["access-control-request-headers"] ?? "*",
    }
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors })
    calls.push({ path, directory })
    if (path === "/global/event")
      return route.fulfill({ headers: cors, contentType: "text/event-stream", body: ": mock\n\n" })
    const fulfill = (json: unknown) => route.fulfill({ headers: cors, json })
    if (path === "/global/health")
      return fulfill({ healthy: true, version: "0.0.0-startup-test-202611250001", sessionLibrary: library })
    if (path === "/project" || path === "/project/current") {
      const projects = [active, other].map((worktree) => ({
        id: worktree.substring(1),
        worktree,
        sandboxes: [],
        icon: { color: "blue" },
        time: { created: now, updated: now },
      }))
      return fulfill(path === "/project" ? projects : projects[0])
    }
    if (path === "/path")
      return fulfill({
        home: "/",
        config: "/",
        state: "/",
        worktree: directory || active,
        directory: directory || active,
      })
    if (path === "/session" && directory === active) {
      await (library !== "primary-library" ? librarySwitch.wait : reloading ? refresh.wait : list.wait)
      return fulfill(reloading ? [] : rows)
    }
    if (path === `/session/${primary}`) return fulfill(rows[0])
    if (path === `/session/${next}`) return fulfill(rows[1])
    if (path === `/session/${primary}/message`) {
      if (!reloading) await messages.wait
      const message = "msg_startup_primary"
      return fulfill([
        {
          info: {
            id: message,
            sessionID: primary,
            role: "user",
            agent: "build",
            time: { created: now },
            model: { providerID: "test", modelID: "test" },
          },
          parts: [
            {
              id: "prt_startup_primary",
              sessionID: primary,
              messageID: message,
              type: "text",
              text: "First message page is ready",
            },
          ],
        },
      ])
    }
    if (/^\/session\/[^/]+\/team$/.test(path)) return fulfill({ members: [], tasks: [] })
    if (path === "/git") return route.fulfill({ status: 404, headers: cors, json: { message: "Not a git repository" } })
    if (path === "/api/fs/find") return fulfill({ data: [] })
    if (path === "/provider") {
      await provider.wait
      return fulfill({ all: [], connected: [], default: {} })
    }
    if (["/config", "/global/config", "/mcp", "/session/status", "/vcs"].includes(path)) return fulfill({})
    return fulfill([])
  })

  const called = (path: string, directory?: string) =>
    calls.filter((call) => call.path === path && (!directory || call.directory === directory)).length
  const firstRow = page
    .locator('[data-component="sidebar-nav-desktop"] [data-component="task-row"]')
    .filter({ hasText: "Startup first task" })
  const nextRow = page
    .locator('[data-component="sidebar-nav-desktop"] [data-component="task-row"]')
    .filter({ hasText: "Startup second task" })
  try {
    await page.goto(`/${slug}/session/${primary}`, { waitUntil: "domcontentloaded" })
    await expect(page.locator('[data-component="route-loading"]')).toBeVisible({ timeout: 30_000 })
    expect(sessionModuleRequests).toBeGreaterThan(0)
    sessionModule.release()
    await expect.poll(() => called("/session", active), { timeout: 40_000 }).toBe(1)
    await expect.poll(() => called(`/session/${primary}/message`)).toBe(1)
    expect(called("/provider")).toBe(0)
    expect(called("/session", other)).toBe(0)
    expect(called("/experimental/session")).toBe(0)
    expect(called("/api/fs/find")).toBe(0)

    list.release()
    await expect(firstRow).toBeVisible()
    expect(called("/provider")).toBe(0)
    expect(called("/agent")).toBe(0)
    messages.release()
    await expect(page.getByText("First message page is ready", { exact: true })).toBeVisible({ timeout: 25_000 })
    await expect.poll(() => called("/provider"), { timeout: 20_000 }).toBe(1)
    await expect.poll(() => called("/api/fs/find", active), { timeout: 20_000 }).toBe(1)
    const sidebar = page.locator('[data-component="sidebar-nav-desktop"]')
    await sidebar.locator('[data-action="rail-menu-trigger"]').click()
    await page.getByRole("button", { name: "Open settings", exact: true }).click()
    await expect(page.locator('section[aria-label="Open settings"]')).toBeVisible()
    await nextRow.click()
    await expect(page).toHaveURL(new RegExp(`/session/${next}$`))
    await expect.poll(() => called(`/session/${next}/message`)).toBeGreaterThan(0)

    reloading = true
    library = "different-library-same-server"
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect.poll(() => called("/session", active)).toBe(2)
    await expect(
      page.locator('[data-component="sidebar-nav-desktop"]').getByRole("button", { name: "startup-primary" }),
    ).toBeVisible()
    await expect(firstRow).toHaveCount(0)
    // One session's metadata and messages do not make a cold workspace list usable.
    await expect(page.getByRole("heading", { name: "Startup second task", exact: true })).toBeVisible()
    expect(called("/provider")).toBe(1)
    librarySwitch.release()

    library = "primary-library"
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect.poll(() => called("/session", active)).toBe(3)
    await expect(firstRow).toBeVisible()
    refresh.release()
    await expect(firstRow).toHaveCount(0)
  } finally {
    list.release()
    messages.release()
    provider.release()
    refresh.release()
    librarySwitch.release()
    sessionModule.release()
  }
})
