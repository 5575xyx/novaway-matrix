import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import * as PlanApprovalNs from "../../src/session/plan-approval"
import { Bus } from "@/bus"
import { SessionID, MessageID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(PlanApprovalNs.defaultLayer, Bus.layer))

const sessionID = SessionID.make("ses_plan_child")
const parentID = SessionID.make("ses_plan_parent")

describe("plan approval", () => {
  it.instance("request blocks until the lead replies", () =>
    Effect.gen(function* () {
      const approval = yield* PlanApprovalNs.Service
      const fiber = yield* approval
        .request({ sessionID, parentID, plan: "docs/plan.md", title: "ship it" })
        .pipe(Effect.forkChild)

      // Give the request a tick to register, then answer it.
      yield* Effect.sleep("20 millis")
      const pending = yield* approval.list()
      expect(pending).toHaveLength(1)
      expect(pending[0]!.plan).toBe("docs/plan.md")

      const ok = yield* approval.reply({ id: pending[0]!.id, approved: true })
      expect(ok).toBe(true)

      const decision = yield* Fiber.join(fiber)
      expect(decision.approved).toBe(true)
    }),
  )

  it.instance("rejection carries feedback", () =>
    Effect.gen(function* () {
      const approval = yield* PlanApprovalNs.Service
      const fiber = yield* approval.request({ sessionID, parentID, plan: "p.md" }).pipe(Effect.forkChild)
      yield* Effect.sleep("20 millis")
      const [pending] = yield* approval.list()
      yield* approval.reply({ id: pending!.id, approved: false, feedback: "add tests first" })
      const decision = yield* Fiber.join(fiber)
      expect(decision.approved).toBe(false)
      expect(decision.feedback).toBe("add tests first")
    }),
  )

  it.instance("unknown request ids are ignored", () =>
    Effect.gen(function* () {
      const approval = yield* PlanApprovalNs.Service
      expect(yield* approval.reply({ id: "plan_nope" as never, approved: true })).toBe(false)
    }),
  )

  it.instance("clear cancels pending requests for a session", () =>
    Effect.gen(function* () {
      const approval = yield* PlanApprovalNs.Service
      const fiber = yield* approval.request({ sessionID, parentID, plan: "p.md" }).pipe(Effect.forkChild)
      yield* Effect.sleep("20 millis")
      yield* approval.clear(sessionID)
      const decision = yield* Fiber.join(fiber)
      expect(decision.approved).toBe(false)
      expect(yield* approval.list()).toHaveLength(0)
    }),
  )

  it.instance("requests are listed with their message id", () =>
    Effect.gen(function* () {
      const approval = yield* PlanApprovalNs.Service
      const messageID = MessageID.make("msg_plan")
      const fiber = yield* approval.request({ sessionID, parentID, messageID, plan: "p.md" }).pipe(Effect.forkChild)
      yield* Effect.sleep("20 millis")
      const [pending] = yield* approval.list()
      expect(pending!.messageID).toBe(messageID)
      yield* approval.reply({ id: pending!.id, approved: true })
      yield* Fiber.join(fiber)
    }),
  )
})
