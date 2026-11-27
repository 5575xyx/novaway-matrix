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
    signal: init.signal ?? AbortSignal.timeout(10_000),
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

const portListenerPids = async () => {
  if (process.platform !== "win32") return new Set<string>()
  const result = Bun.spawn(["netstat", "-ano", "-p", "tcp"], { stdout: "pipe", stderr: "ignore" })
  const output = await new Response(result.stdout).text()
  await result.exited.catch(() => undefined)
  return new Set(
    output
      .split(/\r?\n/)
      .filter((line) => line.includes(`:${port} `) && line.includes("LISTENING"))
      .map((line) => line.trim().split(/\s+/).at(-1))
      .filter((pid): pid is string => !!pid && /^\d+$/.test(pid)),
  )
}

const killPortListeners = async () => {
  for (const pid of await portListenerPids()) {
    await Bun.spawn(["taskkill", "/PID", pid, "/T", "/F"], { stdout: "ignore", stderr: "ignore" }).exited.catch(
      () => undefined,
    )
  }
}

const waitForPortFree = async () => {
  if (process.platform !== "win32") return
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const pids = await portListenerPids()
    if (pids.size === 0) return
    await killPortListeners()
    await Bun.sleep(100)
  }
  throw new Error(`production smoke could not free port ${port}`)
}

