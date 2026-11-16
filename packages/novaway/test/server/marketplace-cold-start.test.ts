import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import net from "node:net"
import { digest, extract, unwrap, validateArtifactUrl } from "../../src/extension/marketplace"

const root = process.cwd()
const tempRoot = path.join(os.tmpdir(), `novaway-marketplace-cold-start-${Date.now()}`)
const config = path.join(tempRoot, "xdg-config", "novaway")
const home = path.join(tempRoot, "home")
const workspace = path.join(tempRoot, "workspace")
const database = path.join(tempRoot, "novaway.sqlite")
let port = 0
let child: ReturnType<typeof Bun.spawn> | undefined

async function reservePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const selected = typeof address === "object" && address ? address.port : 0
      server.close((error) => (error ? reject(error) : resolve(selected)))
    })
  })
}

async function request(pathname: string, init?: RequestInit) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...init,
    headers: { "x-novaway-directory": workspace, ...(init?.headers ?? {}) },
  })
}

async function waitForServer() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await request("/skill", { signal: AbortSignal.timeout(1_000) })
      if (response.status < 500) return
    } catch {
      // The test-owned backend is still booting.
    }
    await Bun.sleep(100)
  }
  throw new Error("fresh NovaWay backend did not start")
}

async function downloadPublicArtifact() {
  const url =
    "https://github.com/NovaWay-AI/novaway-plugins/releases/download/com.novaway.marketplace-smoke-v0.1.1/com.novaway.marketplace-smoke-0.1.1.zip"
  await validateArtifactUrl(url)
  const args = ["-L", "--fail", "--silent", "--show-error", "-A", "novaway-marketplace-test", url]
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const command of ["curl.exe", "curl"]) {
      try {
        const process = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" })
        const [exitCode, bytes, errorText] = await Promise.all([
          process.exited,
          new Response(process.stdout).arrayBuffer(),
          new Response(process.stderr).text(),
        ])
        if (exitCode === 0) return Buffer.from(bytes)
        lastError = new Error(`${command} public artifact downloader exited with ${exitCode}: ${errorText}`)
      } catch (error) {
        lastError = error
      }
    }
    await Bun.sleep(1_000 * (attempt + 1))
  }
  throw lastError
}

async function startServer() {
  const env: Record<string, string | undefined> = {
    ...process.env,
    NOVAWAY_CONFIG_DIR: config,
    NOVAWAY_TEST_HOME: home,
    NOVAWAY_DB: database,
    NOVAWAY_DISABLE_AUTOPROVISION: "1",
    XDG_CONFIG_HOME: path.join(tempRoot, "xdg-config"),
    XDG_DATA_HOME: path.join(tempRoot, "xdg-data"),
    XDG_CACHE_HOME: path.join(tempRoot, "xdg-cache"),
    XDG_STATE_HOME: path.join(tempRoot, "xdg-state"),
  }
  delete env.NOVAWAY_SERVER_PASSWORD
  child = Bun.spawn(
    [process.execPath, "--env-file=../../.env.local", "run", "--conditions=browser", "./src/index.ts", "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: root, env, stdout: "ignore", stderr: "pipe" },
  )
  await waitForServer()
}

async function stopServer() {
  const running = child
  child = undefined
  if (!running) return
  running.kill()
  await running.exited
}

afterAll(async () => {
  await stopServer()
  await fs.rm(tempRoot, { recursive: true, force: true })
})

describe("marketplace fresh-process cold start", () => {
  test("discovers, activates and serves a persisted marketplace Skill in a new process", async () => {
    port = await reservePort()
    const packageRoot = path.join(config, "marketplace", "com.novaway.cold-start@1.0.0")
    await fs.mkdir(packageRoot, { recursive: true })
    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(workspace, { recursive: true })
    await fs.writeFile(
      path.join(packageRoot, "plugin.json"),
      JSON.stringify({
        name: "cold-start-plugin",
        version: "1.0.0",
        apiVersion: 2,
        kind: "declarative",
        contributes: {
          skills: [{ id: "cold", description: "cold start proof", source: { text: "fresh process skill" } }],
        },
      }),
    )
    await fs.writeFile(
      path.join(packageRoot, ".novaway-install.json"),
      JSON.stringify({ name: "com.novaway.cold-start", kind: "zip", version: "1.0.0", source: "fresh-test", installedAt: Date.now() }),
    )

    await startServer()
    const discovered = await request("/plugin")
    expect(discovered.status).toBe(200)
    expect((await discovered.json()).instances).toContainEqual(expect.objectContaining({ id: "cold-start-plugin", status: "installed" }))

    const enabled = await request("/plugin/cold-start-plugin", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    expect(enabled.status).toBe(200)

    const skills = await request("/skill")
    expect(skills.status).toBe(200)
    expect(await skills.json()).toContainEqual(expect.objectContaining({ name: "cold-start-plugin_cold", content: "fresh process skill" }))

    // The second boot uses the immutable public Release artifact, not a local fixture.
    await stopServer()
    await fs.rm(config, { recursive: true, force: true })
    const publicPackageRoot = path.join(config, "marketplace", "com.novaway.marketplace-smoke@0.1.1")
    const publicArtifact = await downloadPublicArtifact()
    expect(publicArtifact.byteLength).toBe(1878)
    expect(digest(publicArtifact)).toBe("b003d4f13d09048d37b3460ceb91531fffbc06ae2023b8bc696924919e66c547")
    await extract(publicArtifact, publicPackageRoot)
    await unwrap(publicPackageRoot)
    await fs.writeFile(
      path.join(publicPackageRoot, ".novaway-install.json"),
      JSON.stringify({
        name: "com.novaway.marketplace-smoke",
        kind: "zip",
        version: "0.1.1",
        source:
          "https://github.com/NovaWay-AI/novaway-plugins/releases/download/com.novaway.marketplace-smoke-v0.1.1/com.novaway.marketplace-smoke-0.1.1.zip",
        sha256: "b003d4f13d09048d37b3460ceb91531fffbc06ae2023b8bc696924919e66c547",
        installedAt: Date.now(),
      }),
    )
    port = await reservePort()
    await startServer()
    const publicDiscovery = await request("/plugin")
    expect(publicDiscovery.status).toBe(200)
    expect((await publicDiscovery.json()).instances).toContainEqual(
      expect.objectContaining({ id: "marketplace-smoke", status: "installed" }),
    )
    const publicEnabled = await request("/plugin/marketplace-smoke", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    expect(publicEnabled.status).toBe(200)
    const publicSkills = await request("/skill")
    expect(publicSkills.status).toBe(200)
    const publicSkillList = (await publicSkills.json()) as Array<{ name?: string; content?: string }>
    expect(publicSkillList.some((item) => item.name?.includes("marketplace-smoke") && item.content?.includes("official marketplace"))).toBe(true)
  }, 120_000)
})
