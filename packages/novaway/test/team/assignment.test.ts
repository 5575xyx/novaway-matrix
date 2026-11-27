import { describe, expect, it as test } from "bun:test"
import { Effect } from "effect"
import { SessionID } from "@/session/schema"
import * as Assignment from "@/team/assignment"
import * as AssignmentReport from "@/team/assignment-report"
import { testEffect } from "../lib/effect"

const it = testEffect(Assignment.defaultLayer)
const sessionID = (value: string) => SessionID.make(value)

const input = (suffix: string) => ({
  id: `assignment_${suffix}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  runID: `run_assignment_${suffix}`,
  taskID: `task_${suffix}`,
  dispatchID: `dispatch_assignment_${suffix}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  attempt: 1,
  objective: "完成一个可复核的员工任务",
  idempotencyKey: `assignment-key-${suffix}-${Date.now()}-${Math.random()}`,
})

describe("team assignment durable state machine", () => {
  test("does not treat an arbitrary JSON envelope as a successful report", () => {
    expect(AssignmentReport.parse("{}")).toMatchObject({ status: "needs_review", structured: true })
    expect(AssignmentReport.parse("{}").blockers).toContainEqual({ kind: "missing_report_status" })
    expect(
      AssignmentReport.parse("{\"summary\":\"done\"}", {
        assignmentID: "current",
        dispatchID: "current-dispatch",
        attempt: 1,
      }),
    ).toMatchObject({ status: "needs_review", identityMismatch: true })
  })

  test("requires the complete dispatch identity when parsing a worker report", () => {
    expect(
      AssignmentReport.parse('{"status":"succeeded","summary":"done"}', {
        assignmentID: "current",
        dispatchID: "current-dispatch",
        attempt: 1,
      }),
    ).toMatchObject({ status: "needs_review", identityMismatch: true })
    expect(
      AssignmentReport.parse(
        '{"status":"succeeded","assignmentID":"current","dispatchID":"current-dispatch","attempt":1}',
        { assignmentID: "current", dispatchID: "current-dispatch", attempt: 1 },
      ),
    ).toMatchObject({ status: "succeeded", identityMismatch: false })
  })


  test("keeps the legacy done flag compatible when no identity is required", () => {
    expect(AssignmentReport.parse('{"summary":"done","claims":[],"done":true}').status).toBe("succeeded")
  })

  it.effect("persists the lifecycle and does not treat a report as verification", () =>
    Effect.gen(function* () {
      const service = yield* Assignment.Service
      const base = input("lifecycle")
      const created = yield* service.create({ ...base, leaseMs: 60_000 })
      expect(created.status).toBe("created")
      expect((yield* service.deliver(created.id))?.status).toBe("delivered")
      expect((yield* service.accept(created.id))?.status).toBe("accepted")
      expect((yield* service.start(created.id))?.status).toBe("running")

      const reported = yield* service.report({
        assignmentID: created.id,
        dispatchID: created.dispatchID,
        attempt: created.attempt,
        sessionID: sessionID("session-lifecycle"),
        status: "succeeded",
        summary: "模型声明完成",
        evidence: [{ kind: "claim", value: "not-yet-verified" }],
      })
      expect(typeof reported).toBe("object")
      if (typeof reported === "object") {
        expect(reported.status).toBe("reported")
        expect(reported.verifiedAt).toBeUndefined()
      }

      const verified = yield* service.verify({
        assignmentID: created.id,
        outcome: "succeeded",
        verification: { verifier: "test", evidence: "independent-check" },
      })
      expect(verified?.status).toBe("succeeded")
      expect(verified?.verifiedAt).toBeDefined()
    }),
  )

  it.effect("rejects stale reports and makes duplicate reports idempotently visible", () =>
    Effect.gen(function* () {
      const service = yield* Assignment.Service
      const base = input("stale")
      const created = yield* service.create(base)
      yield* service.deliver(created.id)
      yield* service.accept(created.id)
      yield* service.start(created.id)
      // A report from another attempt/dispatch can never mutate the active assignment.
      const stale = yield* service.report({
        assignmentID: created.id,
        dispatchID: "dispatch-old",
        attempt: 0,
        sessionID: sessionID("ses_old_session"),
        status: "succeeded",
      })
      expect(stale).toBe("stale")

      const current = yield* service.report({
        assignmentID: created.id,
        dispatchID: created.dispatchID,
        attempt: created.attempt,
        sessionID: sessionID("ses_current_session"),
        status: "succeeded",
        summary: "一次报告",
      })
      expect(typeof current).toBe("object")
      const duplicate = yield* service.report({
        assignmentID: created.id,
        dispatchID: created.dispatchID,
        attempt: created.attempt,
        sessionID: sessionID("ses_current_session"),
        status: "succeeded",
        summary: "迟到的重复报告",
      })
      expect(duplicate).toBe("duplicate")
    }),
  )

  it.effect("expires leases without allowing an old worker to report", () =>
    Effect.gen(function* () {
      const service = yield* Assignment.Service
      const base = input("expiry")
      const created = yield* service.create({ ...base, leaseMs: 1 })
      const expired = yield* service.expireDue({ now: (created.leaseUntil ?? 0) + 1 })
      expect(expired.some((item) => item.id === created.id)).toBe(true)
      expect((yield* service.get(created.id))?.status).toBe("expired")
      const stale = yield* service.report({
        assignmentID: created.id,
        dispatchID: created.dispatchID,
        attempt: created.attempt,
        sessionID: sessionID("ses_expired_worker"),
        status: "succeeded",
      })
      expect(stale).toBe("stale")
    }),
  )
})
