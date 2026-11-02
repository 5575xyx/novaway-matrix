import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Service as VerificationService, defaultLayer as VerificationLayer } from "@/team/verification"
import { testEffect } from "../lib/effect"

const it = testEffect(VerificationLayer)

const runID = () => "run_" + Math.random().toString(36).slice(2, 9)

describe("verification store: same-snapshot reuse", () => {
  it.effect("reuses a deterministic verdict on the same snapshot and marks it as reused", () =>
    Effect.gen(function* () {
      const verification = yield* VerificationService
      const acceptance = yield* verification.register({
        runID: runID(),
        specID: "tests",
        text: "bun test 退出码为 0",
        kind: "test",
      })
      yield* verification.record({
        acceptanceID: acceptance.id,
        snapshotID: "snap_1",
        verifierVersion: "command:v1",
        outcome: "pass",
        measured: "exit 0 · 1.2s · 输出 18 行",
      })

      // 同一快照、同一验证器版本：可以直接复用，另记一条标了 reused 的结论。
      const cached = yield* verification.reusable({
        acceptanceID: acceptance.id,
        snapshotID: "snap_1",
        verifierVersion: "command:v1",
      })
      expect(cached?.outcome).toBe("pass")
      expect(cached?.measured).toContain("exit 0")

      const again = yield* verification.record({
        acceptanceID: acceptance.id,
        snapshotID: "snap_1",
        verifierVersion: "command:v1",
        outcome: cached!.outcome,
        measured: cached!.measured,
        reused: true,
      })
      expect(again.reused).toBe(true)
      const stored = yield* verification.verifications(acceptance.runID)
      expect(stored.filter((item) => item.reused).length).toBe(1)

      // 换快照、换验证器版本都不是同一条结论。
      expect(
        yield* verification.reusable({ acceptanceID: acceptance.id, snapshotID: "snap_2", verifierVersion: "command:v1" }),
      ).toBeUndefined()
      expect(
        yield* verification.reusable({ acceptanceID: acceptance.id, snapshotID: "snap_1", verifierVersion: "command:v2" }),
      ).toBeUndefined()
    }),
  )

  it.effect("never reuses an unverified row: that is not an answer", () =>
    Effect.gen(function* () {
      const verification = yield* VerificationService
      const acceptance = yield* verification.register({
        runID: runID(),
        specID: "tests",
        text: "bun test 退出码为 0",
        kind: "test",
      })
      yield* verification.record({
        acceptanceID: acceptance.id,
        snapshotID: "snap_1",
        verifierVersion: "command:v1",
        outcome: "unverified",
        measured: "超时（>2.0s），未能得出结论",
      })
      expect(
        yield* verification.reusable({ acceptanceID: acceptance.id, snapshotID: "snap_1", verifierVersion: "command:v1" }),
      ).toBeUndefined()
    }),
  )

  it.effect("keeps the verifier's suggestion and hands it back on the summary line", () =>
    Effect.gen(function* () {
      const verification = yield* VerificationService
      const acceptance = yield* verification.register({
        runID: runID(),
        specID: "coverage",
        text: "退款路径的边界用例覆盖率 ≥ 80%",
        kind: "rubric",
      })
      yield* verification.record({
        acceptanceID: acceptance.id,
        snapshotID: "snap_1",
        verifierVersion: "agent-v1",
        outcome: "fail",
        measured: "实测 72%",
        suggestion: "为 payments/refund 补边界用例",
      })
      const summary = yield* verification.summary({
        runID: acceptance.runID,
        currentSnapshot: "snap_1",
      })
      // 驳回不只有实测值，还有下一步怎么做（§4.3 / §6.3）。
      expect(summary.lines[0]?.verification?.suggestion).toBe("为 payments/refund 补边界用例")
      expect(summary.verdict).toBe("failed")
    }),
  )
})
