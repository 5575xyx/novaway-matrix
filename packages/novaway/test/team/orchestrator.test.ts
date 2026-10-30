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

  /** 建一个已批准、带一个已归属验收的运行。 */
  const setup = Effect.gen(function* () {
    const runs = yield* RunService
    const verification = yield* VerificationService
    const run = yield* runs.create({
      sessionID: SessionID.make("ses_" + Math.random().toString(36).slice(2, 9)),
      directory: "/tmp/run",
      mode: "team",
      goal: "集成",
      budget: { tokens: 100_000 },
    })
    yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }] }, planVersion: 1 })
    yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
    const team = yield* runs.addTeam({ runID: run.id })
    yield* verification.register({ runID: run.id, specID: "s", text: "验收", kind: "test", owner: team.id })
    return { runs, run, team }
  })

  it.effect("an integration conflict keeps the run out of done even when every team passed", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorService
      const { runs, run } = yield* setup

      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) => Effect.succeed(report(input.team.id)),
        verify: () => Effect.succeed({ outcome: "pass" as const, measured: "12 passed" }),
        integrate: () =>
          Effect.succeed({
            kind: "conflict" as const,
            team: "alpha",
            files: ["shared.txt"],
            message: "CONFLICT (content)",
          }),
      })

      // 每个团队都过了，但合不到一起 —— 这不是「完成」，是「等人接手」。
      expect(result.state).toBe("partial")
      const stored = yield* runs.get(run.id)
      expect(stored?.error).toContain("集成冲突")
      const events = yield* runs.events({ runID: run.id })
      const conflict = events.find((event) => event.kind === "integration.conflict")
      expect(conflict?.payload).toEqual({ team: "alpha", files: ["shared.txt"] })
    }),
  )

  it.effect("a successful integration binds the merged verification to the merged snapshot", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_" + Math.random().toString(36).slice(2, 9)),
        directory: "/tmp/run",
        mode: "team",
        goal: "集成",
        budget: { tokens: 100_000 },
      })
      yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }] }, planVersion: 1 })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
      const team = yield* runs.addTeam({ runID: run.id })
      yield* verification.register({ runID: run.id, specID: "team", text: "团队验收", kind: "test", owner: team.id })
      // 全局验收不归属团队：它只能在合并后的代码上验证。
      yield* verification.register({ runID: run.id, specID: "global", text: "构建通过", kind: "test" })

      let mergedSnapshot: string | undefined
      let integrationRan = false
      const result = yield* orchestrator.execute({
        runID: run.id,
        // 集成前是团队快照，集成后换成分支上的提交。
        snapshot: () => Effect.succeed(integrationRan ? "snap_merged" : "snap_team"),
        dispatch: (input) => Effect.succeed(report(input.team.id)),
        verify: () => Effect.succeed({ outcome: "pass" as const }),
        integrate: () => {
          integrationRan = true
          return Effect.succeed({ kind: "merged" as const, sha: "snap_merged", merged: ["alpha"] })
        },
        verifyMerged: (input) => {
          mergedSnapshot = input.snapshotID
          return Effect.succeed({ outcome: "pass" as const })
        },
      })

      expect(integrationRan).toBe(true)
      expect(mergedSnapshot).toBe("snap_merged")
      expect(result.state).toBe("done")
      const events = yield* runs.events({ runID: run.id })
      expect(events.find((event) => event.kind === "integration.merged")?.payload).toEqual({
        sha: "snap_merged",
        merged: ["alpha"],
      })
      // 每条验收的**最新**结论都必须落在合并快照上：团队快照上的通过只是中间状态，
      // 历史记录保留（回放要看得到当时验的是哪份代码）。
      const versions = yield* verification.verifications(run.id)
      // 按 summary 的同一规则取「最近一次」：attempt 最大，其次时间最晚。
      const latest = new Map<string, { attempt: number; at: number; snapshotID: string }>()
      for (const item of versions) {
        const current = latest.get(item.acceptanceID)
        const newer =
          !current || item.attempt > current.attempt || (item.attempt === current.attempt && item.at >= current.at)
        if (newer) latest.set(item.acceptanceID, item)
      }
      expect([...latest.values()].map((item) => item.snapshotID)).toEqual(["snap_merged", "snap_merged"])
      // 结论表里不能再剩 stale：合并后重验就是为了让「过期的通过」消失。
      const summary = yield* verification.summary({ runID: run.id, currentSnapshot: "snap_merged" })
      expect(summary.stale).toBe(0)
      expect(summary.pass).toBe(2)
    }),
  )
})
