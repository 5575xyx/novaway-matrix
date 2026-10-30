import { describe, expect, it as plainTest } from "bun:test"
import { Effect, Layer } from "effect"
import { ReleaseGate } from "@/team/release-gate"
import { Service as OrchestratorService, defaultLayer as OrchestratorLayer, type Report } from "@/team/orchestrator"
import { Service as RunService, defaultLayer as RunLayer } from "@/team/run"
import { Service as VerificationService, defaultLayer as VerificationLayer } from "@/team/verification"
import { Service as OpLogService, defaultLayer as OpLogLayer, idempotencyKey } from "@/team/op-log"
import { Service as LedgerService, defaultLayer as LedgerLayer } from "@/team/ledger"
import { summarize, type Acceptance, type Verification } from "@/team/verification"
import { TeamVerifier } from "@/team/verifier"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(OrchestratorLayer, RunLayer, VerificationLayer, OpLogLayer, LedgerLayer))

const report = (teamID: string): Report => ({
  teamID,
  summary: "已完成",
  claims: [{ text: "测试通过" }],
  done: true,
})

/** 建一个已批准的运行，带一个已归属的验收项。 */
const setup = Effect.fn("ReleaseGateTest.setup")(function* (tokens = 100_000) {
  const runs = yield* RunService
  const verification = yield* VerificationService
  const run = yield* runs.create({
    sessionID: SessionID.make("ses_" + Math.random().toString(36).slice(2, 9)),
    directory: "/tmp/release-gate",
    mode: "team",
    goal: "发布门禁",
    budget: { tokens },
  })
  yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }] }, planVersion: 1 })
  yield* runs.approve({ runID: run.id, planVersion: 1, budget: { tokens }, by: "user" })
  const team = yield* runs.addTeam({ runID: run.id })
  yield* verification.register({
    runID: run.id,
    taskID: "t1",
    specID: "gate",
    text: "门禁能跑通",
    kind: "test",
    owner: team.id,
  })
  return { run, team }
})

