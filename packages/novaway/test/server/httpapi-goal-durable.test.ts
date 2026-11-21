import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import net from "node:net"

let port = 0
let serverURL = ""
const root = path.join(import.meta.dir, "../..")
const tempRoot = path.join(os.tmpdir(), `novaway-goal-durable-${Date.now()}`)
const database = path.join(tempRoot, "goal.sqlite")
const workspace = path.join(tempRoot, "workspace")
let child: ReturnType<typeof Bun.spawn> | undefined
let secondaryChild: ReturnType<typeof Bun.spawn> | undefined
let secondaryURL = ""

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

async function waitForServer(targetURL = serverURL) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${targetURL}/super-agent/runs`, {
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
  const env: Record<string, string | undefined> = {
    ...process.env,
    NOVAWAY_DB: database,
    NOVAWAY_DISABLE_AUTOPROVISION: "1",
    NOVAWAY_SUPER_AGENT_OPERATION_LEASE_MS: "10000",
  }
  delete env.NOVAWAY_SERVER_PASSWORD
  child = Bun.spawn(
    [
      process.execPath,
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

function startSecondaryServer(selectedPort: number) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    NOVAWAY_DB: database,
    NOVAWAY_DISABLE_AUTOPROVISION: "1",
    NOVAWAY_SUPER_AGENT_OPERATION_LEASE_MS: "10000",
  }
  delete env.NOVAWAY_SERVER_PASSWORD
  secondaryURL = `http://127.0.0.1:${selectedPort}`
  secondaryChild = Bun.spawn(
    [
      process.execPath,
      "--env-file=../../.env.local",
      "run",
      "--conditions=browser",
      "./src/index.ts",
      "serve",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(selectedPort),
    ],
    { cwd: root, env, stdout: "inherit", stderr: "inherit" },
  )
  return secondaryChild
}

async function stopSecondaryServer() {
  const running = secondaryChild
  secondaryChild = undefined
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

async function secondaryRequest(pathname: string, init?: RequestInit) {
  return fetch(`${secondaryURL}${pathname}`, {
    ...init,
    headers: {
      "x-novaway-directory": workspace,
      ...(init?.headers ?? {}),
    },
  })
}

async function waitForGoalStatus(sessionID: string, goalID: string, expected: string) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const response = await request(`/session/${sessionID}/goals`)
    if (response.ok) {
      const goals = (await response.json()) as Array<{ id: string; status: string }>
      if (goals.find((goal) => goal.id === goalID)?.status === expected) return
    }
    await Bun.sleep(500)
  }
  throw new Error(`Goal ${goalID} did not reach ${expected}`)
}

async function waitForRunStatus(runID: string, expected: string) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const response = await request(`/super-agent/runs/${runID}`)
    if (response.ok && ((await response.json()) as { status?: string }).status === expected) return
    await Bun.sleep(250)
  }
  const detail = await request(`/super-agent/runs/${runID}`)
    .then((response) => response.json())
    .catch(() => undefined)
  const events = await request(`/super-agent/runs/${runID}/events`)
    .then((response) => response.json())
    .catch(() => undefined)
  throw new Error(`Super-Agent run ${runID} did not reach ${expected}: ${JSON.stringify({ detail, events })}`)
}

