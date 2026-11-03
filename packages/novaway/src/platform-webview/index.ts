import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "@/session/schema"
import * as Log from "@novaway/core/util/log"
import { Context, Deferred, Effect, Layer, Option, Schema } from "effect"
import { WebviewRequestID } from "./schema"

const log = Log.create({ service: "platform-webview" })

/**
 * 运营工作台里那块内嵌浏览器（Electron `<webview>`）的操作通道。
 *
 * 模型跑在服务端（sidecar），碰不到客户端里的 webview；而公众号这类后台
 * 只认浏览器里已经登录好的那份会话，另起一个无头浏览器既没有登录态、
 * 用户也看不见发生了什么。所以这里走「服务端发请求 → 客户端执行 → 回传结果」：
 *
 *   tool（服务端） ──bus: platform.webview.request──▶ app（渲染进程）
 *                  ◀──POST /platform/webview/:id/result──
 *
 * 和 `question` 同构，区别只在于请求交给客户端执行而不是交给人回答。
 */

export const DEFAULT_TIMEOUT_MS = 20_000

/**
 * 客户端只需要会四件事：
 * - `status`     读当前地址/标题/平台账号（判断页面在不在、登录没登录）
 * - `script`     在页面里跑一段脚本（快照/点击/填表都由服务端拼好脚本）
 * - `navigate`   跳转（含等待加载完成）
 * - `screenshot` 截当前页面
 *
 * 其余动作都在服务端拼成脚本下发 —— 客户端保持"哑执行器"，改一处不会两边漂移。
 */
export const Action = Schema.Literals(["status", "script", "navigate", "screenshot"])
export type Action = Schema.Schema.Type<typeof Action>

export const Request = Schema.Struct({
  id: WebviewRequestID,
  sessionID: SessionID,
  action: Action,
  /** 指定平台或账号；省略时用工作台当前打开的那个页面。 */
  target: Schema.optional(Schema.String),
  script: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  /** 客户端侧的等待上限（毫秒）：页面加载/元素出现要等多久。 */
  timeoutMs: Schema.optional(Schema.Number),
})
export type Request = Schema.Schema.Type<typeof Request>

export const Result = Schema.Struct({
  requestID: WebviewRequestID,
  ok: Schema.Boolean,
  data: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
})
export type Result = Schema.Schema.Type<typeof Result>

export const Event = {
  Requested: BusEvent.define("platform.webview.request", Request),
  Resolved: BusEvent.define("platform.webview.resolved", Result),
}

export class WebviewError extends Schema.TaggedErrorClass<WebviewError>()("PlatformWebviewError", {
  code: Schema.String,
  message: Schema.String,
}) {}

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<unknown, WebviewError>
}

interface State {
  pending: Map<WebviewRequestID, PendingEntry>
}

export interface Interface {
  /** 发一次页面操作，等客户端回传结果。 */
  readonly exec: (input: Omit<Request, "id">) => Effect.Effect<unknown, WebviewError>
  /** 客户端执行完（成功或失败）后回传。 */
  readonly resolve: (input: Result) => Effect.Effect<void>
  /** 还在等客户端响应的请求。客户端重连后用它补答，避免服务端永远挂着。 */
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@novaway/PlatformWebview") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("PlatformWebview.state")(function* () {
        const state: State = { pending: new Map() }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(
                item.deferred,
                new WebviewError({ code: "closed", message: "页面操作已被取消（工作区已关闭）" }),
              )
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const exec = Effect.fn("PlatformWebview.exec")(function* (input: Omit<Request, "id">) {
      const pending = (yield* InstanceState.get(state)).pending
      const id = WebviewRequestID.ascending()
      const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const info = Schema.decodeUnknownSync(Request)({ ...input, id, timeoutMs: timeout })
      const deferred = yield* Deferred.make<unknown, WebviewError>()
      pending.set(id, { info, deferred })
      log.info("exec", { id, action: input.action, target: input.target })

      yield* bus.publish(Event.Requested, info).pipe(Effect.ignore)

      return yield* Effect.ensuring(
        Deferred.await(deferred).pipe(
          Effect.timeoutOption(timeout + 5_000),
          Effect.flatMap((value) =>
            Option.isSome(value)
              ? Effect.succeed(value.value)
              : Effect.fail(
                  new WebviewError({
                    code: "timeout",
                    message: [
                      `页面操作超时（${input.action}）：没有客户端响应。`,
                      "运营工作台可能没有打开，或者没有选中该平台的账号。",
                      "请用户在「运营工作台」里点开对应账号、让平台页面显示出来后再重试；不要改用无头浏览器。",
                    ].join(" "),
                  }),
                ),
          ),
        ),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const resolve = Effect.fn("PlatformWebview.resolve")(function* (input: Result) {
      const pending = (yield* InstanceState.get(state)).pending
      const existing = pending.get(input.requestID)
      if (!existing) {
        // 超时后客户端才回来是正常的：结果直接丢掉，别让旧结果污染下一次请求。
        log.warn("resolve for unknown request", { requestID: input.requestID })
        return
      }
      pending.delete(input.requestID)
      yield* bus
        .publish(Event.Resolved, {
          requestID: input.requestID,
          ok: input.ok,
          ...(input.data === undefined ? {} : { data: input.data }),
          ...(input.error === undefined ? {} : { error: input.error }),
        })
        .pipe(Effect.ignore)
      if (input.ok) {
        yield* Deferred.succeed(existing.deferred, input.data)
      } else {
        yield* Deferred.fail(
          existing.deferred,
          new WebviewError({ code: "client", message: input.error ?? "页面操作失败" }),
        )
      }
    })

    const list = Effect.fn("PlatformWebview.list")(function* () {
      return Array.from((yield* InstanceState.get(state)).pending.values(), (item) => item.info)
    })

    return Service.of({ exec, resolve, list })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as PlatformWebview from "."
