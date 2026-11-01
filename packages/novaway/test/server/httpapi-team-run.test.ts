/**
 * 端到端：从建会话到「已验证交付」，全程走生产路由树。
 *
 * 其余团队测试都在验证某一段（状态机、调度器、路由契约）。这里补上那个唯一的缺口：
 * 一次真实运行 —— 计划 → 批准 → 执行 → 派队长 → 验证器 → 结算 —— 是否真的能跑完。
 * 模型由 `TestLLMServer` 顶替：队长与验证器各自只回一段 JSON，没有工具调用。
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

const post = (dir: string, path: string, body?: unknown) =>
  Effect.gen(function* () {
    const request = HttpClientRequest.post(path).pipe(
      HttpClientRequest.setHeader("x-opencode-directory", dir),
      HttpClientRequest.setUrlParam("directory", dir),
    )
    const ready = body === undefined ? request : yield* HttpClientRequest.bodyJson(body)(request)
    return yield* HttpClient.execute(ready)
  })

const get = (dir: string, path: string) =>
  HttpClient.execute(
    HttpClientRequest.get(path).pipe(
      HttpClientRequest.setHeader("x-opencode-directory", dir),
      HttpClientRequest.setUrlParam("directory", dir),
    ),
  )

const providerConfig = (url: string) => ({
  $schema: "https://opencode.ai/config.json",
  formatter: false,
  lsp: false,
  // 派发时没有历史助手消息，内核读的是这个默认模型。
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
  teams: Array<{ id: string; phase: string }>
  acceptances: Array<{ id: string; text: string }>
  verifications: Array<{ acceptanceID: string; outcome: string; evidenceRef?: string; snapshotID: string }>
  summary: { pass: number; fail: number; unverified: number; stale: number; verdict: string }
}

/**
 * 一条更窄的端到端：这次的名册来自模板，且队长**声明了自己的岗位说明与模型**。
 *
 * 之前这两个字段只存在库里：`Employee.model` / `Employee.prompt` 从没被读过，
 * 内置「代码审查团队」五个人拿到的提示词一模一样。这里用一个只有「岗位说明里才有的句子」
 * 做匹配：模型没收到这句话，就拿不到报告，运行会以格式问题失败 —— 断言的是真实链路。
 */
const templateRunTest = () =>
  Effect.gen(function* () {
    const llm = yield* TestLLMServer
    const dir = yield* tmpdirScoped({ git: true })
    yield* Effect.promise(() => Bun.write(dir + "/novaway.json", JSON.stringify(providerConfig(llm.url), null, 2)))

    const session = (yield* (yield* post(dir, "/session", { title: "template run" })).json) as { id: string }
    const person = (yield* (
      yield* post(dir, "/team/employee", {
        directory: dir,
        name: "安全审查",
        job: "general",
        // 只有这一句能证明岗位说明真的进了请求：改任何一处都会让匹配落空。
        prompt: "只找安全问题：注入、越权、凭据泄漏。",
        model: "test/test-model",
      })
    ).json) as { id: string }
    const profile = (yield* (
      yield* post(dir, "/team/profile", {
        directory: dir,
        name: "安全组",
        captain: person.id,
        members: [{ employeeID: person.id }],
      })
    ).json) as { profile: { id: string } }

    const created = (yield* (
      yield* post(dir, "/run", { sessionID: session.id, directory: dir, mode: "team", goal: "审查一次变更" })
    ).json) as { run: { id: string } }
    const id = created.run.id
    yield* post(dir, `/run/${id}/plan`, {
      directory: dir,
      teams: [{ name: "安全组", profileID: profile.profile.id }],
    })
    const planned = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
    const teamID = planned.teams[0].id
    const acceptance = (yield* (
      yield* post(dir, `/run/${id}/acceptance`, {
        directory: dir,
        specID: "security",
        text: "没有凭据泄漏",
        kind: "rubric",
        owner: teamID,
      })
    ).json) as { id: string }
    yield* post(dir, `/run/${id}/approve`, {
      directory: dir,
      planVersion: planned.run.planVersion,
      budget: { tokens: 100_000 },
    })

    const report = JSON.stringify({
      summary: "没有发现问题",
      claims: [{ acceptanceID: acceptance.id, text: "检查了注入与越权", evidence: "src/a.ts:1" }],
      done: true,
    })
    const verdict = JSON.stringify({ outcome: "pass", measured: "无泄漏", evidence: "src/a.ts:1" })
    for (let i = 0; i < 3; i++)
      yield* llm.textMatch((hit) => JSON.stringify(hit.body).includes("只找安全问题：注入、越权、凭据泄漏。"), report)
    for (let i = 0; i < 6; i++) yield* llm.textMatch((hit) => JSON.stringify(hit.body).includes("你只做一件事"), verdict)

    expect((yield* post(dir, `/run/${id}/execute`, { directory: dir })).status).toBe(200)

    let detail: Detail | undefined
    for (let i = 0; i < 150; i++) {
      detail = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
      if (["done", "partial", "failed", "exceeded", "cancelled", "blocked"].includes(detail.run.state)) break
      yield* Effect.sleep("200 millis")
    }
    expect(detail?.run).toMatchObject({ state: "done" })
    // 名册里的岗位说明真的发给了模型，而不只是存在库里。
    const hits = yield* llm.hits
    expect(hits.some((hit) => JSON.stringify(hit.body).includes("【你的岗位说明 · 安全审查（general）】"))).toBe(true)
  })

