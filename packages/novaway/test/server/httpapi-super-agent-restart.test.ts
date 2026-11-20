import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import net from "node:net"

let port = 0
let serverURL = ""
const root = process.cwd()
const tempRoot = path.join(os.tmpdir(), `novaway-super-agent-restart-${Date.now()}`)
const database = path.join(tempRoot, "super-agent.sqlite")
const workspace = path.join(tempRoot, "workspace")
let child: ReturnType<typeof Bun.spawn> | undefined

async function reservePort() {
  return await new Promise<number>((resolve, reject) => {
    const probe = net.createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      const selected = typeof address === "object" && address ? address.port : 0
      probe.close((error) => (error ? reject(error) : resolve(selected)))
    })
  })
}

async function waitForServer() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${serverURL}/super-agent/runs`, {
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

function startServer() {
  const env: Record<string, string | undefined> = { ...process.env, NOVAWAY_DB: database, NOVAWAY_DISABLE_AUTOPROVISION: "1" }
  delete env.NOVAWAY_SERVER_PASSWORD
  child = Bun.spawn(
    [process.execPath, "--env-file=../../.env.local", "run", "--conditions=browser", "./src/index.ts", "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: root, env, stdout: "inherit", stderr: "inherit" },
  )
  return child
}

async function stopServer() {
  const running = child
  child = undefined
  if (!running) return
  running.kill()
  await running.exited
}

async function request(pathname: string, init?: RequestInit) {
  return fetch(`${serverURL}${pathname}`, {
    ...init,
    headers: {
      "x-novaway-directory": workspace,
      ...(init?.headers ?? {}),
    },
  })
}

afterAll(async () => {
  await stopServer()
  await fs.rm(tempRoot, { recursive: true, force: true })
})

describe("Super-Agent backend restart recovery", () => {
  test("reloads the durable Run, event outbox, and mutation history after a backend restart", async () => {
    port = await reservePort()
    serverURL = `http://127.0.0.1:${port}`
    await fs.mkdir(tempRoot, { recursive: true })
    await fs.mkdir(workspace, { recursive: true })
    startServer()
    await waitForServer()

    const createdResponse = await request("/super-agent/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: { text: "survive a backend restart", acceptanceCriteria: [] } }),
    })
    expect(createdResponse.status).toBe(200)
    const created = (await createdResponse.json()) as { id: string; graph: { version: number; nodes: unknown[] } }

    const updatedGraph = {
      ...created.graph,
      nodes: (created.graph.nodes as Array<Record<string, unknown>>).map((node) => ({ ...node, title: "Persisted after restart" })),
    }
    const updateResponse = await request(`/super-agent/runs/${created.id}/graph`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: created.graph.version, graph: updatedGraph }),
    })
    expect(updateResponse.status).toBe(200)
    const createdEvents = await request(`/super-agent/runs/${created.id}/events`)
    expect(createdEvents.status).toBe(200)
    expect(((await createdEvents.json()) as Array<{ type: string }>).some((event) => event.type === "run_created")).toBe(true)

    await stopServer()
    startServer()
    await waitForServer()

    const loaded = await request(`/super-agent/runs/${created.id}`)
    expect(loaded.status).toBe(200)
    const run = (await loaded.json()) as { graph: { version: number; nodes: Array<{ title: string }> } }
    expect(run.graph.version).toBe(2)
    expect(run.graph.nodes[0]?.title).toBe("Persisted after restart")

    const mutations = await request(`/super-agent/runs/${created.id}/task-mutations`)
    expect(mutations.status).toBe(200)
    expect(((await mutations.json()) as Array<{ graphVersion: number }>).some((item) => item.graphVersion === 2)).toBe(true)
    const events = await request(`/super-agent/runs/${created.id}/events`)
    expect(events.status).toBe(200)
  }, 90_000)
})