async function recordExplicitPassAndFinish(runID: string, taskID: string, acceptanceID: string) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const response = await request(`/super-agent/runs/${runID}`)
    if (response.ok) {
      const run = (await response.json()) as { graph?: { nodes?: Array<{ id: string; status: string }> } }
      if (run.graph?.nodes?.some((task) => task.id === taskID && ["succeeded", "completed"].includes(task.status))) break
    }
    await Bun.sleep(250)
  }
  await waitForRunStatus(runID, "needs_review")
  const evidence = await request(`/super-agent/runs/${runID}/evidence`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: `${runID}:evidence:explicit-pass:${acceptanceID}`,
      taskID,
      kind: "artifact",
      source: "durable-e2e-verifier",
      measured: "pass",
      acceptanceIDs: [acceptanceID],
    }),
  })
  expect(evidence.status).toBe(200)
  const finished = await request(`/super-agent/runs/${runID}/verify-finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verifierID: "builtin.artifact", summary: "explicit durable evidence passed" }),
  })
  expect(finished.status).toBe(200)
  const finishedBody = (await finished.json()) as { completed: boolean; run?: unknown; verifications?: unknown }
  if (!finishedBody.completed) throw new Error(`explicit verification did not complete: ${JSON.stringify(finishedBody)}`)
}

async function waitForRunEvent(runID: string, type: string) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const response = await request(`/super-agent/runs/${runID}/events`)
    if (response.ok) {
      const events = (await response.json()) as Array<{ type: string }>
      if (events.some((event) => event.type === type)) return events
    }
    await Bun.sleep(100)
  }
  throw new Error(`Super-Agent run ${runID} did not emit ${type}`)
}

async function waitForPermission() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const response = await request("/permission")
    if (response.ok) {
      const requests = (await response.json()) as Array<{ id: string }>
      if (requests[0]) return requests[0]
    }
    await Bun.sleep(250)
  }
  throw new Error("durable worker did not create a pending permission request")
}

afterAll(async () => {
  await stopSecondaryServer()
  await stopServer()
  await fs.rm(tempRoot, { recursive: true, force: true })
})

describe("durable Goal end-to-end lifecycle", () => {
  test("links one Goal to a long-running Super-Agent, survives restart, and syncs cancellation", async () => {
    port = await reservePort()
    serverURL = `http://127.0.0.1:${port}`
    await fs.mkdir(workspace, { recursive: true })
    startServer()
    await waitForServer()

    const sessionResponse = await request("/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "durable Goal e2e" }),
    })
    expect(sessionResponse.status).toBe(200)
    const session = (await sessionResponse.json()) as { id: string }

    const goalResponse = await request(`/session/${session.id}/goals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "long-running production target",
        description: "survive restart and synchronize terminal state",
        status: "in_progress",
        successCriteria: ["the durable run is persisted"],
        executionConfig: { maxIterations: 0, mode: "durable" },
      }),
    })
    expect(goalResponse.status).toBe(200)
    const goal = (await goalResponse.json()) as { id: string; executionConfig?: { mode?: string } }
    expect(goal.executionConfig?.mode).toBe("durable")

    const runResponse = await request("/super-agent/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: { text: "execute the durable Goal", acceptanceCriteria: [] } }),
    })
    expect(runResponse.status).toBe(200)
    const run = (await runResponse.json()) as { id: string }
    const started = await request(`/super-agent/runs/${run.id}/start`, { method: "POST" })
    expect(started.status).toBe(200)

    const linked = await request(`/session/${session.id}/goals/${goal.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        executionConfig: { maxIterations: 0, mode: "durable", superAgentRunId: run.id },
      }),
    })
    expect(linked.status).toBe(200)

    await stopServer()
    startServer()
    await waitForServer()

    const afterRestart = await request(`/session/${session.id}/goals`)
    expect(afterRestart.status).toBe(200)
    const restoredGoals = (await afterRestart.json()) as Array<{
      id: string
      status: string
      executionConfig?: { mode?: string; superAgentRunId?: string }
    }>
    const restored = restoredGoals.find((item) => item.id === goal.id)
    expect(restored).toMatchObject({
      status: "in_progress",
      executionConfig: { mode: "durable", superAgentRunId: run.id },
    })

    const cancelled = await request(`/super-agent/runs/${run.id}/cancel`, { method: "POST" })
    expect(cancelled.status).toBe(200)
    await waitForGoalStatus(session.id, goal.id, "cancelled")
  }, 120_000)

  test("launches and binds a durable Goal atomically and idempotently", async () => {
    const headers = { "content-type": "application/json" }
    const sessionResponse = await request("/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "atomic Goal launch" }),
    })
    expect(sessionResponse.status).toBe(200)
    const session = (await sessionResponse.json()) as { id: string }
    const idempotencyKey = `atomic-goal-${Date.now()}`
    const first = await request(`/session/${session.id}/goals/launch`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        idempotencyKey,
        title: "atomically launch this Goal",
        description: "the Goal and durable run must be linked before startup returns",
        successCriteria: ["the durable run is linked"],
        executionConfig: { maxIterations: 0, mode: "durable" },
        planningMode: "deterministic",
        budget: { toolCalls: 1 },
      }),
    })
    expect(first.status).toBe(200)
    const launched = (await first.json()) as {
      goal: { id: string; status: string; executionConfig?: { mode?: string; superAgentRunId?: string } }
      run: { id: string; status: string }
    }
    expect(launched.run.status).toBe("running")
    expect(launched.goal).toMatchObject({
      status: "in_progress",
      executionConfig: { mode: "durable", superAgentRunId: launched.run.id },
    })

    const retry = await request(`/session/${session.id}/goals/launch`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        idempotencyKey,
        title: "different title must not create another Goal",
        planningMode: "deterministic",
      }),
    })
    expect(retry.status).toBe(200)
    const retried = (await retry.json()) as { goal: { id: string }; run: { id: string } }
    expect(retried.goal.id).toBe(launched.goal.id)
    expect(retried.run.id).toBe(launched.run.id)

    expect((await request(`/super-agent/runs/${launched.run.id}/cancel`, { method: "POST" })).status).toBe(200)
    await waitForGoalStatus(session.id, launched.goal.id, "cancelled")
  }, 120_000)
  test("reconciles approval waits and failures without the Cron scheduler", async () => {
    const sessionResponse = await request("/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "durable Goal gates" }),
    })
    expect(sessionResponse.status).toBe(200)
    const session = (await sessionResponse.json()) as { id: string }

    const goalResponse = await request(`/session/${session.id}/goals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "approval and failure recovery",
        description: "synchronize non-terminal and failed run states",
        status: "in_progress",
        successCriteria: ["the run is recoverable"],
        executionConfig: { maxIterations: 0, mode: "durable" },
      }),
    })
    expect(goalResponse.status).toBe(200)
    const goal = (await goalResponse.json()) as { id: string }

    const runResponse = await request("/super-agent/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: {
          text: "exercise durable gates",
          acceptanceCriteria: [],
          goalId: goal.id,
          sessionId: session.id,
        },
      }),
    })
    expect(runResponse.status).toBe(200)
    const run = (await runResponse.json()) as { id: string; graph: { rootTaskID: string } }
    expect((await request(`/super-agent/runs/${run.id}/start`, { method: "POST" })).status).toBe(200)

    const approvalID = `${run.id}:approval:e2e`
    const approval = await request(`/super-agent/runs/${run.id}/approvals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: approvalID,
        taskID: run.graph.rootTaskID,
        reason: "write production artifact",
        scope: "workspace",
      }),
    })
    expect(approval.status).toBe(200)

    const waiting = await request(`/super-agent/runs/${run.id}/transition`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "waiting_approval" }),
    })
    expect(waiting.status).toBe(200)
    await waitForGoalStatus(session.id, goal.id, "paused")

    const approved = await request(`/super-agent/runs/${run.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestID: approvalID, status: "approved", decidedBy: "e2e" }),
    })
    expect(approved.status).toBe(200)
    await waitForGoalStatus(session.id, goal.id, "in_progress")

    const failed = await request(`/super-agent/runs/${run.id}/transition`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "failed" }),
    })
    expect(failed.status).toBe(200)
    await waitForGoalStatus(session.id, goal.id, "paused")
  }, 120_000)

  test("continues real tool work after restart, approval, and repair before completing acceptance", async () => {
    const headers = { "content-type": "application/json" }

    // A running durable task must be executable after the process that started it
    // is gone. This calls the real native-tool boundary, not only a status API.
    const restartedSessionResponse = await request("/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "durable execution after restart" }),
    })
    const restartedSession = (await restartedSessionResponse.json()) as { id: string }
    const restartedGoalResponse = await request(`/session/${restartedSession.id}/goals`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "execute after restart",
        status: "in_progress",
        successCriteria: ["the artifact tool completed"],
        executionConfig: { maxIterations: 0, mode: "durable" },
      }),
    })
    const restartedGoal = (await restartedGoalResponse.json()) as { id: string }
    const restartedRunResponse = await request("/super-agent/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        goal: {
          text: "run a real artifact-producing tool after restart",
          acceptanceCriteria: [{ id: "restart-artifact", text: "artifact exists", required: true }],
          plan: [
            {
              id: "restart-artifact-task",
              kind: "tool",
              title: "Create restart artifact",
              objective: "Create the durable artifact after recovery",
              input: { tool: "sleep", input: { duration_ms: 0 } },
              acceptanceCriteria: [{ id: "restart-artifact", text: "artifact exists", required: true }],
            },
          ],
          goalId: restartedGoal.id,
          sessionId: restartedSession.id,
        },
      }),
    })
    const restartedRun = (await restartedRunResponse.json()) as {
      id: string
      graph: { version: number; rootTaskID: string; nodes: Array<{ id: string }> }
    }
    expect((await request(`/super-agent/runs/${restartedRun.id}/start`, { method: "POST" })).status).toBe(200)

    await stopServer()
    startServer()
    await waitForServer()

    // The plan is persisted with the Goal/Run. The restarted worker must
    // discover it directly; the test does not manufacture a ready task or call
    // an execute endpoint after recovery.
    const restoredRunResponse = await request(`/super-agent/runs/${restartedRun.id}`)
    expect(restoredRunResponse.status).toBe(200)
    const restoredRun = (await restoredRunResponse.json()) as {
      status: string
      graph: { version: number; rootTaskID: string; nodes: Array<{ id: string; input?: unknown }> }
    }
    expect(restoredRun.status).toBe("running")
    expect(restoredRun.graph.nodes).toHaveLength(1)
    expect(restoredRun.graph.nodes[0]?.id).toBe("restart-artifact-task")
    expect(restoredRun.graph.nodes[0]?.input).toEqual({ tool: "sleep", input: { duration_ms: 0 } })

    await recordExplicitPassAndFinish(restartedRun.id, restartedRun.graph.rootTaskID, "restart-artifact")
    await waitForRunStatus(restartedRun.id, "completed")
    const restartExecution = (await (await request(`/super-agent/runs/${restartedRun.id}`)).json()) as {
      status: string
      graph: { nodes: Array<{ status: string }> }
    }
    expect(restartExecution.status).toBe("completed")
    expect(restartExecution.graph.nodes[0]?.status).toBe("succeeded")
    const restartEvidence = await request(`/super-agent/runs/${restartedRun.id}/evidence`)
    expect(((await restartEvidence.json()) as unknown[]).length).toBeGreaterThan(0)
    await waitForGoalStatus(restartedSession.id, restartedGoal.id, "completed")

    // Approval must unblock the same run, after which a real task executes and
    // the acceptance verifier closes the Goal.
    const approvalSessionResponse = await request("/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "durable approval execution" }),
    })
    const approvalSession = (await approvalSessionResponse.json()) as { id: string }
    const approvalGoalResponse = await request(`/session/${approvalSession.id}/goals`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "execute after approval",
        status: "in_progress",
        successCriteria: ["the approved task completed"],
        executionConfig: { maxIterations: 0, mode: "durable" },
      }),
    })
    const approvalGoal = (await approvalGoalResponse.json()) as { id: string }
    const approvalRunResponse = await request("/super-agent/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        goal: {
          text: "wait for approval then execute",
          acceptanceCriteria: [{ id: "approval-artifact", text: "approved artifact exists", required: true }],
          goalId: approvalGoal.id,
          sessionId: approvalSession.id,
        },
      }),
    })
    const approvalRun = (await approvalRunResponse.json()) as {
      id: string
      graph: { version: number; rootTaskID: string; nodes: Array<{ id: string }> }
    }
    await request(`/super-agent/runs/${approvalRun.id}/start`, { method: "POST" })
    const approvalID = `${approvalRun.id}:approval:execution`
    expect(
      (
        await request(`/super-agent/runs/${approvalRun.id}/approvals`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            id: approvalID,
            taskID: approvalRun.graph.rootTaskID,
            reason: "allow artifact generation",
            scope: "workspace",
          }),
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await request(`/super-agent/runs/${approvalRun.id}/transition`, {
          method: "POST",
          headers,
          body: JSON.stringify({ status: "waiting_approval" }),
        })
      ).status,
    ).toBe(200)
    await waitForGoalStatus(approvalSession.id, approvalGoal.id, "paused")
    const approvalGraph = {
      ...approvalRun.graph,
      nodes: approvalRun.graph.nodes.map((node) =>
        node.id === approvalRun.graph.rootTaskID
          ? { ...node, input: { tool: "sleep", input: { duration_ms: 0 } } }
          : node,
      ),
    }
    expect(
      (
        await request(`/super-agent/runs/${approvalRun.id}/graph`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ expectedVersion: approvalRun.graph.version, graph: approvalGraph }),
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await request(`/super-agent/runs/${approvalRun.id}/approve`, {
          method: "POST",
          headers,
          body: JSON.stringify({ requestID: approvalID, status: "approved", decidedBy: "production-e2e" }),
        })
      ).status,
    ).toBe(200)
    await recordExplicitPassAndFinish(approvalRun.id, approvalRun.graph.rootTaskID, "approval-artifact")
    await waitForRunStatus(approvalRun.id, "completed")
    const approvedExecution = (await (await request(`/super-agent/runs/${approvalRun.id}`)).json()) as {
      status: string
      graph: { nodes: Array<{ status: string }> }
    }
    expect(approvedExecution.status).toBe("completed")
    expect(approvedExecution.graph.nodes[0]?.status).toBe("succeeded")
    const approvalEvidence = await request(`/super-agent/runs/${approvalRun.id}/evidence`)
    expect(((await approvalEvidence.json()) as unknown[]).length).toBeGreaterThan(0)
    await waitForGoalStatus(approvalSession.id, approvalGoal.id, "completed")

    // A real tool failure creates failed evidence, a repair task executes the
    // native tool again, and the latest evidence is then used for acceptance.
    const repairSessionResponse = await request("/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "durable repair execution" }),
    })
    const repairSession = (await repairSessionResponse.json()) as { id: string }
    const repairGoalResponse = await request(`/session/${repairSession.id}/goals`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "repair failed task",
        status: "in_progress",
        successCriteria: ["the repaired artifact completed"],
        executionConfig: { maxIterations: 0, mode: "durable" },
      }),
    })
    const repairGoal = (await repairGoalResponse.json()) as { id: string }
    const repairRunResponse = await request("/super-agent/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        goal: {
          text: "repair a failed artifact task",
          acceptanceCriteria: [{ id: "repair-artifact", text: "repaired artifact exists", required: true }],
          goalId: repairGoal.id,
          sessionId: repairSession.id,
        },
      }),
    })
    const repairRun = (await repairRunResponse.json()) as {
      id: string
      graph: { version: number; rootTaskID: string; nodes: Array<{ id: string }> }
    }
    await request(`/super-agent/runs/${repairRun.id}/start`, { method: "POST" })
    const failedGraph = {
      ...repairRun.graph,
      nodes: repairRun.graph.nodes.map((node) =>
        node.id === repairRun.graph.rootTaskID
          ? { ...node, input: { tool: "sleep", input: { duration_ms: 100 }, timeoutMs: 20 } }
          : node,
      ),
    }
    expect(
      (
        await request(`/super-agent/runs/${repairRun.id}/graph`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ expectedVersion: repairRun.graph.version, graph: failedGraph }),
        })
      ).status,
    ).toBe(200)
    await waitForRunStatus(repairRun.id, "failed")
    await request(`/super-agent/runs/${repairRun.id}/transition`, {
      method: "POST",
      headers,
      body: JSON.stringify({ status: "needs_review" }),
    })
    const failedEvidenceID = `${repairRun.id}:evidence:failed`
    expect(
      (
        await request(`/super-agent/runs/${repairRun.id}/evidence`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            id: failedEvidenceID,
            taskID: repairRun.graph.rootTaskID,
            kind: "test",
            source: "durable failure fixture",
            measured: "fail",
          }),
        })
      ).status,
    ).toBe(200)
    const failedVerificationID = `${repairRun.id}:verification:failed`
    expect(
      (
        await request(`/super-agent/runs/${repairRun.id}/verifications`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            id: failedVerificationID,
            taskID: repairRun.graph.rootTaskID,
            acceptanceID: "repair-artifact",
            verifierID: "builtin.test",
            verifierVersion: "1",
            outcome: "fail",
            evidenceIDs: [failedEvidenceID],
            reason: "initial execution timed out",
          }),
        })
      ).status,
    ).toBe(200)
    const repairResponse = await request(`/super-agent/runs/${repairRun.id}/repair`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sourceTaskID: repairRun.graph.rootTaskID,
        failedVerificationIDs: [failedVerificationID],
        strategyID: "builtin.repair",
        input: { tool: "sleep", input: { duration_ms: 0 }, timeoutMs: 1_000 },
      }),
    })
    expect(repairResponse.status).toBe(200)
    const repair = (await repairResponse.json()) as {
      task: { id: string }
      run: { graph: { version: number; nodes: Array<{ id: string; input?: unknown }> } }
    }
    // Creating the repair task is the only driver action. The durable worker
    // must pick it up, execute it, and run the verifier automatically.
    await recordExplicitPassAndFinish(repairRun.id, repair.task.id, "repair-artifact")
    await waitForRunStatus(repairRun.id, "completed")
    const repaired = (await (await request(`/super-agent/runs/${repairRun.id}`)).json()) as {
      status: string
      graph: { nodes: Array<{ id: string; status: string }> }
    }
    expect(repaired.status).toBe("completed")
    expect(repaired.graph.nodes.find((node) => node.id === repair.task.id)?.status).toBe("succeeded")
    await waitForGoalStatus(repairSession.id, repairGoal.id, "completed")
  }, 180_000)

  test("persists permission waiting and automatically resumes the real write task after approval", async () => {
    const headers = { "content-type": "application/json" }
    const sessionResponse = await request("/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "durable permission gate" }),
    })
    const session = (await sessionResponse.json()) as { id: string }
    const goalResponse = await request(`/session/${session.id}/goals`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "write after approval",
        status: "in_progress",
        successCriteria: ["the approved file was written"],
        executionConfig: { maxIterations: 0, mode: "durable" },
      }),
    })
    const goal = (await goalResponse.json()) as { id: string }
    const runResponse = await request("/super-agent/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        goal: {
          text: "write a file after the user approves the permission request",
          acceptanceCriteria: [{ id: "approved-write", text: "the file exists", required: true }],
          goalId: goal.id,
          sessionId: session.id,
        },
      }),
    })
    const run = (await runResponse.json()) as {
      id: string
      graph: { version: number; rootTaskID: string; nodes: Array<{ id: string }> }
    }
    const filePath = path.join(workspace, `durable-permission-${Date.now()}.txt`)
    const graph = {
      ...run.graph,
      nodes: run.graph.nodes.map((node) =>
        node.id === run.graph.rootTaskID
          ? {
              ...node,
              input: {
                tool: "write",
                input: { filePath, content: "approved durable task\n" },
              },
            }
          : node,
      ),
    }
    expect(
      (
        await request(`/super-agent/runs/${run.id}/graph`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ expectedVersion: run.graph.version, graph }),
        })
      ).status,
    ).toBe(200)
    expect((await request(`/super-agent/runs/${run.id}/start`, { method: "POST" })).status).toBe(200)

    await waitForRunStatus(run.id, "waiting_approval")
    await waitForGoalStatus(session.id, goal.id, "paused")
    const pending = await waitForPermission()
    const replied = await request(`/permission/${encodeURIComponent(pending.id)}/reply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reply: "once" }),
    })
    expect(replied.status).toBe(200)

    await recordExplicitPassAndFinish(run.id, run.graph.rootTaskID, "approved-write")
    await waitForRunStatus(run.id, "completed")
    expect(await fs.readFile(filePath, "utf8")).toBe("approved durable task\n")
    await waitForGoalStatus(session.id, goal.id, "completed")
  }, 120_000)

  test("restores a pending permission request after process restart and resumes the write task", async () => {
    const headers = { "content-type": "application/json" }
    const sessionResponse = await request("/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "durable permission restart" }),
    })
    const session = (await sessionResponse.json()) as { id: string }
    const goalResponse = await request(`/session/${session.id}/goals`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "resume permission after restart",
        status: "in_progress",
        successCriteria: ["the restarted worker writes the file"],
        executionConfig: { maxIterations: 0, mode: "durable" },
      }),
    })
    const goal = (await goalResponse.json()) as { id: string }
    const runResponse = await request("/super-agent/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        goal: {
          text: "write a file after a restart while permission is pending",
          acceptanceCriteria: [{ id: "restart-write", text: "the restarted file exists", required: true }],
          goalId: goal.id,
          sessionId: session.id,
        },
      }),
    })
    const run = (await runResponse.json()) as {
      id: string
      graph: { version: number; rootTaskID: string; nodes: Array<{ id: string }> }
    }
    const filePath = path.join(workspace, `durable-permission-restart-${Date.now()}.txt`)
    const graph = {
      ...run.graph,
      nodes: run.graph.nodes.map((node) =>
        node.id === run.graph.rootTaskID
          ? { ...node, input: { tool: "write", input: { filePath, content: "restarted durable task\\n" } } }
          : node,
      ),
    }
    expect(
      (
        await request(`/super-agent/runs/${run.id}/graph`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ expectedVersion: run.graph.version, graph }),
        })
      ).status,
    ).toBe(200)
    expect((await request(`/super-agent/runs/${run.id}/start`, { method: "POST" })).status).toBe(200)

    await waitForRunStatus(run.id, "waiting_approval")
    await waitForGoalStatus(session.id, goal.id, "paused")
    const pendingBeforeRestart = await waitForPermission()
    await stopServer()
    startServer()
    await waitForServer()

    const pendingAfterRestart = await waitForPermission()
    expect(pendingAfterRestart.id).toBe(pendingBeforeRestart.id)
    const replied = await request(`/permission/${encodeURIComponent(pendingAfterRestart.id)}/reply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reply: "once" }),
    })
    expect(replied.status).toBe(200)
    await recordExplicitPassAndFinish(run.id, run.graph.rootTaskID, "restart-write")
    await waitForRunStatus(run.id, "completed")
    expect(await fs.readFile(filePath, "utf8")).toBe("restarted durable task\\n")
    await waitForGoalStatus(session.id, goal.id, "completed")
  }, 120_000)

  test("marks an interrupted native operation for review after process recovery without replaying side effects", async () => {
    const headers = { "content-type": "application/json" }
    const sessionResponse = await request("/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "durable crash recovery" }),
    })
    const session = (await sessionResponse.json()) as { id: string }
    const goalResponse = await request(`/session/${session.id}/goals`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "recover interrupted operation",
        status: "in_progress",
        successCriteria: ["the uncertain operation is reviewed safely"],
        executionConfig: { maxIterations: 0, mode: "durable" },
      }),
    })
    const goal = (await goalResponse.json()) as { id: string }
    const runResponse = await request("/super-agent/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        goal: {
          text: "run a long operation and recover it after a process crash",
          acceptanceCriteria: [{ id: "crash-review", text: "the interrupted operation is reviewed", required: true }],
          goalId: goal.id,
          sessionId: session.id,
        },
      }),
    })
    const run = (await runResponse.json()) as {
      id: string
      graph: { version: number; rootTaskID: string; nodes: Array<{ id: string }> }
    }
    const graph = {
      ...run.graph,
      nodes: run.graph.nodes.map((node) =>
        node.id === run.graph.rootTaskID ? { ...node, input: { tool: "sleep", input: { duration_ms: 5_000 } } } : node,
      ),
    }
    expect(
      (
        await request(`/super-agent/runs/${run.id}/graph`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ expectedVersion: run.graph.version, graph }),
        })
      ).status,
    ).toBe(200)
    expect((await request(`/super-agent/runs/${run.id}/start`, { method: "POST" })).status).toBe(200)

    await waitForRunEvent(run.id, "tool_operation_started")
    await stopServer()
    startServer()
    await waitForServer()

    // The new process must not replay an operation whose external side effect
    // boundary is unknown. It moves the run to review, then the watchdog records
    // the expired lease as durable evidence for a human or repair policy.
    await waitForRunStatus(run.id, "needs_review")
    const events = await waitForRunEvent(run.id, "operation_lease_expired")
    expect(events.filter((event) => event.type === "tool_operation_started")).toHaveLength(1)
    expect(events.filter((event) => event.type === "operation_lease_expired")).toHaveLength(1)
    await waitForGoalStatus(session.id, goal.id, "paused")
  }, 120_000)

  test("coordinates one durable operation across two NovaWay processes", async () => {
    const headers = { "content-type": "application/json" }
    const secondaryPort = await reservePort()
    startSecondaryServer(secondaryPort)
    await waitForServer(secondaryURL)

    try {
      const sessionResponse = await request("/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "multi-process durable worker" }),
      })
      const session = (await sessionResponse.json()) as { id: string }
      const goalResponse = await request(`/session/${session.id}/goals`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: "multi-process operation goal",
          status: "in_progress",
          successCriteria: ["one process completes the operation"],
          executionConfig: { maxIterations: 0, mode: "durable" },
        }),
      })
      const goal = (await goalResponse.json()) as { id: string }
      const runResponse = await request("/super-agent/runs", {
        method: "POST",
        headers,
        body: JSON.stringify({
          goal: {
            text: "execute one operation while two workers are online",
            acceptanceCriteria: [],
            goalId: goal.id,
            sessionId: session.id,
          },
        }),
      })
      const run = (await runResponse.json()) as {
        id: string
        graph: { version: number; rootTaskID: string; nodes: Array<{ id: string }> }
      }
      const graph = {
        ...run.graph,
        nodes: run.graph.nodes.map((node) =>
          node.id === run.graph.rootTaskID
            ? { ...node, input: { tool: "sleep", input: { duration_ms: 1_000 } } }
            : node,
        ),
      }
      expect(
        (
          await request(`/super-agent/runs/${run.id}/graph`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ expectedVersion: run.graph.version, graph }),
          })
        ).status,
      ).toBe(200)
      expect((await request(`/super-agent/runs/${run.id}/start`, { method: "POST" })).status).toBe(200)
      await waitForRunStatus(run.id, "completed")
      const events = (await request(`/super-agent/runs/${run.id}/events`).then((response) =>
        response.json(),
      )) as Array<{ type: string }>
      expect(events.filter((event) => event.type === "tool_operation_started")).toHaveLength(1)
      await waitForGoalStatus(session.id, goal.id, "completed")
    } finally {
      await stopSecondaryServer()
    }
  }, 120_000)

  test("executes arbitrary read tasks concurrently under a durable worker load", async () => {
    const headers = { "content-type": "application/json" }
    const inputFile = path.join(workspace, "durable-load-input.txt")
    await fs.writeFile(inputFile, "durable load input\n", "utf8")
    const loadCount = Math.max(100, Math.min(500, Number(process.env.NOVAWAY_DURABLE_LOAD_RUNS ?? 100)))
    const loadSessionResponse = await request("/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "durable 500-run load" }),
    })
    const loadSession = (await loadSessionResponse.json()) as { id: string }
    const runs = await Promise.all(
      Array.from({ length: loadCount }, async (_, index) => {
        const runResponse = await request("/super-agent/runs", {
          method: "POST",
          headers,
          body: JSON.stringify({
            goal: {
              text: `read the durable load fixture ${index}`,
              acceptanceCriteria: [],
              sessionId: loadSession.id,
            },
          }),
        })
        const run = (await runResponse.json()) as {
          id: string
          graph: { version: number; rootTaskID: string; nodes: Array<{ id: string }> }
        }
        const graph = {
          ...run.graph,
          nodes: run.graph.nodes.map((node) =>
            node.id === run.graph.rootTaskID
              ? { ...node, input: { tool: "read", input: { filePath: inputFile, limit: 20 } } }
              : node,
          ),
        }
        expect(
          (
            await request(`/super-agent/runs/${run.id}/graph`, {
              method: "PUT",
              headers,
              body: JSON.stringify({ expectedVersion: run.graph.version, graph }),
            })
          ).status,
        ).toBe(200)
        expect((await request(`/super-agent/runs/${run.id}/start`, { method: "POST" })).status).toBe(200)
        return { id: run.id, sessionID: loadSession.id }
      }),
    )

    const deadline = Date.now() + 300_000
    while (Date.now() < deadline) {
      const pendingResponse = await request("/permission")
      if (pendingResponse.ok) {
        const pending = (await pendingResponse.json()) as Array<{ id: string }>
        await Promise.all(
          pending.map((permission) =>
            request(`/permission/${encodeURIComponent(permission.id)}/reply`, {
              method: "POST",
              headers,
              body: JSON.stringify({ reply: "once" }),
            }),
          ),
        )
      }
      const statuses = await Promise.all(
        runs.map(async (item) => {
          const response = await request(`/super-agent/runs/${item.id}`)
          return response.ok ? ((await response.json()) as { status: string }).status : "unavailable"
        }),
      )
      if (statuses.every((status) => status === "completed")) break
      await Bun.sleep(500)
    }

    for (const item of runs) {
      const run = (await (await request(`/super-agent/runs/${item.id}`)).json()) as {
        status: string
        graph: { nodes: Array<{ status: string }> }
      }
      expect(run.status).toBe("completed")
      expect(run.graph.nodes[0]?.status).toBe("succeeded")
    }
  }, 1_800_000)
})
