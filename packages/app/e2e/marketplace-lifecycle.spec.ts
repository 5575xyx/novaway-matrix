import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

const directory = resolve(process.cwd(), "..", "..")
const workspaceSlug = () =>
  Buffer.from(directory, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const entry = {
  packageId: "com.novaway.browser-marketplace-smoke",
  name: "Browser Marketplace Smoke",
  version: "0.1.0",
  description: "Browser lifecycle fixture",
  url: "https://example.test/browser-marketplace-smoke.zip",
  kind: "zip",
  sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  runtimeTargets: ["novaway-v2"],
  capabilities: ["skills"],
  permissions: ["filesystem.read"],
  categories: ["testing"],
  longDescription:
    "A controlled browser fixture with explicit permission metadata and a deliberately long description for layout verification. ".repeat(
      24,
    ),
}

async function openMarketplace(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    localStorage.setItem("novaway-theme-id", "novaway")
    localStorage.setItem("novaway-color-scheme", "light")
  })
  await page.goto(`/${workspaceSlug()}/session`)
  const extensions = page
    .locator(
      '[data-component="sidebar-rail-item"][aria-label="Extensions"]:visible, [data-component="sidebar-rail-item"][aria-label="扩展"]:visible',
    )
    .last()
  await expect(extensions).toBeVisible({ timeout: 15_000 })
  await extensions.click()
  await expect(page.getByText(/Extensions|扩展/).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-component="marketplace-hero"]')).toBeVisible()
  expect(
    await page
      .locator('[data-component="marketplace-hero"] h1')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(28)
  for (const width of [1440, 768]) {
    await page.setViewportSize({ width, height: 900 })
    const header = page.locator('[data-component="extensions-header"]')
    await expect(header).toBeVisible()
    const navigation = page.locator('nav[aria-label="Extension navigation"], nav[aria-label="扩展导航"]').first()
    await expect(navigation).toBeVisible()
    expect(
      await navigation.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.left + bounds.width
      }),
    ).toBeLessThan(520)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({
    path: test.info().outputPath("market-discovery.png"),
    fullPage: true,
    animations: "disabled",
  })
  await expect(page.locator("#market-source-panel")).toHaveCount(0)
  await page.getByRole("button", { name: /Marketplace sources|市场源/ }).click()
  await expect(page.locator("#market-source-panel")).toBeVisible()
}

