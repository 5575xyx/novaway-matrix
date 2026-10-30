import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { Identifier } from "@/id/id"
import { Service as HookService, defaultLayer as HookLayer } from "@/hook/service"
import { empty as emptyHook } from "@/hook/schema"

/**
 * MCP elicitation：服务器在工具调用中途反过来向用户要输入。
 *
 * 与 CC 的对应关系（`services/mcp/elicitationHandler.ts`）：
 *
 * 1. 先跑 `Elicitation` 钩子 —— 它能直接给出答案（本地脚本知道该填什么），
 *    或者 `deny` 阻断（视为 `decline`）。这一步不打扰用户。
 * 2. 没有钩子回答时把请求挂进队列并广播 `elicitation.asked`，等 UI 回答。
 * 3. 拿到答案后再跑 `ElicitationResult` 钩子 —— 它可以改写或拦截。
 *
 * 几条刻意的取舍：
 *
 * - **默认不超时。** 这是「有人在等填表」，设默认超时会把用户正在读的弹窗
 *   关掉。真正的兜底是：调用被中断（`signal`）→ 立刻 `cancel`；需要无人值守
 *   时可配 `experimental.elicitation_timeout_ms`。
 * - **永远返回结果、永不抛错。** 协议侧只认 `accept` / `decline` / `cancel`；
 *   把内部异常变成 `cancel` 才能让 MCP 服务器继续走它自己的降级路径，
 *   否则一次实现错误会让整个工具调用挂死。
 * - **`url` 模式只做转交。** 我们不在内核里打开浏览器：UI 层决定怎么展示。
 *   服务器确认完成后会发 `notifications/elicitation/complete`，转成
 *   `elicitation.completed` 事件让弹窗知道可以收起了。
 */

export const Action = Schema.Literals(["accept", "decline", "cancel"])
export type Action = Schema.Schema.Type<typeof Action>

export const Mode = Schema.Literals(["form", "url"])
export type Mode = Schema.Schema.Type<typeof Mode>

export const Request = Schema.Struct({
  id: Schema.String,
  serverName: Schema.String,
  message: Schema.String,
  mode: Mode,
  /** `url` 模式下要用户打开的地址。 */
  url: Schema.optional(Schema.String),
  /** `url` 模式下服务器给的标识，完成通知靠它匹配。 */
  elicitationId: Schema.optional(Schema.String),
  /** `form` 模式的 JSON Schema；UI 据此渲染字段。 */
  requestedSchema: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  at: Schema.Number,
  /** 服务器已确认完成（仅 `url` 模式）。 */
  completed: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "ElicitationRequest" })
export type Request = Schema.Schema.Type<typeof Request>

export const Reply = Schema.Struct({
  requestID: Schema.String,
  action: Action,
  content: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "ElicitationReply" })
export type Reply = Schema.Schema.Type<typeof Reply>

const Rejected = Schema.Struct({ requestID: Schema.String }).annotate({ identifier: "ElicitationRejected" })
const Completed = Schema.Struct({
  serverName: Schema.String,
  elicitationId: Schema.String,
}).annotate({ identifier: "ElicitationCompleted" })

export const Event = {
  Asked: BusEvent.define("elicitation.asked", Request),
  Replied: BusEvent.define("elicitation.replied", Reply),
  Rejected: BusEvent.define("elicitation.rejected", Rejected),
  Completed: BusEvent.define("elicitation.completed", Completed),
}

/** 协议侧的入参，只取我们需要的字段，避免把 SDK 的类型泄漏进服务。 */
export type Params = {
  message: string
  mode?: string
  url?: string
  elicitationId?: string
  requestedSchema?: Record<string, unknown>
}

export type Result = {
  action: Action
  content?: Record<string, unknown>
}

export type Answer = {
  /** 服务器名，用于钩子的 matcher。 */
  serverName: string
  params: Params
  /** 调用被中断时必须立刻 `cancel`，否则工具调用会一直挂着。 */
  signal?: AbortSignal
  /** 0 表示一直等（默认）。 */
  timeoutMs?: number
}

export interface Interface {
  /** 向用户（或钩子）要一个答案。永不失败。 */
  readonly ask: (input: Answer) => Effect.Effect<Result>
  readonly reply: (input: Reply) => Effect.Effect<void>
  readonly reject: (requestID: string) => Effect.Effect<void>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
  /** 服务器确认 `url` 模式已完成。 */
  readonly complete: (input: { serverName: string; elicitationId: string }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/Elicitation") {}

type Pending = {
  info: Request
  deferred: Deferred.Deferred<Result>
}

type State = {
  pending: Map<string, Pending>
}

const modeOf = (params: Params): Mode => (params.mode === "url" ? "url" : "form")

const metadata = (serverName: string, params: Params) => ({
  mcp_server_name: serverName,
  message: params.message,
  mode: modeOf(params),
  url: params.url,
  elicitation_id: params.elicitationId,
  requested_schema: params.requestedSchema,
})

const CANCEL: Result = { action: "cancel" }
const DECLINE: Result = { action: "decline" }

/**
 * 等界面回答，同时处理中断与可选超时。
 *
 * 中断优先：`Deferred.await` 与 abort 赛跑，谁先到算谁。超时如果没配就
 * 完全不参与竞争（用 `Effect.never` 表达），避免无谓的定时器。
 */
function wait(input: { deferred: Deferred.Deferred<Result>; signal?: AbortSignal; timeoutMs: number }) {
  const answered = Deferred.await(input.deferred)
  const aborted = Effect.callback<Result>((resume) => {
    const signal = input.signal
    if (!signal) return resume(Effect.never)
    if (signal.aborted) return resume(Effect.succeed(CANCEL))
    const onAbort = () => resume(Effect.succeed(CANCEL))
    signal.addEventListener("abort", onAbort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", onAbort))
  })
  const raced = Effect.race(answered, aborted)
  if (input.timeoutMs <= 0) return raced
  return Effect.race(raced, Effect.as(Effect.sleep(input.timeoutMs), CANCEL))
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const hooks = yield* HookService

    const state = yield* InstanceState.make<State>(
      Effect.fn("Elicitation.state")(function* () {
        const value: State = { pending: new Map() }
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            // 实例销毁（项目关闭/服务退出）时不能再留人干等：一律 cancel。
            for (const item of value.pending.values()) yield* Deferred.succeed(item.deferred, CANCEL)
            value.pending.clear()
          }),
        )
        return value
      }),
    )

