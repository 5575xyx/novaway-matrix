import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Service as OrchestratorService, defaultLayer as OrchestratorLayer, type Report } from "@/team/orchestrator"
import { Service as RunService, defaultLayer as RunLayer } from "@/team/run"
import { Service as VerificationService, defaultLayer as VerificationLayer } from "@/team/verification"
import { Service as OpLogService, defaultLayer as OpLogLayer } from "@/team/op-log"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(OrchestratorLayer, RunLayer, VerificationLayer, OpLogLayer))

const report = (teamID: string): Report => ({
  teamID,
  summary: "已完成",
  claims: [{ text: "测试通过" }],
  done: true,
})

describe("team orchestrator", () => {
  it.effect("ignores the report's own claim and reworks until the verifier passes", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const sessionID = SessionID.make("ses_" + Math.random().toString(36).slice(2, 9))

      const run = yield* runs.create({
        sessionID,
        directory: "/tmp/run",
        mode: "team",
        goal: "修复登录",
        budget: { tokens: 100_000 },
      })
      yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }] }, planVersion: 1 })
      const approved = yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
      expect(approved && approved !== "stale-plan" ? approved.state : undefined).toBe("running")

      const team = yield* runs.addTeam({ runID: run.id })
      yield* verification.register({
        runID: run.id,
        taskID: "t1",
        specID: "login",
        text: "登录接口返回 200",
        kind: "test",
        owner: team.id,
      })

      let dispatched = 0
      const feedbacks: string[][] = []
      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) => {
          dispatched += 1
          if (input.feedback) feedbacks.push(input.feedback)
          return Effect.succeed(report(input.team.id))
        },
        // 成员自己说通过了，但验证器第一轮判定失败。
        verify: () =>
          Effect.succeed(
            dispatched === 1 ? { outcome: "fail" as const, measured: "401" } : { outcome: "pass" as const },
          ),
      })

      expect(dispatched).toBe(2)
      expect(result.state).toBe("done")
      expect(result.summary.pass).toBe(1)
      expect(feedbacks.length).toBe(1)
      expect(feedbacks[0][0]).toContain("未达标")
      expect(feedbacks[0][0]).toContain("401")

      const events = yield* runs.events({ runID: run.id })
      const kinds = events.map((event) => event.kind)
      expect(kinds).toContain("team.rework")
      expect(kinds).toContain("team.delivered")
      expect(kinds).toContain("run.settled")
    }),
  )

  it.effect("never reports done when the verifier itself fails", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_v"),
        directory: "/tmp/run",
        mode: "team",
        goal: "目标",
        budget: { tokens: 100_000 },
      })
      const team = yield* runs.addTeam({ runID: run.id })
      yield* verification.register({
        runID: run.id,
        specID: "s",
        text: "必须验证",
        kind: "test",
        owner: team.id,
      })

      const result = yield* orchestrator.execute({
        runID: run.id,
        maxRounds: 2,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) => Effect.succeed(report(input.team.id)),
        verify: () => Effect.die(new Error("verifier crashed")),
      })

      expect(result.state).not.toBe("done")
      expect(result.summary.deliverable).toBe(false)
      expect(result.summary.unverified).toBe(1)
    }),
  )

  it.effect("stops with exceeded when the budget cannot cover a dispatch", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_b"),
        directory: "/tmp/run",
        mode: "team",
        goal: "目标",
        budget: { tokens: 100 },
      })
      yield* runs.addTeam({ runID: run.id })

      const result = yield* orchestrator.execute({
        runID: run.id,
        reserveTokens: 4000,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) => Effect.succeed(report(input.team.id)),
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      expect(result.state).toBe("exceeded")
    }),
  )

  it.effect("treats a global acceptance without a merged verifier as unverified", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_merged"),
        directory: "/tmp/run",
        mode: "auto",
        goal: "合并验收",
        budget: { tokens: 100_000 },
      })
      const team = yield* runs.addTeam({ runID: run.id })
      yield* verification.register({ runID: run.id, specID: "s1", text: "单团队验收", kind: "test", owner: team.id })
      // 没有 owner 的验收是全局验收，必须在合并快照上验证。
      yield* verification.register({ runID: run.id, specID: "s2", text: "合并后全量测试", kind: "test" })

      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_final"),
        dispatch: (input) => Effect.succeed(report(input.team.id)),
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      expect(result.state).not.toBe("done")
      expect(result.summary.unverified).toBe(1)
      expect(result.summary.verdict).toBe("partial")
    }),
  )

  it.effect("reaches done when the merged verifier also passes", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_merged_ok"),
        directory: "/tmp/run",
        mode: "auto",
        goal: "合并验收",
        budget: { tokens: 100_000 },
      })
      const team = yield* runs.addTeam({ runID: run.id })
      yield* verification.register({ runID: run.id, specID: "s1", text: "单团队验收", kind: "test", owner: team.id })
      yield* verification.register({ runID: run.id, specID: "s2", text: "合并后全量测试", kind: "test" })

      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_final"),
        dispatch: (input) => Effect.succeed(report(input.team.id)),
        verify: () => Effect.succeed({ outcome: "pass" as const }),
        verifyMerged: () => Effect.succeed({ outcome: "pass" as const, verifierVersion: "merged-v1" }),
      })

      expect(result.state).toBe("done")
      expect(result.summary.pass).toBe(2)
      expect(result.summary.deliverable).toBe(true)
    }),
  )

  it.effect("refuses to settle as done while a tool operation is unknown", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const ops = yield* OpLogService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_unknown"),
        directory: "/tmp/run",
        mode: "team",
        goal: "目标",
        budget: { tokens: 100_000 },
      })
      const team = yield* runs.addTeam({ runID: run.id })
      yield* verification.register({ runID: run.id, specID: "s", text: "验收", kind: "test", owner: team.id })

      // 模拟上次崩溃留下的「执行到一半」的记录。
      yield* ops.begin({ runID: run.id, tool: "bash", idempotencyKey: "orphan" })
      yield* ops.markUnknown({ runID: run.id, olderThanMs: -1000 })

      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) => Effect.succeed(report(input.team.id)),
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      expect(result.state).toBe("needs_review")
    }),
  )

  it.effect("marks a cancelled run only after recording what already happened", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_cancel"),
        directory: "/tmp/run",
        mode: "team",
        goal: "目标",
        budget: { tokens: 100_000 },
      })
      const team = yield* runs.addTeam({ runID: run.id })
      yield* verification.register({ runID: run.id, specID: "s", text: "验收", kind: "test", owner: team.id })

      const controller = new AbortController()
      controller.abort()
      let dispatched = 0
      const result = yield* orchestrator.execute({
        runID: run.id,
        signal: controller.signal,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) => {
          dispatched += 1
          return Effect.succeed(report(input.team.id))
        },
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      expect(dispatched).toBe(0)
      expect(result.state).toBe("cancelled")
      const events = yield* runs.events({ runID: run.id })
      const kinds = events.map((event) => event.kind)
      expect(kinds).toContain("cancel.requested")
      expect(kinds).toContain("cancel.settled")
      expect(kinds.indexOf("cancel.requested")).toBeLessThan(kinds.indexOf("cancel.settled"))
    }),
  )
})