const stop = async (child: Bun.Subprocess) => {
  if (process.platform === "win32" && child.pid) {
    await Bun.spawn(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited.catch(() => undefined)
  } else if (child.exitCode === null) {
    child.kill()
  }
  await child.exited.catch(() => undefined)
  await killPortListeners()
  await waitForPortFree()
}

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
  let initialHealth: { status: number; body: string } | undefined
  await waitFor(
    async () => {
      try {
        const response = await request("/global/health")
        initialHealth = { status: response.status, body: await response.text() }
        return response.ok
      } catch {
        initialHealth = undefined
        return false
      }
    },
    60_000,
    "health",
  ).catch((error) => {
    const detail = initialHealth
      ? ` (last response ${initialHealth.status}: ${initialHealth.body})`
      : " (no HTTP response)"
    throw new Error(`${error.message}${detail}`)
  })
  const authenticatedHealth = await request("/global/health")
  if (!authenticatedHealth.ok)
    throw new Error(`expected authenticated health to return 200, got ${authenticatedHealth.status}`)
  const unauthenticated = await fetch(`${base}/global/health`)
  if (unauthenticated.status !== 401)
    throw new Error(`expected unauthenticated health to return 401, got ${unauthenticated.status}`)
  const wrongCredentials = await fetch(`${base}/global/health`, {
    headers: { authorization: `Basic ${Buffer.from(`${username}:wrong-password`).toString("base64")}` },
  })
  if (wrongCredentials.status !== 401)
    throw new Error(`expected wrong credentials to return 401, got ${wrongCredentials.status}`)

  const employeeResponse = await request("/team/employee", {
    method: "POST",
    body: JSON.stringify({ name: "Production smoke expert", job: "build" }),
  })
  const employee = (await employeeResponse.json()) as { id?: string }
  if (!employeeResponse.ok || !employee.id) throw new Error(`could not create smoke expert: ${employeeResponse.status}`)
  const openExpert = (title: string) =>
    request("/session", { method: "POST", body: JSON.stringify({ title, expertID: employee.id }) })
  type ExpertConversation = { id?: string; employeeID?: string; teamMode?: string; teamIDs?: string[] }
  const hasExpert = (session: ExpertConversation) =>
    session.employeeID === employee.id && session.teamMode === "selected" && session.teamIDs?.length === 0
  const opened = await openExpert("Production smoke expert conversation")
  const expertConversation = (await opened.json()) as ExpertConversation
  if (!opened.ok || !expertConversation.id || !hasExpert(expertConversation)) {
    throw new Error(`expert session was not created with its selection: ${opened.status}`)
  }
  const archived = await request(`/team/employee/${employee.id}`, {
    method: "PATCH",
    body: JSON.stringify({ archived: true }),
  })
  if (!archived.ok) throw new Error(`could not archive smoke expert: ${archived.status}`)
  const rejectedTitle = "This archived expert session must not exist"
  const rejected = await openExpert(rejectedTitle)
  if (rejected.status !== 400) throw new Error(`expected archived expert launch to return 400, got ${rejected.status}`)
  const listedSessions = await request(`/session?directory=${encodeURIComponent(directory)}`)
  const listed = (await listedSessions.json()) as { id: string; title: string }[]
  if (
    !listedSessions.ok ||
    !listed.some((item) => item.id === expertConversation.id) ||
    listed.some((item) => item.title === rejectedTitle)
  ) {
    throw new Error("expert launch did not preserve the expected session list")
  }

  const sessionResponse = await request("/session", {
    method: "POST",
    body: JSON.stringify({ title: "production smoke" }),
  })
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
    async () =>
      ((await request(`/super-agent/runs/${run.id}`)).json() as Promise<{ status: string }>).then(
        (item) => item.status === "needs_review",
      ),
    60_000,
    "durable verification required",
  )
  const evidenceResponse = await request(`/super-agent/runs/${run.id}/evidence`, {
    method: "POST",
    body: JSON.stringify({
      id: `${run.id}:production-smoke:evidence`,
      taskID: run.graph.rootTaskID,
      kind: "test",
      source: "production-deployment-smoke",
      acceptanceIDs: ["criterion-1"],
      measured: "pass",
    }),
  })
  if (!evidenceResponse.ok)
    throw new Error(`production smoke could not record criterion evidence: ${evidenceResponse.status}`)
  const verificationResponse = await request(`/super-agent/runs/${run.id}/verify-finish`, {
    method: "POST",
    body: JSON.stringify({ verifierID: "builtin.test", summary: "production durable smoke verified" }),
  })
  if (!verificationResponse.ok) throw new Error(`production smoke could not verify run: ${verificationResponse.status}`)
  await waitFor(
    async () =>
      ((await request(`/super-agent/runs/${run.id}`)).json() as Promise<{ status: string }>).then(
        (item) => item.status === "completed",
      ),
    60_000,
    "durable completion",
  )
  const completedGoal = (await (await request(`/session/${session.id}/goals/${goal.id}`)).json()) as { status: string }
  if (completedGoal.status !== "completed") throw new Error(`Goal did not complete: ${completedGoal.status}`)

  const restartRunResponse = await request("/super-agent/runs", {
    method: "POST",
    body: JSON.stringify({
      goal: { text: "recover an interrupted production operation", acceptanceCriteria: [], sessionId: session.id },
    }),
  })
  const restartRun = (await restartRunResponse.json()) as {
    id: string
    graph: { version: number; rootTaskID: string; nodes: unknown[] }
  }
  const restartGraph = {
    ...restartRun.graph,
    nodes: restartRun.graph.nodes.map((node) => {
      const item = node as { id: string }
      return item.id === restartRun.graph.rootTaskID
        ? { ...item, input: { tool: "sleep", input: { duration_ms: 10_000 } } }
        : item
    }),
  }
  await request(`/super-agent/runs/${restartRun.id}/graph`, {
    method: "PUT",
    body: JSON.stringify({ expectedVersion: restartRun.graph.version, graph: restartGraph }),
  })
  await request(`/super-agent/runs/${restartRun.id}/start`, { method: "POST" })
  await waitFor(
    async () => {
      const events = (await (await request(`/super-agent/runs/${restartRun.id}/events`)).json()) as Array<{
        type: string
      }>
      return events.some((event) => event.type === "tool_operation_started")
    },
    30_000,
    "operation start before restart",
  )
  await stop(serverProcess)
  serverProcess = start()
  let restartHealth: { status: number; body: string } | undefined
  await waitFor(
    async () => {
      try {
        const response = await request("/global/health")
        restartHealth = { status: response.status, body: await response.text() }
        return response.ok
      } catch {
        restartHealth = undefined
        return false
      }
    },
    60_000,
    "health after restart",
  ).catch((error) => {
    const detail = restartHealth
      ? ` (last response ${restartHealth.status}: ${restartHealth.body})`
      : " (no HTTP response)"
    throw new Error(`${error.message}${detail}`)
  })
  await waitFor(
    async () =>
      ((await request(`/super-agent/runs/${restartRun.id}`)).json() as Promise<{ status: string }>).then(
        (item) => item.status === "needs_review",
      ),
    30_000,
    "safe recovery review state",
  )
  const restoredExpert = await request(`/session/${expertConversation.id}`)
  if (!restoredExpert.ok || !hasExpert((await restoredExpert.json()) as ExpertConversation)) {
    throw new Error("expert session selection was not preserved after restart")
  }

  const evidence = {
    binary: path.relative(root, binary).replaceAll("\\", "/"),
    platform: process.platform,
    arch: process.arch,
    auth: { unauthenticated: 401, wrongCredentials: 401, authenticated: 200 },
    flow: "completed",
    restartRecovery: "needs_review",
    expertConversation: { create: "selected", archivedLaunch: 400, orphanSession: false, persistedAfterRestart: true },
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
    await stop(serverProcess)
  }
  await rm(runRoot, { recursive: true, force: true })
}
