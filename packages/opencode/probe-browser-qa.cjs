const { chromium } = require("playwright-core")
const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")

const outDir = path.join(process.cwd(), ".tmp-browser-qa")
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
]

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>PowersNexus Todo 验收</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f7fb; color: #172033; }
    main { width: min(720px, calc(100% - 32px)); margin: 40px auto; padding: 24px; background: white; border-radius: 16px; box-shadow: 0 8px 28px #17203318; }
    h1 { margin-top: 0; }
    form { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
    input, button { min-height: 44px; border-radius: 8px; border: 1px solid #aab3c5; padding: 0 12px; font: inherit; }
    button { cursor: pointer; background: #315efb; color: white; border-color: #315efb; }
    button.secondary { margin-top: 16px; background: white; color: #9b1c1c; border-color: #d6a1a1; }
    #status { min-height: 48px; display: grid; place-items: center; color: #576176; }
    #list { padding: 0; margin: 16px 0 0; list-style: none; }
    #list li { padding: 12px; border: 1px solid #dce1eb; border-radius: 8px; margin-top: 8px; overflow-wrap: anywhere; }
    #error { margin-top: 16px; padding: 12px; background: #fff0f0; color: #9b1c1c; border-radius: 8px; }
    :focus-visible { outline: 3px solid #ffb000; outline-offset: 2px; }
    [hidden] { display: none !important; }
    @media (max-width: 480px) { main { margin: 16px auto; padding: 16px; } form { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>Todo 样板</h1>
    <form id="form" aria-label="新增待办">
      <label for="title" hidden>待办标题</label>
      <input id="title" name="title" placeholder="输入待办后按 Enter" autocomplete="off" />
      <button type="submit">添加</button>
    </form>
    <div id="status" role="status">正在加载待办…</div>
    <ul id="list" aria-label="待办列表"></ul>
    <div id="error" role="alert" hidden>加载失败，请重试</div>
    <button id="fail" type="button" class="secondary">模拟错误状态</button>
  </main>
  <script>
    const storageKey = "powersnexus-todo-browser-qa"
    const form = document.querySelector("#form")
    const title = document.querySelector("#title")
    const list = document.querySelector("#list")
    const status = document.querySelector("#status")
    const error = document.querySelector("#error")

    const read = () => JSON.parse(localStorage.getItem(storageKey) || "[]")
    const write = (items) => localStorage.setItem(storageKey, JSON.stringify(items))
    const render = () => {
      const items = read()
      list.replaceChildren(...items.map((text) => {
        const item = document.createElement("li")
        item.textContent = text
        return item
      }))
      status.textContent = items.length ? items.length + " 条待办" : "暂无待办"
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault()
      const value = title.value.trim()
      if (!value) return
      write([...read(), value])
      title.value = ""
      render()
      title.focus()
    })

    document.querySelector("#fail").addEventListener("click", async () => {
      const result = await fetch("/api/error").then((response) => response.json())
      if (!result.ok) error.hidden = false
    })

    setTimeout(render, 350)
  </script>
</body>
</html>`

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (request.url === "/api/error") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ ok: false, code: "EXPECTED_TEST_ERROR" }))
        return
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      response.end(html)
    })
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("无法分配验收端口"))
      resolve({ server, url: `http://127.0.0.1:${address.port}/` })
    })
  })
}

async function screenshot(page, viewport, state) {
  const file = path.join(outDir, `${viewport}-${state}.png`)
  await page.screenshot({ path: file, fullPage: true })
  return file
}

async function run() {
  const { server, url } = await startServer()
  const consoleErrors = []
  const networkFailures = []
  const results = []
  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      channel: process.env.POWERSNEXUS_BROWSER_CHANNEL || "chrome",
    })
    const context = await browser.newContext()
    const page = await context.newPage()
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    page.on("response", (response) => {
      if (response.status() >= 400 && !response.url().endsWith("/api/error")) {
        networkFailures.push({ url: response.url(), status: response.status() })
      }
    })

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(url, { waitUntil: "domcontentloaded" })
      await page.evaluate(() => localStorage.removeItem("powersnexus-todo-browser-qa"))
      await page.reload({ waitUntil: "domcontentloaded" })

      const loadingVisible = await page.getByRole("status").getByText("正在加载待办…").isVisible()
      const loadingShot = await screenshot(page, viewport.name, "loading")
      await page.getByText("暂无待办").waitFor()
      const emptyShot = await screenshot(page, viewport.name, "empty")

      const input = page.getByPlaceholder("输入待办后按 Enter")
      await input.fill(`验收待办-${viewport.name}`)
      await input.press("Enter")
      await page.getByText(`验收待办-${viewport.name}`).waitFor()
      const focusedAfterEnter = await input.evaluate((element) => element === document.activeElement)
      const mainShot = await screenshot(page, viewport.name, "main")

      await page.reload({ waitUntil: "domcontentloaded" })
      await page.getByText(`验收待办-${viewport.name}`).waitFor()
      const persistedAfterRefresh = await page.getByText(`验收待办-${viewport.name}`).isVisible()

      await page.getByRole("button", { name: "模拟错误状态" }).click()
      await page.getByRole("alert").waitFor()
      const errorShot = await screenshot(page, viewport.name, "error")
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      const accessibility = await page.locator("body").ariaSnapshot()

      const screenshots = [loadingShot, emptyShot, mainShot, errorShot]
      results.push({
        viewport: viewport.name,
        width: viewport.width,
        height: viewport.height,
        loadingVisible,
        emptyVisible: true,
        keyboardSubmit: true,
        focusedAfterEnter,
        persistedAfterRefresh,
        errorVisible: true,
        overflow,
        accessibility: accessibility.slice(0, 4000),
        screenshots,
        passed:
          loadingVisible &&
          focusedAfterEnter &&
          persistedAfterRefresh &&
          !overflow &&
          screenshots.every((file) => fs.existsSync(file)),
      })
    }

    await context.close()
  } finally {
    if (browser) await browser.close().catch(() => undefined)
    await new Promise((resolve) => server.close(resolve))
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scenario: "react-todo-complete",
    consoleErrors,
    networkFailures,
    results,
    evidenceFiles: results.flatMap((result) => result.screenshots),
    ok:
      results.length === viewports.length &&
      results.every((result) => result.passed) &&
      consoleErrors.length === 0 &&
      networkFailures.length === 0,
  }
  fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8")
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.ok) process.exitCode = 1
}

run().catch((cause) => {
  process.stderr.write(`${cause?.stack || cause}\n`)
  process.exitCode = 2
})
