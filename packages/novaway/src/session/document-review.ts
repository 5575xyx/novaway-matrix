import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { Identifier } from "@/id/id"
import { MessageID, SessionID } from "./schema"

/**
 * 交付物评审（PRD、实施计划、方案、规格）。
 *
 * 主代理写完一份需要用户拍板的文档后，不是自己在聊天里问「这样可以吗」，
 * 而是把文档挂到这条评审通道上：界面渲染成一张带「开始评审 / 评审通过 /
 * 需要调整」的卡片，代理在这里阻塞，直到用户做出选择。
 *
 * 三种结论：
 * - `approved`：用户通过，代理继续下一步（例如按计划开始实施）；
 * - `revise`：带着用户意见回去改，改完可以再次提交评审；
 * - `pending`：等待超时（用户可能离开了），代理应当停下，等下一条用户消息。
 *
 * 与 `plan-approval.ts` 的区别：那个是子代理向 lead 要授权，只在父子会话
 * 之间使用；这里是**主会话**的文档评审，入口是用户本人。
 */

export const RequestID = Schema.String.pipe(
  Schema.brand("DocumentReviewID"),
  Schema.annotate({ identifier: "DocumentReviewID" }),
)
export type RequestID = Schema.Schema.Type<typeof RequestID>

export const Kind = Schema.Literals(["prd", "plan", "spec", "design", "report", "other"])
export type Kind = Schema.Schema.Type<typeof Kind>

export const Pending = Schema.Struct({
  id: RequestID,
  sessionID: SessionID,
  messageID: Schema.optional(Schema.NullOr(MessageID)),
  path: Schema.String,
  kind: Kind,
  title: Schema.String,
  version: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  highlights: Schema.Array(Schema.String),
  questions: Schema.Array(Schema.String),
  lines: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
}).annotate({ identifier: "DocumentReviewPending" })
export type Pending = Schema.Schema.Type<typeof Pending>

export const Outcome = Schema.Literals(["approved", "revise", "pending", "cancelled"])
export type Outcome = Schema.Schema.Type<typeof Outcome>

export type Decision = { decision: Outcome; feedback?: string }

export const Event = {
  Requested: BusEvent.define("document_review.requested", Pending),
  Resolved: BusEvent.define(
    "document_review.resolved",
    Schema.Struct({
      id: RequestID,
      sessionID: SessionID,
      decision: Outcome,
      feedback: Schema.optional(Schema.String),
    }),
  ),
}

