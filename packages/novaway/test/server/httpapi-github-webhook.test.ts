import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const root = path.join(import.meta.dir, "../..")
const tempRoot = path.join(os.tmpdir(), `novaway-github-webhook-${Date.now()}-${Math.random().toString(36).slice(2)}`)
const database = path.join(tempRoot, "workflow.sqlite")
const workspace = path.join(tempRoot, "workspace")
const secret = "route-e2e-webhook-secret"
const serverURL = { value: "" }
let child: ReturnType<typeof Bun.spawn> | undefined

async function reservePort() {
  return await new Promise<number>((resolve, reject) => {
    const probe = net.createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      const port = typeof address === "object" && address ? address.port : 0
      probe.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

async function waitForServer() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${serverURL.value}/session`, {
        headers: { "x-novaway-directory": workspace },
        signal: AbortSignal.timeout(1_000),
      })
      if (response.status < 500) return
    } catch {
      // The test-owned server is still booting.
    }
    await Bun.sleep(100)
  }
  throw new Error("test-owned NovaWay backend did not start")
}

async function request(pathname: string, init?: RequestInit) {
  return fetch(`${serverURL.value}${pathname}`, {
    ...init,
    headers: { "x-novaway-directory": workspace, ...(init?.headers ?? {}) },
  })
}

function signature(rawBody: string) {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`
}

beforeAll(async () => {
  await fs.mkdir(workspace, { recursive: true })
  const port = await reservePort()
  serverURL.value = `http://127.0.0.1:${port}`
  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: "production",
    NOVAWAY_DB: database,
    NOVAWAY_DISABLE_AUTOPROVISION: "1",
    NOVAWAY_GITHUB_WEBHOOK_SECRET: secret,
  }
  delete env.NOVAWAY_SERVER_PASSWORD
  child = Bun.spawn(
    [process.execPath, "--env-file=../../.env.local", "run", "--conditions=browser", "./src/index.ts", "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: root, env, stdout: "inherit", stderr: "inherit" },
  )
  await waitForServer()
})

afterAll(async () => {
  const running = child
  child = undefined
  if (running) {
    running.kill()
    await running.exited
  }
  await fs.rm(tempRoot, { recursive: true, force: true })
})

describe("GitHub webhook raw-body route", () => {
  test("accepts the exact signed body and rejects tampering or missing signatures", async () => {
    const sessionResponse = await request("/session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    expect(sessionResponse.status).toBe(200)
    const session = (await sessionResponse.json()) as { id?: string }
    expect(typeof session.id).toBe("string")

    const rawBody = JSON.stringify({ event: "check_run", deliveryID: "route-delivery-1", payload: { action: "completed", check_run: { name: "ci" } } })
    const initialState = await request(`/session/${session.id}/workflow-state`)
    expect(initialState.status).toBe(200)
    expect(await initialState.json()).toBeNull()


    const pathName = `/session/${session.id}/workflow-webhooks/github`
    const accepted = await request(pathName, {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "check_run", "x-github-delivery": "route-delivery-1", "x-hub-signature-256": signature(rawBody) },
      body: rawBody,
    })
    const acceptedBody = await accepted.text()
    if (accepted.status !== 200) throw new Error(`webhook response ${accepted.status}: ${acceptedBody}`)
    expect(accepted.status).toBe(200)

    const eventsResponse = await request(`/session/${session.id}/workflow-events`)
    expect(eventsResponse.status).toBe(200)
    const events = (await eventsResponse.json()) as Array<{ type?: string; payload?: { deliveryID?: string } }>
    expect(events.filter((event) => event.type === "integration.check" && event.payload?.deliveryID === "route-delivery-1")).toHaveLength(1)
    expect(events.filter((event) => event.type === "memory.evidence")).toHaveLength(1)

    const replay = await request(pathName, {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "check_run", "x-github-delivery": "route-delivery-1", "x-hub-signature-256": signature(rawBody) },
      body: rawBody,
    })
    expect(replay.status).toBe(200)

    const wrongEventHeader = await request(pathName, {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "push", "x-github-delivery": "route-delivery-2", "x-hub-signature-256": signature(rawBody) },
      body: rawBody,
    })
    expect(wrongEventHeader.status).toBe(400)

    const wrongDeliveryHeader = await request(pathName, {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "check_run", "x-github-delivery": "route-delivery-2", "x-hub-signature-256": signature(rawBody) },
      body: rawBody,
    })
    expect(wrongDeliveryHeader.status).toBe(400)

    const wrongSecret = await request(pathName, {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "check_run", "x-github-delivery": "route-delivery-2", "x-hub-signature-256": `sha256=${createHmac("sha256", "wrong-secret").update(rawBody).digest("hex")}` },
      body: rawBody,
    })
    expect(wrongSecret.status).toBe(400)

    const tampered = await request(pathName, {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "check_run", "x-github-delivery": "route-delivery-1", "x-hub-signature-256": signature(rawBody) },
      body: `${rawBody} `,
    })
    expect(tampered.status).toBe(400)

    const missing = await request(pathName, {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "check_run", "x-github-delivery": "route-delivery-1" },
      body: rawBody,
    })
    expect(missing.status).toBe(400)
  })
})
