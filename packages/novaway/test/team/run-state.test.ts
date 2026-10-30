import { describe, expect, it as check } from "bun:test"
import { Effect, Layer } from "effect"
import { Service as RunService, defaultLayer as RunLayer, canStart, canTransition, isTerminal } from "@/team/run"
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

  check("an approved run may revoke its approval before it starts", () => {
    // 改计划里的授权等于换了一份计划：批准作废、回到待批准（§11.1）。
    expect(canTransition("running", "awaiting_approval")).toBe(true)
    expect(canStart("awaiting_approval", undefined)).toBe(false)
    // 终态不可再离开，撤回批准也就不成立。
    for (const state of ["done", "partial", "failed", "exceeded", "cancelled"] as const)
      expect(canTransition(state, "awaiting_approval")).toBe(false)
  })

  check("a run that is already executing cannot be started twice", () => {
    // 已批准、还没开始执行：可以起。
    expect(canStart("running", undefined)).toBe(true)
    // 正在执行：编排期间一定有 phase，重复执行会把同一次运行派发两遍。
    expect(canStart("running", "executing")).toBe(false)
    expect(canStart("running", "verify-merged")).toBe(false)
    // 未批准、终态都不行。
    expect(canStart("awaiting_approval", undefined)).toBe(false)
    expect(canStart("done", undefined)).toBe(false)
    expect(canStart("cancelled", undefined)).toBe(false)
    // 中断后恢复可以继续。
    expect(canStart("paused", undefined)).toBe(true)
    expect(canStart("needs_review", undefined)).toBe(true)
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

  it.effect("changing the policy withdraws the approval it no longer covers", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_state_policy"),
        directory: "/tmp/run",
        mode: "team",
        goal: "目标",
      })
      yield* runs.update({
        runID: run.id,
        plan: { teams: [{ name: "a" }], policy: { readOnly: true } },
        planVersion: 1,
      })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 10 }, by: "user" })

      // 人把授权放宽：版本号递增、回到待批准。旧的批准绑定的是第 1 版，不能继续生效。
      const next = yield* runs.update({
        runID: run.id,
        plan: { teams: [{ name: "a" }], policy: { readOnly: false } },
        planVersion: 2,
        state: "awaiting_approval",
      })
      expect(next?.state).toBe("awaiting_approval")
      expect(next?.planVersion).toBe(2)
      expect(next?.approval?.planVersion).toBe(1)
      expect(canStart(next ? next.state : "done", next?.phase)).toBe(false)

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