export interface Interface {
  /** 登记一次评审并立刻返回请求信息（界面马上就能渲染卡片）。 */
  readonly prepare: (
    input: Omit<Pending, "id" | "createdAt" | "highlights" | "questions"> & {
      highlights?: readonly string[]
      questions?: readonly string[]
    },
  ) => Effect.Effect<Pending>
  /** 等待用户对某条请求做出选择。 */
  readonly wait: (id: RequestID) => Effect.Effect<Decision>
  /** prepare + wait 的便捷组合；`onRequest` 在等待开始前调用一次。 */
  readonly request: (
    input: Omit<Pending, "id" | "createdAt" | "highlights" | "questions"> & {
      highlights?: readonly string[]
      questions?: readonly string[]
    },
    hooks?: { onRequest?: (info: Pending) => Effect.Effect<void> },
  ) => Effect.Effect<Decision>
  readonly reply: (input: { id: RequestID; decision: Outcome; feedback?: string }) => Effect.Effect<boolean>
  readonly list: (sessionID?: SessionID) => Effect.Effect<Pending[]>
  /** 会话结束时清掉挂着的请求，避免代理永远等下去。 */
  readonly clear: (sessionID?: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/DocumentReview") {}

type Entry = { info: Pending; deferred: Deferred.Deferred<Decision> }
type State = {
  pending: Map<string, Entry>
  /**
   * 已结算的结论。
   *
   * `wait` 是懒执行的：登记之后若用户（或测试）先回复，等到 wait 真正跑起来时
   * 请求已经不在 pending 里了。留一份短期结论，wait 才不会把「已经通过」读成
   * 「已取消」。只保留最近几十条，避免长期运行攒内存。
   */
  settled: Map<string, Decision>
}
const SETTLED_LIMIT = 64

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("DocumentReview.state")(function* () {
        const pending = new Map<string, Entry>()
        const settled = new Map<string, Decision>()
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const entry of pending.values()) {
              yield* Deferred.succeed(entry.deferred, { decision: "cancelled" }).pipe(Effect.ignore)
            }
            pending.clear()
          }),
        )
        return { pending, settled }
      }),
    )

    const prepare: Interface["prepare"] = Effect.fn("DocumentReview.prepare")(function* (input) {
      const { pending } = yield* InstanceState.get(state)
      const id = RequestID.make(Identifier.ascending("event"))
      const info: Pending = {
        id,
        sessionID: input.sessionID,
        messageID: input.messageID,
        path: input.path,
        kind: input.kind,
        title: input.title,
        version: input.version,
        summary: input.summary,
        highlights: [...(input.highlights ?? [])],
        questions: [...(input.questions ?? [])],
        lines: input.lines,
        createdAt: Date.now(),
      }
      pending.set(id, { info, deferred: yield* Deferred.make<Decision>() })
      yield* bus.publish(Event.Requested, info).pipe(Effect.ignore)
      return info
    })

    const remember = (settled: Map<string, Decision>, id: string, decision: Decision) => {
      settled.set(id, decision)
      if (settled.size > SETTLED_LIMIT) settled.delete(settled.keys().next().value!)
    }

    const wait: Interface["wait"] = Effect.fn("DocumentReview.wait")(function* (id: RequestID) {
      const { pending, settled } = yield* InstanceState.get(state)
      const entry = pending.get(id)
      if (entry) return yield* Deferred.await(entry.deferred)
      return settled.get(id) ?? ({ decision: "cancelled" } as Decision)
    })

    const request: Interface["request"] = Effect.fn("DocumentReview.request")(function* (input, hooks) {
      const info = yield* prepare(input)
      if (hooks?.onRequest) yield* hooks.onRequest(info)
      return yield* wait(info.id)
    })

    const reply: Interface["reply"] = Effect.fn("DocumentReview.reply")(function* (input) {
      const { pending, settled } = yield* InstanceState.get(state)
      const entry = pending.get(input.id)
      if (!entry) return false
      pending.delete(input.id)
      remember(settled, input.id, {
        decision: input.decision,
        ...(input.feedback ? { feedback: input.feedback } : {}),
      })
      yield* bus
        .publish(Event.Resolved, {
          id: input.id,
          sessionID: entry.info.sessionID,
          decision: input.decision,
          ...(input.feedback ? { feedback: input.feedback } : {}),
        })
        .pipe(Effect.ignore)
      yield* Deferred.succeed(entry.deferred, {
        decision: input.decision,
        ...(input.feedback ? { feedback: input.feedback } : {}),
      })
      return true
    })

    const list: Interface["list"] = Effect.fn("DocumentReview.list")(function* (sessionID?: SessionID) {
      const { pending } = yield* InstanceState.get(state)
      return Array.from(pending.values(), (entry) => entry.info).filter(
        (item) => !sessionID || item.sessionID === sessionID,
      )
    })

    const clear: Interface["clear"] = Effect.fn("DocumentReview.clear")(function* (sessionID?: SessionID) {
      const { pending, settled } = yield* InstanceState.get(state)
      for (const [id, entry] of pending.entries()) {
        if (sessionID && entry.info.sessionID !== sessionID) continue
        pending.delete(id)
        remember(settled, id, { decision: "cancelled" })
        yield* Deferred.succeed(entry.deferred, { decision: "cancelled" }).pipe(Effect.ignore)
      }
    })

    return Service.of({ prepare, wait, request, reply, list, clear })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as DocumentReview from "./document-review"
