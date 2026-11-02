/**
 * 端到端：钱和时间用完了，运行就要停，而且要说清楚是哪一条用完了。
 *
 * 预算是用户批准的上限，不是建议（§7.3）。两条硬上限的语义不同：
 * - 墙钟：按本次执行计时，到期就不再开新的派发；
 * - token：派发前预占，预占额度不够就一次都不派。
 * 两种都必须落到「超限」，不能把「没派出去」结算成「没做成」——
 * 前者是预算问题，后者是能力问题，混在一起用户不知道该加钱还是改要求。
 */
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Config, Effect, Layer } from "effect"
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
      HttpClientRequest.setHeader("x-opencode-directory", dir),
      HttpClientRequest.setUrlParam("directory", dir),
    )
    const ready = body === undefined ? request : yield* HttpClientRequest.bodyJson(body)(request)
    return yield* HttpClient.execute(ready)
  })

const get = (dir: string, suffix: string) =>
  HttpClient.execute(
    HttpClientRequest.get(suffix).pipe(
      HttpClientRequest.setHeader("x-opencode-directory", dir),
      HttpClientRequest.setUrlParam("directory", dir),
    ),
  )

const providerConfig = (url: string) => ({
  $schema: "https://opencode.ai/config.json",
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
  run: { id: string; state: string; planVersion: number; error?: string }
  teams: Array<{ id: string; phase: string; worktree?: string }>
  summary: { pass: number; fail: number; unverified: number; stale: number; verdict: string }
}

type Event = { seq: number; kind: string; payload?: Record<string, unknown> }

/** 建一个已批准、带一个验收项的运行；预算由调用方决定。 */
const prepare = (dir: string, budget: Record<string, unknown>, llmURL: string) =>
  Effect.gen(function* () {
    const session = (yield* (
      yield* post(dir, "/session", { title: "budget run" })
    ).json) as { id: string }
    const created = (yield* (
      yield* post(dir, "/run", { sessionID: session.id, directory: dir, mode: "team", goal: "补一份说明" })
    ).json) as { run: { id: string } }
    const id = created.run.id
    yield* post(dir, `/run/${id}/plan`, { directory: dir, teams: [{ name: "写作组" }] })
    const planned = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
    const teamID = planned.teams[0].id
    yield* post(dir, `/run/${id}/acceptance`, {
      directory: dir,
      specID: "doc",
      text: "仓库里有 src/doc.md",
      kind: "test",
      owner: teamID,
      verifier: { kind: "command", run: "test -f src/doc.md", timeoutMs: 30_000 },
    })
    const widened = (yield* (
      yield* post(dir, `/run/${id}/policy`, { directory: dir, readOnly: false })
    ).json) as Detail
    yield* post(dir, `/run/${id}/approve`, {
      directory: dir,
      planVersion: widened.run.planVersion,
      budget,
    })
    void llmURL
    return id
  })

const settle = (dir: string, id: string) =>
  Effect.gen(function* () {
    let detail: Detail | undefined
    for (let i = 0; i < 200; i++) {
      detail = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
      if (["done", "partial", "failed", "exceeded", "cancelled", "blocked"].includes(detail.run.state)) break
      yield* Effect.sleep("100 millis")
    }
    return detail
  })

const eventsOf = (dir: string, id: string) =>
  Effect.gen(function* () {
    return (yield* (yield* get(dir, `/run/${id}/events`)).json) as Event[]
  })

describe("team run budget", () => {
  it.live(
    "a spent wall clock stops before any dispatch and settles as exceeded",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const dir = yield* tmpdirScoped({ git: true })
        yield* Effect.promise(() => Bun.write(dir + "/novaway.json", JSON.stringify(providerConfig(llm.url), null, 2)))
        const id = yield* prepare(dir, { tokens: 100_000, wallMs: 0 }, llm.url)

        expect((yield* post(dir, `/run/${id}/execute`, { directory: dir })).status).toBe(200)
        const detail = yield* settle(dir, id)
        const events = yield* eventsOf(dir, id)
        const kinds = events.map((event) => event.kind)
        const exceeded = events.filter((event) => event.kind === "budget.exceeded")

        expect(detail?.run.state).toBe("exceeded")
        expect(detail?.teams.map((team) => team.phase)).toEqual(["exceeded"])
        expect(exceeded.length).toBe(1)
        // 说清楚是哪一条上限到期：用户才知道下一步该改什么。
        expect(String(exceeded[0].payload?.reason)).toContain("墙钟")
        expect(kinds).not.toContain("team.dispatched")
        // 一次都没有派发：超限后的「继续跑」等于把硬上限变成建议。
        expect((yield* llm.hits).filter((hit) => JSON.stringify(hit.body).includes("你是一个团队的队长")).length).toBe(0)
      }),
    120_000,
  )

  it.live(
    "a token budget too small to reserve stops the team before it starts",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const dir = yield* tmpdirScoped({ git: true })
        yield* Effect.promise(() => Bun.write(dir + "/novaway.json", JSON.stringify(providerConfig(llm.url), null, 2)))
        // 预占一次派发远大于批准的额度：预算不足不是团队的错，记「超限」而不是「失败」。
        const id = yield* prepare(dir, { tokens: 10 }, llm.url)

        expect((yield* post(dir, `/run/${id}/execute`, { directory: dir })).status).toBe(200)
        const detail = yield* settle(dir, id)
        const events = yield* eventsOf(dir, id)
        const exceeded = events.filter((event) => event.kind === "budget.exceeded")

        expect(detail?.run.state).toBe("exceeded")
        expect(detail?.teams.map((team) => team.phase)).toEqual(["exceeded"])
        expect(exceeded.length).toBe(1)
        // 按团队给出的那条事件带 teamID：用户要知道是哪一队没拿到额度。
        expect(typeof exceeded[0].payload?.teamID).toBe("string")
        expect(events.map((event) => event.kind)).not.toContain("team.dispatched")
        expect((yield* llm.hits).filter((hit) => JSON.stringify(hit.body).includes("你是一个团队的队长")).length).toBe(0)
      }),
    120_000,
  )
})
