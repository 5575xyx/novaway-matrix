import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Queue } from "effect"
import { Bus } from "../src/bus"
import { PlatformWebview } from "../src/platform-webview"
import { WebviewRequestID } from "../src/platform-webview/schema"
import { SessionID } from "../src/session/schema"
import { testEffect } from "./lib/effect"

// 和被测服务共用同一个 Bus：请求事件必须发到测试订阅的这个实例上。
const bus = Bus.layer
const it = testEffect(Layer.mergeAll(PlatformWebview.layer.pipe(Layer.provide(bus)), bus))

const sessionID = SessionID.make("ses_webview-test")

/** 等第一个下发给客户端的请求（等价于"运营工作台收到了操作请求"）。 */
const nextRequest = Effect.fn("WebviewTest.nextRequest")(function* () {
  const bus = yield* Bus.Service
  const queue = yield* Queue.unbounded<PlatformWebview.Request>()
  const off = yield* bus.subscribeCallback(PlatformWebview.Event.Requested, (event) =>
    Queue.offerUnsafe(queue, event.properties as PlatformWebview.Request),
  )
  yield* Effect.addFinalizer(() => Effect.sync(off))
  return yield* Queue.take(queue)
})

describe("platform webview", () => {
  it.instance("hands a page action to the client and returns its result", () =>
    Effect.gen(function* () {
      const webview = yield* PlatformWebview.Service

      const fiber = yield* webview
        .exec({ sessionID, action: "script", script: "1 + 1" })
        .pipe(Effect.forkScoped)

      const request = yield* nextRequest()
      expect(request.action).toBe("script")
      expect(request.script).toBe("1 + 1")
      expect(request.sessionID).toBe(sessionID)

      // 客户端在页面里执行完，把结果带回来。
      yield* webview.resolve({ requestID: request.id, ok: true, data: 2 })

      expect(yield* Fiber.join(fiber)).toBe(2)
      expect(yield* webview.list()).toHaveLength(0)
    }),
  )

  it.instance("surfaces the client error to the tool", () =>
    Effect.gen(function* () {
      const webview = yield* PlatformWebview.Service

      const fiber = yield* webview
        .exec({ sessionID, action: "script", script: "document.title" })
        .pipe(Effect.forkScoped)

      const request = yield* nextRequest()
      yield* webview.resolve({ requestID: request.id, ok: false, error: "没有打开的平台页面" })

      const exit = yield* Fiber.join(fiber).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(exit.cause.toString()).toContain("没有打开的平台页面")
    }),
  )

  it.instance("drops results for unknown requests instead of failing", () =>
    Effect.gen(function* () {
      const webview = yield* PlatformWebview.Service
      // 超时之后客户端才回来是正常现象：结果丢弃，不能污染下一次请求。
      yield* webview.resolve({ requestID: WebviewRequestID.ascending(), ok: true, data: 1 })
      expect(yield* webview.list()).toHaveLength(0)
    }),
  )
})