test("marketplace browser lifecycle covers discovery, source management, install, update and uninstall", async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  let installed = false
  let sourceEnabled = true
  let sourceName = "NovaWay Official"
  const customSources: Array<{
    id: string
    name: string
    type: "claude" | "zcode" | "auto"
    url: string
    enabled: boolean
    lastError?: string
  }> = []
  let operationNumber = 0
  let operationPolls = 0
  let failNextInstall = false
  let catalogErrorNext = false
  let extensionEnabled = true
  let failSourceRefreshNext = false
  const operations: Array<Record<string, unknown>> = []
  const operation = (operationType: string, phase = "completed") => {
    operationNumber += 1
    const value = {
      operationId: `browser-operation-${operationNumber}`,
      operationType,
      packageId: entry.packageId,
      phase,
      installationStatus: phase === "completed" && operationType === "uninstall" ? "absent" : "installed",
      activationStatus: phase === "completed" && operationType === "uninstall" ? "disabled" : "active",
      consumerStatus: phase === "completed" && operationType === "uninstall" ? "undiscovered" : "usable",
      cleanupStatus: phase === "completed" ? "completed" : "pending",
      disposeStatus: phase === "completed" ? "completed" : "pending",
      requiresRestart: false,
      progress: phase === "completed" ? 100 : 40,
      startedAt: Date.now(),
      ...(phase === "completed" ? { finishedAt: Date.now() } : {}),
      ...(phase === "failed"
        ? { errorCode: "MARKETPLACE_OPERATION_FAILED", recoveryHint: "Retry the installation." }
        : {}),
    }
    operations.push(value)
    return value
  }
  const installedRecord = () => ({
    ...entry,
    name: entry.packageId,
    version: installed ? "0.1.0" : undefined,
    source: entry.url,
    installedAt: Date.now(),
    root: `/isolated/marketplace/${entry.packageId}@0.1.0`,
    files: 4,
    bytes: 1878,
    previous:
      installed && operations.some((item) => item.operationType === "update")
        ? { version: "0.1.0", source: entry.url, installedAt: Date.now() - 1_000, files: 4, bytes: 1878 }
        : undefined,
  })

  await page.route(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\//, async (route) => {
    const url = new URL(route.request().url())
    if (url.port === (process.env.PLAYWRIGHT_PORT ?? "3210")) return route.fallback()
    const path = url.pathname
    const project = { id: "market-test", worktree: directory, time: { created: 0, updated: 0 }, sandboxes: [] }
    const responses: Record<string, unknown> = {
      "/global/health": { healthy: true, version: "test" },
      "/global/config": {},
      "/config": {},
      "/path": { directory, worktree: directory, home: directory, config: directory, state: directory },
      "/project": [project],
      "/project/current": project,
      "/provider": { all: [], connected: [], default: {} },
      "/provider/auth": {},
      "/mcp": {},
      "/session/status": {},
      "/vcs": { branch: "test" },
      "/git": {
        changes: [],
        log: [],
        branches: [],
        branch: { branch: "test", ahead: 0, behind: 0 },
        remotes: [],
        stashes: [],
      },
    }
    if (path.endsWith("/event")) {
      return route.fulfill({ contentType: "text/event-stream", body: ": fixture\n\n" })
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(responses[path] ?? []) })
  })

  await page.route("**/extension/marketplace**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

    if (pathname.endsWith("/extension/marketplace") && request.method() === "GET") {
      const errors = catalogErrorNext ? ["offline: showing the last cached catalog"] : []
      catalogErrorNext = false
      await json({
        installed: installed ? [installedRecord()] : [],
        legacy: [],
        sources: [
          {
            id: "novaway-official",
            name: sourceName,
            type: "novaway",
            url: "https://example.test/catalog.json",
            enabled: sourceEnabled,
            trust: "official",
            builtin: true,
            createdAt: 0,
            updatedAt: 0,
          },
          ...customSources.map((source) => ({
            ...source,
            trust: "unverified" as const,
            builtin: false,
            createdAt: 1,
            updatedAt: 1,
          })),
        ],
        novaway: [{ ...entry, version: installed ? "0.2.0" : entry.version }],
        zcode: [],
        claude: [],
        updates: installed ? [{ name: entry.packageId, state: "outdated", available: "0.2.0" }] : [],
        errors,
      })
      return
    }
    if (pathname.endsWith("/extension/marketplace/operations") && request.method() === "GET") {
      const pending = operations.find((item) => item.operationType === "install" && item.phase === "staging")
      if (pending) {
        operationPolls += 1
        if (operationPolls >= 2) {
          Object.assign(pending, {
            phase: "completed",
            progress: 100,
            cleanupStatus: "completed",
            disposeStatus: "completed",
            finishedAt: Date.now(),
          })
        }
      }
      await json(operations)
      return
    }
    if (pathname.endsWith("/extension/marketplace/legacy/migrations") && request.method() === "GET") {
      await json([])
      return
    }
    if (pathname.endsWith("/extension/marketplace/install") && request.method() === "POST") {
      if (failNextInstall) {
        failNextInstall = false
        operation("install", "failed")
        await json({ message: "fixture install failed" }, 400)
        return
      }
      const wasInstalled = installed
      installed = true
      const lifecycleOperation = operation(wasInstalled ? "update" : "install", wasInstalled ? "completed" : "staging")
      await json({ ...installedRecord(), operationId: lifecycleOperation.operationId })
      return
    }
    if (pathname.endsWith("/extension/marketplace/sources") && request.method() === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as {
        name?: string
        type?: "claude" | "zcode" | "auto"
        url?: string
      }
      const source = {
        id: `browser-source-${customSources.length + 1}`,
        name: body.name ?? "Browser source",
        type: body.type ?? "auto",
        url: body.url ?? "https://example.test/custom.json",
        enabled: true,
      }
      customSources.push(source)
      await json({ ...source, trust: "unverified", createdAt: 1, updatedAt: 1 })
      return
    }
    if (pathname.includes("/extension/marketplace/sources/") && request.method() === "PATCH") {
      const body = JSON.parse(request.postData() ?? "{}") as {
        enabled?: boolean
        name?: string
        url?: string
        type?: "claude" | "zcode" | "auto"
      }
      const sourceId = pathname.split("/").pop() ?? ""
      if (sourceId === "novaway-official") {
        if (body.enabled !== undefined) sourceEnabled = body.enabled
        if (body.name) sourceName = body.name
        await json({
          id: sourceId,
          name: sourceName,
          type: "novaway",
          url: "https://example.test/catalog.json",
          enabled: sourceEnabled,
          trust: "official",
          builtin: true,
          createdAt: 0,
          updatedAt: 1,
        })
      } else {
        const source = customSources.find((item) => item.id === sourceId)
        if (source) Object.assign(source, body)
        await json({
          ...(source ?? { id: sourceId, name: "missing", type: "auto", url: "", enabled: false }),
          trust: "unverified",
          builtin: false,
          createdAt: 1,
          updatedAt: 1,
        })
      }
      return
    }
    if (pathname.endsWith("/refresh") && request.method() === "POST") {
      const sourceId = pathname.split("/").at(-2) ?? ""
      const source = customSources.find((item) => item.id === sourceId)
      if (failSourceRefreshNext) {
        failSourceRefreshNext = false
        if (source) source.lastError = "preflight failed: invalid catalog fixture"
        await json({ message: "preflight failed" }, 400)
        return
      }
      if (source) delete source.lastError
      await json({
        ...(source ?? {
          id: sourceId,
          name: "refreshed",
          type: "auto",
          url: "https://example.test/custom.json",
          enabled: true,
        }),
        trust: "unverified",
        builtin: false,
        createdAt: 1,
        updatedAt: 2,
      })
      return
    }
    if (pathname.includes("/extension/marketplace/sources/") && request.method() === "DELETE") {
      const sourceId = pathname.split("/").pop() ?? ""
      const index = customSources.findIndex((item) => item.id === sourceId)
      if (index >= 0) customSources.splice(index, 1)
      await json(true)
      return
    }
    if (pathname.endsWith("/update/preview") && request.method() === "POST") {
      await json({
        currentVersion: "0.1.0",
        targetVersion: "0.2.0",
        sourceChanged: false,
        sourceUrlChanged: false,
        permissionsAdded: [],
        permissionsRemoved: [],
        dependenciesAdded: {},
        dependenciesRemoved: [],
        conflictsAdded: [],
        conflictsRemoved: [],
        digestChanged: false,
        requiresConfirmation: false,
      })
      return
    }
    if (pathname.includes(`/extension/marketplace/${entry.packageId}/rollback`) && request.method() === "POST") {
      await json({ ...installedRecord(), operationId: operation("rollback").operationId })
      return
    }
    if (pathname.includes(`/extension/marketplace/${entry.packageId}`) && request.method() === "DELETE") {
      installed = false
      await json(true)
      operation("uninstall")
      return
    }
    await route.continue()
  })
  await page.route(/\/extension(?:\?.*)?$/, async (route) => {
    const request = route.request()
    if (request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            name: entry.packageId,
            version: "0.1.0",
            description: entry.description,
            root: "/isolated/marketplace/com.novaway.browser-marketplace-smoke@0.1.0",
            source: "plugin",
            enabled: extensionEnabled,
          },
        ]),
      })
      return
    }
    if (request.method() === "PATCH") {
      const body = JSON.parse(request.postData() ?? "{}") as { enabled?: boolean }
      extensionEnabled = body.enabled ?? extensionEnabled
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          name: entry.packageId,
          root: "/isolated/marketplace/com.novaway.browser-marketplace-smoke@0.1.0",
          source: "plugin",
          enabled: extensionEnabled,
        }),
      })
      return
    }
    await route.continue()
  })
  await page.route("**/plugin/contributions**", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" }),
  )

  page.on("dialog", (dialog) => void dialog.accept())
  await openMarketplace(page)
  await expect(page.getByText(sourceName, { exact: true })).toBeVisible()
  await expect(page.getByText(entry.name, { exact: true })).toBeVisible()
  await expect(page.locator('[data-component="marketplace-hero"]')).toBeVisible()
  await expect(page.locator('[data-component="marketplace-filters"]')).toBeVisible()
  const initialCard = page.locator('[data-component="market-entry"]').filter({ hasText: entry.name })
  await expect(initialCard).toHaveAttribute("data-market-trust", "verified")
  await page.getByRole("combobox", { name: /^(Source|来源)$/ }).selectOption("novaway-official")
  await expect(page.locator('[data-component="market-entry"][data-market-source="novaway-official"]')).toHaveCount(2)
  await page.getByRole("combobox", { name: /^(Source|来源)$/ }).selectOption("all")

  const sourceNameInput = page.getByRole("textbox", { name: /Source name|名称/i }).first()
  const smokeEntry = page.locator('[data-component="market-entry"]').filter({ hasText: entry.name })
  await smokeEntry.getByRole("button", { name: /Details|详情/ }).click()
  await expect(smokeEntry.locator('[data-component="market-entry-details"]')).toContainText("filesystem.read")
  await expect(smokeEntry.locator('[data-component="market-entry-details"]')).toContainText("novaway-v2")
  expect(
    await smokeEntry
      .locator('[data-component="market-entry-details"]')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)

  const searchInput = page.getByRole("textbox", { name: /Search names|搜索名称/ })
  await searchInput.fill("Browser Marketplace")
  await expect(page.getByText(entry.name, { exact: true })).toBeVisible()
  await expect(page.getByText("ppt-master", { exact: true })).toHaveCount(0)
  await searchInput.fill("")
  await page.getByRole("button", { name: "testing", exact: true }).click()
  await expect(page.getByText(entry.name, { exact: true })).toBeVisible()
  await page.locator('[aria-label="Category"], [aria-label="分类"]').getByRole("button").first().click()
  await searchInput.fill("no-such-plugin")
  await expect(page.getByText(/catalog is empty|目录为空/)).toBeVisible()
  await searchInput.fill("")
  const addSource = async (name: string, type: "auto" | "claude" | "zcode") => {
    await sourceNameInput.fill(name)
    await page.getByRole("combobox", { name: /Source type|源类型/ }).selectOption(type)
    await page.getByRole("textbox", { name: "URL" }).fill(`https://example.test/${type}.json`)
    await page.getByRole("button", { name: /Add source|添加源/ }).click()
    await expect(page.getByText(name, { exact: true })).toBeVisible()
  }
  await addSource("Browser Test Source", "auto")
  await addSource("Claude Test Source", "claude")
  await addSource("ZCode Test Source", "zcode")

  const customSource = page.locator('[data-source-id="browser-source-1"]')
  await customSource.getByRole("button", { name: /Edit|编辑/ }).click()
  await sourceNameInput.fill("Browser Test Source Edited")
  await page.getByRole("textbox", { name: "URL" }).fill("https://example.test/browser-source-edited.json")
  await page.getByRole("button", { name: /Save source|保存源/ }).click()
  await expect(page.getByText("Browser Test Source Edited", { exact: true })).toBeVisible()
  const editedSource = page.locator('[data-source-id="browser-source-1"]')
  await editedSource.getByRole("button", { name: /Disable|停用/ }).click()
  await expect(editedSource).toContainText(/disabled|已停用/)
  await editedSource.getByRole("button", { name: /Enable|启用/ }).click()
  await editedSource.getByRole("button", { name: /Refresh|刷新/ }).click()
  failSourceRefreshNext = true
  await editedSource.getByRole("button", { name: /Refresh|刷新/ }).click()
  await expect(editedSource).toContainText("preflight failed")

  await smokeEntry.getByRole("button", { name: /Install|安装/ }).click()
  await expect(page.locator('[data-component="market-operation-history"]')).not.toHaveAttribute("open", "")
  await page.locator('[data-component="market-operation-history"] summary').click()
  await expect(page.locator('[data-component="market-operation-history"]')).toContainText("staging")
  await expect(page.locator('[data-component="market-operation-history"]')).toContainText("completed")
  await expect(page.getByText(/Installed|已安装/).first()).toBeVisible()

  await page.getByRole("button", { name: /Update|更新/ }).click()
  await expect(page.locator('[data-component="market-operation-history"]')).toContainText("install")
  await expect(smokeEntry.getByRole("button", { name: /Remove|卸载/ })).toBeVisible()
  await smokeEntry.getByRole("button", { name: /Roll back|回滚/ }).click()
  await expect(page.locator('[data-component="market-operation-history"]')).toContainText("rollback")

  await editedSource.getByRole("button", { name: /Remove|删除/ }).click()
  await expect(page.locator('[data-source-id="browser-source-1"]')).toHaveCount(0)
  await expect(smokeEntry.getByRole("button", { name: /Remove|卸载/ })).toBeVisible()
  await smokeEntry.getByRole("button", { name: /Remove|卸载/ }).click()
  await expect(page.locator('[data-component="market-operation-history"]')).toContainText("uninstall")
  await expect(smokeEntry.getByRole("button", { name: /Install|安装/ })).toBeVisible()

  failNextInstall = true
  await smokeEntry.getByRole("button", { name: /Install|安装/ }).click()
  await expect(page.locator('[data-component="market-operation-history"]')).toContainText("failed")
  await expect(page.locator('[data-component="market-operation-history"]')).toContainText("MARKETPLACE")
  await smokeEntry.getByRole("button", { name: /Install|安装/ }).click()
  await expect(page.locator('[data-component="market-operation-history"]')).toContainText("completed")

  catalogErrorNext = true
  await page.getByRole("button", { name: /Refresh catalog|刷新目录/ }).click()
  await expect(page.locator('[data-component="market-catalog-errors"]')).toContainText("offline")
  await expect(page.getByText(entry.name, { exact: true })).toBeVisible()
  await page.getByRole("button", { name: /Marketplace sources|市场源/ }).click()
  await expect(page.locator("#market-source-panel")).toHaveCount(0)
  await searchInput.fill("Browser Marketplace")
  await smokeEntry.getByRole("button", { name: /Details|详情/ }).click()
  await page.locator('[data-component="market-operation-history"] summary').click()
  await searchInput.fill("")
  await searchInput.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath("market-light.png"), fullPage: true })
  await page.evaluate(() => {
    localStorage.setItem("novaway-color-scheme", "dark")
    window.dispatchEvent(new StorageEvent("storage", { key: "novaway-color-scheme", newValue: "dark" }))
  })
  await page.screenshot({ path: test.info().outputPath("market-dark.png"), fullPage: true })
  await page.setViewportSize({ width: 768, height: 900 })
  expect(
    await page
      .locator('[data-component="marketplace"]')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await page.screenshot({ path: test.info().outputPath("market-narrow.png"), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole("button", { name: /^(Installed|已安装)$/ }).click()
  await expect(page.getByText(entry.packageId, { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("installed-dark.png"), fullPage: true })
  const extensionSwitch = page.getByRole("switch", { name: entry.packageId, exact: true })
  const extensionSwitchControl = extensionSwitch.locator("..").locator('[data-slot="switch-control"]')
  await expect(extensionSwitch).toHaveAttribute("aria-checked", "true")
  await extensionSwitchControl.click()
  await expect(extensionSwitch).toHaveAttribute("aria-checked", "false")
  await extensionSwitchControl.click()
  await expect(extensionSwitch).toHaveAttribute("aria-checked", "true")
  await page.getByRole("button", { name: "Marketplace", exact: true }).first().click()
  await searchInput.fill("Browser Marketplace")
  await page.getByRole("button", { name: /^(Installed|已安装)$/ }).click()
  await page.getByRole("button", { name: "Marketplace", exact: true }).first().click()
  await expect(searchInput).toHaveValue("Browser Marketplace")
  expect(pageErrors).toEqual([])
})
