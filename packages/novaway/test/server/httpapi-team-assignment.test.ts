import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { TeamAssignmentTable, TeamRunTable } from "@/team/run.sql"
import { eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const state = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()))
  }),
)
const routes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(HttpApiApp.routes, {
  disableListenLog: true,
})
const layer = Layer.mergeAll(state, routes).pipe(
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(layer)

const post = (directory: string, path: string, body?: unknown) =>
  Effect.gen(function* () {
    const request = HttpClientRequest.post(path).pipe(
      HttpClientRequest.setHeader("x-novaway-directory", directory),
      HttpClientRequest.setUrlParam("directory", directory),
    )
    return yield* HttpClient.execute(body === undefined ? request : yield* HttpClientRequest.bodyJson(body)(request))
  })

const get = (directory: string, path: string) =>
  HttpClient.execute(
    HttpClientRequest.get(path).pipe(
      HttpClientRequest.setHeader("x-novaway-directory", directory),
      HttpClientRequest.setUrlParam("directory", directory),
    ),
  )

describe("run assignment HTTP API", () => {
  it.live("supports identity-bound heartbeat, report, verification and retry", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const session = (yield* (yield* post(directory, "/session", { title: "assignment API" })).json) as { id: string }
      const created = (yield* (yield* post(directory, "/run", {
        sessionID: session.id,
        directory,
        mode: "team",
        goal: "assignment API",
      })).json) as { run: { id: string } }
      const now = Date.now()
      const assignmentID = `assignment_http_${now}`
      yield* Effect.sync(() =>
        Database.use((db) =>
          db.insert(TeamAssignmentTable).values({
            id: assignmentID,
            run_id: created.run.id,
            task_id: "task-http",
            session_id: null,
            dispatch_id: `dispatch_http_${now}`,
            attempt: 1,
            status: "running",
            objective: "API assignment",
            scope: null,
            acceptance_ids: [],
            worktree: null,
            prompt_hash: null,
            skill_manifest_hash: null,
            permission_hash: null,
            idempotency_key: `idempotency_http_${now}`,
            lease_until: now + 60_000,
            last_heartbeat_at: null,
            heartbeat_misses: 0,
            report: null,
            verification: null,
            error: null,
            time_created: now,
            time_updated: now,
          }).run(),
        ),
      )

      const listedResponse = yield* get(directory, `/run/${created.run.id}/assignments`)
      const listed = (yield* listedResponse.json) as Array<{ id: string }>
      expect(listed.map((item) => item.id)).toEqual([assignmentID])

      const heartbeat = yield* post(directory, `/run/${created.run.id}/assignments/${assignmentID}/heartbeat`, {
        dispatchID: `dispatch_http_${now}`,
        attempt: 1,
        sessionID: session.id,
        leaseMs: 60_000,
      })
      expect(heartbeat.status).toBe(200)

      const report = yield* post(directory, `/run/${created.run.id}/assignments/${assignmentID}/report`, {
        dispatchID: `dispatch_http_${now}`,
        attempt: 1,
        sessionID: session.id,
        status: "succeeded",
        summary: "worker report",
      })
      expect(report.status).toBe(200)
      expect(((yield* report.json) as { status: string }).status).toBe("reported")

      const verified = yield* post(directory, `/run/${created.run.id}/assignments/${assignmentID}/verify`, {
        outcome: "succeeded",
        verification: { verifier: "http-test" },
      })
      expect(verified.status).toBe(200)
      expect(((yield* verified.json) as { status: string }).status).toBe("succeeded")

      const retry = yield* post(directory, `/run/${created.run.id}/assignments/${assignmentID}/retry`, {})
      expect(retry.status).toBe(409)
    }),
  )

  it.live("pauses safe run boundaries and rejects terminal runs", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const session = (yield* (yield* post(directory, "/session", { title: "pause API" })).json) as { id: string }
      const created = (yield* (yield* post(directory, "/run", {
        sessionID: session.id,
        directory,
        mode: "team",
        goal: "pause API",
      })).json) as { run: { id: string } }
      const runID = created.run.id

      const planned = yield* post(directory, `/run/${runID}/plan`, { directory, teams: [] })
      expect(planned.status).toBe(200)
      const paused = yield* post(directory, `/run/${runID}/pause`, {})
      expect(paused.status).toBe(200)
      expect(((yield* paused.json) as { run: { state: string } }).run.state).toBe("paused")

      // In-flight work belongs to the orchestrator and must be cancelled instead.
      yield* Effect.sync(() =>
        Database.use((db) =>
          db.update(TeamRunTable).set({ state: "running", phase: "executing" }).where(eq(TeamRunTable.id, runID)).run(),
        ),
      )
      const inFlight = yield* post(directory, `/run/${runID}/pause`, {})
      expect(inFlight.status).toBe(409)

      // A run that is ready but has not entered a dispatch phase is also safe.
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(TeamRunTable)
            .set({ state: "running", phase: null })
            .where(eq(TeamRunTable.id, runID))
            .run(),
        ),
      )
      const pausedReady = yield* post(directory, `/run/${runID}/pause`, {})
      expect(pausedReady.status).toBe(200)
      expect(((yield* pausedReady.json) as { run: { state: string } }).run.state).toBe("paused")
      const events = (yield* (yield* get(directory, `/run/${runID}/events`)).json) as Array<{ kind: string }>
      expect(events.some((event) => event.kind === "run.paused")).toBe(true)

      yield* Effect.sync(() =>
        Database.use((db) =>
          db.update(TeamRunTable).set({ state: "done", phase: null }).where(eq(TeamRunTable.id, runID)).run(),
        ),
      )
      const terminal = yield* post(directory, `/run/${runID}/pause`, {})
      expect(terminal.status).toBe(409)
    }),
  )
})
