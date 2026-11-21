import { expect, test, type Page } from "@playwright/test"
import { resolve } from "node:path"

/**
 * 设计文档 §6.4 UI 预算：
 * - 启动后首次 `/plugin/contributions` 完成 → rail 项可点 < 500ms；
 * - 停用插件（SSE → 重渲染）→ rail 图标消失 < 300ms。
 *
 * 需要真实 production backend（VITE_NOVAWAY_SERVER_PORT，默认 4096）与内置 `novaway-ui`；
 * 计时在页面内用 `performance.now()` 打点，避免 Playwright 轮询间隔污染测量。
 */
const directory = resolve(process.cwd(), "..", "..")
const workspaceSlug = () =>
  Buffer.from(directory, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const backend = () => `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const rail = (page: Page) => page.locator('[data-component="sidebar-rail-item"][aria-label="NovaWay Home"]').first()

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const marks: Record<string, number> = {}
    ;(window as unknown as { __pluginUiMarks: Record<string, number> }).__pluginUiMarks = marks
    const calls: Array<{ url: string; start: number; end: number }> = []
    ;(window as unknown as { __pluginUiCalls: typeof calls }).__pluginUiCalls = calls
    const original = window.fetch
    window.fetch = async (...args: Parameters<typeof original>) => {
      const url = String(args[0] instanceof Request ? args[0].url : args[0])
      const method = args[0] instanceof Request ? args[0].method : (args[1]?.method ?? "GET")
      const start = performance.now()
      const response = await original(...args)
      calls.push({ url, start, end: performance.now() })
      if (url.includes("/plugin/contributions")) marks.contribEnd ??= performance.now()
      if (url.includes("/plugin/") && method === "PATCH") marks.patchEnd = performance.now()
      if (url.includes("/global/event") && response.body) {
        // 设计文档 §6.4 的停用预算从「SSE 事件到达浏览器」起算；PATCH 往返本身不计入。
        const reader = response.clone().body!.getReader()
        const decoder = new TextDecoder()
        void (async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) return
              if (decoder.decode(value, { stream: true }).includes("plugin.changed"))
                marks.eventAt ??= performance.now()
            }
          } catch {
            // 流被 abort 属正常收尾。
          }
        })()
      }
      return response
    }
    const observer = new MutationObserver(() => {
      const element = document.querySelector('[data-component="sidebar-rail-item"][aria-label="NovaWay Home"]')
      if (element && marks.railAt === undefined) marks.railAt = performance.now()
      if (!element && marks.railAt !== undefined && marks.railGoneAt === undefined) marks.railGoneAt = performance.now()
    })
    observer.observe(document, { childList: true, subtree: true })
  })
}

async function toggle(page: Page, enabled: boolean) {
  return page.evaluate(
    async ({ endpoint, dir, value }) => {
      const marks = (window as unknown as { __pluginUiMarks: Record<string, number> }).__pluginUiMarks
      // 只关注本次切换引发的 SSE：清掉上一个事件的打点。
      delete (marks as Record<string, number | undefined>).eventAt
      marks.patchStart = performance.now()
      const response = await fetch(`${endpoint}/plugin/novaway-ui`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-novaway-directory": dir },
        body: JSON.stringify({ enabled: value, scope: "builtin" }),
      })
      return response.status
    },
    { endpoint: backend(), dir: directory, value: enabled },
  )
}

const marksOf = (page: Page) =>
  page.evaluate(() => ({ ...(window as unknown as { __pluginUiMarks: Record<string, number> }).__pluginUiMarks }))

test("D6 UI budget: first contributions response to clickable rail < 500ms", async ({ page }) => {
  await instrument(page)
  await page.goto(`/${workspaceSlug()}/session`)
  await expect(rail(page)).toBeVisible({ timeout: 20_000 })
  await expect(rail(page)).toBeEnabled()
  const marks = await marksOf(page)
  expect(marks.contribEnd).toBeGreaterThan(0)
  expect(marks.railAt).toBeGreaterThan(0)
  const delay = marks.railAt! - marks.contribEnd!
  console.log(`contributions → clickable rail: ${delay.toFixed(1)}ms`)
  expect(delay).toBeLessThan(500)
})

test("D9 UI budget: disable via SSE removes the rail icon in < 300ms", async ({ page }) => {
  await instrument(page)
  await page.goto(`/${workspaceSlug()}/session`)
  await expect(rail(page)).toBeVisible({ timeout: 20_000 })

  expect(await toggle(page, false)).toBe(200)
  await expect(page.locator('[data-component="sidebar-rail-item"][aria-label="NovaWay Home"]')).toHaveCount(0, {
    timeout: 5_000,
  })
  const marks = await marksOf(page)
  expect(marks.railGoneAt).toBeGreaterThan(0)
  expect(marks.eventAt).toBeGreaterThan(0)
  const fromPatchStart = marks.railGoneAt! - marks.patchStart!
  const fromPatchEnd = marks.railGoneAt! - (marks.patchEnd ?? marks.patchStart!)
  const fromEvent = marks.railGoneAt! - marks.eventAt!
  const calls = await page.evaluate(
    () =>
      (window as unknown as { __pluginUiCalls: Array<{ url: string; start: number; end: number }> }).__pluginUiCalls,
  )
  const refresh = calls.filter((call) => call.url.includes("/plugin/contributions") && call.start > marks.patchStart!)
  const detail = refresh
    .map((call) => `contrib ${call.start.toFixed(1)}→${call.end.toFixed(1)} (${(call.end - call.start).toFixed(1)}ms)`)
    .join(", ")
  const window = calls.filter((call) => call.start > marks.patchStart! && call.start <= marks.railGoneAt!)
  console.log(
    `disable → icon gone: fromEvent=${fromEvent.toFixed(1)}ms fromPatchEnd=${fromPatchEnd.toFixed(1)}ms fromPatchStart=${fromPatchStart.toFixed(1)}ms | ${detail || "no contributions refetch"}`,
  )
  // 诊断用：乐观移除后应只看到后台对齐请求，而不是等待它完成才消失。
  console.log(
    `calls in window: ${JSON.stringify(window.map((c) => c.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 48)))}`,
  )
  // §6.4 口径：停用插件（SSE → 重渲染）→ rail 图标消失 < 300ms。
  expect(fromEvent).toBeLessThan(300)

  expect(await toggle(page, true)).toBe(200)
  await expect(rail(page)).toBeVisible({ timeout: 20_000 })
})