describe("release gates", () => {
  it.effect("G1: every pass expands to snapshot + verifier version + measured", () =>
    Effect.gen(function* () {
      const verification = yield* VerificationService
      const { run } = yield* setup()
      const [acceptance] = yield* verification.list(run.id)
      yield* verification.record({
        acceptanceID: acceptance.id,
        snapshotID: "snap_1",
        verifierVersion: "agent-v1",
        outcome: "pass",
        measured: "pytest: 12 passed",
      })
      const gate = ReleaseGate.auditPassEvidence(yield* verification.verifications(run.id))
      expect(gate.detail).toEqual(["抽查 1 条 pass，全部可展开"])
      expect(gate.passed).toBe(true)

      // 少一项也算不通过：没有快照的 pass 无法复核。
      yield* verification.record({
        acceptanceID: acceptance.id,
        snapshotID: "unknown",
        verifierVersion: "agent-v1",
        outcome: "pass",
        measured: "ok",
      })
      expect(ReleaseGate.auditPassEvidence(yield* verification.verifications(run.id)).passed).toBe(false)
    }),
  )

  // 用真实时钟：`markUnknown` 判的是墙上时间，TestClock 不会推进它。
  it.live("G3: unknown operations are listed after restart and never auto-retried", () =>
    Effect.gen(function* () {
      const ops = yield* OpLogService
      const runID = "run_" + Math.random().toString(36).slice(2, 9)
      const key = idempotencyKey({ scope: { runID }, tool: "write", args: { path: "a.txt" } })
      const begun = yield* ops.begin({ runID, tool: "write", idempotencyKey: key })
      expect(begun.op.outcome).toBe("started")

      // 「重启」：超时的 started 一律判为 unknown。
      // 先让时间走一点，否则同一毫秒内 `started_at < cutoff` 不成立。
      yield* Effect.sleep("5 millis")
      const marked = yield* ops.markUnknown({ runID, olderThanMs: 1 })
      expect(marked).toBe(1)

      const pending = yield* ops.needsReview(runID)
      expect(pending.map((op) => op.outcome)).toEqual(["unknown"])

      // 同一个键再调：不能被当成新调用。
      const replay = yield* ops.begin({ runID, tool: "write", idempotencyKey: key })
      const gate = ReleaseGate.auditRecovery({
        marked,
        pending: pending.map((op) => ({ tool: op.tool, outcome: op.outcome })),
        replays: [{ tool: replay.op.tool, replayed: replay.replayed }],
      })
      expect(gate.passed).toBe(true)

      // 没有标记到任何操作时，门禁不能假绿。
      expect(ReleaseGate.auditRecovery({ marked: 0, pending: [], replays: [] }).passed).toBe(false)
    }),
  )

  it.effect("G4: ten concurrent reservation rounds never push committed past the cap", () =>
    Effect.gen(function* () {
      const ledger = yield* LedgerService
      const cap = { tokens: 10_000 }
      const runID = "run_" + Math.random().toString(36).slice(2, 9)
      const usages = []

      for (let round = 0; round < 10; round += 1) {
        const results = yield* Effect.forEach(
          Array.from({ length: 8 }, (_, index) => index),
          (index) => Effect.exit(ledger.reserve({ runID, actor: "team_" + index, tokens: 2_000, cap })),
          { concurrency: 8 },
        )
        // 结算一半、释放一半：并发判断看的是承诺量，不是单次调用。
        for (const [index, result] of results.entries()) {
          if (result._tag !== "Success") continue
          if (index % 2 === 0) yield* ledger.settle({ id: result.value.id, tokens: 1_500 })
          else yield* ledger.release({ id: result.value.id })
        }
        usages.push(yield* ledger.usage({ runID, cap }))
      }

      const gate = ReleaseGate.auditBudget(usages, cap.tokens)
      expect(gate.detail).toEqual(["10 个采样点均未超支（cap=10000）"])
      expect(gate.passed).toBe(true)
      expect(usages.every((usage) => usage.committed <= cap.tokens)).toBe(true)
    }),
  )

  it.effect("G2: each of the five anomalies lands on a predefined resting state", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorService
      const runs = yield* RunService
      const ops = yield* OpLogService

      const runAnomaly = (kind: ReleaseGate.AnomalyKind) =>
        Effect.gen(function* () {
          const { run } = yield* setup()
          if (kind === "crash") {
            // 模拟「工具执行到一半进程被杀」：操作停在 started。
            const key = idempotencyKey({ scope: { runID: run.id }, tool: "bash", args: { cmd: "git push" } })
            yield* ops.begin({ runID: run.id, tool: "bash", idempotencyKey: key })
          }
          const signal = new AbortController()
          if (kind === "cancel") signal.abort()
          const result = yield* orchestrator.execute({
            runID: run.id,
            snapshot: () => Effect.succeed("snap_1"),
            signal: signal.signal,
            dispatch: () => {
              if (kind === "cancel") return Effect.succeed(report("team"))
              if (kind === "format") return Effect.fail(new Error("成员回复不是合法 JSON（重试已耗尽）"))
              if (kind === "timeout") return Effect.fail(new Error("派发超时"))
              if (kind === "permission") return Effect.fail(new Error("权限被拒绝：bash"))
              return Effect.succeed(report("team"))
            },
            verify: () => Effect.succeed({ outcome: "fail", measured: "未达标" }),
          })
          const stored = yield* runs.get(run.id)
          expect(stored?.state).toBe(result.state)
          return result.state
        })

      for (const anomaly of ReleaseGate.ANOMALIES) {
        const state = yield* runAnomaly(anomaly.kind)
        const gate = ReleaseGate.auditAnomaly(anomaly.kind, state)
        expect({ kind: anomaly.kind, passed: gate.passed, detail: gate.detail }).toEqual({
          kind: anomaly.kind,
          passed: true,
          detail: [anomaly.kind + " 落到 " + state],
        })
      }

      // 反例：还在运行必须判失败，否则「一直转圈」会被放过去。
      expect(ReleaseGate.auditAnomaly("format", "running").passed).toBe(false)
      // 崩溃后的运行不能宣称完成。
      expect(ReleaseGate.auditAnomaly("crash", "done").passed).toBe(false)
    }),
  )

  it.effect("G5: verifier corpus clears recall and false-kill thresholds", () =>
    Effect.gen(function* () {
      expect(ReleaseGate.auditVerifier(TeamVerifier.CORPUS).passed).toBe(true)
      // 阈值不能被被测对象自己改松：换成全漏判的语料必须失败。
      const broken = ReleaseGate.auditVerifier(
        TeamVerifier.CORPUS.map((item) => ({ ...item, reply: JSON.stringify({ outcome: "pass", evidence: "x" }) })),
      )
      expect(broken.passed).toBe(false)
    }),
  )

  it.effect("G6: false-pass review refuses to pass without human review", () =>
    Effect.gen(function* () {
      const ids = Array.from({ length: 50 }, (_, index) => "ver_" + index.toString().padStart(3, "0"))
      const sample = ReleaseGate.samplePass(ids, 0.2)
      expect(sample.length).toBeGreaterThanOrEqual(10)
      // 同一次发版重复抽样必须抽到同一批。
      expect(ReleaseGate.samplePass(ids, 0.2)).toEqual(sample)

      expect(ReleaseGate.auditFalsePass(sample.length, sample.length, 0).passed).toBe(true)
      // 未复核不等于无问题。
      expect(ReleaseGate.auditFalsePass(0, sample.length, 0).passed).toBe(false)
      // 超过 10% 不允许发布。
      expect(ReleaseGate.auditFalsePass(10, 10, 2).passed).toBe(false)
    }),
  )

  plainTest("release fails when any gate fails and when no gate ran", () => {
    const ok = { id: "G1" as const, title: "ok", passed: true, detail: [] }
    const bad = { id: "G4" as const, title: "bad", passed: false, detail: ["超支"] }
    expect(ReleaseGate.release([ok]).passed).toBe(true)
    expect(ReleaseGate.release([ok, bad]).passed).toBe(false)
    expect(ReleaseGate.release([]).passed).toBe(false)
  })
})

