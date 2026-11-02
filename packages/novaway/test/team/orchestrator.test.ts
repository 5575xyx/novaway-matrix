import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { Service as OrchestratorService, defaultLayer as OrchestratorLayer, type Report } from "@/team/orchestrator"
import { Service as RunService, defaultLayer as RunLayer, isTerminal } from "@/team/run"
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

  it.effect("a cancel interrupts the dispatch that is already in flight", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_cancel_inflight"),
        directory: "/tmp/run",
        mode: "team",
        goal: "目标",
        budget: { tokens: 100_000 },
      })
      const team = yield* runs.addTeam({ runID: run.id })
      yield* verification.register({ runID: run.id, specID: "s", text: "验收", kind: "test", owner: team.id })

      const controller = new AbortController()
      const started = yield* Deferred.make<void>()
      // 派发一直不返回（队长卡在模型调用里）：只靠循环检查点的话，
      // 编排器要等这次派发自己结束才看得到停止请求。
      const fiber = yield* orchestrator
        .execute({
          runID: run.id,
          signal: controller.signal,
          snapshot: () => Effect.succeed("snap_1"),
          dispatch: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined)
              return yield* Effect.never
            }),
          verify: () => Effect.succeed({ outcome: "pass" as const }),
        })
        .pipe(Effect.forkChild)

      yield* Deferred.await(started)
      controller.abort()
      const result = yield* Fiber.join(fiber)

      expect(result.state).toBe("cancelled")
      const kinds = (yield* runs.events({ runID: run.id })).map((event) => event.kind)
      expect(kinds).toContain("cancel.settled")
      // 被打断的派发不是团队的失败：事件里不该留下一条「这一队做错了什么」。
      expect(kinds).not.toContain("team.failed")
      expect((yield* runs.teams(run.id))[0].phase).toBe("cancelled")
    }),
  )

  it.effect("a cancel that lands after the last round still ends cancelled, not done", () =>
    Effect.gen(function* () {
      const { runs, run } = yield* setup
      const orchestrator = yield* OrchestratorService
      const controller = new AbortController()

      const result = yield* orchestrator.execute({
        runID: run.id,
        signal: controller.signal,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) => Effect.succeed(report(input.team.id)),
        verify: () => Effect.succeed({ outcome: "pass" as const }),
        // 团队已经交付、正在集成时才点停止：这一段同样要停得住。
        integrate: () => {
          controller.abort()
          return Effect.succeed({ kind: "skipped" as const, reason: "测试" })
        },
      })

      // 不能因为「取消来晚了一步」就把已经点过的停止改写成 done。
      expect(result.state).toBe("cancelled")
      expect((yield* runs.get(run.id))?.state).toBe("cancelled")
      const kinds = (yield* runs.events({ runID: run.id })).map((event) => event.kind)
      expect(kinds).toContain("cancel.settled")
      expect(kinds).not.toContain("run.settled")
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
        // 结构化失败项：指标里的「驳回原因 TopN」用它，不解析给人看的中文。
        failed: [{ text: "验收", outcome: "fail" }],
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

  it.effect("stops scheduling new dispatches once the wall clock is spent", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_wall"),
        directory: "/tmp/run",
        mode: "team",
        goal: "长时间审查",
        // 墙钟上限是硬上限（§7.3）：超过即停，输出降级结果。
        budget: { tokens: 100_000, wallMs: 0 },
      })
      yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }] }, planVersion: 1 })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000, wallMs: 0 }, by: "user" })
      const team = yield* runs.addTeam({ runID: run.id, profileID: "prof_alpha" })

      // 墙钟给 0 ms：不依赖真实时钟，只验证「到期就不再开新的」。
      let dispatched = 0
      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: () => {
          dispatched += 1
          return Effect.succeed(report("team"))
        },
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      // 一次都不该派：超限后的「继续跑」等于把硬上限变成建议。
      expect(dispatched).toBe(0)
      expect(result.state).toBe("exceeded")
      expect((yield* runs.teams(run.id))[0].phase).toBe("exceeded")
      const events = yield* runs.events({ runID: run.id })
      const exceeded = events.filter((event) => event.kind === "budget.exceeded")
      expect(exceeded.length).toBe(1)
      expect(exceeded[0].payload?.reason).toContain("墙钟")
      expect(team.phase).toBe("queued")
    }),
  )

  it.effect("stops scheduling new dispatches once settled cost reaches the cap", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_cost"),
        directory: "/tmp/run",
        mode: "team",
        goal: "两个有依赖的团队",
        // 成本上限是硬上限（§7.3）：调用前无法预占成本，所以停的也是新的派发。
        budget: { tokens: 100_000, cost: 0.5 },
      })
      yield* runs.update({
        runID: run.id,
        plan: { teams: [{ name: "upstream" }, { name: "downstream" }] },
        planVersion: 1,
      })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000, cost: 0.5 }, by: "user" })
      const upstream = yield* runs.addTeam({ runID: run.id })
      const downstream = yield* runs.addTeam({ runID: run.id, dependsOn: [0] })
      yield* verification.register({ runID: run.id, specID: "u", text: "上游验收", kind: "test", owner: upstream.id })
      yield* verification.register({ runID: run.id, specID: "d", text: "下游验收", kind: "test", owner: downstream.id })

      let dispatched = 0
      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) => {
          dispatched += 1
          // 第一批就把成本花过上限：下一批派发之前必须停。
          return Effect.succeed({ ...report(input.team.id), usage: { tokens: 10, cost: 0.6 } })
        },
        verify: () => Effect.succeed({ outcome: "pass" as const, usage: { tokens: 5 } }),
      })

      // 第一个团队照常跑完（中断在跑的只会留下半成品），第二个一次都不该派。
      expect(dispatched).toBe(1)
      expect(result.state).toBe("exceeded")
      const phases = (yield* runs.teams(run.id)).map((team) => team.phase).sort()
      expect(phases).toEqual(["delivered", "exceeded"])
      const events = yield* runs.events({ runID: run.id })
      const exceeded = events.filter((event) => event.kind === "budget.exceeded")
      expect(exceeded.length).toBe(1)
      expect(exceeded[0].payload?.reason).toContain("成本")
      // 成本是事实，不是估算：结算后能在运行快照里读到。
      const settled = yield* runs.get(run.id)
      expect(Number(settled?.usage?.cost)).toBeCloseTo(0.6, 10)
    }),
  )

  it.effect("keeps a slice of the cap for verification instead of handing it all to dispatches", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_reserve"),
        directory: "/tmp/run",
        mode: "team",
        goal: "为验收留额度",
        budget: { tokens: 100 },
      })
      yield* runs.update({
        runID: run.id,
        plan: { teams: [{ name: "upstream" }, { name: "downstream" }] },
        planVersion: 1,
      })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100 }, by: "user" })
      const upstream = yield* runs.addTeam({ runID: run.id })
      const downstream = yield* runs.addTeam({ runID: run.id, dependsOn: [0] })
      yield* verification.register({ runID: run.id, specID: "u", text: "上游验收", kind: "test", owner: upstream.id })

      let dispatched = 0
      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        reserveTokens: 50,
        dispatch: (input) => {
          dispatched += 1
          return Effect.succeed({ ...report(input.team.id), usage: { tokens: 50 } })
        },
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      // 批准 100：派发只拿到 85，第二个 50 已经放不下 —— 剩下的留给验证与收尾。
      // 没有这份预留时，第二个团队会刚好塞进 100 的上限里。
      expect(dispatched).toBe(1)
      expect(result.state).toBe("exceeded")
      expect((yield* runs.teams(run.id)).map((team) => team.phase).sort()).toEqual(["delivered", "exceeded"])
    }),
  )

  it.effect("refuses to dispatch a team whose roster cannot be addressed", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const ledger = yield* LedgerService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_addressing"),
        directory: "/tmp/run",
        mode: "team",
        goal: "名册里有人被归档了",
        budget: { tokens: 100_000 },
      })
      yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }] }, planVersion: 1 })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
      const team = yield* runs.addTeam({ runID: run.id })

      let dispatched = 0
      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        // 名册里的人已经归档：这一轮一个都不派。
        addressing: () => Effect.succeed([{ employeeID: "emp_b", name: "小红", job: "build", reason: "archived" as const }]),
        dispatch: (input) => {
          dispatched += 1
          return Effect.succeed(report(input.team.id))
        },
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      // 不跳过、不静默改派：整轮派发失败，团队不是「交付」而是「失败」。
      expect(dispatched).toBe(0)
      expect((yield* runs.teams(run.id))[0].phase).toBe("failed")
      expect(result.state).toBe("failed")
      // 人都派不出去，就不该先占住额度。
      expect((yield* ledger.usage({ runID: run.id })).reserved).toBe(0)

      const event = (yield* runs.events({ runID: run.id })).find((item) => item.kind === "team.addressing_failed")
      expect(event?.payload?.reason).toContain("小红")
      expect(event?.payload?.reason).toContain("已归档")
      // 名单要能被看板点名：结构化一份，界面不用解析那句中文。
      expect(event?.payload?.members).toEqual([
        { employeeID: "emp_b", name: "小红", job: "build", reason: "archived" },
      ])
      const after = yield* runs.get(run.id)
      expect(after?.error).toContain("小红")
    }),
  )

  it.effect("still delivers the teams whose rosters are fine", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_addressing_partial"),
        directory: "/tmp/run",
        mode: "team",
        goal: "两个团队，一个名册坏了",
        budget: { tokens: 100_000 },
      })
      yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }, { name: "beta" }] }, planVersion: 1 })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
      const broken = yield* runs.addTeam({ runID: run.id, profileID: "prof_broken" })
      yield* runs.addTeam({ runID: run.id, profileID: "prof_ok" })
      yield* verification.register({ runID: run.id, specID: "b", text: "另一队验收", kind: "test", owner: broken.id })

      // 寻址失败只影响自己的团队：局部阻塞不冻结整次运行（§4.4）。
      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        addressing: (team) =>
          Effect.succeed(team.profileID === "prof_broken" ? [{ employeeID: "emp_b", reason: "archived" as const }] : []),
        dispatch: (input) => Effect.succeed(report(input.team.id)),
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      expect(result.state).toBe("partial")
      expect((yield* runs.teams(run.id)).map((team) => team.phase).sort()).toEqual(["delivered", "failed"])
    }),
  )

  it.effect("a run whose remaining work waits on a failed team is blocked, not failed", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_deadlock"),
        directory: "/tmp/run",
        mode: "team",
        goal: "下游在等一个失败的上游",
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
      yield* verification.register({ runID: run.id, specID: "u", text: "上游验收", kind: "test", owner: upstream.id })

      const dispatched: string[] = []
      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) => {
          dispatched.push(input.team.id)
          return input.team.id === upstream.id
            ? Effect.fail(new Error("上游崩了"))
            : Effect.succeed(report(input.team.id))
        },
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      // 下游永远等不到上游交付：再转几轮也不会派发任何团队。
      // 这不是「没有团队产出可交付结果」的失败，而是「所有剩余工作都无法推进」（§8.1）。
      expect(dispatched).toEqual([upstream.id])
      expect(result.state).toBe("blocked")
      expect((yield* runs.teams(run.id)).map((team) => team.phase).sort()).toEqual(["failed", "queued"])

      const event = (yield* runs.events({ runID: run.id })).find((item) => item.kind === "blocked")
      expect(event?.payload?.teams).toEqual([{ teamID: downstream.id, waitingOn: [0] }])
      const after = yield* runs.get(run.id)
      expect(after?.state).toBe("blocked")
      expect(after?.error).toContain(downstream.id)
      // blocked 不是终态：修好依赖后还能再次执行（`canStart` 只为 running 带 phase 时拒绝）。
      expect(after && isTerminal(after.state)).toBe(false)
    }),
  )

  it.effect("re-executing a blocked run retries the teams that failed", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_unblock"),
        directory: "/tmp/run",
        mode: "team",
        goal: "先阻塞再重试",
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
      yield* verification.register({ runID: run.id, specID: "u", text: "上游验收", kind: "test", owner: upstream.id })

      let broken = true
      const dispatch = (input: { team: { id: string } }) =>
        input.team.id === upstream.id && broken
          ? Effect.fail(new Error("上游崩了"))
          : Effect.succeed(report(input.team.id))

      const first = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch,
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })
      expect(first.state).toBe("blocked")

      // 用户处理完（这里是上游恢复正常）之后再次执行：失败过的团队回到队列重新派发，
      // 而不是带着 `failed` 立刻再判一次 blocked。
      broken = false
      const second = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_2"),
        dispatch,
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })
      expect(second.state).toBe("done")
      expect((yield* runs.teams(run.id)).map((team) => team.phase).sort()).toEqual(["delivered", "delivered"])
      const unblocked = (yield* runs.events({ runID: run.id })).find((item) => item.kind === "unblocked")
      expect(unblocked?.payload?.teams).toEqual([upstream.id])
      expect(downstream.id).toBeTruthy()
    }),
  )

  it.effect("re-asks when the captain reply is unreadable, without spending business attempts", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_format"),
        directory: "/tmp/run",
        mode: "team",
        goal: "队长第一次没按格式回话",
        budget: { tokens: 100_000 },
      })
      yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }] }, planVersion: 1 })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
      const team = yield* runs.addTeam({ runID: run.id })
      yield* verification.register({ runID: run.id, specID: "a", text: "验收", kind: "test", owner: team.id })

      const dispatched: Array<{ round: number; attempt: number }> = []
      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) => {
          dispatched.push({ round: input.round, attempt: dispatched.length + 1 })
          // 前两次只回一句客套话（读不出报告），第三次才是正常报告。
          return Effect.succeed(dispatched.length < 3 ? { ...report(input.team.id), claims: [], malformed: "回复里没有可解析的 JSON 对象" } : report(input.team.id))
        },
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      expect(dispatched).toHaveLength(3)
      // 三次派发都发生在同一轮：格式重试不该把运行推进到下一轮。
      expect(new Set(dispatched.map((item) => item.round)).size).toBe(1)
      // 最终仍然交付，而且业务尝试没有被格式问题消耗。
      expect(result.state).toBe("done")
      expect((yield* runs.get(run.id))?.attempts).toEqual({ business: 0, formatRetry: 2 })
      const retries = (yield* runs.events({ runID: run.id })).filter((item) => item.kind === "team.format_retry")
      expect(retries).toHaveLength(2)
      expect(retries[0].payload?.reason).toContain("JSON")
    }),
  )

  it.effect("fails the team as a format problem after the retry limit", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_format_limit"),
        directory: "/tmp/run",
        mode: "team",
        goal: "队长一直不按格式回话",
        budget: { tokens: 100_000 },
      })
      yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }] }, planVersion: 1 })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
      const team = yield* runs.addTeam({ runID: run.id })

      let dispatched = 0
      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) => {
          dispatched += 1
          return Effect.succeed({ ...report(input.team.id), claims: [], malformed: "缺少 summary / claims / done" })
        },
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      // 上限 3：第三次仍读不出来就判这一队失败，原因是格式，不是「没做到」。
      expect(dispatched).toBe(3)
      expect(result.state).toBe("failed")
      const after = (yield* runs.teams(run.id))[0]
      expect(after.phase).toBe("failed")
      expect(after.verdict?.verdict).toBe("format")
      const failure = (yield* runs.events({ runID: run.id })).find(
        (item) => item.kind === "team.failed" && item.payload?.reason === "format",
      )
      expect(failure?.payload?.attempts).toBe(3)
    }),
  )

  /**
   * 零进展上限（§9）。没有它，一个挂住的队长调用会让整次运行永远停在 running：
   * 用户看到「正在跑」，事件流不再增长，取消之外没有任何出路。
   */
  it.live("a dispatch that never progresses ends the team as a timeout", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_timeout"),
        directory: "/tmp/run",
        mode: "team",
        goal: "队长永远不回话",
        budget: { tokens: 100_000 },
      })
      yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }] }, planVersion: 1 })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
      const team = yield* runs.addTeam({ runID: run.id })

      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: () => Effect.never,
        verify: () => Effect.succeed({ outcome: "pass" as const }),
        dispatchTimeoutMs: 50,
      })

      expect(result.state).toBe("failed")
      const after = (yield* runs.teams(run.id))[0]
      expect(after.phase).toBe("failed")
      // 裁决与「没做到」分开：超时说得出是超时。
      expect(after.verdict?.verdict).toBe("timeout")
      const event = (yield* runs.events({ runID: run.id })).find(
        (item) => item.kind === "team.failed" && item.payload?.kind === "timeout",
      )
      expect(event?.payload?.timeoutMs).toBe(50)
      // 预占必须被释放：超时不是「花掉了这笔钱」。
      const usage = yield* (yield* LedgerService).usage({ runID: run.id, cap: { tokens: 100_000 } })
      expect(usage.reserved).toBe(0)
    }),
  )

  it.effect("a failed dispatch says why it failed instead of folding everything into one message", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_failure_kind"),
        directory: "/tmp/run",
        mode: "team",
        goal: "提供方挂了",
        budget: { tokens: 100_000 },
      })
      yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }] }, planVersion: 1 })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
      yield* runs.addTeam({ runID: run.id })

      yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: () => Effect.fail(new Error("AI_APICallError: fetch failed")),
        verify: () => Effect.succeed({ outcome: "pass" as const }),
      })

      const after = (yield* runs.teams(run.id))[0]
      expect(after.verdict?.verdict).toBe("provider")
      const event = (yield* runs.events({ runID: run.id })).find((item) => item.kind === "team.failed")
      expect(event?.payload).toMatchObject({ kind: "provider", message: "AI_APICallError: fetch failed" })
    }),
  )

  it.live("a verifier that never answers leaves the criterion unverified, never unpassed-as-passed", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const verification = yield* VerificationService
      const orchestrator = yield* OrchestratorService
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_verify_timeout"),
        directory: "/tmp/run",
        mode: "team",
        goal: "验证器卡住",
        budget: { tokens: 100_000 },
      })
      yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }] }, planVersion: 1 })
      yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens: 100_000 }, by: "user" })
      const team = yield* runs.addTeam({ runID: run.id })
      const acceptance = yield* verification.register({
        runID: run.id,
        taskID: "t1",
        specID: "login",
        text: "登录接口返回 200",
        kind: "test",
        owner: team.id,
      })

      const result = yield* orchestrator.execute({
        runID: run.id,
        snapshot: () => Effect.succeed("snap_1"),
        dispatch: (input) => Effect.succeed(report(input.team.id)),
        verify: () => Effect.never,
        verifyTimeoutMs: 50,
        maxRounds: 1,
      })

      const line = result.summary.lines.find((item) => item.acceptance.id === acceptance.id)
      expect(line?.outcome).toBe("unverified")
      expect(result.summary.pass).toBe(0)
      expect(result.state).not.toBe("done")
      const records = yield* verification.verifications(run.id)
      // 超时有自己的验证器版本：回放里能看出「这不是一次判断，这是没等到判断」。
      expect(records.at(-1)).toMatchObject({ outcome: "unverified", verifierVersion: "verifier-timeout" })
      const event = (yield* runs.events({ runID: run.id })).find((item) => item.kind === "verification.failed")
      expect(event?.payload?.kind).toBe("timeout")
    }),
  )
})
