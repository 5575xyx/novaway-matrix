import { expect, test, type Page } from "@playwright/test"

test.describe.configure({ timeout: 120_000 })

const mock = "http://127.0.0.1:4474"
const directory = "/interaction-performance"
const slug = Buffer.from(directory).toString("base64url")
const sessionID = "ses_perf_main"
const childID = "ses_perf_child"
const turnCount = 32
const lastAssistant = "msg_perf_31_b"
const textPart = "part_perf_31_b"

const now = Date.now()
const task = (id: string, title: string, parentID?: string) => ({
  id, title, parentID, directory, projectID: "performance", scope: "project",
  slug: id, version: "test", time: { created: now, updated: now },
})
const rootTask = task(sessionID, "Performance task")
const childTask = task(childID, "Child performance task", sessionID)
const project = { id: "performance", worktree: directory, sandboxes: [], time: { created: now }, icon: { color: "blue" } }
const messages = Array.from({ length: turnCount }, (_, index) => {
  const key = `perf_${String(index).padStart(2, "0")}`
  const user = `msg_${key}_a`
  const assistant = `msg_${key}_b`
  const created = now - (turnCount - index) * 1000
  const running = index === turnCount - 1
  return [
    {
      info: { id: user, sessionID, role: "user", agent: "build", time: { created }, model: { providerID: "test", modelID: "test" } },
      parts: [{ id: `part_${key}_a`, messageID: user, sessionID, type: "text", text: `Historical question ${index}` }],
    },
    {
      info: {
        id: assistant, sessionID, role: "assistant", parentID: user, agent: "build", mode: "build", modelID: "test", providerID: "test",
        time: { created, completed: running ? undefined : created + 100 }, path: { cwd: directory, root: directory },
        cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        {
          id: `part_${key}_b`, messageID: assistant, sessionID, type: "text",
          text: running ? "An answer in progress" : Array.from({ length: 7 }, (_, line) => `Historical answer ${index}, paragraph ${line}.`).join("\n\n"),
        },
        {
          id: `part_${key}_c`, callID: `call_${key}`, messageID: assistant, sessionID, type: "tool", tool: "bash",
          state: running
            ? { status: "running", title: "Wait for fixture", input: { description: "Wait for fixture" }, time: { start: created } }
            : { status: "completed", title: "Historical tool", input: {}, output: `history-preview-probe-${index}`, time: { start: created, end: created + 100 } },
        },
      ],
    },
  ]
}).flat()

declare global {
  interface Window {
    interactionFixture?: { push: (payload: object) => void }
  }
}

async function openFixture(
  page: Page,
  longChat = false,
  listFiles?: (path: string) => Promise<unknown>,
  history = messages,
) {
  let archiveCalls = 0
  await page.addInitScript(({ mock, directory }) => {
    localStorage.setItem("novaway.settings.dat:defaultServerUrl", mock)
    localStorage.setItem("novaway.global.dat:server", JSON.stringify({
      list: [{ type: "http", http: { url: mock } }],
      projects: { local: [{ worktree: directory, expanded: true }] },
    }))
    // Drive the generated SDK and real event reducer, without a backend or reconnect timer.
    const originalFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url !== `${mock}/global/event`) return originalFetch(input, init)
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const encode = new TextEncoder()
          window.interactionFixture = {
            push: (payload) => controller.enqueue(encode.encode(`data: ${JSON.stringify({ directory, payload })}\n\n`)),
          }
        },
      }), { headers: { "Content-Type": "text/event-stream" } }))
    }
  }, { mock, directory })
  await page.route(`${mock}/**`, async (route) => {
    const url = new URL(route.request().url())
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": route.request().headers()["access-control-request-headers"] ?? "*",
    }
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers })
    const json = (data: unknown) => route.fulfill({ headers, json: data })
    switch (url.pathname) {
      case "/global/health": return json({ healthy: true, version: "0.0.0-test", sessionLibrary: "perf" })
      case "/project": return json([project])
      case "/project/current": return json(project)
      case "/session": return json((url.searchParams.get("directory") ?? route.request().headers()["x-novaway-directory"]) === directory ? [rootTask, childTask] : [])
      case "/experimental/session":
        if (url.searchParams.get("archived") === "true") archiveCalls++
        return json([])
      case `/session/${sessionID}`: return json(rootTask)
      case `/session/${childID}`: return json(childTask)
      case `/session/${sessionID}/message`: return json(longChat ? history : [])
      case `/session/${sessionID}/team`:
      case `/session/${childID}/team`: return json({ members: [], tasks: [] })
      case "/path": return json({ home: "/", config: "/", state: "/", worktree: directory, directory })
      case "/provider": return json({ all: [], connected: [], default: {} })
      case "/session/status": return json(longChat ? { [sessionID]: { type: "busy" } } : {})
      case "/config":
      case "/global/config":
      case "/mcp":
      case "/vcs": return json({})
      case "/git": return route.fulfill({ status: 404, headers, json: { message: "Not a git repository" } })
      case "/file": return json(listFiles ? await listFiles(url.searchParams.get("path") ?? "") : [])
      case "/api/fs/find": return json({ data: [] })
      default: return json([])
    }
  })
  await page.goto(`/${slug}/session/${sessionID}`, { waitUntil: "domcontentloaded" })
  return { archiveCalls: () => archiveCalls }
}

