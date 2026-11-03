/**
 * 端到端：进程被杀之后，运行必须能真的续上。
 *
 * 上一个进程留下的运行还停在 `running + executing`：它既不能继续（`canStart` 看到过期的
 * phase 就拒绝），也不在终态，看板上永远「正在跑」。恢复把它收拾成 `paused`（没有未知
 * 操作）或 `needs_review`（有工具停在「已开始、结果未写回」），这一步此前只有单元覆盖。
 *
 * 这条测试补的是后半段 —— 恢复之后人真正会做的事：
 * 1. `paused` 点「继续」，编排器从排队状态重新派发、验证、集成，跑到 `done`；
 * 2. `needs_review` 在复核之前不能续跑；
 * 3. 复核给出 `abandoned`（确认没落地）之后，同一个幂等键的那次写**真的重试了** ——
 *    不是被「已经执行过」跳过，也不是自动重跑。
 */
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { TeamRunOpTable, TeamRunTable, TeamRunTeamTable } from "@/team/run.sql"
import { idempotencyKey } from "@/team/op-log"
import { Database } from "@/storage/db"
import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Config, Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"


const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()))
  }),
)

const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true },
)

const layer = Layer.mergeAll(testStateLayer, servedRoutes, TestLLMServer.layer).pipe(
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)

const it = testEffect(layer)

const post = (dir: string, suffix: string, body?: unknown) =>
  Effect.gen(function* () {
    const request = HttpClientRequest.post(suffix).pipe(
      HttpClientRequest.setHeader("x-novaway-directory", dir),
      HttpClientRequest.setUrlParam("directory", dir),
    )
    const ready = body === undefined ? request : yield* HttpClientRequest.bodyJson(body)(request)
    return yield* HttpClient.execute(ready)
  })

const get = (dir: string, suffix: string) =>
  HttpClient.execute(
    HttpClientRequest.get(suffix).pipe(
      HttpClientRequest.setHeader("x-novaway-directory", dir),
      HttpClientRequest.setUrlParam("directory", dir),
    ),
  )

const providerConfig = (url: string) => ({
  $schema: "https://novaway.ai/config.json",
  formatter: false,
  lsp: false,
  model: "test/test-model",
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: url },
    },
  },
})

type Detail = {
  run: { id: string; state: string; phase?: string; planVersion: number; error?: string }
  teams: Array<{ id: string; phase: string; worktree?: string }>
  summary: { pass: number; fail: number; unverified: number; stale: number; verdict: string }
  needsReview: Array<{ id: string; tool: string; outcome: string; startedAt: number }>
}

type Event = { seq: number; kind: string; payload?: Record<string, unknown> }

const exists = (file: string) =>
  fs
    .stat(file)
    .then(() => true)
    .catch(() => false)

const line = String.fromCharCode(10)
const refundDoc = ["# 退款说明", "", "退款在 7 个工作日内原路退回。"].join(line)
const memberPrompt = "把退款说明写到 src/refund.md。"

const reportOf = (acceptanceID: string) =>
  JSON.stringify({
    summary: "退款说明已补齐",
    claims: [{ acceptanceID, text: "写了 src/refund.md", evidence: "src/refund.md" }],
    done: true,
  })

/** 建好一次「已批准、计划里有一个团队」的运行，返回后续要用的 id。 */
const prepare = (dir: string, llmURL: string) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => Bun.write(dir + "/novaway.json", JSON.stringify(providerConfig(llmURL), null, 2)))

    const session = (yield* (
      yield* post(dir, "/session", {
        title: "restart run",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
        permissionMode: "bypassPermissions",
      })
    ).json) as { id: string }

    const person = (yield* (
      yield* post(dir, "/team/employee", { directory: dir, name: "小林", job: "general" })
    ).json) as { id: string }
    const profile = (yield* (
      yield* post(dir, "/team/profile", {
        directory: dir,
        name: "写作组",
        captain: person.id,
        members: [{ employeeID: person.id }],
      })
    ).json) as { profile: { id: string } }

    const created = (yield* (
      yield* post(dir, "/run", { sessionID: session.id, directory: dir, mode: "team", goal: "补一份退款说明" })
    ).json) as { run: { id: string } }
    const id = created.run.id

    yield* post(dir, `/run/${id}/plan`, {
      directory: dir,
      teams: [{ name: "写作组", profileID: profile.profile.id }],
    })
    // 团队 id 直接从库里读，不走详情接口：详情接口会顺手触发恢复，
    // 而恢复是按目录缓存的 —— 先看一次详情，后面造出来的「崩溃现场」就轮不到恢复了。
    const teamRow = yield* Effect.sync(() =>
      Database.use((db) => db.select().from(TeamRunTeamTable).where(eq(TeamRunTeamTable.run_id, id)).all()[0]),
    )
    const teamID = teamRow.id

    const acceptance = (yield* (
      yield* post(dir, `/run/${id}/acceptance`, {
        directory: dir,
        specID: "refund-doc",
        text: "仓库里有 src/refund.md",
        kind: "test",
        owner: teamID,
        verifier: { kind: "command", run: "test -f src/refund.md", timeoutMs: 30_000 },
      })
    ).json) as { id: string }

    yield* post(dir, `/run/${id}/policy`, { directory: dir, readOnly: false })

    const runRow = yield* Effect.sync(() =>
      Database.use((db) => db.select().from(TeamRunTable).where(eq(TeamRunTable.id, id)).all()[0]),
    )
    yield* post(dir, `/run/${id}/approve`, {
      directory: dir,
      planVersion: runRow.plan_version,
      budget: { tokens: 100_000 },
    })

    return { id, teamID, acceptanceID: acceptance.id }
  })

