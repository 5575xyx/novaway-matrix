/**
 * 端到端：两个团队各干各的，合成一份仍然成立才算交付。
 *
 * 单个团队的 `pass` 不是可交付（§10.2）：两个人分别在各自的副本里写对了，
 * 合到一起会不会互相撞、合并后的树还能不能过验收，都得真的合一次才知道。
 *
 * 这条测试让两个团队并行改两个不同文件，然后检查：
 * 1. 集成分支真的建出来了，里面两个文件都在（合并没有丢东西）；
 * 2. 用户的分支和工作区没被碰 —— 合并进用户分支是用户的动作，不是运行的副作用。
 */
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
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
  run: { id: string; state: string; planVersion: number; error?: string; mergeState?: string; mergedAt?: number }
  teams: Array<{ id: string; phase: string; worktree?: string }>
  summary: {
    pass: number
    fail: number
    unverified: number
    stale: number
    verdict: string
    lines?: Array<{ acceptanceID: string; tier?: string; tierReason?: string }>
  }
}

type Event = { seq: number; kind: string; payload?: Record<string, unknown> }

const exists = (file: string) =>
  fs
    .stat(file)
    .then(() => true)
    .catch(() => false)

const exec = promisify(execFile)

const git = async (cwd: string, args: string[]) => (await exec("git", args, { cwd })).stdout.trim()

