import { expect, test } from "@playwright/test"
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import { resolve } from "node:path"

const directory = resolve(process.cwd(), "..", "..")
const backend = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4199"}`
const workspaceSlugFor = (workspaceDirectory: string) =>
  Buffer.from(workspaceDirectory, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const workspaceSlug = () => workspaceSlugFor(directory)

async function apiFor(
  page: import("@playwright/test").Page,
  workspaceDirectory: string,
  pathname: string,
  init?: RequestInit,
) {
  return page.evaluate(
    async ({ endpoint, workspaceDirectory, pathname, init }) => {
      const response = await fetch(`${endpoint}${pathname}`, {
        ...init,
        headers: { "x-novaway-directory": workspaceDirectory, ...(init?.headers ?? {}) },
      })
      return { status: response.status, body: (await response.json().catch(() => undefined)) as unknown }
    },
    { endpoint: backend, workspaceDirectory, pathname, init },
  )
}

async function api(page: import("@playwright/test").Page, pathname: string, init?: RequestInit) {
  return apiFor(page, directory, pathname, init)
}

test("Super-Agent panel sends configured server credentials", async ({ page }) => {
  const port = Number(process.env.PLAYWRIGHT_AUTH_SERVER_PORT ?? 4200)
  const password = "super-agent-browser-secret"
  const tempRoot = resolve(os.tmpdir(), `novaway-super-agent-browser-auth-${Date.now()}`)
  const database = resolve(tempRoot, "super-agent.sqlite")
  const backendRoot = resolve(directory, "packages", "novaway")
  const bun = process.env.BUN_INSTALL
    ? resolve(process.env.BUN_INSTALL, "bin", process.platform === "win32" ? "bun.exe" : "bun")
    : "bun"
  const endpoint = `http://127.0.0.1:${port}`
  let child: ReturnType<typeof spawn> | undefined

  const start = () => {
    child = spawn(
      bun,
      [
        "--env-file=../../.env.local",
        "run",
        "--conditions=browser",
        "./src/index.ts",
        "serve",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: backendRoot,
        env: {
          ...process.env,
          NOVAWAY_DB: database,
          NOVAWAY_SERVER_USERNAME: "NovaWay",
          NOVAWAY_SERVER_PASSWORD: password,
          NOVAWAY_DISABLE_AUTOPROVISION: "1",
        },
        stdio: "ignore",
      },
    )
  }

  const stop = async () => {
    const running = child
    child = undefined
    if (!running) return
    if (process.platform === "win32" && running.pid) {
      try {
        execFileSync("taskkill", ["/PID", String(running.pid), "/T", "/F"], { stdio: "ignore" })
      } catch {
        // The process may already have exited before taskkill ran.
      }
    } else {
      running.kill()
    }
    await Promise.race([
      new Promise<void>((resolveExit) => {
        if (running.exitCode !== null) return resolveExit()
        running.once("close", () => resolveExit())
      }),
      new Promise<void>((resolveExit) => setTimeout(resolveExit, 5_000)),
    ])
  }

  const waitForBackend = async () => {
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${endpoint}/super-agent/runs`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`NovaWay:${password}`).toString("base64")}`,
            "x-novaway-directory": directory,
          },
          signal: AbortSignal.timeout(1_000),
        })
        if (response.status < 500) return
      } catch {
        // The test-owned backend is still starting.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
    throw new Error("test-owned authenticated Super-Agent backend did not start")
  }

  await fs.mkdir(tempRoot, { recursive: true })
  await page.addInitScript(
    ({ serverURL, serverPassword }) => {
      const value = JSON.stringify({
        list: [{ type: "http", http: { url: serverURL, username: "NovaWay", password: serverPassword } }],
        projects: {},
        lastProject: {},
      })
      localStorage.setItem("novaway.global.dat:server", value)
      localStorage.setItem("novaway.global.dat:server.v3", value)
    },
    { serverURL: endpoint, serverPassword: password },
  )

  try {
    start()
    await waitForBackend()
    await page.goto(`/${workspaceSlug()}/session`)
    await page.getByText("Super-Agent", { exact: true }).last().click()
    await expect(page.locator('[data-component="super-agent-panel"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText("No Super-Agent runs", { exact: true })).toBeVisible()
    await page.getByLabel("Super-Agent goal").fill(`Authenticated browser goal ${Date.now()}`)
    await page.getByLabel("Super-Agent acceptance criteria").fill("authenticated request succeeds")
    await page.getByRole("button", { name: "Create Run" }).click()
    await expect(page.locator('[data-component="super-agent-details"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText("HTTP 401", { exact: true })).toHaveCount(0)
  } finally {
    await stop()
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  }
})

test("Super-Agent panel persists a run through reload and lifecycle controls", async ({ page }) => {
  await page.goto(`/${workspaceSlug()}/session`)
  await page.getByText("Super-Agent", { exact: true }).last().click()
  await expect(page.locator('[data-component="super-agent-panel"]')).toBeVisible({ timeout: 20_000 })
  await page.getByLabel("Super-Agent goal").fill(`Chromium goal ${Date.now()}`)
  await page.getByLabel("Super-Agent acceptance criteria").fill("run exists")
  await page.getByRole("button", { name: "Create Run" }).click()
  await expect(page.locator('[data-component="super-agent-details"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText("Run details", { exact: true })).toBeVisible()
  const runID = await page.locator("[data-run-id]").first().getAttribute("data-run-id")
  expect(runID).toBeTruthy()
  const taskID = await page.evaluate(
    async ({ endpoint, directory, runID }) => {
      const headers = { "x-novaway-directory": directory }
      const response = await fetch(`${endpoint}/super-agent/runs/${runID}`, { headers })
      const body = (await response.json()) as { graph: { rootTaskID: string } }
      return body.graph.rootTaskID
    },
    { endpoint: backend, directory, runID },
  )
  const approvalResponse = await page.evaluate(
    async ({ endpoint, directory, runID, taskID }) => {
      const response = await fetch(`${endpoint}/super-agent/runs/${runID}/approvals`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-novaway-directory": directory },
        body: JSON.stringify({
          id: `${runID}:approval:chromium`,
          taskID,
          reason: "Run the browser golden path",
          scope: "tool:fixture",
        }),
      })
      return response.status
    },
    { endpoint: backend, directory, runID, taskID },
  )
  expect(approvalResponse).toBe(200)
  await page.reload()
  await page.getByText("Super-Agent", { exact: true }).last().click()
  await page.locator("[data-run-id]").first().click()
  await expect(page.getByText("Run the browser golden path", { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.getByRole("button", { name: "Approve" }).click()
  await expect(page.getByText("approved · tool:fixture", { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.getByRole("button", { name: "Start" }).last().click()
  await expect(page.getByText("Running", { exact: true }).last()).toBeVisible({ timeout: 10_000 })
  await page.getByRole("button", { name: "Pause" }).last().click()
  await expect(page.getByText("Paused", { exact: true }).last()).toBeVisible({ timeout: 10_000 })
  await page.getByRole("button", { name: "Resume" }).last().click()
  await expect(page.getByText("Running", { exact: true }).last()).toBeVisible({ timeout: 10_000 })
  await page.reload()
  await page.getByText("Super-Agent", { exact: true }).last().click()
  await expect(page.locator('[data-component="super-agent-panel"]')).toBeVisible({ timeout: 20_000 })
})

test("Chromium reconnects to a persisted Super-Agent run after a transient offline period", async ({
  page,
  context,
}) => {
  await page.goto(`/${workspaceSlug()}/session`)
  const created = await api(page, "/super-agent/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: { text: `Browser reconnect ${Date.now()}`, acceptanceCriteria: [] } }),
  })
  expect(created.status).toBe(200)
  const run = created.body as { id: string }

  await page.getByText("Super-Agent", { exact: true }).last().click()
  await page.getByRole("button", { name: "Refresh" }).click()
  await page.locator(`[data-run-id="${run.id}"]`).click()
  await expect(page.getByText("Status: Draft", { exact: true })).toBeVisible()

  await context.setOffline(true)
  await page.getByRole("button", { name: "Refresh" }).click()
  await context.setOffline(false)
  await page.getByRole("button", { name: "Refresh" }).click()
  await page.locator(`[data-run-id="${run.id}"]`).click()
  await expect(page.getByText("Status: Draft", { exact: true })).toBeVisible()
  await expect(page.getByText("Run details", { exact: true })).toBeVisible()
})

test("Chromium runs parallel plugin Agents, preserves a sibling failure, and blocks after disable", async ({
  page,
}) => {
  const workspaceDirectory = await fs.mkdtemp(resolve(os.tmpdir(), "novaway-super-agent-plugin-browser-"))
  const pluginRoot = resolve(workspaceDirectory, ".novaway", "extensions", "browser-parallel-runtime")
  await fs.mkdir(pluginRoot, { recursive: true })
  await fs.writeFile(
    resolve(pluginRoot, "plugin.json"),
    JSON.stringify({
      name: "browser-parallel-runtime",
      apiVersion: 2,
      kind: "declarative",
      contributes: {
        agentRuntimes: [
          {
            id: "browser.fixture-agent",
            version: "1",
            runtimeType: "browser-fixture-runtime",
            capabilities: ["agent"],
            entry: "./runtime.mjs",
            supports: { streaming: false, pause: false, resume: false, cancellation: true },
          },
        ],
      },
    }),
  )
  await fs.writeFile(
    resolve(pluginRoot, "runtime.mjs"),
    `const sessions = new Map()
export default {
  id: "browser.fixture-agent",
  version: "1",
  type: "browser-fixture-runtime",
  discover: async () => [],
  start: async (input) => {
    const id = input.runID + ":" + input.taskID + ":" + Math.random()
    sessions.set(id, input.instruction)
    return { id, runID: input.runID, taskID: input.taskID }
  },
  send: async () => undefined,
  events: async function* (handle) {
    yield { type: "started", at: Date.now() }
    if (sessions.get(handle.id) === "fail") yield { type: "failed", at: Date.now(), code: "fixture_failure", message: "parallel fixture failed" }
    else yield { type: "completed", at: Date.now(), output: { instruction: sessions.get(handle.id) } }
  },
  pause: async () => ({ checkpointID: "fixture-checkpoint" }),
  resume: async () => undefined,
  cancel: async () => undefined,
  dispose: async (handle) => { sessions.delete(handle.id) },
}
`,
  )
  try {
    const slug = workspaceSlugFor(workspaceDirectory)
    await page.goto(`/${slug}/session`)
    const plugins = await apiFor(page, workspaceDirectory, "/plugin")
    expect(plugins.status).toBe(200)
    expect(plugins.body).toMatchObject({
      instances: expect.arrayContaining([expect.objectContaining({ id: "browser-parallel-runtime" })]),
    })
    const enabled = await apiFor(page, workspaceDirectory, "/plugin/browser-parallel-runtime", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, scope: "project" }),
    })
    expect(enabled.status).toBe(200)

    const created = await apiFor(page, workspaceDirectory, "/super-agent/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: { text: "parallel plugin agents", acceptanceCriteria: [] },
        budget: { childAgents: 4 },
      }),
    })
    expect(created.status).toBe(200)
    const run = created.body as { id: string; graph: { rootTaskID: string } }
    const delegated = await apiFor(page, workspaceDirectory, `/super-agent/runs/${run.id}/delegate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskID: run.graph.rootTaskID,
        runtimeType: "browser-fixture-runtime",
        calls: [
          { agentID: "browser.fixture-agent", instruction: "keep" },
          { agentID: "browser.fixture-agent", instruction: "fail" },
        ],
      }),
    })
    expect(delegated.status).toBe(200)
    expect(delegated.body).toMatchObject({ result: { type: "agent_failed", code: "child_agent_partial_failure" } })
    const delegatedRun = delegated.body as {
      run: { graph: { nodes: Array<{ kind: string; status: string; output?: unknown }> } }
    }
    const children = delegatedRun.run.graph.nodes.filter((node) => node.kind === "child-agent")
    expect(children).toHaveLength(2)
    expect(children.filter((node) => node.status === "succeeded")).toHaveLength(1)
    expect(children.filter((node) => node.status === "failed")).toHaveLength(1)

    const disabled = await apiFor(page, workspaceDirectory, "/plugin/browser-parallel-runtime", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, scope: "project" }),
    })
    expect(disabled.status).toBe(200)
    const blocked = await apiFor(page, workspaceDirectory, `/super-agent/runs/${run.id}/delegate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskID: run.graph.rootTaskID,
        runtimeType: "browser-fixture-runtime",
        agentID: "browser.fixture-agent",
        instruction: "keep",
      }),
    })
    expect(blocked.status).not.toBe(200)
  } finally {
    await fs
      .rm(workspaceDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
      .catch(() => undefined)
  }
})

