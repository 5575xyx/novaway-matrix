import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const platformName = process.platform === "win32" ? "windows" : process.platform
const binaryAbi = process.env.NOVAWAY_BINARY_ABI === "musl" ? "-musl" : ""
const binaryName = `xymt-novaway-${platformName}-${process.arch}${binaryAbi}/bin/novaway${process.platform === "win32" ? ".exe" : ""}`
const binary = path.join(root, "dist", binaryName)
const runRoot = path.join(root, "test-results", `production-deployment-${Date.now()}`)
const workspace = path.join(runRoot, "workspace")
const database = path.join(runRoot, "production.sqlite")
// Reserve an OS-assigned ephemeral port before starting the child process. This
// prevents parallel CI jobs and stale listeners from influencing the result.
const portReservation = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: { data() {} },
})
const port = portReservation.port
portReservation.stop()
const base = `http://127.0.0.1:${port}`
const username = "novaway"
const password = "production-smoke-secret"
const directory = process.platform === "win32" ? path.win32.normalize(workspace) : workspace
const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`

await mkdir(workspace, { recursive: true })

const request = async (pathname: string, init: RequestInit = {}) =>
  fetch(`${base}${pathname}`, {
    ...init,
    headers: {
      authorization: auth,
      "content-type": "application/json",
      "x-novaway-directory": directory,
      ...(init.headers ?? {}),
    },
  })

const start = () =>
  Bun.spawn([binary, "serve", "--hostname=127.0.0.1", `--port=${port}`], {
    env: {
      ...process.env,
      NOVAWAY_DB: database,
      NOVAWAY_SERVER_USERNAME: username,
      NOVAWAY_SERVER_PASSWORD: password,
      NOVAWAY_SUPER_AGENT_OPERATION_LEASE_MS: "2000",
      // Keep deployment smoke deterministic and independent of external catalog uptime.
      NOVAWAY_DISABLE_MODELS_FETCH: "1",
    },
    stdout: "inherit",
    stderr: "inherit",
  })

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs: number, label: string) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(250)
  }
  throw new Error(`production smoke timeout: ${label}`)
}

let serverProcess = start()
try {
  await waitFor(
    async () => {
      try {
        return (await request("/global/health")).ok
      } catch {
        return false
      }
    },
    60_000,
    "health",
  )
  const authenticatedHealth = await request("/global/health")
  if (!authenticatedHealth.ok) throw new Error(`expected authenticated health to return 200, got ${authenticatedHealth.status}`)
  const unauthenticated = await fetch(`${base}/global/health`)
  if (unauthenticated.status !== 401) throw new Error(`expected unauthenticated health to return 401, got ${unauthenticated.status}`)
  const wrongCredentials = await fetch(`${base}/global/health`, {
    headers: { authorization: `Basic ${Buffer.from(`${username}:wrong-password`).toString("base64")}` },
  })
  if (wrongCredentials.status !== 401) throw new Error(`expected wrong credentials to return 401, got ${wrongCredentials.status}`)

  const sessionResponse = await request("/session", { method: "POST", body: JSON.stringify({ title: "production smoke" }) })
  const session = (await sessionResponse.json()) as { id: string }
  if (!session.id) throw new Error("production smoke did not create a session")
  const launchResponse = await request(`/session/${session.id}/goals/launch`, {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: `production-smoke:${session.id}`,
      title: "production durable smoke",
      description: "execute a production durable smoke task",
      successCriteria: ["the production run completes"],
      executionConfig: { maxIterations: 0, mode: "durable" },
      planningMode: "deterministic",
      budget: { toolCalls: 1 },
    }),
  })
  const launched = (await launchResponse.json()) as {
    goal: { id: string }
    run: { id: string; graph: { version: number; rootTaskID: string; nodes: unknown[] } }
  }
  if (!launchResponse.ok || !launched.goal?.id || !launched.run?.id)
    throw new Error(`production smoke could not atomically launch Goal: ${launchResponse.status}`)
  const goal = launched.goal
  const run = launched.run
  const graph = {
    ...run.graph,
    nodes: run.graph.nodes.map((node) => {
      const item = node as { id: string }
      return item.id === run.graph.rootTaskID ? { ...item, input: { tool: "sleep", input: { duration_ms: 0 } } } : node
    }),
  }
  await request(`/super-agent/runs/${run.id}/graph`, {
    method: "PUT",
    body: JSON.stringify({ expectedVersion: run.graph.version, graph }),
  })
  await waitFor(
    async () => ((await request(`/super-agent/runs/${run.id}`)).json() as Promise<{ status: string }>).then((item) => item.status === "completed"),
    60_000,
    "durable completion",
  )
  const completedGoal = (await (await request(`/session/${session.id}/goals/${goal.id}`)).json()) as { status: string }
  if (completedGoal.status !== "completed") throw new Error(`Goal did not complete: ${completedGoal.status}`)

  const restartRunResponse = await request("/super-agent/runs", {
    method: "POST",
    body: JSON.stringify({ goal: { text: "recover an interrupted production operation", acceptanceCriteria: [], sessionId: session.id } }),
  })
  const restartRun = (await restartRunResponse.json()) as { id: string; graph: { version: number; rootTaskID: string; nodes: unknown[] } }
  const restartGraph = {
    ...restartRun.graph,
    nodes: restartRun.graph.nodes.map((node) => {
      const item = node as { id: string }
      return item.id === restartRun.graph.rootTaskID ? { ...item, input: { tool: "sleep", input: { duration_ms: 10_000 } } } : item
    }),
  }
  await request(`/super-agent/runs/${restartRun.id}/graph`, {
    method: "PUT",
    body: JSON.stringify({ expectedVersion: restartRun.graph.version, graph: restartGraph }),
  })
  await request(`/super-agent/runs/${restartRun.id}/start`, { method: "POST" })
  await waitFor(
    async () => {
      const events = (await (await request(`/super-agent/runs/${restartRun.id}/events`)).json()) as Array<{ type: string }>
      return events.some((event) => event.type === "tool_operation_started")
    },
    30_000,
    "operation start before restart",
  )
  serverProcess.kill()
  await serverProcess.exited
  serverProcess = start()
  await waitFor(
    async () => {
      try {
        return (await request("/global/health")).ok
      } catch {
        return false
      }
    },
    60_000,
    "health after restart",
  )
  await waitFor(
    async () => ((await request(`/super-agent/runs/${restartRun.id}`)).json() as Promise<{ status: string }>).then((item) => item.status === "needs_review"),
    30_000,
    "safe recovery review state",
  )

  const evidence = {
    binary: path.relative(root, binary).replaceAll("\\", "/"),
    platform: process.platform,
    arch: process.arch,
    auth: { unauthenticated: 401, wrongCredentials: 401, authenticated: 200 },
    flow: "completed",
    restartRecovery: "needs_review",
    createdAt: new Date().toISOString(),
  }
  await writeFile(
    path.join(root, "test-results", "production-deployment-smoke.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  )
  console.log("PRODUCTION_DEPLOYMENT_SMOKE=PASS")
  console.log("PRODUCTION_FLOW=completed")
  console.log("PRODUCTION_RESTART_RECOVERY=needs_review")
  console.log("PRODUCTION_AUTH=unauthenticated:401/wrong:401/authenticated:200")
} finally {
  if (process.exitCode === undefined) {
    serverProcess.kill()
    await serverProcess.exited.catch(() => undefined)
  }
  await rm(runRoot, { recursive: true, force: true })
}
