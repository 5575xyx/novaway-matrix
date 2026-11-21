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