/** 造一次「上一个进程跑到一半被杀」的运行：库里还停在 running + executing，时间戳是旧的。 */
const crash = (id: string, teamID: string, seedOps?: (db: Parameters<Parameters<typeof Database.use>[0]>[0]) => void) =>
  Effect.sync(() =>
    Database.transaction((db) => {
      db.update(TeamRunTable)
        .set({ state: "running", phase: "executing", time_updated: 1 })
        .where(eq(TeamRunTable.id, id))
        .run()
      db.update(TeamRunTeamTable)
        .set({ phase: "running", round_captain: 1, time_updated: 1 })
        .where(eq(TeamRunTeamTable.id, teamID))
        .run()
      seedOps?.(db)
    }),
  )

const captainMatch = (hit: { body: Record<string, unknown> }) => {
  const body = JSON.stringify(hit.body)
  return body.includes("你是一个团队的队长") && body.includes("仓库里有 src/refund.md")
}
const memberMatch = (hit: { body: Record<string, unknown> }) => {
  const body = JSON.stringify(hit.body)
  return body.includes(memberPrompt) && !body.includes("你是一个团队的队长")
}

/** 队长「派活 → 报告」、成员「写 → 回一句」：恢复后的续跑只走这一遍。 */
const scriptRun = (llm: { toolMatch: (match: typeof captainMatch, name: string, input: unknown) => Effect.Effect<void>; textMatch: (match: typeof captainMatch, value: string) => Effect.Effect<void> }, acceptanceID: string) =>
  Effect.gen(function* () {
    yield* llm.toolMatch(captainMatch, "task", {
      description: "写退款说明",
      prompt: memberPrompt,
      subagent_type: "general",
      name: "小林",
    })
    yield* llm.textMatch(captainMatch, reportOf(acceptanceID))
    yield* llm.toolMatch(memberMatch, "write", { filePath: "src/refund.md", content: refundDoc })
    yield* llm.textMatch(memberMatch, "已写入")
  })

const waitSettled = (dir: string, id: string) =>
  Effect.gen(function* () {
    let detail: Detail | undefined
    for (let i = 0; i < 400; i++) {
      detail = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
      if (["done", "partial", "failed", "exceeded", "cancelled", "blocked"].includes(detail.run.state)) break
      yield* Effect.sleep("250 millis")
    }
    return detail
  })

