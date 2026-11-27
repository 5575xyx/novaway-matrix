import { expect, test } from "@playwright/test"

test("static long chat timeline scroll baseline", async ({ page }) => {
  await page.goto("/e2e/fixtures/chat-scroll.html")
  await expect(page.locator("[data-timeline-row]")).toHaveCount(240)
  await expect(page.locator("[data-timeline-row] pre")).toHaveCount(60, { timeout: 30_000 })

  const metrics = await page.evaluate(async () => {
    const root = document.querySelector<HTMLDivElement>("#scroll-root")!
    const frameGaps: number[] = []
    const longTasks: Array<{ startTime: number; duration: number }> = []
    const observer = new PerformanceObserver((entries) => {
      longTasks.push(...entries.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })))
    })
    observer.observe({ type: "longtask", buffered: true })

    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const scrollStartedAt = performance.now()
    let previous = scrollStartedAt
    let frame = 0
    const sampleFrames = () =>
      new Promise<void>((resolve) => {
        const tick = (now: number) => {
          frameGaps.push(now - previous)
          previous = now
          root.scrollTop = Math.min(root.scrollTop + 180, root.scrollHeight)
          frame += 1
          if (frame < 90 && root.scrollTop < root.scrollHeight - root.clientHeight) {
            requestAnimationFrame(tick)
            return
          }
          resolve()
        }
        requestAnimationFrame(tick)
      })

    await sampleFrames()
    const scrollEndedAt = performance.now()
    observer.disconnect()
    const sorted = frameGaps.toSorted((a, b) => a - b)
    const percentile = (value: number) => sorted[Math.floor((sorted.length - 1) * value)] ?? 0
    return {
      frames: frameGaps.length,
      p50FrameMs: percentile(0.5),
      p95FrameMs: percentile(0.95),
      maxFrameMs: Math.max(...frameGaps),
      scrollStartedAt,
      scrollEndedAt,
      longTasks,
      scrollLongTasks: longTasks.filter((task) => task.startTime >= scrollStartedAt && task.startTime <= scrollEndedAt),
      rowCount: document.querySelectorAll("[data-timeline-row]").length,
    }
  })

  console.info("chat-scroll-performance", metrics)
  expect(metrics.frames).toBeGreaterThan(30)
})

test("Markdown does not redecorate the previous HTML while a new parse is pending", async ({ page }) => {
  await page.addInitScript(() => {
    const queryAll = Element.prototype.querySelectorAll
    Element.prototype.querySelectorAll = function (selectors: string) {
      if (selectors === "pre" && !this.isConnected && this.querySelector("[data-paint-probe]")) {
        const data = document.documentElement.dataset
        data.markdownDecorations = String(Number(data.markdownDecorations ?? 0) + 1)
      }
      return queryAll.call(this, selectors)
    }
  })
  await page.goto("/e2e/fixtures/chat-scroll.html?pending-parse", { waitUntil: "domcontentloaded" })
  const reply = page.locator('[data-component="markdown"]')
  const decorations = async () => Number(await page.locator("html").getAttribute("data-markdown-decorations"))
  await expect(reply.locator("[data-paint-probe]")).toHaveText("Visible reply", { timeout: 45_000 })
  expect(await decorations()).toBeGreaterThan(0)
  await page.evaluate(() => { document.documentElement.dataset.markdownDecorations = "0" })
  await page.getByRole("button", { name: "Update text" }).click()
  await expect(reply).toHaveText("Visible reply")
  const whilePending = await decorations()
  await page.getByRole("button", { name: "Finish parsing" }).click()
  await expect(reply).toHaveText("New reply")
  console.info("markdown-paint", { whilePending, afterParse: await decorations() })
  expect(whilePending).toBe(0)
  expect(await decorations()).toBe(1)
  await page.getByRole("button", { name: "Clear" }).click()
  await expect(reply).toBeEmpty()
})
