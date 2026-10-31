import { describe, expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { Service as OrchestratorService, defaultLayer as OrchestratorLayer, type Report } from "@/team/orchestrator"
import { Service as RunService, defaultLayer as RunLayer } from "@/team/run"
import { Service as VerificationService, defaultLayer as VerificationLayer } from "@/team/verification"
import { Service as OpLogService, defaultLayer as OpLogLayer } from "@/team/op-log"
import { Service as LedgerService, defaultLayer as LedgerLayer } from "@/team/ledger"
import { SessionID } from "@/session/schema"
import { normalize } from "@/team/artifacts"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(OrchestratorLayer, RunLayer, VerificationLayer, OpLogLayer, LedgerLayer))

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

  it.effect("settles the dispatch with its real usage and charges verification on top", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const ledger = yield* LedgerService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_usage"),
        directory: "/tmp/run",
        mode: "team",
        goal: "算钱",
        budget: { tokens: 100_000 },
      })
      const team = yield* runs.addTeam({ runID: run.id })
      yield* verification.register({ runID: run.id, specID: "s", text: "完成", kind: "test", owner: team.id })

      yield* orchestrator.execute({
        runID: run.id,
        reserveTokens: 4000,
        snapshot: () => Effect.succeed("snap_1"),
        // 派发回报真实用量；验证器也报一份。
        dispatch: (input) => Effect.succeed({ ...report(input.team.id), usage: { tokens: 1200 } }),
        verify: () => Effect.succeed({ outcome: "pass" as const, usage: { tokens: 300 } }),
      })

      const usage = yield* ledger.usage({ runID: run.id })
      // 结算用实际值替换预占，不再把每一笔都记成「用量不明」。
      expect(usage.reserved).toBe(0)
      expect(usage.unknown).toBe(0)
      // 1200（派发）+ 300（轮内验证）+ 300（合并后重验）：验一次算一次钱，
      // 重验是另一笔开销，不该被前一笔吞掉（§10.2 的重验本来就是「再花一遍」）。
      expect(usage.settled).toBe(1800)
      const entries = yield* ledger.entries(run.id)
      expect(entries.every((entry) => entry.state === "settled")).toBe(true)
      // 三笔都记在团队名下，没有人替验证付账。
      expect(new Set(entries.map((entry) => entry.actor))).toEqual(new Set([team.id]))
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

  it.effect("an integration conflict sends the team back to rework and retries the merge", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_" + Math.random().toString(36).slice(2, 9)),
        directory: "/tmp/run",
        mode: "team",
        goal: "冲突返工",
        budget: { tokens: 100_000 },
      })
      yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }] }, planVersion: 1 })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
      const team = yield* runs.addTeam({ runID: run.id })
      const verification = yield* VerificationService
      yield* verification.register({ runID: run.id, specID: "s", text: "验收", kind: "test", owner: team.id })

      let dispatched = 0
      let integrateCalls = 0
      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) =>
          Effect.sync(() => {
            dispatched += 1
            return report(input.team.id)
          }),
        verify: () => Effect.succeed({ outcome: "pass" as const }),
        integrate: () =>
          Effect.sync(() => {
            integrateCalls += 1
            // 第一次冲突，返工之后第二次合并成功。
            if (integrateCalls === 1)
              // `integrate()` 用团队名（profileID ?? id）指认冲突方。
              return {
                kind: "conflict" as const,
                team: team.id,
                files: ["shared.txt"],
                message: "CONFLICT (content)",
              }
            return { kind: "merged" as const, sha: "snap_merged", merged: [team.id] }
          }),
      })

      expect(dispatched).toBe(2)
      expect(integrateCalls).toBe(2)
      expect(result.state).toBe("done")
      const events = yield* runs.events({ runID: run.id })
      // 冲突被当成返工任务交给团队，而不是留给用户手工救火。
      expect(events.find((event) => event.kind === "team.conflict")?.payload).toEqual({
        team: team.id,
        files: ["shared.txt"],
        round: 1,
      })
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

  it.effect("a reworked upstream invalidates a delivered downstream and re-runs it", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_" + Math.random().toString(36).slice(2, 9)),
        directory: "/tmp/run",
        mode: "team",
        goal: "DAG",
        budget: { tokens: 100_000 },
      })
      yield* runs.update({
        runID: run.id,
        plan: { teams: [{ name: "upstream" }, { name: "downstream" }] },
        planVersion: 1,
      })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
      const upstream = yield* runs.addTeam({ runID: run.id })
      const downstream = yield* runs.addTeam({ runID: run.id, dependsOn: [0] })
      const verification = yield* VerificationService
      yield* verification.register({ runID: run.id, specID: "u", text: "上游验收", kind: "test", owner: upstream.id })
      yield* verification.register({ runID: run.id, specID: "d", text: "下游验收", kind: "test", owner: downstream.id })

      // 状态：两边都已交付；下游的「通过」绑定的是上游 v1 的产物。
      const v1 = normalize([{ name: "api", schema: { rev: 1 } }])
      yield* runs.updateTeam({ id: upstream.id, phase: "delivered", artifactsOut: v1 })
      yield* runs.updateTeam({
        id: downstream.id,
        phase: "delivered",
        verdict: { verdict: "complete", pass: 1, round: 1, deps: [{ teamID: 0, name: "api", version: v1[0].version }] },
      })
      // 上游返工后重新交付，产物内容变了（版本因此不同）。
      yield* runs.updateTeam({
        id: upstream.id,
        artifactsOut: normalize([{ name: "api", schema: { rev: 2 } }]),
      })

      let downstreamRuns = 0
      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) =>
          Effect.sync(() => {
            if (input.team.id === downstream.id) downstreamRuns += 1
            return report(input.team.id)
          }),
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      // 旧结论作废 → 下游被退回重跑；只重跑下游，上游不受影响。
      const events = yield* runs.events({ runID: run.id })
      const invalidated = events.find((event) => event.kind === "team.invalidated")
      expect(invalidated?.payload?.teamID).toBe(downstream.id)
      expect(invalidated?.payload?.broken).toEqual([{ teamID: 0, name: "api", version: v1[0].version }])
      expect(downstreamRuns).toBe(1)
      expect(result.state).toBe("done")
    }),
  )

  it.effect("commits before taking a snapshot so the verified snapshot contains the edits", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorService
      const { run } = yield* setup
      const order: string[] = []

      const result = yield* orchestrator.execute({
        runID: run.id,
        commit: () => Effect.sync(() => void order.push("commit")),
        snapshot: () =>
          Effect.sync(() => {
            order.push("snapshot")
            return "snap_after_commit"
          }),
        dispatch: (input) => Effect.succeed(report(input.team.id)),
        verify: () => Effect.succeed({ outcome: "pass" as const }),
        integrate: () =>
          Effect.sync(() => {
            order.push("integrate")
            return { kind: "merged" as const, sha: "snap_merged", merged: [] }
          }),
      })

      expect(result.state).toBe("done")
      // 先提交再取快照：否则验证对着旧 HEAD，而集成合不到任何改动。
      expect(order.slice(0, 2)).toEqual(["commit", "snapshot"])
      // 集成之前也要有一次提交：合的是磁盘上的最终内容，不是「最后一次派发时」的内容。
      expect(order[order.indexOf("integrate") - 1]).toBe("commit")
    }),
  )

  it.effect("a failed commit fails the team instead of verifying an uncommitted workspace", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorService
      const { runs, run } = yield* setup

      const result = yield* orchestrator.execute({
        runID: run.id,
        commit: () => Effect.fail(new Error("git commit 失败")),
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) => Effect.succeed(report(input.team.id)),
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      // 无法落成提交 = 无法复验：这一队不算交付，整体也不能是 done。
      expect(result.state).not.toBe("done")
      const events = yield* runs.events({ runID: run.id })
      const failed = events.find((event) => event.kind === "team.failed")
      expect(failed?.payload?.reason).toBe("commit")
    }),
  )

  it.effect("a failed merged verification sends exactly the responsible team back once", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorService
      const verification = yield* VerificationService
      const { runs, run, team } = yield* setup

      let verifyCalls = 0
      let integrateCalls = 0
      let dispatched = 0
      const result = yield* orchestrator.execute({
        runID: run.id,
        // 每次集成之后取到的都是新快照。
        snapshot: () => Effect.succeed("snap_" + integrateCalls),
        dispatch: (input) => {
          dispatched += 1
          return Effect.succeed(report(input.team.id))
        },
        // 团队快照上通过（第 1 次），合并后重验失败（第 2 次），返工后再次通过。
        verify: () => Effect.succeed({ outcome: verifyCalls++ === 1 ? ("fail" as const) : ("pass" as const) }),
        integrate: () =>
          Effect.sync(() => {
            integrateCalls += 1
            return { kind: "merged" as const, sha: "snap_" + integrateCalls, merged: ["alpha"] }
          }),
      })

      // 责任团队只退回一次；重验通过后仍然可以落成 done。
      expect(result.state).toBe("done")
      expect(dispatched).toBe(2)
      const events = yield* runs.events({ runID: run.id })
      const reworks = events.filter(
        (event) => event.kind === "team.rework" && event.payload?.reason === "merged-verification",
      )
      expect(reworks.length).toBe(1)
      expect(reworks[0].payload).toEqual({
        teamID: team.id,
        reason: "merged-verification",
        notes: ["合并后重验未通过：验收（fail）"],
      })
      // 合并后重验的结论落在最终的合并快照上，而不是团队自己的快照。
      const summary = yield* verification.summary({ runID: run.id, currentSnapshot: "snap_2" })
      expect(summary.pass).toBe(1)
      expect(summary.stale).toBe(0)
    }),
  )

  it.effect("a merged verification that still fails after the rework is reported as partial, not done", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorService
      const { runs, run } = yield* setup

      let verifyCalls = 0
      let integrateCalls = 0
      let dispatched = 0
      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_" + integrateCalls),
        dispatch: (input) => {
          dispatched += 1
          return Effect.succeed(report(input.team.id))
        },
        // 团队验收每次都过，合并重验每次都不过：返工解决不了，就不该无限重试。
        verify: () => Effect.succeed({ outcome: verifyCalls++ % 2 === 0 ? ("pass" as const) : ("fail" as const) }),
        integrate: () =>
          Effect.sync(() => {
            integrateCalls += 1
            return { kind: "merged" as const, sha: "snap_" + integrateCalls, merged: ["alpha"] }
          }),
      })

      expect(result.state).not.toBe("done")
      // 只退回一次：第二次仍失败就照实记 partial，而不是继续烧预算。
      expect(dispatched).toBe(2)
      const events = yield* runs.events({ runID: run.id })
      const reworks = events.filter(
        (event) => event.kind === "team.rework" && event.payload?.reason === "merged-verification",
      )
      expect(reworks.length).toBe(1)
    }),
  )

  it.effect("dispatches at most three teams at a time unless the caller asks otherwise", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_conc"),
        directory: "/tmp/run",
        mode: "team",
        goal: "五个团队的审查",
      })
      yield* runs.update({ runID: run.id, plan: { teams: [] }, planVersion: 1 })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
      for (let index = 0; index < 5; index++) yield* runs.addTeam({ runID: run.id, profileID: "prof_" + index })

      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const dispatch = () =>
        Effect.gen(function* () {
          const now = yield* Ref.updateAndGet(active, (value) => value + 1)
          yield* Ref.update(peak, (value) => (now > value ? now : value))
          // 让出调度权，让同一批里的其他团队有机会真的跑起来。
          yield* Effect.yieldNow
          yield* Effect.yieldNow
          yield* Ref.update(active, (value) => value - 1)
          return report("team")
        })

      yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch,
        // 没有验收项：不进入验证，只考察派发并发。
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      // 缺省 3：十个团队同时开跑会让成本与写冲突一起爆炸（§4.5）。
      expect(yield* Ref.get(peak)).toBe(3)
    }),
  )

  it.effect("honours an explicit concurrency of one", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_conc1"),
        directory: "/tmp/run",
        mode: "team",
        goal: "串行审查",
      })
      yield* runs.update({ runID: run.id, plan: { teams: [] }, planVersion: 1 })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
      for (let index = 0; index < 3; index++) yield* runs.addTeam({ runID: run.id, profileID: "prof_" + index })

      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      yield* orchestrator.execute({
        runID: run.id,
        concurrency: 1,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: () =>
          Effect.gen(function* () {
            const now = yield* Ref.updateAndGet(active, (value) => value + 1)
            yield* Ref.update(peak, (value) => (now > value ? now : value))
            yield* Effect.yieldNow
            yield* Ref.update(active, (value) => value - 1)
            return report("team")
          }),
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      // 用户显式要求串行时不要自作聪明地并行：他可能就是在省额度。
      expect(yield* Ref.get(peak)).toBe(1)
    }),
  )
})