describe("release gate G7", () => {
  /** 把「有效结论」还原成 summar 的输入：unverified 不给记录，stale 用旧快照。 */
  const summarizeOutcomes = (outcomes: readonly ("pass" | "fail" | "unverified" | "stale")[]) => {
    const acceptances: Acceptance[] = outcomes.map((_, index) => ({
      id: "acc_" + index,
      runID: "run_gate",
      specID: String(index),
      version: 1,
      text: "t" + index,
      kind: "test",
    }))
    const verifications: Verification[] = outcomes.flatMap((outcome, index) => {
      if (outcome === "unverified") return []
      return [
        {
          id: "ver_" + index,
          acceptanceID: "acc_" + index,
          runID: "run_gate",
          attempt: 0,
          snapshotID: outcome === "stale" ? "snap_old" : "snap_1",
          verifierVersion: "agent-v1",
          outcome: outcome === "stale" ? ("pass" as const) : outcome,
          at: Date.now(),
        },
      ]
    })
    return summarize(acceptances, verifications, "snap_1")
  }

  plainTest("G7: no summary path folds unverified (or stale) into pass", () => {
    const gate = ReleaseGate.auditNoFold(summarizeOutcomes)
    expect(gate.detail).toEqual(["341 种组合全部成立"])
    expect(gate.passed).toBe(true)

    // 反例：把 unverified 当通过的实现必须被抓出来。
    const folding = ReleaseGate.auditNoFold((outcomes) => {
      const real = summarizeOutcomes(outcomes)
      return { ...real, pass: outcomes.filter((item) => item !== "fail").length }
    })
    expect(folding.passed).toBe(false)
  })
})