const taskRow = '[data-component="task-row"]'

test("only the visible sidebar mounts its tasks; drawer and desktop share collapse and archive state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const fixture = await openFixture(page)
  const desktop = page.locator('[data-component="sidebar-nav-desktop"]')
  const mobile = page.locator('[data-component="sidebar-nav-mobile"]')
  const child = page.locator(`${taskRow}[data-level="2"]`).filter({ hasText: "Child performance task" })
  await expect(child).toBeVisible({ timeout: 40_000 })
  await expect(mobile).toHaveCount(0)
  await expect.poll(fixture.archiveCalls, { timeout: 30_000 }).toBe(1)

  const expand = page.locator(`${taskRow}[data-level="1"]`).getByRole("button", { expanded: true })
  await expand.click()
  await expect(child).toHaveCount(0)
  await page.setViewportSize({ width: 1100, height: 800 })
  await expect(desktop).toHaveCount(0)
  await expect(mobile.locator(taskRow)).toHaveCount(0)

  const trigger = page.getByRole("button", { name: /Toggle menu|切换菜单/ }).first()
  await trigger.click()
  await expect(mobile).not.toHaveAttribute("inert", "")
  await expect(mobile).toBeFocused()
  await expect(mobile.locator(`${taskRow}[data-level="1"]`)).toBeVisible()
  await expect(child).toHaveCount(0)
  await mobile.locator(`${taskRow}[data-level="1"]`).locator("button[data-row-action][aria-expanded=false]").click()
  await expect(child).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(trigger).toBeFocused()
  await expect(mobile).toHaveAttribute("inert", "")
  await expect(mobile.locator(taskRow)).toHaveCount(0)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(child).toBeVisible()
  await expect(mobile).toHaveCount(0)
  expect(fixture.archiveCalls()).toBe(1)

  await desktop.getByRole("button", { name: /^(View|视图)$/ }).click()
  await page.getByRole("menuitem", { name: /Group by|分组方式/ }).hover()
  await page.getByRole("menuitemradio", { name: /By date|按日期/ }).click()
  await page.keyboard.press("Escape")
  if (await page.getByRole("menuitem", { name: /Group by|分组方式/ }).isVisible()) await page.keyboard.press("Escape")
  const today = desktop.getByRole("button", { name: /^(Today|今天)$/ })
  await expect(today).toHaveAttribute("aria-expanded", "true")
  await expect(today).toHaveText(/(Today|今天)\s*1/)
  await expect(child).toHaveCount(1)
  await today.click()
  await expect(child).toHaveCount(0)
  await today.click()
  await expect(child).toBeVisible()
})

