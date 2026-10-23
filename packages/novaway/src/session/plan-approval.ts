import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@novaway/core/util/log"
import { MessageID, SessionID } from "./schema"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "plan-approval" })

/**
 * Plan approval.
 *
 * A subagent that finishes planning must not silently switch itself to an
 * editing agent: the lead decides. The agent asks here, the request is surfaced
 * to the lead (as a message and as a bus event for the UI), and the subagent
 * blocks until a decision arrives.
 *
 * The main thread keeps its existing interactive prompt — there is a human to
 * answer it, so this service is only used when `session.parentID` is set.
 */
export const RequestID = Schema.String.pipe(
  Schema.brand("PlanRequestID"),
  Schema.annotate({ identifier: "PlanRequestID" }),
)
export type RequestID = Schema.Schema.Type<typeof RequestID>

export const Pending = Schema.Struct({
  id: RequestID,
  sessionID: SessionID,
  parentID: Schema.optional(Schema.NullOr(SessionID)),
  messageID: Schema.optional(MessageID),
  plan: Schema.String,
  title: Schema.optional(Schema.String),
  createdAt: Schema.Number,
}).annotate({ identifier: "PlanApprovalPending" })
export type Pending = Schema.Schema.Type<typeof Pending>

export type Decision = { approved: boolean; feedback?: string }

export const Event = {
  Requested: BusEvent.define("plan_approval.requested", Pending),
  Resolved: BusEvent.define(
    "plan_approval.resolved",
    Schema.Struct({
      id: RequestID,
      sessionID: SessionID,
      approved: Schema.Boolean,
      feedback: Schema.optional(Schema.String),
    }),
  ),
}

export interface Interface {
  /** Ask the lead to approve a plan; resolves when a reply arrives. */
  readonly request: (input: {
    sessionID: SessionID
    parentID?: SessionID
    messageID?: MessageID
    plan: string
    title?: string
  }) => Effect.Effect<Decision>
  readonly reply: (input: { id: RequestID; approved: boolean; feedback?: string }) => Effect.Effect<boolean>
  readonly list: () => Effect.Effect<Pending[]>
  /** Deny every pending request (used when a session is cancelled). */
  readonly clear: (sessionID?: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/PlanApproval") {}

type Entry = { info: Pending; deferred: Deferred.Deferred<Decision> }
type State = { pending: Map<string, Entry> }

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("PlanApproval.state")(function* () {
        const pending = new Map<string, Entry>()
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const entry of pending.values()) {
              yield* Deferred.succeed(entry.deferred, { approved: false, feedback: "session closed" }).pipe(
                Effect.ignore,
              )
            }
            pending.clear()
          }),
        )
        return { pending }
      }),
    )

    const request: Interface["request"] = Effect.fn("PlanApproval.request")(function* (input) {
      const { pending } = yield* InstanceState.get(state)
      const id = Identifier.ascending("event") as unknown as RequestID
      const info: Pending = {
        id,
        sessionID: input.sessionID,
        parentID: input.parentID,
        messageID: input.messageID,
        plan: input.plan,
        title: input.title,
        createdAt: Date.now(),
      }
      const deferred = yield* Deferred.make<Decision>()
      pending.set(id, { info, deferred })
      log.info("requested", { id, sessionID: input.sessionID, parentID: input.parentID })
      yield* bus.publish(Event.Requested, info).pipe(Effect.ignore)
      return yield* Deferred.await(deferred)
    })

    const reply: Interface["reply"] = Effect.fn("PlanApproval.reply")(function* (input) {
      const { pending } = yield* InstanceState.get(state)
      const entry = pending.get(input.id)
      if (!entry) return false
      pending.delete(input.id)
      log.info("resolved", { id: input.id, approved: input.approved })
      yield* bus
        .publish(Event.Resolved, {
          id: input.id,
          sessionID: entry.info.sessionID,
          approved: input.approved,
          ...(input.feedback ? { feedback: input.feedback } : {}),
        })
        .pipe(Effect.ignore)
      yield* Deferred.succeed(entry.deferred, {
        approved: input.approved,
        ...(input.feedback ? { feedback: input.feedback } : {}),
      })
      return true
    })

    const list: Interface["list"] = Effect.fn("PlanApproval.list")(function* () {
      const { pending } = yield* InstanceState.get(state)
      return Array.from(pending.values(), (entry) => entry.info)
    })

    const clear: Interface["clear"] = Effect.fn("PlanApproval.clear")(function* (sessionID?: SessionID) {
      const { pending } = yield* InstanceState.get(state)
      for (const [id, entry] of pending.entries()) {
        if (sessionID && entry.info.sessionID !== sessionID) continue
        pending.delete(id)
        yield* Deferred.succeed(entry.deferred, { approved: false, feedback: "cancelled" }).pipe(Effect.ignore)
      }
    })

    return Service.of({ request, reply, list, clear })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as PlanApproval from "./plan-approval"
