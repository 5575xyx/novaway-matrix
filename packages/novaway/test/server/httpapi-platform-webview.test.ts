import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Flag } from "@novaway/core/flag/flag"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"

// 挂生产路由树，验证 webview 通道真的接到了 /platform/webview 上（而不是只测
// PlatformWebview 服务本身 —— 那个在 test/platform-webview.test.ts 里）。
const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const originalWorkspaces = Flag.NOVAWAY_EXPERIMENTAL_WORKSPACES
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Flag.NOVAWAY_EXPERIMENTAL_WORKSPACES = originalWorkspaces
        await resetDatabase()
      }),
    )
  }),
)

const servedRoutes: Layer.Layer<never, import("effect").Config.ConfigError, import("effect/unstable/http").HttpServer.HttpServer> =
  HttpRouter.serve(HttpApiApp.routes, { disableListenLog: true, disableLogger: true })

const httpApiServerLayer = servedRoutes.pipe(
  Layer.provideMerge(Socket.layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)

const it = testEffect(Layer.mergeAll(testStateLayer, httpApiServerLayer))

describe("platform webview HttpApi", () => {
  it.live("lists nothing while no desktop client is connected", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get("/platform/webview")

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual([])
    }),
  )

  it.live("accepts a result for an unknown request without failing", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post("/platform/webview/wv_unknown/result").pipe(
        HttpClientRequest.bodyJson({ ok: false, error: "没有打开的平台页面" }),
        Effect.flatMap(HttpClient.execute),
      )

      expect(response.status).toBe(200)
      expect(yield* response.json).toBe(true)
    }),
  )

  it.live("rejects a malformed result body", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post("/platform/webview/wv_unknown/result").pipe(
        HttpClientRequest.bodyJson({ ok: "yes" }),
        Effect.flatMap(HttpClient.execute),
      )

      expect(response.status).toBe(400)
    }),
  )
})
