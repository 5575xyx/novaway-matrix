/**
 * 端到端：两个人改了同一个文件，合并冲突不能被当成「合好了」。
 *
 * 各自的 pass 不构成可交付（§10.2）：两个团队在各自的副本里都写对了，
 * 合到一起却可能撞在同一个文件上。这时运行必须停下来，把冲突文件交还给
 * 责任团队重做，而不是「先当成功」或者自动挑一边。
 *
 * 这条测试让两个团队都写 src/shared.md：第一次集成必然冲突，
 * 冲突团队在下一轮拿到「合并冲突：…」的意见后才改到与上游一致。
 */
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { describe, expect } from "bun:test"
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
  teams: Array<{ id: string; phase: string; profileID?: string; worktree?: string }>
  summary: { pass: number; fail: number; unverified: number; stale: number; verdict: string }
}

type Event = { seq: number; kind: string; payload?: Record<string, unknown> }

const exists = (file: string) =>
  fs
    .stat(file)
    .then(() => true)
    .catch(() => false)

const line = String.fromCharCode(10)
const shared = (version: string) => ["# 共享说明", "", "版本" + version + "。"].join(line)

describe("team run merge conflict", () => {
  it.live(
    "two teams editing the same file conflict, the responsible team is sent back, and nothing is claimed done prematurely",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const dir = yield* tmpdirScoped({ git: true })
        yield* Effect.promise(() => Bun.write(dir + "/novaway.json", JSON.stringify(providerConfig(llm.url), null, 2)))

        const session = (yield* (
          yield* post(dir, "/session", {
            title: "merge conflict run",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
            permissionMode: "bypassPermissions",
          })
        ).json) as { id: string }

        const lynn = (yield* (
          yield* post(dir, "/team/employee", { directory: dir, name: "小林", job: "general" })
        ).json) as { id: string }
        const zhou = (yield* (
          yield* post(dir, "/team/employee", { directory: dir, name: "小周", job: "general" })
        ).json) as { id: string }
        const alpha = (yield* (
          yield* post(dir, "/team/profile", {
            directory: dir,
            name: "写作组",
            captain: lynn.id,
            members: [{ employeeID: lynn.id }],
          })
        ).json) as { profile: { id: string } }
        const beta = (yield* (
          yield* post(dir, "/team/profile", {
            directory: dir,
            name: "校对组",
            captain: zhou.id,
            members: [{ employeeID: zhou.id }],
          })
        ).json) as { profile: { id: string } }

        const created = (yield* (
          yield* post(dir, "/run", { sessionID: session.id, directory: dir, mode: "team", goal: "合写一份共享说明" })
        ).json) as { run: { id: string } }
        const id = created.run.id

        yield* post(dir, `/run/${id}/plan`, {
          directory: dir,
          teams: [
            { name: "写作组", profileID: alpha.profile.id },
            { name: "校对组", profileID: beta.profile.id },
          ],
        })
        const planned = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
        const alphaID = planned.teams[0].id
        const betaID = planned.teams[1].id

        // 两条验收看的是同一个文件：各自都能通过，合起来才知道撞不撞。
        const acceptAResult = (yield* (
          yield* post(dir, `/run/${id}/acceptance`, {
            directory: dir,
            specID: "shared-a",
            text: "仓库里有 src/shared.md（写作组交付）",
            kind: "test",
            owner: alphaID,
            verifier: { kind: "command", run: "test -f src/shared.md", timeoutMs: 30_000 },
          })
        ).json) as { id: string }
        const acceptBResult = (yield* (
          yield* post(dir, `/run/${id}/acceptance`, {
            directory: dir,
            specID: "shared-b",
            text: "仓库里有 src/shared.md（校对组交付）",
            kind: "test",
            owner: betaID,
            verifier: { kind: "command", run: "test -f src/shared.md", timeoutMs: 30_000 },
          })
        ).json) as { id: string }

        const widened = (yield* (
          yield* post(dir, `/run/${id}/policy`, { directory: dir, readOnly: false })
        ).json) as Detail

        yield* post(dir, `/run/${id}/approve`, {
          directory: dir,
          planVersion: widened.run.planVersion,
          budget: { tokens: 200_000 },
        })

        const reportOf = (acceptanceID: string) =>
          JSON.stringify({
            summary: "共享说明已补齐",
            claims: [{ acceptanceID, text: "写了 src/shared.md", evidence: "src/shared.md" }],
            done: true,
          })
        const acceptA = "仓库里有 src/shared.md（写作组交付）"
        const acceptB = "仓库里有 src/shared.md（校对组交付）"
        const captainA = (hit: { body: Record<string, unknown> }) => {
          const body = JSON.stringify(hit.body)
          return body.includes("你是一个团队的队长") && body.includes(acceptA)
        }
        // 第一轮与冲突后的重做用「合并冲突」这条意见区分：它只出现在打回之后。
        const captainBFirst = (hit: { body: Record<string, unknown> }) => {
          const body = JSON.stringify(hit.body)
          return body.includes("你是一个团队的队长") && body.includes(acceptB) && !body.includes("合并冲突")
        }
        const captainBRetry = (hit: { body: Record<string, unknown> }) => {
          const body = JSON.stringify(hit.body)
          return body.includes("你是一个团队的队长") && body.includes(acceptB) && body.includes("合并冲突")
        }
        const member = (needle: string) => (hit: { body: Record<string, unknown> }) => {
          const body = JSON.stringify(hit.body)
          return body.includes(needle) && !body.includes("你是一个团队的队长")
        }

        const alphaAcceptance = acceptAResult.id
        const betaAcceptance = acceptBResult.id

        // 队长每次「派活 → 报告」成对排队：格式重问会重新走一遍同一个匹配。
        for (let i = 0; i < 3; i++) {
          yield* llm.toolMatch(captainA, "task", {
            description: "写共享说明",
            prompt: "把共享说明写到 src/shared.md，用 A 写法。",
            subagent_type: "general",
            name: "小林",
          })
          yield* llm.textMatch(captainA, reportOf(alphaAcceptance))
          yield* llm.toolMatch(captainBFirst, "task", {
            description: "写共享说明",
            prompt: "把共享说明写到 src/shared.md，用 B 写法。",
            subagent_type: "general",
            name: "小周",
          })
          yield* llm.textMatch(captainBFirst, reportOf(betaAcceptance))
          yield* llm.toolMatch(captainBRetry, "task", {
            description: "写共享说明",
            prompt: "把共享说明写到 src/shared.md，与上游对齐写法。",
            subagent_type: "general",
            name: "小周",
          })
          yield* llm.textMatch(captainBRetry, reportOf(betaAcceptance))
        }
        // 成员一上来先读再写：文件已经存在时只写会被工具拒掉（先读后写是硬规则），
        // 重做轮恰好就是「文件已存在」的情况，漏掉读这一步会让对齐悄悄没发生。
        for (let i = 0; i < 4; i++) {
          for (const [needle, content] of [
            ["用 A 写法", shared("A")],
            ["用 B 写法", shared("B")],
            ["与上游对齐写法", shared("A")],
          ] as const) {
            yield* llm.toolMatch(member(needle), "read", { filePath: "src/shared.md" })
            yield* llm.toolMatch(member(needle), "write", { filePath: "src/shared.md", content })
            yield* llm.textMatch(member(needle), "已写入")
          }
        }

        expect((yield* post(dir, `/run/${id}/execute`, { directory: dir })).status).toBe(200)

        let detail: Detail | undefined
        for (let i = 0; i < 400; i++) {
          detail = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
          if (["done", "partial", "failed", "exceeded", "cancelled", "blocked"].includes(detail.run.state)) break
          yield* Effect.sleep("250 millis")
        }

        const events = (yield* (yield* get(dir, `/run/${id}/events`)).json) as Event[]
        const kinds = events.map((event) => event.kind)
        const conflict = events.find((event) => event.kind === "team.conflict")
        const conflictRework = events.find(
          (event) => event.kind === "team.rework" && JSON.stringify(event.payload?.notes ?? []).includes("合并冲突"),
        )

        // 冲突被如实记下来，连带冲突文件 —— 用户要知道撞在哪儿。
        expect(kinds).toContain("team.conflict")
        expect(conflict?.payload?.files).toEqual(["src/shared.md"])
        // 责任团队被退回，拿到的正是「合并冲突：…」这条意见。
        expect(conflictRework).toBeDefined()
        expect(conflictRework?.payload?.round).toBe(1)
        // 退回发生在第 1 轮，重做就必须落在第 2 轮：中间不能空转掉一轮，
        // 否则 maxRounds 只有 3 时，一次冲突就吃掉全部返工预算。
        const betaRounds = events
          .filter((event) => event.kind === "team.dispatched" && event.payload?.teamID === betaID)
          .map((event) => event.payload?.round)
        expect(betaRounds).toEqual([1, 2])
        // 第二次集成必须真的合上，且以合上的代码为准重新验证。
        expect(kinds).toContain("integration.merged")
        expect(detail?.run.state).toBe("done")
        expect(detail?.summary).toMatchObject({ pass: 2, fail: 0, unverified: 0, verdict: "complete" })
        expect(detail?.teams.map((team) => team.phase)).toEqual(["delivered", "delivered"])
        // 用户的工作区一个字节都没动。
        expect(yield* Effect.promise(() => exists(path.join(dir, "src", "shared.md")))).toBe(false)
      }),
    240_000,
  )
})