describe("team run merge", () => {
  it.live(
    "two teams work in parallel and the merged tree is what gets verified",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const dir = yield* tmpdirScoped({ git: true })
        yield* Effect.promise(() => Bun.write(dir + "/novaway.json", JSON.stringify(providerConfig(llm.url), null, 2)))
        // 测试配置先提交：显式合并拒绝在脏工作区上动手（§10.2），
        // 留一个未跟踪的 novaway.json 会让「用户点了合并」这一步变成 dirty 拒绝。
        yield* Effect.promise(() => git(dir, ["add", "-A"]))
        yield* Effect.promise(() => git(dir, ["commit", "-m", "test config", "--no-verify"]))

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
          yield* post(dir, "/run", { sessionID: session.id, directory: dir, mode: "team", goal: "各补一份说明" })
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

        // 两个团队各一条验收，各自的命令只管自己那份文件。
        const docA = (yield* (
          yield* post(dir, `/run/${id}/acceptance`, {
            directory: dir,
            specID: "refund-doc",
            text: "仓库里有 src/refund.md",
            kind: "test",
            owner: alphaID,
            verifier: { kind: "command", run: "test -f src/refund.md", timeoutMs: 30_000 },
          })
        ).json) as { id: string }
        const docB = (yield* (
          yield* post(dir, `/run/${id}/acceptance`, {
            directory: dir,
            specID: "policy-doc",
            text: "仓库里有 src/policy.md",
            kind: "test",
            owner: betaID,
            verifier: { kind: "command", run: "test -f src/policy.md", timeoutMs: 30_000 },
          })
        ).json) as { id: string }

        // 默认只读；这次要真的写文件，放宽必须是显式的（模型没有提权通道）。
        const widened = (yield* (
          yield* post(dir, `/run/${id}/policy`, { directory: dir, readOnly: false })
        ).json) as Detail

        yield* post(dir, `/run/${id}/approve`, {
          directory: dir,
          planVersion: widened.run.planVersion,
          budget: { tokens: 200_000 },
        })
        const headBefore = yield* Effect.promise(() => git(dir, ["rev-parse", "HEAD"]))

        const reportOf = (acceptanceID: string, evidence: string) =>
          JSON.stringify({
            summary: "说明已补齐",
            claims: [{ acceptanceID, text: "写了 " + evidence, evidence }],
            done: true,
          })
        // 两个队长的开场白一样，用「自己那条验收」把它们分开：队长只看得到自己组的验收。
        const captainOf = (acceptanceText: string) => (hit: { body: Record<string, unknown> }) => {
          const body = JSON.stringify(hit.body)
          return body.includes("你是一个团队的队长") && body.includes(acceptanceText)
        }
        const memberWriting = (file: string) => (hit: { body: Record<string, unknown> }) => {
          const body = JSON.stringify(hit.body)
          return body.includes("写到 " + file) && !body.includes("你是一个团队的队长")
        }
        const line = String.fromCharCode(10)
        // 队长每次「派活 → 报告」成对排队：格式重问会重新走一遍同一个匹配。
        for (let i = 0; i < 3; i++) {
          yield* llm.toolMatch(captainOf("仓库里有 src/refund.md"), "task", {
            description: "写退款说明",
            prompt: "把退款说明写到 src/refund.md，然后回报。",
            subagent_type: "general",
            name: "小林",
          })
          yield* llm.textMatch(captainOf("仓库里有 src/refund.md"), reportOf(docA.id, "src/refund.md"))
          yield* llm.toolMatch(captainOf("仓库里有 src/policy.md"), "task", {
            description: "写政策说明",
            prompt: "把政策说明写到 src/policy.md，然后回报。",
            subagent_type: "general",
            name: "小周",
          })
          yield* llm.textMatch(captainOf("仓库里有 src/policy.md"), reportOf(docB.id, "src/policy.md"))
        }
        // 两个成员并行写各自的文件。
        for (let i = 0; i < 3; i++) {
          yield* llm.toolMatch(memberWriting("src/refund.md"), "write", {
            filePath: "src/refund.md",
            content: ["# 退款说明", "", "七天内原路退回。"].join(line),
          })
          yield* llm.textMatch(memberWriting("src/refund.md"), "已写入")
          yield* llm.toolMatch(memberWriting("src/policy.md"), "write", {
            filePath: "src/policy.md",
            content: ["# 政策说明", "", "以最新公告为准。"].join(line),
          })
          yield* llm.textMatch(memberWriting("src/policy.md"), "已写入")
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

        expect(detail?.run.state).toBe("done")
        expect(kinds).toContain("integration.merged")
        // 两条验收分属两个团队，都过了才叫交付。
        expect(detail?.summary).toMatchObject({ pass: 2, fail: 0, unverified: 0, verdict: "complete" })
        // 每队各改一个文件、且都有可执行命令：调度器判轻档，并把理由一并落库（§19.1）。
        expect(detail?.summary.lines?.length).toBe(2)
        expect(detail?.summary.lines?.every((line) => line.tier === "light" && !!line.tierReason)).toBe(true)
        expect(detail?.teams.map((team) => team.phase)).toEqual(["delivered", "delivered"])

        // 集成真的合出了东西：集成 worktree 里两个文件都在。
        const integration = (yield* Effect.promise(async () => {
          const list = await git(dir, ["worktree", "list", "--porcelain"])
          const paths = list
            .split("\n")
            .filter((row) => row.startsWith("worktree "))
            .map((row) => row.slice("worktree ".length).trim())
          for (const root of paths) {
            const both =
              (await exists(path.join(root, "src", "refund.md"))) && (await exists(path.join(root, "src", "policy.md")))
            if (both) return root
          }
          return undefined
        }))
        expect(typeof integration).toBe("string")
        expect(yield* Effect.promise(() => git(dir, ["branch", "--list", "novaway/integrate/*"]))).not.toBe("")

        // 用户的分支和工作区一个字节都没动：合并进用户分支是用户的动作。
        expect(yield* Effect.promise(() => git(dir, ["rev-parse", "HEAD"]))).toBe(headBefore)
        expect(yield* Effect.promise(() => exists(path.join(dir, "src", "refund.md")))).toBe(false)
        expect(yield* Effect.promise(() => exists(path.join(dir, "src", "policy.md")))).toBe(false)
        // 跑完不等于合并：`done` 之外还要有独立的合并状态。
        expect(detail?.run.mergeState).toBe("unmerged")

        // 显式合并：用户点了这一下，代码才进自己的分支。
        const merged = (yield* (yield* post(dir, `/run/${id}/merge`)).json) as {
          merged: boolean
          branch?: string
          sha?: string
          alreadyMerged?: boolean
        }
        expect(merged.merged).toBe(true)
        expect(merged.alreadyMerged).toBeUndefined()
        expect(yield* Effect.promise(() => git(dir, ["rev-parse", "HEAD"]))).not.toBe(headBefore)
        expect(yield* Effect.promise(() => exists(path.join(dir, "src", "refund.md")))).toBe(true)
        expect(yield* Effect.promise(() => exists(path.join(dir, "src", "policy.md")))).toBe(true)

        const afterMerge = (yield* (yield* get(dir, `/run/${id}`)).json) as Detail
        expect(afterMerge.run.mergeState).toBe("merged")
        expect(typeof afterMerge.run.mergedAt).toBe("number")

        // 再点一次：不产生新的合并，也不能把上一次的 sha 说成这一次的。
        const headAfterMerge = yield* Effect.promise(() => git(dir, ["rev-parse", "HEAD"]))
        const again = (yield* (yield* post(dir, `/run/${id}/merge`)).json) as {
          merged: boolean
          sha?: string
          alreadyMerged?: boolean
        }
        expect(again.merged).toBe(true)
        expect(again.alreadyMerged).toBe(true)
        expect(again.sha).toBe(merged.sha)
        expect(yield* Effect.promise(() => git(dir, ["rev-parse", "HEAD"]))).toBe(headAfterMerge)
      }),
    240_000,
  )
})
