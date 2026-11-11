import { test as base, expect } from "@playwright/test"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { resolve, extname, sep } from "node:path"
import { readFile } from "node:fs/promises"

type Reply = { id: number; status: number; headers: Record<string, string>; body: string; error?: string }
type RequestInput = { url: string; method: string; headers: Record<string, string>; body?: string }
type OfficeApi = { origin?: string; request: (request: RequestInput) => Promise<Reply> }

// Opt-in, test-owned backend using production handlers and real file IO. By default a
// random-port listener preserves real SSE delivery; OFFICE_STDIO_ONLY=1 retains the
// no-listener fallback (initial SSE frame only, not a sustained watcher acceptance).
export const test = base.extend<{}, { officeApi: OfficeApi | undefined }>({
  officeApi: [
    async ({}, use) => {
      if (process.env.OFFICE_IN_PROCESS_API !== "1") return use(undefined)
      const child = spawn("bun", ["test", "test/server/office-browser-bridge.test.ts"], {
        cwd: resolve(process.cwd(), "..", "novaway"),
        env: {
          ...process.env,
          OFFICE_BROWSER_BRIDGE: "1",
          OFFICE_BROWSER_TCP: process.env.OFFICE_STDIO_ONLY === "1" ? "0" : "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      })
      let origin: string | undefined
      let id = 0
      const waiting = new Map<number, { resolve: (reply: Reply) => void; reject: (error: Error) => void }>()
      let ready!: () => void
      let failReady!: (error: Error) => void
      const started = new Promise<void>((resolve, reject) => {
        ready = resolve
        failReady = reject
      })
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => {
          const error = new Error("In-process Office API test exited unexpectedly")
          failReady(error)
          for (const pending of waiting.values()) pending.reject(error)
          waiting.clear()
          resolve()
        }),
      )
      child.on("error", (error) => failReady(error))
      child.stderr.on("data", (data) => process.stderr.write(data))
      const lines = createInterface({ input: child.stdout })
      lines.on("line", (line) => {
        if (!line.startsWith("OFFICE_BROWSER_API ")) return
        const result = JSON.parse(line.slice("OFFICE_BROWSER_API ".length)) as Reply & {
          ready?: boolean
          origin?: string
        }
        if (result.ready) {
          origin = result.origin
          return ready()
        }
        const pending = waiting.get(result.id)
        waiting.delete(result.id)
        if (result.error) pending?.reject(new Error(result.error))
        else pending?.resolve(result)
      })
      await started
      try {
        await use({
          origin,
          request: (input) =>
            new Promise<Reply>((resolve, reject) => {
              const requestID = ++id
              waiting.set(requestID, { resolve, reject })
              child.stdin.write(JSON.stringify({ ...input, id: requestID }) + "\n")
            }),
        })
      } finally {
        child.stdin.end("shutdown\n")
        await exited
        lines.close()
      }
    },
    { scope: "worker", timeout: 90_000 },
  ],
  page: async ({ page, officeApi, baseURL }, use) => {
    // Serve the actual Vite build through Playwright without opening a second app/server.
    // Only static transport changes; UI code, workers, fonts and API handlers remain real.
    if (process.env.OFFICE_PRODUCTION_DIST) {
      if (!baseURL) throw new Error("Production Office tests require a baseURL")
      const directory = resolve(process.env.OFFICE_PRODUCTION_DIST)
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".otf": "font/otf",
      }
      await page.route(`${baseURL}/**`, async (route) => {
        const relative = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "")
        const file = resolve(directory, relative || "index.html")
        if (!file.startsWith(directory + sep)) return route.abort()
        try {
          await route.fulfill({
            body: await readFile(file),
            contentType: mime[extname(file)] ?? "application/octet-stream",
          })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
          if (!route.request().isNavigationRequest())
            return route.fulfill({ status: 404, body: "Missing production asset" })
          await route.fulfill({ body: await readFile(resolve(directory, "index.html")), contentType: "text/html" })
        }
      })
    }
    if (officeApi) {
      await page.route(/^http:\/\/(127\.0\.0\.1|localhost):4096\//, async (route) => {
        const request = route.request()
        if (officeApi.origin) {
          const url = new URL(request.url())
          return route.continue({ url: officeApi.origin + url.pathname + url.search })
        }
        const reply = await officeApi.request({
          url: request.url(),
          method: request.method(),
          headers: await request.allHeaders(),
          body: request.postDataBuffer()?.toString("base64"),
        })
        const headers: Record<string, string> = { ...reply.headers, "access-control-allow-origin": "*" }
        delete headers["content-length"]
        delete headers["transfer-encoding"]
        await route.fulfill({ status: reply.status, headers, body: Buffer.from(reply.body, "base64") })
      })
    }
    await use(page)
  },
})

export { expect }