describe("team run restart recovery", () => {
  it.live(
    "a run paused by a restart continues on click and really finishes",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const dir = yield* tmpdirScoped({ git: true })
        const { id, teamID, acceptanceID } = yield* prepare(dir, llm.url)

        yield* crash(id, teamID)

        // 打开看板就是恢复点：状态定性，未完成的团队回到排队。
        const recovered = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
        expect(recovered.run.state).toBe("paused")
        expect(recovered.teams[0].phase).toBe("queued")
        const firstEvents = (yield* (yield* get(dir, `/run/${id}/events`)).json) as Event[]
        const recovery = firstEvents.find((event) => event.kind === "run.recovered")
        expect(recovery?.payload).toMatchObject({ state: "paused", unknownOps: 0, from: "running", phase: "executing" })
        // 恢复事件只留结构：路径、命令、目标原文都不进日志。
        expect(JSON.stringify(recovery?.payload)).not.toContain(dir)

        yield* scriptRun(llm, acceptanceID)
        expect((yield* post(dir, `/run/${id}/execute`, { directory: dir })).status).toBe(200)

        const detail = yield* waitSettled(dir, id)
        const events = (yield* (yield* get(dir, `/run/${id}/events`)).json) as Event[]
        const kinds = events.map((event) => event.kind)
        // 恢复不是结算：它之后必须还有真正的派发，运行才算「续上了」。
        const recoveredAt = kinds.indexOf("run.recovered")
        const dispatchedAt = kinds.indexOf("team.dispatched")
        expect(recoveredAt).toBeGreaterThanOrEqual(0)
        expect(dispatchedAt).toBeGreaterThan(recoveredAt)
        const dispatched = events.find((event) => event.kind === "team.dispatched")
        expect(dispatched?.payload?.round).toBe(1)
        expect(kinds.filter((kind) => kind === "run.recovered").length).toBe(1)

        expect(detail?.run.state).toBe("done")
        expect(detail?.summary).toMatchObject({ pass: 1, fail: 0, verdict: "complete" })
        expect(detail?.teams.map((team) => team.phase)).toEqual(["delivered"])
        // 续跑写的是团队 worktree：用户的工作区一个字节都没动。
        expect(detail?.teams[0].worktree).toBeDefined()
        expect(yield* Effect.promise(() => exists(path.join(detail!.teams[0].worktree!, "src", "refund.md")))).toBe(true)
        expect(yield* Effect.promise(() => exists(path.join(dir, "src", "refund.md")))).toBe(false)
      }),
    240_000,
  )

  it.live(
    "an unknown operation blocks the resume until a human reviews it, and the verdict decides the retry",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const dir = yield* tmpdirScoped({ git: true })
        const { id, teamID, acceptanceID } = yield* prepare(dir, llm.url)

        // 崩溃现场：运行停在 running + executing，团队停在 running，写操作开始过但没写回结果。
        // 幂等键与续跑时那次写完全一致 —— 这正是「同一个键要不要重跑」的问题。
        const writeKey = idempotencyKey({
          scope: { runID: id, taskID: teamID, attempt: 1 },
          tool: "write",
          args: { filePath: "src/refund.md", content: refundDoc },
        })
        yield* crash(id, teamID, (db) => {
          db.insert(TeamRunOpTable)
            .values({
              id: "op_restart_write",
              run_id: id,
              tool: "write",
              idempotency_key: writeKey,
              started_at: 1,
              outcome: "started",
            })
            .run()
          // 另一条已经有结论的操作：复核接口不能把它改写。
          db.insert(TeamRunOpTable)
            .values({
              id: "op_restart_done",
              run_id: id,
              tool: "bash",
              idempotency_key: "restart:done",
              started_at: 1,
              finished_at: 2,
              outcome: "succeeded",
            })
            .run()
        })

        const review = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
        expect(review.run.state).toBe("needs_review")
        expect(review.run.error).toContain("结果不明")
        // 只回结构与时间：参数里常有命令与凭据。
        expect(review.needsReview).toEqual([{ id: "op_restart_write", tool: "write", outcome: "unknown", startedAt: 1 }])

        // 没复核之前不许续跑：带着未知项开跑，等于用猜测覆盖已经发生的事。
        expect((yield* post(dir, `/run/${id}/execute`, { directory: dir })).status).toBe(400)
        // 已经有结论的操作不能被复核改写，不存在的操作是 404。
        expect(
          (yield* post(dir, `/run/${id}/ops/op_restart_done/review`, { directory: dir, verdict: "abandoned" })).status,
        ).toBe(400)
        expect(
          (yield* post(dir, `/run/${id}/ops/op_missing/review`, { directory: dir, verdict: "abandoned" })).status,
        ).toBe(404)

        // 人核对过文件：这次写没有落地 → 同一个键可以重试。
        const reviewed = (yield* (
          yield* post(dir, `/run/${id}/ops/op_restart_write/review`, { directory: dir, verdict: "abandoned" })
        ).json) as Detail
        expect(reviewed.needsReview).toEqual([])
        // 复核完最后一项就不再是「待核对」：回到 paused，等用户点继续。
        expect(reviewed.run.state).toBe("paused")

        const reviewedEvents = (yield* (yield* get(dir, `/run/${id}/events`)).json) as Event[]
        const opEvent = reviewedEvents.find((event) => event.kind === "op.reviewed")
        expect(opEvent?.payload).toMatchObject({ opID: "op_restart_write", tool: "write", verdict: "abandoned" })
        expect(JSON.stringify(opEvent?.payload)).not.toContain(refundDoc)
        // 同一条复核两次：第二次不该再改任何东西。
        expect(
          (yield* post(dir, `/run/${id}/ops/op_restart_write/review`, { directory: dir, verdict: "succeeded" })).status,
        ).toBe(400)

        yield* scriptRun(llm, acceptanceID)
        expect((yield* post(dir, `/run/${id}/execute`, { directory: dir })).status).toBe(200)

        const detail = yield* waitSettled(dir, id)
        expect(detail?.run.state).toBe("done")
        expect(detail?.summary).toMatchObject({ pass: 1, verdict: "complete" })
        // `abandoned` 的语义在这里兑现：那次写**真的重试了**（不是被当成「已经执行过」跳过）。
        // 证据是同一个幂等键的记录被回填成了 succeeded，文件也落在了 worktree 里。
        const row = yield* Effect.sync(() =>
          Database.use((db) =>
            db.select().from(TeamRunOpTable).where(eq(TeamRunOpTable.id, "op_restart_write")).all()[0],
          ),
        )
        expect(row.outcome).toBe("succeeded")
        expect(row.finished_at ?? 0).toBeGreaterThan(1)
        expect(yield* Effect.promise(() => exists(path.join(detail!.teams[0].worktree!, "src", "refund.md")))).toBe(true)
        expect(yield* Effect.promise(() => exists(path.join(dir, "src", "refund.md")))).toBe(false)
      }),
    240_000,
  )
})