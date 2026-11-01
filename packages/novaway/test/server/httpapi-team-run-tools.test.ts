/**
 * 端到端：队长真的派活、成员真的改文件、验收靠命令退出码。
 *
 * 前两条端到端只让模型回 JSON：证明得了「计划→批准→派发→验证→结算」的链路，
 * 却证明不了「成员在团队副本里干活」。这条补上真实工具调用 —— 队长用 `task`
 * 派给名册里的某个人，成员用 `write` 落文件，验收项跑 `test -f` 看退出码。
 *
 * 两件事必须同时成立：
 * 1. 文件落在团队 worktree 里（否则合并、验证都对着空目录）；
 * 2. 用户自己的工作区不被写入（团队副本存在的意义就是隔离）。
 */
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import fs from "node:fs/promises"
import path from "node:path"
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

const exists = (file: string) =>
  fs
    .stat(file)
    .then(() => true)
    .catch(() => false)

describe("team run with real tool calls", () => {
  it.live(
    "the captain dispatches a member, the member writes the file, the command verifier decides",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const dir = yield* tmpdirScoped({ git: true })
        yield* Effect.promise(() => Bun.write(dir + "/novaway.json", JSON.stringify(providerConfig(llm.url), null, 2)))

        const session = (yield* (
          yield* post(dir, "/session", {
            title: "tools run",
            // 其余测试只让模型回 JSON；这里要真实工具，权限必须先放开。
            // `bypassPermissions` 是「无人值守运行」的等价配置：子代理会话会继承
            // 父会话的模式，成员写文件时不会停在没人回答的授权弹窗上。
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

        const acceptance = (yield* (
          yield* post(dir, `/run/${id}/acceptance`, {
            directory: dir,
            specID: "refund-doc",
            text: "仓库里有 src/refund.md",
            kind: "test",
            owner: teamID,
            // 命令是「人」写的受控配置：退出码就是结论，不经过模型。
            verifier: { kind: "command", run: "test -f src/refund.md", timeoutMs: 30_000 },
          })
        ).json) as { id: string }

        // 默认只读；这次要真的写文件，放宽必须是显式的（模型没有提权通道）。
        const widened = (yield* (
          yield* post(dir, `/run/${id}/policy`, { directory: dir, readOnly: false })
        ).json) as Detail

        yield* post(dir, `/run/${id}/approve`, {
          directory: dir,
          planVersion: widened.run.planVersion,
          budget: { tokens: 100_000 },
        })

        const captainMatch = (hit: { body: Record<string, unknown> }) =>
          JSON.stringify(hit.body).includes("你是一个团队的队长")
        const memberMatch = (hit: { body: Record<string, unknown> }) =>
          JSON.stringify(hit.body).includes("把退款说明写到 src/refund.md")
        const report = JSON.stringify({
          summary: "退款说明已补齐",
          claims: [{ acceptanceID: acceptance.id, text: "写了 src/refund.md", evidence: "src/refund.md" }],
          done: true,
        })
        // 队长每次「派活 → 报告」成对排队：格式重问会重新走一遍同一个匹配，
        // 只排工具调用的话，重问会落到「没有匹配」的 ok 上，永远读不出报告。
        for (let i = 0; i < 3; i++) {
          yield* llm.toolMatch(captainMatch, "task", {
            description: "写退款说明",
            prompt: "把退款说明写到 src/refund.md，然后回报。",
            subagent_type: "general",
            name: "小林",
          })
          yield* llm.textMatch(captainMatch, report)
        }
        // 成员：真的写文件，然后回一句。
        for (let i = 0; i < 3; i++) {
          yield* llm.toolMatch(memberMatch, "write", {
            filePath: "src/refund.md",
            content: ["# 退款说明", "", "七天内原路退回。"].join(String.fromCharCode(10)),
          })
          yield* llm.textMatch(memberMatch, "已写入")
        }

        expect((yield* post(dir, `/run/${id}/execute`, { directory: dir })).status).toBe(200)

        let detail: Detail | undefined
        for (let i = 0; i < 200; i++) {
          detail = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
          if (["done", "partial", "failed", "exceeded", "cancelled", "blocked"].includes(detail.run.state)) break
          yield* Effect.sleep("250 millis")
        }

        // 团队副本里必须真的有这个文件（否则合并与复验都对着空目录）。
        expect(detail?.run.state).toBe("done")
        expect(detail?.summary).toMatchObject({ pass: 1, fail: 0, unverified: 0, verdict: "complete" })
        // 用户的工作区不能被写：团队副本存在的意义就是隔离。
        expect(yield* Effect.promise(() => exists(path.join(dir, "src", "refund.md")))).toBe(false)
      }),
    180_000,
  )
})
