import { describe, expect, it } from "bun:test"
import { replay } from "@/team/replay"
import type { RunEvent } from "@/team/run"
import type { Acceptance, Verification } from "@/team/verification"

const acceptance = (id: string, text = "没有高危问题"): Acceptance => ({
  id,
  runID: "run_1",
  specID: "spec-" + id,
  version: 1,
  text,
  kind: "rubric",
})

const verification = (input: Partial<Verification> & { acceptanceID: string; outcome: Verification["outcome"] }) => ({
  id: "ver_" + input.acceptanceID,
  runID: "run_1",
  attempt: 1,
  snapshotID: "snap_1",
  verifierVersion: "v1",
  at: 1,
  ...input,
})

const event = (seq: number, kind: string, payload?: Record<string, unknown>): RunEvent => ({
  id: "evt_" + seq,
  runID: "run_1",
  seq,
  at: 1000 + seq,
  kind,
  payload,
})

describe("decision chain replay", () => {
  it("keeps the event order and carries only structural fields", () => {
    const result = replay({
      state: "done",
      events: [
        event(2, "team.reported", { teamID: "t1", round: 1, claims: 3, message: "命令输出 /secret/path" }),
        event(1, "team.dispatched", { teamID: "t1", round: 1, acceptance: 2 }),
        event(3, "verification.recorded", {
          acceptanceID: "acc_1",
          attempt: 1,
          outcome: "pass",
          snapshotID: "snap_1",
          verifierVersion: "v1",
        }),
      ],
      acceptances: [acceptance("acc_1")],
      verifications: [verification({ acceptanceID: "acc_1", outcome: "pass" })],
    })

    expect(result.source).toBe("events")
    expect(result.steps.map((step) => step.seq)).toEqual([1, 2, 3])
    expect(result.steps[1]).toEqual({
      seq: 2,
      at: 1002,
      kind: "team.reported",
      teamID: "t1",
      round: 1,
      count: 3,
    })
    // 错误原文（可能带命令与路径）不进回放。
    expect(JSON.stringify(result.steps)).not.toContain("/secret/path")
  })

  it("keeps unknown event kinds instead of silently dropping them", () => {
    const result = replay({
      state: "running",
      events: [event(1, "some.future.event", { teamID: "t1", whatever: "x" })],
      acceptances: [],
      verifications: [],
    })
    // 不认识的种类照样留在链上，只是不带 payload —— 悄悄丢事件等于藏证据。
    expect(result.steps).toEqual([{ seq: 1, at: 1001, kind: "some.future.event", teamID: "t1" }])
  })

  it("never folds unverified or stale into pass, and says so", () => {
    const result = replay({
      state: "partial",
      events: [event(1, "team.dispatched", { teamID: "t1", round: 1 })],
      acceptances: [acceptance("acc_1"), acceptance("acc_2"), acceptance("acc_3")],
      verifications: [
        verification({ acceptanceID: "acc_1", outcome: "pass" }),
        // acc_2 没有验证记录 → unverified；acc_3 的快照不是当前快照 → stale。
        verification({ acceptanceID: "acc_3", outcome: "pass", snapshotID: "snap_old" }),
      ],
      currentSnapshot: "snap_1",
    })

    expect(result.conclusion.counts).toEqual({ pass: 1, fail: 0, unverified: 1, stale: 1 })
    expect(result.conclusion.deliverable).toBe(false)
    expect(result.conclusion.verdict).toBe("partial")
    expect(result.conclusion.lines.map((line) => line.outcome)).toEqual(["pass", "unverified", "stale"])
    expect(result.conclusion.notes.join("\n")).toContain("没有通过验证证据")
    expect(result.conclusion.notes.join("\n")).toContain("快照与当前代码不一致")
  })

  it("says whether the conclusion is backed by events, not just the verification table", () => {
    const events = [event(1, "verification.recorded", { acceptanceID: "acc_1", attempt: 1, outcome: "pass" })]
    const acceptances = [acceptance("acc_1")]
    const verifications = [verification({ acceptanceID: "acc_1", outcome: "pass" })]

    expect(replay({ state: "done", events, acceptances, verifications }).conclusion.evidence).toBe("complete")
    // 旧版本运行没有 verification.recorded：结论来自验证表，必须如实说。
    const old = replay({ state: "done", events: [], acceptances, verifications })
    expect(old.conclusion.evidence).toBe("absent")
    expect(old.conclusion.notes.join("\n")).toContain("没有写入验证事件")
    expect(old.source).toBe("empty")
    // 事件流为空时不编一条链出来。
    expect(old.steps).toEqual([])
  })

  it("marks partial event evidence when only some passes are traced", () => {
    const result = replay({
      state: "done",
      events: [event(1, "verification.recorded", { acceptanceID: "acc_1", attempt: 1, outcome: "pass" })],
      acceptances: [acceptance("acc_1"), acceptance("acc_2")],
      verifications: [
        verification({ acceptanceID: "acc_1", outcome: "pass" }),
        verification({ acceptanceID: "acc_2", outcome: "pass" }),
      ],
    })
    expect(result.conclusion.evidence).toBe("partial")
    expect(result.conclusion.notes.join("\n")).toContain("只存在于验证表")
  })

  it("keeps only whitelisted reasons and never invents fields", () => {
    const result = replay({
      state: "failed",
      events: [
        event(1, "team.rework", { teamID: "t1", reason: "merged-verification" }),
        event(2, "team.failed", { teamID: "t1", reason: "提交失败：/home/user/x" }),
        event(3, "integration.merged", { branch: "novaway/integrate/run_1", merged: ["t1"], sha: "abc" }),
      ],
      acceptances: [],
      verifications: [],
    })
    expect(result.steps[0].reason).toBe("merged-verification")
    // 自由文本原因（可能是路径）不当作枚举放行。
    expect(result.steps[1].reason).toBeUndefined()
    // 分支名是运行看板本来就会显示的内容；sha 与文件列表不重复塞进回放。
    expect(result.steps[2].count).toBe(1)
    expect(JSON.stringify(result.steps)).not.toContain("novaway/integrate")
  })
})
