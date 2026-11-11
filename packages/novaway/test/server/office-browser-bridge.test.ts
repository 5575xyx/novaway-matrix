import { test } from "bun:test"
import { createInterface } from "node:readline"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { disposeAllInstances } from "../fixture/fixture"

/**
 * Optional browser-test transport: real HttpApi handlers and real file IO.
 * Run only via the app's OFFICE_IN_PROCESS_API=1 Playwright fixture. The backend package
 * preload isolates config/database/home. OFFICE_BROWSER_TCP=1 creates a test-owned
 * random-port listener with sustained SSE; otherwise stdio forwards the initial frame only.
 * It never restarts, reloads or stops any pre-existing app/server.
 */
test.skipIf(process.env.OFFICE_BROWSER_BRIDGE !== "1")(
  "Office browser request bridge",
  async () => {
    const tasks = new Set<Promise<void>>()
    const controllers = new Set<AbortController>()
    const lines = createInterface({ input: process.stdin })
    const send = (value: object) => console.log("OFFICE_BROWSER_API " + JSON.stringify(value))
    const listener =
      process.env.OFFICE_BROWSER_TCP === "1"
        ? Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            idleTimeout: 0,
            async fetch(request) {
              // Test-owned transport only. Business requests run unmodified production handlers;
              // the listener keeps SSE streams alive instead of fabricating/replaying events.
              const response =
                request.method === "OPTIONS"
                  ? new Response(null, { status: 204 })
                  : await HttpApiApp.webHandler().handler(request, HttpApiApp.context)
              const headers = new Headers(response.headers)
              headers.set("access-control-allow-origin", request.headers.get("origin") ?? "*")
              headers.set("access-control-allow-headers", "*")
              headers.set("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
              return new Response(response.body, { status: response.status, headers })
            },
          })
        : undefined
    send({ ready: true, origin: listener?.url.origin })
    for await (const line of lines) {
      if (line === "shutdown") break
      const input = JSON.parse(line) as {
        id: number
        url: string
        method: string
        headers: Record<string, string>
        body?: string
      }
      const controller = new AbortController()
      controllers.add(controller)
      const task = (async () => {
        const request = new Request(input.url, {
          signal: controller.signal,
          method: input.method,
          headers: input.headers,
          ...(input.body ? { body: Buffer.from(input.body, "base64") } : {}),
        })
        const response = await HttpApiApp.webHandler().handler(request, HttpApiApp.context)
        const streaming = response.headers.get("content-type")?.includes("text/event-stream")
        const reader = streaming ? response.body?.getReader() : undefined
        const bytes = reader
          ? ((await reader.read()).value ?? new Uint8Array())
          : new Uint8Array(await response.arrayBuffer())
        if (reader) {
          controller.abort()
          void reader.cancel().catch(() => {})
        }
        send({
          id: input.id,
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(bytes).toString("base64"),
        })
      })().catch((error: unknown) => {
        send({ id: input.id, error: String(error) })
      })
      tasks.add(task)
      void task.finally(() => {
        tasks.delete(task)
        controllers.delete(controller)
      })
    }
    // Stop only the random-port listener created by this test; never touch a pre-existing server.
    await listener?.stop(true)
    for (const controller of controllers) controller.abort()
    await Promise.all(tasks)
    await disposeAllInstances()
  },
  600_000,
)