    /** `ElicitationResult` 之后仍可能被钩子改写或拦截。 */
    const finalize = Effect.fnUntraced(function* (serverName: string, params: Params, answer: Result) {
      const result = yield* hooks
        .trigger({
          event: "ElicitationResult",
          metadata: { ...metadata(serverName, params), action: answer.action, content: answer.content },
        })
        .pipe(Effect.catchCause(() => Effect.succeed(emptyHook())))
      if (result.blocked) return DECLINE
      return result.elicitation ?? answer
    })

    const ask: Interface["ask"] = Effect.fn("Elicitation.ask")(function* (input) {
      const serverName = input.serverName
      const params = input.params

      // 1) 钩子先回答：能自动填的就不该弹窗。
      const hook = yield* hooks
        .trigger({ event: "Elicitation", metadata: metadata(serverName, params) })
        .pipe(Effect.catchCause(() => Effect.succeed(emptyHook())))
      if (hook.blocked) {
        yield* bus.publish(Event.Replied, { requestID: `hook:${serverName}`, action: "decline" })
        return DECLINE
      }
      if (hook.elicitation) {
        const final = yield* finalize(serverName, params, hook.elicitation)
        yield* bus.publish(Event.Replied, {
          requestID: `hook:${serverName}`,
          action: final.action,
          ...(final.content ? { content: final.content } : {}),
        })
        return final
      }

      // 2) 交给界面。
      const pending = (yield* InstanceState.get(state)).pending
      const info: Request = {
        id: Identifier.ascending("event"),
        serverName,
        message: params.message,
        mode: modeOf(params),
        ...(params.url ? { url: params.url } : {}),
        ...(params.elicitationId ? { elicitationId: params.elicitationId } : {}),
        ...(params.requestedSchema ? { requestedSchema: params.requestedSchema } : {}),
        at: Date.now(),
      }
      const deferred = yield* Deferred.make<Result>()
      pending.set(info.id, { info, deferred })
      yield* bus.publish(Event.Asked, info)

      const answer = yield* Effect.ensuring(
        wait({ deferred, signal: input.signal, timeoutMs: input.timeoutMs ?? 0 }),
        Effect.sync(() => {
          pending.delete(info.id)
        }),
      )

      const final = yield* finalize(serverName, params, answer)
      yield* bus.publish(Event.Replied, {
        requestID: info.id,
        action: final.action,
        ...(final.content ? { content: final.content } : {}),
      })
      return final
    })

    const reply = Effect.fn("Elicitation.reply")(function* (input: Reply) {
      const pending = (yield* InstanceState.get(state)).pending
      const existing = pending.get(input.requestID)
      if (!existing) return
      pending.delete(input.requestID)
      yield* Deferred.succeed(existing.deferred, {
        action: input.action,
        ...(input.content ? { content: input.content } : {}),
      })
    })

    const reject = Effect.fn("Elicitation.reject")(function* (requestID: string) {
      const pending = (yield* InstanceState.get(state)).pending
      const existing = pending.get(requestID)
      if (!existing) return
      pending.delete(requestID)
      yield* bus.publish(Event.Rejected, { requestID })
      yield* Deferred.succeed(existing.deferred, CANCEL)
    })

    const list = Effect.fn("Elicitation.list")(function* () {
      return Array.from((yield* InstanceState.get(state)).pending.values(), (item) => item.info)
    })

    const complete = Effect.fn("Elicitation.complete")(function* (input: {
      serverName: string
      elicitationId: string
    }) {
      yield* bus.publish(Event.Completed, input)
      const pending = (yield* InstanceState.get(state)).pending
      for (const item of pending.values()) {
        if (item.info.elicitationId !== input.elicitationId) continue
        if (item.info.serverName !== input.serverName) continue
        // 只标记，不结束等待：用户可能还在确认页面上。
        // `list()` 也必须看到这个标记，否则刷新页面后弹窗又会回到「等待中」。
        item.info = { ...item.info, completed: true }
        yield* bus.publish(Event.Asked, item.info)
        break
      }
    })

    return Service.of({ ask, reply, reject, list, complete })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.defaultLayer), Layer.provide(HookLayer))

export * as Elicitation from "./elicitation"