async function streamText(page: Page, marker: string) {
  await expect.poll(() => page.evaluate(() => !!window.interactionFixture)).toBe(true)
  await page.evaluate(({ lastAssistant, textPart, marker }) => {
    const delta = Array.from({ length: 10 }, (_, n) => `\n\n${marker} paragraph ${n}.`).join("")
    window.interactionFixture!.push({
      type: "message.part.delta",
      properties: { messageID: lastAssistant, partID: textPart, field: "text", delta },
    })
  }, { lastAssistant, textPart, marker })
}

test("streaming follows new content, quiet tool work stays idle, and scrolling up pauses follow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFixture(page, true)
  const viewport = page.locator('[data-component="message-timeline"] .scroll-view__viewport')
  const bottomGap = () => viewport.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
  await expect(page.getByText("An answer in progress", { exact: true })).toBeVisible({ timeout: 40_000 })
  await expect.poll(bottomGap).toBeLessThanOrEqual(4)
  await streamText(page, "First streamed block")
  await expect(page.getByText("First streamed block paragraph 9.", { exact: true })).toBeInViewport()
  await expect.poll(bottomGap).toBeLessThanOrEqual(4)

  await expect(page.locator(`${taskRow} [data-task-status="running"]`)).toHaveCount(1)
  const idle = await viewport.evaluate(async (el) => {
    const sample = (frames: number) => new Promise<number[]>((resolve) => {
      const gaps: number[] = []
      let previous = performance.now()
      const tick = (now: number) => {
        gaps.push(now - previous)
        previous = now
        if (gaps.length === frames) resolve(gaps)
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    // Allow initial virtual measurements and panel recovery timers to settle.
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const getHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!.get!
    let reads = 0
    Object.defineProperty(el, "scrollHeight", { configurable: true, get() { reads++; return getHeight.call(el) } })
    try {
      const gaps = (await sample(45)).sort((a, b) => a - b)
      return { reads, frames: gaps.length, p95FrameMs: gaps[Math.floor(gaps.length * 0.95)] }
    } finally {
      Reflect.deleteProperty(el, "scrollHeight")
    }
  })
  console.info("quiet-chat", idle)
  expect(idle.reads).toBeLessThan(10)

  await viewport.focus()
  await viewport.press("PageUp")
  await expect.poll(bottomGap).toBeGreaterThan(250)
  const readingTop = await viewport.evaluate((el) => new Promise<number>((resolve) => {
    let top = el.scrollTop
    let stable = 0
    const tick = () => {
      stable = top === el.scrollTop ? stable + 1 : 0
      top = el.scrollTop
      if (stable >= 3) resolve(top)
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }))
  await streamText(page, "Second streamed block")
  // The active turn remains mounted while reading earlier turns; an SSE update must not jump to it.
  await expect(page.getByText("Second streamed block paragraph 9.", { exact: true })).toBeAttached()
  await expect.poll(bottomGap).toBeGreaterThan(350)
  expect(Math.abs(await viewport.evaluate((el) => el.scrollTop) - readingTop)).toBeLessThan(80)

  const pane = page.locator('[data-component="side-pane-frame"]')
  const open = page.getByTitle(/Toggle side pane|切换 Side Pane/)
  const close = pane.getByRole("button", { name: /Collapse side pane|折叠侧栏/ })
  if (await pane.getAttribute("data-open") === "true") await close.click()
  await open.click()
  await expect(pane).toHaveAttribute("data-open", "true")
  const visibleHistory = () => viewport.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return Array.from(el.querySelectorAll('[data-timeline-row="UserMessage"]')).some((row) => {
      const bounds = row.getBoundingClientRect()
      return bounds.top < rect.bottom && bounds.bottom > rect.top
    })
  })
  await expect.poll(visibleHistory).toBe(true)
  await expect.poll(bottomGap).toBeGreaterThan(150)
  await close.click()
  await expect(pane).toHaveAttribute("data-open", "false")
  await expect.poll(visibleHistory).toBe(true)
  await expect.poll(bottomGap).toBeGreaterThan(150)
})


test("completing a turn does not rescan old artifacts or clone the composer DOM while typing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    const original = String.prototype.matchAll
    const clone = Range.prototype.cloneContents
    document.addEventListener("performance-probe-reset", () => {
      document.documentElement.dataset.historyPreviewScans = "0"
      document.documentElement.dataset.composerRangeClones = "0"
    })
    const increment = (key: string) => {
      const data = document.documentElement.dataset
      data[key] = String(Number(data[key] ?? 0) + 1)
    }
    String.prototype.matchAll = function (pattern) {
      if (String(this).startsWith("history-preview-probe-")) increment("historyPreviewScans")
      return original.call(this, pattern)
    }
    Range.prototype.cloneContents = function () {
      const node = this.startContainer
      const element = node instanceof Element ? node : node.parentElement
      if (element?.closest('[data-component="prompt-input"]')) increment("composerRangeClones")
      return clone.call(this)
    }
  })
  await openFixture(page, true)
  await expect(page.getByText("An answer in progress", { exact: true })).toBeVisible({ timeout: 40_000 })
  await expect(page.locator(`${taskRow} [data-task-status="running"]`)).toHaveCount(1)
  const initialScans = await page.locator("html").getAttribute("data-history-preview-scans")
  expect(Number(initialScans)).toBe(turnCount - 1)

  const editor = page.locator('[data-component="prompt-input"]')
  await editor.fill(Array.from({ length: 80 }, (_, i) => `Draft line ${i}`).join("\n"))
  await editor.press("Control+End")
  const completed = { ...messages.at(-1)!.info, time: { ...messages.at(-1)!.info.time, completed: now + 1000 } }
  await page.evaluate(({ completed, sessionID }) => {
    document.dispatchEvent(new Event("performance-probe-reset"))
    window.interactionFixture!.push({ type: "message.updated", properties: { info: completed } })
    window.interactionFixture!.push({ type: "session.status", properties: { sessionID, status: { type: "idle" } } })
  }, { completed, sessionID })
  await page.keyboard.insertText(" — draft continues")
  await expect(editor).toContainText("Draft line 79 — draft continues")
  await expect(page.locator(`${taskRow} [data-task-status="running"]`)).toHaveCount(0)
  const counts = await page.locator("html").evaluate((el) => ({
    historicalScans: Number((el as HTMLElement).dataset.historyPreviewScans),
    composerClones: Number((el as HTMLElement).dataset.composerRangeClones),
  }))
  console.info("turn-completion-and-composer", counts)
  expect(counts).toEqual({ historicalScans: 0, composerClones: 0 })
})

