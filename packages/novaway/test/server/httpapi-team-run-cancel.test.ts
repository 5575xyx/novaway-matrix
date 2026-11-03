/**
 * 端到端：点了停止，运行就要真的停下。
 *
 * 前面的端到端都跑到自然结束。真实使用里最常见的中断是用户点「停止」，而停止
 * 最难的时刻恰恰是队长正在跑的时候：模型调用卡在那里，编排器只会在循环检查点
 * 看信号 —— 检查点根本没机会执行。如果取消只是把库里的状态改成 `cancelled`，
 * 编排器随后会用自己的结算把它覆盖回 `done`，用户看到的就是「点了停止却照样跑完」。
 *
 * 这条测试让队长调用一直挂着，然后在中途取消，检查三件事：
 * 1. 运行真的在短时间内停住（不会等到零进展上限）；
 * 2. 三段式事件齐全且顺序正确（requested 先于 settled），团队记为 cancelled；
 * 3. 取消之后不再有新派发 —— 停止是停止，不是「下一轮再说」。
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
import { TestLLMServer, reply } from "../lib/llm-server"


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
  run: { id: string; state: string; planVersion: number; error?: string }
  teams: Array<{ id: string; phase: string; worktree?: string }>
  summary: { pass: number; fail: number; unverified: number; stale: number; verdict: string }
}

type Event = { seq: number; kind: string; payload?: Record<string, unknown> }

type Status = Record<string, { type: string }>

describe("team run cancel", () => {
  it.live(
    "cancelling while the captain is running stops the run instead of letting it finish",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const dir = yield* tmpdirScoped({ git: true })
        yield* Effect.promise(() => Bun.write(dir + "/novaway.json", JSON.stringify(providerConfig(llm.url), null, 2)))

        const session = (yield* (
          yield* post(dir, "/session", {
            title: "cancel run",
            // 无人值守运行：子会话继承模式，成员不会停在没人回答的授权弹窗上。
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
        const planned = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
        const teamID = planned.teams[0].id

        yield* post(dir, `/run/${id}/acceptance`, {
          directory: dir,
          specID: "refund-doc",
          text: "仓库里有 src/refund.md",
          kind: "test",
          owner: teamID,
          verifier: { kind: "command", run: "test -f src/refund.md", timeoutMs: 30_000 },
        })

        const widened = (yield* (
          yield* post(dir, `/run/${id}/policy`, { directory: dir, readOnly: false })
        ).json) as Detail

        yield* post(dir, `/run/${id}/approve`, {
          directory: dir,
          planVersion: widened.run.planVersion,
          budget: { tokens: 100_000 },
        })

        // 队长一开口就卡住：这正是「停止」最难的时刻 —— 派发已经在飞，检查点还没到。
        // 用 hold 而不是 hang：测试收尾时把连接放掉，服务端不会留下一根等不到头的流。
        const captainMatch = (hit: { body: Record<string, unknown> }) =>
          JSON.stringify(hit.body).includes("你是一个团队的队长")
        let release!: () => void
        const held = new Promise<void>((resolve) => {
          release = resolve
        })
        yield* llm.pushMatch(captainMatch, reply().wait(held).text("{}").stop())

        expect((yield* post(dir, `/run/${id}/execute`, { directory: dir })).status).toBe(200)

        const events = () => Effect.gen(function* () {
          return (yield* (yield* get(dir, `/run/${id}/events`)).json) as Event[]
        })
        const statuses = () => Effect.gen(function* () {
          return (yield* (yield* get(dir, "/session/status")).json) as Status
        })
        const busy = (status: Status) => Object.values(status).filter((item) => item.type === "busy").length

        // 等到派发真的发生、队长的模型调用也已经在飞：没有这一步，
        // 取消可能落在派发之前，测到的只是「还没开始就停了」。
        let dispatched = false
        for (let i = 0; i < 300; i++) {
          const kinds = (yield* events()).map((event) => event.kind)
          const inFlight = (yield* llm.hits).some((hit) => captainMatch(hit))
          if (kinds.includes("team.dispatched") && inFlight && busy(yield* statuses()) > 0) {
            dispatched = true
            break
          }
          yield* Effect.sleep("100 millis")
        }
        expect(dispatched).toBe(true)

        const cancelled = yield* post(dir, `/run/${id}/cancel`, { directory: dir })
        expect(cancelled.status).toBe(200)

        let detail: Detail | undefined
        for (let i = 0; i < 200; i++) {
          detail = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
          if (["done", "partial", "failed", "exceeded", "cancelled", "blocked"].includes(detail.run.state)) break
          yield* Effect.sleep("100 millis")
        }

        const after = yield* events()
        const kinds = after.map((event) => event.kind)

        // 停住了，而且是「取消」，不是跑完之后自己结算成别的结果。
        expect(detail?.run.state).toBe("cancelled")
        expect(kinds).toContain("cancel.requested")
        expect(kinds).toContain("cancel.settled")
        expect(kinds.indexOf("cancel.requested")).toBeLessThan(kinds.indexOf("cancel.settled"))
        // 在途派发被打断不算团队的失败：记录里不该出现「这一队做错了什么」。
        expect(kinds).not.toContain("team.failed")
        expect(detail?.teams.map((team) => team.phase)).toEqual(["cancelled"])

        // 在途的模型调用真的被打断了：会话回到 idle，而不是「停止派发、后台接着跑」。
        let settled = false
        for (let i = 0; i < 100; i++) {
          if (busy(yield* statuses()) === 0) {
            settled = true
            break
          }
          yield* Effect.sleep("100 millis")
        }
        expect(settled).toBe(true)

        // 取消之后不再有新的派发：队长只被问过一次。
        const captainHits = (yield* llm.hits).filter((hit) => captainMatch(hit))
        expect(captainHits.length).toBe(1)

        // 放掉那条卡住的响应，连接正常结束；服务端不留悬空的流。
        release()
        yield* Effect.sleep("100 millis")
      }),
    120_000,
  )
})
