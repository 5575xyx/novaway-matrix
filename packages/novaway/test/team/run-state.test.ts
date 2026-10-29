import { describe, expect, it as check } from "bun:test"
import { Effect, Layer } from "effect"
import { Service as RunService, defaultLayer as RunLayer, canTransition, isTerminal } from "@/team/run"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(RunLayer)

describe("team run state machine", () => {
  check("keeps terminal states terminal", () => {
    for (const state of ["done", "partial", "failed", "exceeded", "cancelled"] as const) {
      expect(isTerminal(state)).toBe(true)
      expect(canTransition(state, "running")).toBe(false)
    }
    expect(canTransition("needs_review", "running")).toBe(true)
  })

  it.effect("invalidates an approval when the plan version moves on", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_state"),
        directory: "/tmp/run",
        mode: "team",
        goal: "目标",
      })
      yield* runs.update({ runID: run.id, plan: { teams: [{ name: "a" }] }, planVersion: 1 })
      yield* runs.update({ runID: run.id, plan: { teams: [{ name: "b" }] }, planVersion: 2 })

      // 用户批准的是第 1 版计划，现在已经不是当前版本了。
      const stale = yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 10 }, by: "user" })
      expect(stale).toBe("stale-plan")

      const approved = yield* runs.approve({ runID: run.id, planVersion: 2, budget: { tokens: 10 }, by: "user" })
      expect(approved && approved !== "stale-plan" ? approved.state : undefined).toBe("running")
    }),
  )

  it.effect("refuses to leave a finished run", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_state2"),
        directory: "/tmp/run",
        mode: "team",
        goal: "目标",
      })
      yield* runs.update({ runID: run.id, state: "cancelled", terminalReason: "user-cancelled" })
      const exit = yield* Effect.exit(runs.update({ runID: run.id, state: "running" }))
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.effect("appends events with a gap-free sequence", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_state3"),
        directory: "/tmp/run",
        mode: "team",
        goal: "目标",
      })
      yield* runs.appendEvent({ runID: run.id, kind: "a" })
      yield* runs.appendEvent({ runID: run.id, kind: "b" })
      const events = yield* runs.events({ runID: run.id })
      expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
      expect(events.at(-1)?.kind).toBe("b")
    }),
  )
})