test("artifact correction ignores late file verification and keeps the verification screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  let allowOld!: () => void
  const old = new Promise<void>((resolve) => { allowOld = resolve })
  const requested: string[] = []
  const older = ".proof-old/first.pdf"
  const newer = ".proof-new/final.pdf"
  const card = (path: string) => page.locator(`[data-preview-kind="file"][title="${directory}/${path}"]`)
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="
  try {
    await openFixture(page, true, async (directoryPath) => {
      const path = directoryPath.endsWith("/") ? directoryPath.slice(0, -1) : directoryPath
      requested.push(path)
      if (path === ".proof-old") await old
      const file = path === ".proof-old" ? older : path === ".proof-new" ? newer : undefined
      return file ? [{ name: file.split("/").at(-1), path: file, absolute: `${directory}/${file}`, type: "file", ignored: false }] : []
    })
    await expect(page.getByText("An answer in progress", { exact: true })).toBeVisible({ timeout: 40_000 })
    const completed = { ...messages.at(-1)!.info, time: { ...messages.at(-1)!.info.time, completed: now + 1000 } }
    await page.evaluate(({ completed, older, sessionID, lastAssistant, textPart, image, now }) => {
      const push = window.interactionFixture!.push
      push({ type: "message.updated", properties: { info: completed } })
      push({ type: "session.status", properties: { sessionID, status: { type: "idle" } } })
      push({ type: "message.part.updated", properties: { part: {
        id: textPart, messageID: lastAssistant, sessionID, type: "text", text: `Delivery ${older}`,
      } } })
      push({ type: "message.part.updated", properties: { part: {
        id: "part_perf_31_d", callID: "call_perf_screenshot", messageID: lastAssistant, sessionID,
        type: "tool", tool: "browser_screenshot", state: {
          status: "completed", input: {}, title: "Verification", output: "Screen captured", metadata: {},
          attachments: [{ type: "file", mime: "image/png", url: image, filename: "proof.png" }],
          time: { start: now, end: now + 100 },
        },
      } } })
    }, { completed, older, sessionID, lastAssistant, textPart, image, now })
    await expect.poll(() => requested.includes(".proof-old")).toBe(true)
    await expect(card(older)).toHaveCount(0)
    await expect(page.locator('[data-component="tool-evidence"] img')).toHaveAttribute("src", image)

    await page.evaluate(({ newer, sessionID, lastAssistant, textPart }) => {
      window.interactionFixture!.push({ type: "message.part.updated", properties: { part: {
        id: textPart, messageID: lastAssistant, sessionID, type: "text", text: `Corrected delivery ${newer}`,
      } } })
    }, { newer, sessionID, lastAssistant, textPart })
    await expect(card(newer)).toBeVisible()
    const oldResponse = page.waitForResponse((res) => new URL(res.url()).searchParams.get("path") === ".proof-old/")
    allowOld()
    await (await oldResponse).finished()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(card(newer)).toBeVisible()
    await expect(card(older)).toHaveCount(0)
    expect(requested.filter((path) => path === ".proof-new")).toHaveLength(1)
  } finally {
    allowOld()
  }
})

