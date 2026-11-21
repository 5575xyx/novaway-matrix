import { afterEach, describe, expect, test } from "bun:test"
import { Context, Effect } from "effect"
import { Database } from "../../src/storage/db"
import { SuperAgentOperationTable } from "../../src/super-agent/super-agent.sql"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import * as Log from "@novaway/core/util/log"

void Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string, method = "GET", body?: unknown) {
  return HttpApiApp.webHandler().handler(
    new Request(`http://localhost${route}`, {
      method,
      headers: { "x-novaway-directory": directory, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    context,
  )
}

afterEach(async () => {
  await resetDatabase()
})

describe("Super-Agent HttpApi", () => {
  test("does not allow a Goal PATCH to bypass verification", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = tmp.path
    const sessionResponse = await request("/session", directory, "POST", { title: "verification-owned goal" })
    expect(sessionResponse.status).toBe(200)
    const session = (await sessionResponse.json()) as { id: string }
    const goalResponse = await request(`/session/${session.id}/goals`, directory, "POST", {
      title: "must be verified",
      status: "in_progress",
      successCriteria: ["a real verifier passes"],
    })
    expect(goalResponse.status).toBe(200)
    const goal = (await goalResponse.json()) as { id: string }
    const bypass = await request(`/session/${session.id}/goals/${goal.id}`, directory, "PATCH", {
      status: "completed",
    })
    expect(bypass.status).toBe(400)
    const current = await request(`/session/${session.id}/goals/${goal.id}`, directory)
    expect(((await current.json()) as { status: string }).status).toBe("in_progress")
  })

  test("creates a run, transitions it, and reads ordered events", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = tmp.path
    const created = await request("/super-agent/runs", directory, "POST", {
      goal: {
        text: "run checks",
        acceptanceCriteria: [{ id: "checks", text: "checks pass", required: true }],
      },
    })
    expect(created.status).toBe(200)
    const run = (await created.json()) as { id: string; status: string }
    expect(run.status).toBe("draft")

    const planning = await request(`/super-agent/runs/${run.id}/transition`, directory, "POST", { status: "planning" })
    expect(planning.status).toBe(200)
    expect(((await planning.json()) as { status: string }).status).toBe("planning")

    const events = await request(`/super-agent/runs/${run.id}/events`, directory)
    expect(events.status).toBe(200)
    expect(((await events.json()) as Array<{ type: string }>).map((event) => event.type)).toEqual([
      "run_created",
      "run_status_changed",
    ])
    const tail = await request(`/super-agent/runs/${run.id}/events?after=1`, directory)
    expect(((await tail.json()) as Array<{ sequence: number }>).map((event) => event.sequence)).toEqual([2])

    const listed = await request("/super-agent/runs", directory)
    expect(listed.status).toBe(200)
    expect(((await listed.json()) as Array<{ id: string }>).map((item) => item.id)).toEqual([run.id])
  })

  test("runs the lifecycle through start, pause, resume, cancel, and graph APIs", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = tmp.path
    const created = await request("/super-agent/runs", directory, "POST", {
      goal: { text: "lifecycle", acceptanceCriteria: [] },
    })
    const run = (await created.json()) as { id: string }

    const started = await request(`/super-agent/runs/${run.id}/start`, directory, "POST")
    expect(started.status).toBe(200)
    expect(((await started.json()) as { status: string }).status).toBe("running")

    const paused = await request(`/super-agent/runs/${run.id}/pause`, directory, "POST", { reason: "checkpoint" })
    expect(paused.status).toBe(200)
    expect(((await paused.json()) as { status: string; checkpointID?: string }).status).toBe("paused")
    const detail = await request(`/super-agent/runs/${run.id}`, directory)
    expect(((await detail.json()) as { checkpointID?: string }).checkpointID).toBeTruthy()

    const resumed = await request(`/super-agent/runs/${run.id}/resume`, directory, "POST")
    expect(resumed.status).toBe(200)
    expect(((await resumed.json()) as { status: string }).status).toBe("running")

    const graph = await request(`/super-agent/runs/${run.id}/graph`, directory)
    expect(graph.status).toBe(200)
    const graphBody = (await graph.json()) as {
      rootTaskID: string
      version: number
      nodes: Array<Record<string, unknown>>
    }
    expect(graphBody.rootTaskID).toContain(run.id)
    const updatedGraph = await request(`/super-agent/runs/${run.id}/graph`, directory, "PUT", {
      expectedVersion: graphBody.version,
      graph: { ...graphBody, nodes: graphBody.nodes.map((node) => ({ ...node, title: "Updated" })) },
    })
    expect(updatedGraph.status).toBe(200)
    expect(((await updatedGraph.json()) as { version: number }).version).toBe(graphBody.version + 1)

    const cancelled = await request(`/super-agent/runs/${run.id}/cancel`, directory, "POST")
    expect(cancelled.status).toBe(200)
    expect(((await cancelled.json()) as { status: string }).status).toBe("cancelled")
  })
  test("completes only through evidence and verification", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = tmp.path
    const created = await request("/super-agent/runs", directory, "POST", {
      goal: { text: "verified run", acceptanceCriteria: [{ id: "checks", text: "checks pass", required: true }] },
    })
    const run = (await created.json()) as { id: string }
    await request(`/super-agent/runs/${run.id}/start`, directory, "POST")
    const detail = (await (await request(`/super-agent/runs/${run.id}`, directory)).json()) as {
      graph: { rootTaskID: string }
    }
    const executed = await request(`/super-agent/runs/${run.id}/execute-tool`, directory, "POST", {
      taskID: detail.graph.rootTaskID,
      tool: "sleep",
      input: { duration_ms: 0 },
      sessionID: "sa-http-verified-session",
      messageID: "sa-http-verified-message",
    })
    expect(executed.status).toBe(200)
    const verifying = await request(`/super-agent/runs/${run.id}/transition`, directory, "POST", {
      status: "verifying",
    })
    expect(verifying.status).toBe(200)
    const evidence = await request(`/super-agent/runs/${run.id}/evidence`, directory, "POST", {
      id: `${run.id}:evidence:checks`,
      taskID: detail.graph.rootTaskID,
      kind: "test",
      source: "bun test",
      measured: "pass",
      acceptanceIDs: ["checks"],
    })
    expect(evidence.status).toBe(200)
    const finished = await request(`/super-agent/runs/${run.id}/verify-finish`, directory, "POST", {
      verifierID: "builtin.test",
      summary: "test evidence passed",
    })
    expect(finished.status).toBe(200)
    const finishedBody = (await finished.json()) as { run: { status: string }; completed: boolean }
    expect(finishedBody.completed).toBe(true)
    expect(finishedBody.run.status).toBe("completed")
    const replay = await request(`/super-agent/runs/${run.id}/verify-finish`, directory, "POST", {
      verifierID: "builtin.test",
      summary: "replayed",
    })
    expect(replay.status).toBe(200)
    expect(((await replay.json()) as { completed: boolean }).completed).toBe(true)
  })
  test("executes a native registered tool and persists task/evidence/usage", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = tmp.path
    const created = await request("/super-agent/runs", directory, "POST", {
      goal: { text: "execute a tool", acceptanceCriteria: [] },
      budget: { toolCalls: 1 },
    })
    const run = (await created.json()) as { id: string }
    await request(`/super-agent/runs/${run.id}/start`, directory, "POST")
    const detail = (await (await request(`/super-agent/runs/${run.id}`, directory)).json()) as {
      graph: { rootTaskID: string; nodes: Array<{ status: string }> }
    }
    const executed = await request(`/super-agent/runs/${run.id}/execute-tool`, directory, "POST", {
      taskID: detail.graph.rootTaskID,
      tool: "sleep",
      input: { duration_ms: 0 },
      sessionID: "sa-http-session",
      messageID: "sa-http-message",
      instructionID: `${run.id}:sleep:1`,
      idempotencyKey: `${run.id}:sleep:1`,
    })
    expect(executed.status).toBe(200)
    const body = (await executed.json()) as {
      result: { type: string; evidenceIDs?: string[] }
      run: { usage: { toolCalls: number } }
    }
    expect(body.result.type).toBe("tool_completed")
    expect(body.result.evidenceIDs).toHaveLength(1)
    expect(body.run.usage.toolCalls).toBe(1)

    const graph = (await (await request(`/super-agent/runs/${run.id}/graph`, directory)).json()) as {
      nodes: Array<{ status: string }>
    }
    expect(graph.nodes[0]?.status).toBe("succeeded")
    const evidence = await request(`/super-agent/runs/${run.id}/evidence`, directory)
    expect(((await evidence.json()) as unknown[]).length).toBe(1)
  })
  test("times out a native tool and releases its operation without evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = tmp.path
    const created = await request("/super-agent/runs", directory, "POST", {
      goal: { text: "timeout a tool", acceptanceCriteria: [] },
      budget: { toolCalls: 1 },
    })
    const run = (await created.json()) as { id: string }
    await request(`/super-agent/runs/${run.id}/start`, directory, "POST")
    const detail = (await (await request(`/super-agent/runs/${run.id}`, directory)).json()) as {
      graph: { rootTaskID: string }
    }
    const executed = await request(`/super-agent/runs/${run.id}/execute-tool`, directory, "POST", {
      taskID: detail.graph.rootTaskID,
      tool: "sleep",
      input: { duration_ms: 100 },
      sessionID: "sa-http-timeout-session",
      messageID: "sa-http-timeout-message",
      instructionID: `${run.id}:sleep-timeout:1`,
      idempotencyKey: `${run.id}:sleep-timeout:1`,
      timeoutMs: 20,
    })
    expect(executed.status).toBe(200)
    const body = (await executed.json()) as {
      result: { type: string; code?: string }
      run: { usage: { toolCalls: number } }
    }
    expect(body.result).toMatchObject({ type: "agent_failed", code: "tool_timeout" })
    expect(body.run.usage.toolCalls).toBe(0)

    const graph = (await (await request(`/super-agent/runs/${run.id}/graph`, directory)).json()) as {
      nodes: Array<{ status: string }>
    }
    expect(graph.nodes[0]?.status).toBe("failed")
    const evidence = await request(`/super-agent/runs/${run.id}/evidence`, directory)
    expect(((await evidence.json()) as unknown[]).length).toBe(0)
  })
  test("creates a repair task after failed verification", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = tmp.path
    const created = await request("/super-agent/runs", directory, "POST", {
      goal: {
        text: "repair failed checks",
        acceptanceCriteria: [{ id: "checks", text: "checks pass", required: true }],
      },
    })
    const run = (await created.json()) as { id: string }
    await request(`/super-agent/runs/${run.id}/start`, directory, "POST")
    const detail = (await (await request(`/super-agent/runs/${run.id}`, directory)).json()) as {
      graph: { rootTaskID: string; version: number; nodes: Array<Record<string, unknown>> }
    }
    await request(`/super-agent/runs/${run.id}/graph`, directory, "PUT", {
      expectedVersion: detail.graph.version,
      graph: {
        ...detail.graph,
        nodes: detail.graph.nodes.map((node) =>
          node.id === detail.graph.rootTaskID ? { ...node, input: { tool: "sleep", input: { duration_ms: 0 } } } : node,
        ),
      },
    })
    await request(`/super-agent/runs/${run.id}/transition`, directory, "POST", { status: "verifying" })
    await request(`/super-agent/runs/${run.id}/evidence`, directory, "POST", {
      id: `${run.id}:evidence:failed`,
      taskID: detail.graph.rootTaskID,
      kind: "test",
      source: "fixture",
      measured: "fail",
    })
    await request(`/super-agent/runs/${run.id}/verifications`, directory, "POST", {
      id: `${run.id}:verification:failed`,
      taskID: detail.graph.rootTaskID,
      acceptanceID: "checks",
      verifierID: "builtin.test",
      verifierVersion: "1",
      outcome: "fail",
      evidenceIDs: [`${run.id}:evidence:failed`],
      reason: "fixture failed",
    })
    await request(`/super-agent/runs/${run.id}/transition`, directory, "POST", { status: "needs_review" })
    const repair = await request(`/super-agent/runs/${run.id}/repair`, directory, "POST", {
      sourceTaskID: detail.graph.rootTaskID,
      failedVerificationIDs: [`${run.id}:verification:failed`],
      strategyID: "builtin.repair",
    })
    expect(repair.status).toBe(200)
    const body = (await repair.json()) as {
      task: { id: string; kind: string }
      run: { graph: { nodes: unknown[] } }
    }
    expect(body.task.kind).toBe("repair")
    expect(body.run.graph.nodes).toHaveLength(2)
    const rerun = await request(`/super-agent/runs/${run.id}/repair/execute`, directory, "POST", {
      taskID: body.task.id,
      sessionID: "sa-http-repair-session",
      messageID: "sa-http-repair-message",
      evidenceKind: "artifact",
      verifyAfter: false,
      verifierID: "builtin.artifact",
      summary: "repair verified",
    })
    expect(rerun.status).toBe(200)
    const rerunBody = (await rerun.json()) as {
      result: { type: string }
      run: { status: string; graph: { nodes: Array<{ id: string; status: string; evidenceIDs: string[] }> } }
    }
    expect(rerunBody.result.type).toBe("tool_completed")

    // A successful repair operation is not itself acceptance evidence. Record
    // the explicit verification result before closing the run.
    const passEvidence = await request(`/super-agent/runs/${run.id}/evidence`, directory, "POST", {
      id: `${run.id}:evidence:repair-pass`,
      taskID: body.task.id,
      kind: "test",
      source: "fixture-verifier",
      measured: "pass",
      acceptanceIDs: ["checks"],
    })
    expect(passEvidence.status).toBe(200)
    const finishedRepair = await request(`/super-agent/runs/${run.id}/verify-finish`, directory, "POST", {
      verifierID: "builtin.test",
      summary: "repair verified",
    })
    expect(finishedRepair.status).toBe(200)
    const finishedRepairBody = (await finishedRepair.json()) as { completed: boolean; run: { status: string } }
    expect(finishedRepairBody.completed).toBe(true)
    expect(finishedRepairBody.run.status).toBe("completed")

    const evidence = await request(`/super-agent/runs/${run.id}/evidence`, directory)
    expect(((await evidence.json()) as unknown[]).length).toBe(3)
    const mutations = await request(`/super-agent/runs/${run.id}/task-mutations`, directory)
    expect(mutations.status).toBe(200)
    const mutationBody = (await mutations.json()) as Array<{ taskID: string; graphVersion: number }>
    expect(mutationBody.length).toBeGreaterThan(0)
    expect(mutationBody.some((mutation) => mutation.taskID === body.task.id)).toBe(true)
  })
  test("recovers an expired operation through the HTTP boundary", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = tmp.path
    const created = await request("/super-agent/runs", directory, "POST", {
      goal: { text: "recover an interrupted operation", acceptanceCriteria: [] },
    })
    const run = (await created.json()) as { id: string }
    await request(`/super-agent/runs/${run.id}/start`, directory, "POST")
    const now = Date.now()
    await Effect.runPromise(
      Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(SuperAgentOperationTable)
            .values({
              id: `${run.id}:expired-operation`,
              run_id: run.id,
              instruction_id: `${run.id}:instruction`,
              idempotency_key: `${run.id}:expired-key`,
              status: "started",
              lease_until: now - 1,
              time_started: now - 100,
              time_updated: now - 100,
            })
            .run(),
        ),
      ),
    )

    const recovered = await request(`/super-agent/runs/${run.id}/recover`, directory, "POST", { at: now })
    expect(recovered.status).toBe(200)
    const body = (await recovered.json()) as {
      run: { status: string }
      operations: Array<{ status: string }>
      reviewRequired: boolean
    }
    expect(body.run.status).toBe("needs_review")
    expect(body.operations).toMatchObject([{ status: "unknown" }])
    expect(body.reviewRequired).toBe(true)
  })
  test("rejects a missing run", async () => {
    await using tmp = await tmpdir({ git: true })
    const response = await request("/super-agent/runs/missing/events", tmp.path)
    expect(response.status).toBe(404)
  })
})