test("Chromium reloads durable state after a test-owned backend restart", async ({ page }) => {
  const port = Number(process.env.PLAYWRIGHT_SERVER_PORT ?? 4198)
  const tempRoot = resolve(os.tmpdir(), `novaway-super-agent-browser-restart-${Date.now()}`)
  const database = resolve(tempRoot, "super-agent.sqlite")
  const backendRoot = resolve(directory, "packages", "novaway")
  const bun = process.env.BUN_INSTALL
    ? resolve(process.env.BUN_INSTALL, "bin", process.platform === "win32" ? "bun.exe" : "bun")
    : "bun"
  const endpoint = `http://127.0.0.1:${port}`
  let child: ReturnType<typeof spawn> | undefined

  const start = () => {
    child = spawn(
      bun,
      [
        "--env-file=../../.env.local",
        "run",
        "--conditions=browser",
        "./src/index.ts",
        "serve",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: backendRoot,
        env: { ...process.env, NOVAWAY_DB: database, NOVAWAY_SERVER_PASSWORD: "", NOVAWAY_DISABLE_AUTOPROVISION: "1" },
        stdio: "ignore",
      },
    )
  }
  const stop = async () => {
    const running = child
    child = undefined
    if (!running) return
    if (process.platform === "win32" && running.pid) {
      try {
        execFileSync("taskkill", ["/PID", String(running.pid), "/T", "/F"], { stdio: "ignore" })
      } catch {
        // The process may already have exited before taskkill ran.
      }
    } else {
      running.kill()
    }
    await Promise.race([
      new Promise<void>((resolveExit) => {
        if (running.exitCode !== null) return resolveExit()
        running.once("close", () => resolveExit())
      }),
      new Promise<void>((resolveExit) => setTimeout(resolveExit, 5_000)),
    ])
  }
  const waitForBackend = async () => {
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${endpoint}/super-agent/runs`, {
          headers: { "x-novaway-directory": directory },
          signal: AbortSignal.timeout(1_000),
        })
        if (response.status < 500) return
      } catch {
        // The test-owned backend is still starting.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
    throw new Error("test-owned browser restart backend did not start")
  }

  await fs.mkdir(tempRoot, { recursive: true })
  try {
    await page.goto(`/${workspaceSlug()}/session`)
    start()
    await waitForBackend()
    const created = await api(page, "/super-agent/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: { text: `Browser backend restart ${Date.now()}`, acceptanceCriteria: [] } }),
    })
    expect(created.status).toBe(200)
    const run = created.body as { id: string; graph: { version: number; nodes: Array<Record<string, unknown>> } }
    const graph = {
      ...run.graph,
      nodes: run.graph.nodes.map((node) => ({ ...node, title: "Persisted in browser restart" })),
    }
    expect(
      (
        await api(page, `/super-agent/runs/${run.id}/graph`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedVersion: run.graph.version, graph }),
        })
      ).status,
    ).toBe(200)

    await page.goto(`/${workspaceSlug()}/session`)
    await page.getByText("Super-Agent", { exact: true }).last().click()
    await page.getByRole("button", { name: "Refresh" }).click()
    await page.locator(`[data-run-id="${run.id}"]`).click()
    await expect(page.getByText("Persisted in browser restart", { exact: true })).toBeVisible()

    await stop()
    start()
    await waitForBackend()
    await page.reload()
    await page.getByText("Super-Agent", { exact: true }).last().click()
    await page.getByRole("button", { name: "Refresh" }).click()
    await page.locator(`[data-run-id="${run.id}"]`).click()
    await expect(page.getByText("Persisted in browser restart", { exact: true })).toBeVisible()
    await expect(page.getByText("graph v2", { exact: true })).toBeVisible()
    const mutations = await api(page, `/super-agent/runs/${run.id}/task-mutations`)
    expect(mutations.status).toBe(200)
    expect(mutations.body).toEqual(expect.arrayContaining([expect.objectContaining({ graphVersion: 2 })]))
  } finally {
    await stop()
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  }
})

test("Chromium drives failed verification through repair and completion", async ({ page }) => {
  await page.goto(`/${workspaceSlug()}/session`)
  const created = await api(page, "/super-agent/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: {
        text: `Browser repair ${Date.now()}`,
        acceptanceCriteria: [{ id: "checks", text: "checks pass", required: true }],
      },
    }),
  })
  expect(created.status).toBe(200)
  const run = created.body as {
    id: string
    graph: { version: number; rootTaskID: string; nodes: Array<Record<string, unknown>> }
  }
  expect((await api(page, `/super-agent/runs/${run.id}/start`, { method: "POST" })).status).toBe(200)
  const graph = {
    ...run.graph,
    nodes: run.graph.nodes.map((node) =>
      node.id === run.graph.rootTaskID ? { ...node, input: { tool: "sleep", input: { duration_ms: 0 } } } : node,
    ),
  }
  expect(
    (
      await api(page, `/super-agent/runs/${run.id}/graph`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: run.graph.version, graph }),
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await api(page, `/super-agent/runs/${run.id}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "verifying" }),
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await api(page, `/super-agent/runs/${run.id}/evidence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: `${run.id}:evidence:failed`,
          taskID: run.graph.rootTaskID,
          kind: "test",
          source: "chromium",
          measured: "fail",
        }),
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await api(page, `/super-agent/runs/${run.id}/verifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: `${run.id}:verification:failed`,
          taskID: run.graph.rootTaskID,
          acceptanceID: "checks",
          verifierID: "builtin.test",
          verifierVersion: "1",
          outcome: "fail",
          evidenceIDs: [`${run.id}:evidence:failed`],
          reason: "browser fixture failure",
        }),
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await api(page, `/super-agent/runs/${run.id}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "needs_review" }),
      })
    ).status,
  ).toBe(200)
  const repair = await api(page, `/super-agent/runs/${run.id}/repair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceTaskID: run.graph.rootTaskID,
      failedVerificationIDs: [`${run.id}:verification:failed`],
      strategyID: "builtin.repair",
    }),
  })
  expect(repair.status).toBe(200)
  const repairTask = (repair.body as { task: { id: string } }).task
  const executed = await api(page, `/super-agent/runs/${run.id}/repair/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskID: repairTask.id,
      sessionID: "chromium-repair-session",
      messageID: "chromium-repair-message",
      evidenceKind: "artifact",
      verifyAfter: true,
      verifierID: "builtin.artifact",
      summary: "browser repair completed",
    }),
  })
  expect(executed.status).toBe(200)
  expect(executed.body).toMatchObject({ completed: false, run: { status: "needs_review" } })
  const repairEvidence = await api(page, `/super-agent/runs/${run.id}/evidence`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: `${run.id}:evidence:repair-pass`,
      taskID: run.graph.rootTaskID,
      kind: "test",
      source: "chromium-repair",
      acceptanceIDs: ["checks"],
      measured: "pass",
    }),
  })
  expect(repairEvidence.status).toBe(200)
  const finished = await api(page, `/super-agent/runs/${run.id}/verify-finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verifierID: "builtin.test", summary: "browser repair acceptance passed" }),
  })
  expect(finished.status).toBe(200)
  expect(finished.body).toMatchObject({ completed: true, run: { status: "completed" } })
  const evidence = await api(page, `/super-agent/runs/${run.id}/evidence`)
  expect(evidence.status).toBe(200)
  expect(evidence.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: `${run.id}:evidence:failed`, measured: "fail" }),
      expect.objectContaining({ kind: "artifact", source: "tool:sleep", measured: "tool execution completed" }),
    ]),
  )
  const verifications = await api(page, `/super-agent/runs/${run.id}/verifications`)
  expect(verifications.status).toBe(200)
  expect(verifications.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: `${run.id}:verification:failed`, outcome: "fail" }),
      expect.objectContaining({ verifierID: "builtin.artifact", outcome: "unverified" }),
      expect.objectContaining({ verifierID: "builtin.test", outcome: "pass" }),
    ]),
  )
  const mutations = await api(page, `/super-agent/runs/${run.id}/task-mutations`)
  expect(mutations.status).toBe(200)
  expect(mutations.body).toEqual(expect.arrayContaining([expect.objectContaining({ taskID: repairTask.id })]))

  await page.getByText("Super-Agent", { exact: true }).last().click()
  await page.getByRole("button", { name: "Refresh" }).click()
  await page.locator(`[data-run-id="${run.id}"]`).click()
  await expect(page.getByText("Status: Completed", { exact: true })).toBeVisible()
  await expect(page.getByText("Evidence: 3", { exact: true })).toBeVisible()
  await expect(page.getByText("Verifications: 3", { exact: true })).toBeVisible()
  await expect(page.getByText("checks: fail", { exact: true })).toBeVisible()
  await expect(page.getByText("checks: pass", { exact: true })).toBeVisible()
  await expect(page.getByText(new RegExp(`#v\\d+ .* → succeeded`)).last()).toBeVisible()

  await page.reload()
  await page.getByText("Super-Agent", { exact: true }).last().click()
  await page.locator(`[data-run-id="${run.id}"]`).click()
  await expect(page.getByText("Status: Completed", { exact: true })).toBeVisible()
  await expect(page.getByText("Evidence: 3", { exact: true })).toBeVisible()
  await expect(page.getByText("Verifications: 3", { exact: true })).toBeVisible()
})