test("an SSE burst preserves the authoritative snapshot and its entire tail without resetting the heartbeat per token", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window)
    window.setTimeout = (handler, delay, ...args) => {
      if (delay === 15_000) {
        const data = document.documentElement.dataset
        data.heartbeatTimers = String(Number(data.heartbeatTimers ?? 0) + 1)
      }
      return original(handler, delay, ...args)
    }
  })
  await openFixture(page, true)
  await expect(page.getByText("An answer in progress", { exact: true })).toBeVisible({ timeout: 40_000 })
  await expect.poll(() => page.evaluate(() => !!window.interactionFixture)).toBe(true)
  const chunks = Array.from({ length: 160 }, (_, index) => ` token-${index};`)
  const snapshot = "Authoritative answer:"
  await page.evaluate(({ lastAssistant, sessionID, textPart, snapshot, chunks }) => {
    document.documentElement.dataset.heartbeatTimers = "0"
    const push = window.interactionFixture!.push
    const replace = (text: string) => push({ type: "message.part.updated", properties: { sessionID, part: {
      id: textPart, messageID: lastAssistant, sessionID, type: "text", text,
    } } })
    const append = (delta: string) => push({ type: "message.part.delta", properties: {
      messageID: lastAssistant, sessionID, partID: textPart, field: "text", delta,
    } })
    replace("Temporary answer:")
    append(" obsolete text;")
    replace(snapshot)
    for (const chunk of chunks) append(chunk)
  }, { lastAssistant, sessionID, textPart, snapshot, chunks })
  // This checks the actual visible reply, not an internal accumulator.
  const text = page.locator(`[data-timeline-part-id="${textPart}"] [data-component="markdown"]`)
  await expect(text).toHaveText(snapshot + chunks.join(""), { timeout: 10_000 })
  const timers = Number(await page.locator("html").getAttribute("data-heartbeat-timers"))
  console.info("stream-burst", { chunks: chunks.length, heartbeatTimers: timers })
  expect(timers).toBeLessThanOrEqual(2)
})

const cpuThrottleRate = Number(process.env.PERF_CPU_RATE ?? 4)
const streamPaceMs = Number(process.env.PERF_STREAM_PACE_MS ?? 12)