describe("team run end-to-end", () => {
  it.live(
    "plans, approves, dispatches, verifies and settles a run",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const dir = yield* tmpdirScoped({ git: true })
        yield* Effect.promise(() =>
          Bun.write(dir + "/novaway.json", JSON.stringify(providerConfig(llm.url), null, 2)),
        )

        const session = (yield* (yield* post(dir, "/session", { title: "e2e run" })).json) as {
          id: string
        }

        const createResponse = yield* post(dir, "/run", {
          sessionID: session.id,
          directory: dir,
          mode: "team",
          goal: "确认退款流程可用",
        })
        expect(createResponse.status).toBe(200)
        const created = (yield* createResponse.json) as { run: { id: string } }
        const id = created.run.id

        yield* post(dir, `/run/${id}/plan`, { directory: dir, teams: [{ name: "alpha" }] })
        const planned = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
        expect(planned.teams).toHaveLength(1)
        const teamID = planned.teams[0].id

        const acceptance = (yield* (
          yield* post(dir, `/run/${id}/acceptance`, {
            directory: dir,
            specID: "refund",
            text: "退款流程可用",
            kind: "rubric",
            owner: teamID,
          })
        ).json) as { id: string }

        yield* post(dir, `/run/${id}/approve`, {
          directory: dir,
          planVersion: planned.run.planVersion,
          budget: { tokens: 100_000 },
        })

        // 队长只回结构化报告；验证器只回判定。两者都靠提示词开头区分。
        //
        // 同一段回复要排队多份：验收会验两遍（团队快照一次、合并后的快照再一次），
        // 返工后还会重派。只排一份的话，第二次调用会落到「没有匹配」的默认回复上，
        // 验证器拿到一句 ok，结论就变成 unverified —— 那是测试没准备，不是实现有问题。
        const report = JSON.stringify({
          summary: "退款边界已确认",
          claims: [{ acceptanceID: acceptance.id, text: "补了退款边界用例", evidence: "src/refund.ts:42" }],
          artifacts: [{ name: "refund", version: 1 }],
          done: true,
        })
        const verdict = JSON.stringify({ outcome: "pass", measured: "用例通过", evidence: "src/refund.ts:42" })
        for (let i = 0; i < 3; i++)
          yield* llm.textMatch((hit) => JSON.stringify(hit.body).includes("你是一个团队的队长"), report)
        for (let i = 0; i < 6; i++)
          yield* llm.textMatch((hit) => JSON.stringify(hit.body).includes("你只做一件事"), verdict)

        expect((yield* post(dir, `/run/${id}/execute`, { directory: dir })).status).toBe(200)

        // 执行是分叉出去的：轮询到终态为止，而不是假设同步完成。
        let detail: Detail | undefined
        for (let i = 0; i < 150; i++) {
          detail = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
          if (["done", "partial", "failed", "exceeded", "cancelled"].includes(detail.run.state)) break
          yield* Effect.sleep("200 millis")
        }

        expect(detail?.run).toMatchObject({ state: "done" })
        expect(detail?.teams.map((team) => team.phase)).toEqual(["delivered"])
        // 结论只能来自验证器：通过项要带证据，且不能是「未验证被折算成通过」。
        const recorded = (detail?.verifications ?? []).filter((item) => item.acceptanceID === acceptance.id)
        expect(recorded.at(-1)?.outcome).toBe("pass")
        expect(recorded.at(-1)?.evidenceRef).toContain("src/refund.ts")
        // 四项分列计数，未验证不并入通过。
        expect(detail?.summary).toMatchObject({ pass: 1, fail: 0, unverified: 0, stale: 0, verdict: "complete" })
      }),
    120_000,
  )

  it.live("a template roster reaches the model with the captain's own instructions", templateRunTest, 120_000)
})

