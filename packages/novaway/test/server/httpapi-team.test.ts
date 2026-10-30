import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Flag } from "@novaway/core/flag/flag"
import { describe, expect } from "bun:test"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// 团队接口走的是生产路由树：mission 的编号/起点/状态与 run 的目标校验都在 HTTP 边界上，
// 只测 service 会漏掉「参数被序列化成什么、拒绝时返回什么状态码」这一层。
const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const originalWorkspaces = Flag.NOVAWAY_EXPERIMENTAL_WORKSPACES
    Flag.NOVAWAY_EXPERIMENTAL_WORKSPACES = true
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Flag.NOVAWAY_EXPERIMENTAL_WORKSPACES = originalWorkspaces
        await resetDatabase()
      }),
    )
  }),
)

const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true, disableLogger: true },
)

const httpApiServerLayer = servedRoutes.pipe(
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)

const it = testEffect(Layer.mergeAll(testStateLayer, httpApiServerLayer))

const directoryHeader = (dir: string) => HttpClientRequest.setHeader("x-opencode-directory", dir)

const send = (request: HttpClientRequest.HttpClientRequest, body?: unknown) =>
  Effect.gen(function* () {
    // `bodyJson(body)` 返回的是 request → Effect，所以要显式把请求喂进去再执行。
    const ready = body === undefined ? request : yield* HttpClientRequest.bodyJson(body)(request)
    return yield* HttpClient.execute(ready)
  })

const post = (dir: string, path: string, body?: unknown) =>
  send(HttpClientRequest.post(path).pipe(directoryHeader(dir)), body)

const get = (dir: string, path: string, param?: string) =>
  HttpClient.execute(
    HttpClientRequest.get(path).pipe(
      directoryHeader(dir),
      param ? HttpClientRequest.setUrlParam("directory", param) : (request) => request,
    ),
  )

const patch = (dir: string, path: string, body: unknown) =>
  send(HttpClientRequest.patch(path).pipe(directoryHeader(dir)), body)

describe("team HttpApi", () => {
  it.live("creates, lists and updates a mission; the diff says why it cannot be computed yet", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })

      const created = yield* post(dir, "/team/mission", { directory: dir, goal: "把下载流程改好" })
      expect(created.status).toBe(200)
      const mission = (yield* created.json) as {
        id: string
        number: number
        label: string
        status: string
        baseSHA?: string
        runCount: number
      }
      // 编号只给人看；起点在建目标时就冻结。
      expect(mission.label).toBe("M-001")
      expect(mission.status).toBe("active")
      expect(mission.baseSHA).toBeTruthy()
      expect(mission.runCount).toBe(0)

      const listed = yield* get(dir, "/team/mission", dir)
      expect(listed.status).toBe(200)
      expect(((yield* listed.json) as Array<{ id: string }>).map((item) => item.id)).toContain(mission.id)

      // 别的目录看不到这个目标：列表按目录过滤，不是「全局一张表随便看」。
      const other = yield* tmpdirScoped({ git: true })
      const elsewhere = yield* get(other, "/team/mission", other)
      expect(yield* elsewhere.json).toEqual([])

      const detail = yield* get(dir, `/team/mission/${mission.id}`)
      expect(detail.status).toBe(200)
      expect((yield* detail.json) as { goal: string }).toMatchObject({ goal: "把下载流程改好" })

      // 还没有工作区时，差异返回原因而不是「0 个文件」。
      const diff = yield* get(dir, `/team/mission/${mission.id}/diff`)
      expect(diff.status).toBe(200)
      expect((yield* diff.json) as { files: unknown[]; skippedReason?: string }).toMatchObject({
        files: [],
        untracked: [],
        truncated: false,
        skippedReason: "目标还没有工作区",
      })

      const updated = yield* patch(dir, `/team/mission/${mission.id}`, { status: "done" })
      expect(updated.status).toBe(200)
      expect((yield* updated.json) as { status: string }).toMatchObject({ status: "done" })

      expect((yield* get(dir, "/team/mission/mis_missing")).status).toBe(404)
    }),
  )

  it.live("refuses to attach a run to a mission that is missing, finished or in another directory", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const created = yield* post(dir, "/team/mission", { directory: dir, goal: "长期目标" })
      const mission = (yield* created.json) as { id: string }

      const body = (missionID: string, directory: string) => ({
        sessionID: "ses_team_http",
        directory,
        mode: "team" as const,
        goal: "一次运行",
        missionID,
      })

      // 目标不存在 / 目标属于别的目录 / 目标已结束：三种情况都不能悄悄降级成「不带目标的运行」。
      expect((yield* post(dir, "/run", body("mis_missing", dir))).status).toBe(400)
      const other = yield* tmpdirScoped({ git: true })
      expect((yield* post(dir, "/run", body(mission.id, other))).status).toBe(400)

      yield* patch(dir, `/team/mission/${mission.id}`, { status: "done" })
      expect((yield* post(dir, "/run", body(mission.id, dir))).status).toBe(400)
    }),
  )

  it.live("merge is only offered for terminal runs with a verified delivery", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })

      const created = yield* post(dir, "/run", {
        sessionID: "ses_team_http",
        directory: dir,
        mode: "team",
        goal: "一次性运行",
      })
      expect(created.status).toBe(200)
      const run = (yield* created.json) as { run: { id: string; state: string } }
      expect(run.run.state).toBe("planning")

      // 还在计划中的运行没有可交付物：合并没有意义，直接拒绝。
      expect((yield* post(dir, `/run/${run.run.id}/merge`)).status).toBe(400)

      const cancelled = yield* post(dir, `/run/${run.run.id}/cancel`)
      expect(cancelled.status).toBe(200)

      // 取消也是终态，但它不是「已验证交付」：返回原因，不假装合并成功。
      const merged = yield* post(dir, `/run/${run.run.id}/merge`)
      expect(merged.status).toBe(200)
      expect((yield* merged.json) as { merged: boolean; message?: string }).toMatchObject({
        merged: false,
        message: expect.stringContaining("cancelled"),
      })

      expect((yield* post(dir, "/run/run_missing/merge")).status).toBe(404)
    }),
  )
})