test(`long-session streaming stays responsive under ${cpuThrottleRate}x CPU throttling with 400 turns loaded`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const count = 400
  const timestamp = Date.now()
  const accumulatedAnswer = Array.from({ length: 40 }, (_, index) => `Completed response paragraph ${index}: a previously streamed paragraph remains unchanged.`)
    .join("\n\n") + "\n\nLong session streaming answer"
  const history = Array.from({ length: count }, (_, index) => {
    const userID = `msg_long_${index}_u`
    const assistantID = `msg_long_${index}_a`
    const created = timestamp - (count - index) * 1000
    const active = index === count - 1
    return [
      {
        info: {
          id: userID,
          sessionID,
          role: "user",
          agent: "build",
          time: { created },
          model: { providerID: "test", modelID: "test" },
        },
        parts: [{
          id: `part_long_${index}_u`,
          messageID: userID,
          sessionID,
          type: "text",
          text: `Long history request ${index}: inspect and improve the project carefully.`,
        }],
      },
      {
        info: {
          id: assistantID,
          sessionID,
          role: "assistant",
          parentID: userID,
          agent: "build",
          mode: "build",
          modelID: "test",
          providerID: "test",
          time: { created, ...(active ? {} : { completed: created + 100 }) },
          path: { cwd: directory, root: directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [{
          id: `part_long_${index}_a`,
          messageID: assistantID,
          sessionID,
          type: "text",
          text: active ? accumulatedAnswer : `Historical response ${index}: completed successfully.`,
        }],
      },
    ]
  }).flat()
  const latestAssistant = `msg_long_${count - 1}_a`
  const latestPart = `part_long_${count - 1}_a`

  await openFixture(page, true, undefined, history)
  const viewport = page.locator('[data-component="message-timeline"] .scroll-view__viewport')
  await expect(page.getByText("Long session streaming answer", { exact: true })).toBeVisible({ timeout: 40_000 })
  await expect.poll(() => page.evaluate(() => !!window.interactionFixture)).toBe(true)
  await page.waitForTimeout(800)
  const cpu = await page.context().newCDPSession(page)
  await cpu.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottleRate })

  const sample = await page.evaluate(async ({ sessionID, latestAssistant, latestPart, streamPaceMs }) => {
    const longTasks: Array<{ startTime: number; duration: number; attribution: Array<{ name: string; containerType: string; containerName: string }> }> = []
    const longFrames: Array<{ startTime: number; duration: number; blockingDuration?: number; scripts: Array<{ invoker: string; functionName: string; sourceURL: string; duration: number }> }> = []
    const observer = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        const task = entry as PerformanceLongTaskTiming
        longTasks.push({
          startTime: task.startTime,
          duration: task.duration,
          attribution: task.attribution.map((item) => ({
            name: item.name,
            containerType: item.containerType,
            containerName: item.containerName,
          })),
        })
      }
    })
    observer.observe({ type: "longtask", buffered: false })
    let longFrameObserver: PerformanceObserver | undefined
    if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) {
      longFrameObserver = new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          const frame = entry as PerformanceEntry & {
            blockingDuration?: number
            scripts?: Array<{ invoker?: string; functionName?: string; sourceURL?: string; duration?: number }>
          }
          longFrames.push({
            startTime: frame.startTime,
            duration: frame.duration,
            blockingDuration: frame.blockingDuration,
            scripts: (frame.scripts ?? []).map((script) => ({
              invoker: script.invoker ?? "",
              functionName: script.functionName ?? "",
              sourceURL: script.sourceURL ?? "",
              duration: script.duration ?? 0,
            })),
          })
        }
      })
      longFrameObserver.observe({ type: "long-animation-frame", buffered: false } as PerformanceObserverInit)
    }
    const gaps: number[] = []
    let previous = performance.now()
    let frames = 0
    let maxFrameGapMs = 0
    let maxFrameGapAtMs = 0
    const chunks = Array.from({ length: 80 }, (_, index) => ` streamed-${index};`)
    const expectedTail = chunks.join("")
    const injectionStarted = performance.now()
    let lastDeltaSentAt = injectionStarted
    const tailRendered = new Promise<{ time: number; finalDeltaToPaintMs: number }>((resolve) => {
      const finish = (time: number) => {
        observer.disconnect()
        longFrameObserver?.disconnect()
        clearTimeout(timeout)
        resolve({ time, finalDeltaToPaintMs: time - lastDeltaSentAt })
      }
      const check = () => {
        const part = document.querySelector(`[data-timeline-part-id="${latestPart}"] [data-component="markdown"]`)
        if (part?.textContent?.includes(expectedTail)) finish(performance.now())
      }
      const observer = new MutationObserver(check)
      observer.observe(document.body, { subtree: true, childList: true, characterData: true })
      const timeout = setTimeout(() => finish(Number.NaN), 15_000)
      check()
    })
    const framesDone = new Promise<void>((resolve) => {
      const tick = (now: number) => {
        const gap = now - previous
        gaps.push(gap)
        if (gap > maxFrameGapMs) {
          maxFrameGapMs = gap
          maxFrameGapAtMs = now - injectionStarted
        }
        previous = now
        frames++
        if (frames >= 60) resolve()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    for (const [index, delta] of chunks.entries()) {
      if (index === chunks.length - 1) lastDeltaSentAt = performance.now()
      window.interactionFixture!.push({
        type: "message.part.delta",
        properties: { messageID: latestAssistant, sessionID, partID: latestPart, field: "text", delta },
      })
      if (streamPaceMs > 0) await new Promise((resolve) => setTimeout(resolve, streamPaceMs))
    }
    const injectionMs = performance.now() - injectionStarted
    const tail = await tailRendered
    const streamToTailMs = tail.time - injectionStarted
    await framesDone
    observer.disconnect()
    longFrameObserver?.disconnect()
    gaps.sort((a, b) => a - b)
    return {
      turns: 400,
      frames: gaps.length,
      p50FrameMs: gaps[Math.floor(gaps.length * 0.5)],
      p95FrameMs: gaps[Math.floor(gaps.length * 0.95)],
      maxFrameMs: gaps[gaps.length - 1],
      maxFrameGapAtMs,
      longTasks,
      longFrames,
      injectionMs,
      streamToTailMs,
      finalDeltaToPaintMs: tail.finalDeltaToPaintMs,
      expectedTail,
    }
  }, { sessionID, latestAssistant, latestPart, streamPaceMs })

  await expect(page.locator(`[data-timeline-part-id="${latestPart}"] [data-component="markdown"]`))
    .toContainText(sample.expectedTail, { timeout: 15_000 })
  const streamToTailMs = sample.streamToTailMs
  await cpu.send("Emulation.setCPUThrottlingRate", { rate: 1 })
  const bottomGap = await viewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)
  console.info("long-session-bottom-gap", bottomGap)
  expect(bottomGap).toBeLessThan(8)
  console.info("long-session-streaming", {
    cpuThrottleRate,
    turns: sample.turns,
    frames: sample.frames,
    p50FrameMs: sample.p50FrameMs,
    p95FrameMs: sample.p95FrameMs,
    maxFrameMs: sample.maxFrameMs,
    maxFrameGapAtMs: sample.maxFrameGapAtMs,
    longTasks: JSON.stringify(sample.longTasks),
    longFrames: JSON.stringify(sample.longFrames),
    injectionMs: sample.injectionMs,
    streamToTailMs,
    finalDeltaToPaintMs: sample.finalDeltaToPaintMs,
    renderedTurns: await viewport.locator('[data-timeline-row="UserMessage"]').count(),
  })
  if (cpuThrottleRate <= 4) {
    expect(sample.p95FrameMs).toBeLessThan(50)
    expect(sample.maxFrameMs).toBeLessThan(100)
    expect(Math.max(0, ...sample.longTasks.map((task) => task.duration))).toBeLessThan(100)
  } else if (cpuThrottleRate <= 8) {
    expect(sample.p95FrameMs).toBeLessThan(75)
    expect(sample.maxFrameMs).toBeLessThan(100)
    expect(sample.finalDeltaToPaintMs).toBeLessThan(100)
    expect(Math.max(0, ...sample.longTasks.map((task) => task.duration))).toBeLessThan(80)
  }
})
