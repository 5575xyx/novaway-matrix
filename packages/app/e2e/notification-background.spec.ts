import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

test.use({ video: "off", trace: "off" })
test.describe.configure({ timeout: 120_000 })

function workspaceRootSlug() {
  return Buffer.from(resolve(process.cwd(), "..", ".."), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

const states = ["done", "partial", "failed", "needs_review", "blocked"] as const

function runView(id: string, state: string, directory: string) {
  const now = Date.now()
  return {
    id,
    sessionID: `session-${id}`,
    directory,
    mode: "auto",
    goal: `后台任务 ${state}`,
    state,
    phase: null,
    planVersion: 0,
    roundMain: 0,
    attempts: { business: 0, formatRetry: 0 },
    createdAt: now - 10_000,
    updatedAt: now,
    readOnly: true,
    mergeState: "unmerged",
  }
}

test("后台任务状态变化在离开任务页面后持久化通知并按状态去重", async ({ page }) => {
  const directory = resolve(process.cwd(), "..", "..")
  let listCalls = 0
  await page.route("**/*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === "/run" && request.method() === "GET") {
      listCalls += 1
      const state = listCalls <= 3 ? "running" : "terminal"
      const runs = states.map((item) => runView(`run-notification-${item}`, state === "running" ? "running" : item, directory))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(runs) })
    }
    return route.continue()
  })

  await page.addInitScript(() => localStorage.clear())
  await page.goto(`/${workspaceRootSlug()}/session`, { waitUntil: "domcontentloaded", timeout: 60_000 })

  await expect.poll(() => listCalls, { timeout: 30_000 }).toBeGreaterThan(0)
  await expect
    .poll(
      async () => {
        const values = await page.evaluate(() => Object.values(localStorage))
        return values.some((value) => value.includes("run-notification-done"))
      },
      { timeout: 30_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true)

  // Navigate away from the task route without reloading the layout-level provider.
  await page.evaluate(() => history.pushState({}, "", "/"))
  await page.waitForTimeout(6_000)
  const persisted = await page.evaluate(() => Object.values(localStorage).join("\n"))
  for (const state of states) expect(persisted).toContain(`run-notification-${state}`)

  // The same terminal state is returned repeatedly; each run remains represented once.
  const notificationStore = await page.evaluate(() =>
    Object.values(localStorage).find((value) => value.includes("run-notification-done")) ?? "",
  )
  const parsedStore = JSON.parse(notificationStore) as { list?: Array<{ runID?: string }> }
  for (const state of states) {
    const matches = parsedStore.list?.filter((item) => item.runID === `run-notification-${state}`) ?? []
    expect(matches.length).toBe(1)
  }
})
