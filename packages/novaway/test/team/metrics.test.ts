import { describe, expect, it } from "bun:test"
import { report, type EventSample, type Sample } from "@/team/metrics"
import type { RunState } from "@/team/run"

const run = (id: string, state: RunState, extra: Partial<Sample["run"]> = {}): Sample["run"] => ({
  id,
  state,
  roundMain: 0,
  attempts: { business: 0, formatRetry: 0 },
  createdAt: 1_700_000_000_000,
  ...extra,
})

const sample = (r: Sample["run"], events: EventSample[] = [], ledger?: Sample["ledger"]): Sample => ({
  run: r,
  events,
  ...(ledger ? { ledger } : {}),
})

describe("team run metrics", () => {
  it("counts states and rounds, and never folds unknown usage into settled", () => {
    const result = report([
      sample(run("r1", "done", { roundMain: 1, usage: { settled: 100, unknown: 0 } })),
      // 用量不明：单列，不并入 settled。
      sample(run("r2", "partial", { roundMain: 2, usage: { settled: 50, unknown: 30 } })),
      // 没有用量快照：不参与覆盖率，也不写成 0。
      sample(run("r3", "failed", { roundMain: 2 })),
      sample(run("r4", "done", { roundMain: 1, usage: { settled: 20, unknown: 0, overrun: true } })),
    ])

    expect(result.window.runs).toBe(4)
    expect(result.states).toEqual([
      { state: "done", runs: 2 },
      { state: "partial", runs: 1 },
      { state: "failed", runs: 1 },
    ])
    expect(result.tokens).toEqual({ settled: 170, unknown: 30, covered: 3, overrunRuns: 1, cost: 0, costCovered: 0 })
    // 轮次分布保持轮次升序，界面不用自己排。
    expect(result.rounds).toEqual([
      { round: 1, runs: 2 },
      { round: 2, runs: 2 },
    ])
  })

  it("takes rework reasons from the structured field, then the reason, then 未分类", () => {
    const result = report([
      sample(run("r1", "done"), [
        { kind: "team.rework", payload: { failed: [{ text: "没有高危问题", outcome: "fail" }] } },
        { kind: "team.rework", payload: { failed: [{ text: "没有高危问题", outcome: "fail" }] } },
        { kind: "team.rework", payload: { failed: [{ text: "测试全绿", outcome: "fail" }] } },
      ]),
      sample(run("r2", "done"), [{ kind: "team.rework", payload: { reason: "merged-verification" } }]),
      sample(run("r3", "done"), [{ kind: "team.rework" }]),
    ])

    expect(result.rework.total).toBe(5)
    // 次数相同按码元顺序排（不是按环境语言）：同一批数据到哪里都得到同一张表。
    expect(result.rework.top).toEqual([
      { reason: "没有高危问题", count: 2 },
      { reason: "merged-verification", count: 1 },
      { reason: "未分类", count: 1 },
      { reason: "测试全绿", count: 1 },
    ])
  })

  it("limits the TopN deterministically", () => {
    const result = report(
      [
        sample(run("r1", "done"), [
          { kind: "team.rework", payload: { failed: [{ text: "b" }, { text: "a" }, { text: "c" }] } },
        ]),
      ],
      2,
    )
    // 次数相同按文本排序：结果稳定，不会因遍历顺序变化。
    expect(result.rework.top).toEqual([
      { reason: "a", count: 1 },
      { reason: "b", count: 1 },
    ])
  })

  it("gives no failure rate when nothing was dispatched", () => {
    const empty = report([sample(run("r1", "done"))])
    // 0 次派发 ≠ 0% 失败：分母不够就不给百分比。
    expect(empty.attempts).toEqual({ dispatched: 0, failed: 0 })

    const counted = report([
      sample(run("r1", "done"), [
        { kind: "team.dispatched" },
        { kind: "team.dispatched" },
        { kind: "team.dispatched" },
        { kind: "team.failed", payload: { message: "boom" } },
      ]),
    ])
    expect(counted.attempts).toEqual({ dispatched: 3, failed: 1, failureRate: 1 / 3 })
  })

  it("measures the blocked rate over runs that actually have events", () => {
    const result = report([
      sample(run("r1", "done"), [{ kind: "tool.denied", payload: { tool: "bash", reason: "权限不足" } }]),
      // 这条运行有事件但没阻塞：它是分母的一部分。
      sample(run("r2", "done"), [{ kind: "team.dispatched" }]),
      // 没有任何事件：不进分母，避免把「没记录」当成「没阻塞」。
      sample(run("r3", "done")),
    ])

    expect(result.window.eventsCovered).toBe(2)
    expect(result.blockers).toEqual({ runs: 1, rate: 1 / 2, byKind: [{ kind: "tool.denied", count: 1 }] })
  })

  it("splits verification spend from dispatch spend, and counts only settled rows", () => {
    const result = report([
      sample(run("r1", "done", { usage: { settled: 125 } }), [], [
        // 预占里的钱还没结算：不是「花了多少」，不参与占比。
        { kind: "dispatch", state: "reserved", settled: 0, reserved: 50 },
        { kind: "dispatch", state: "settled", settled: 100, reserved: 0 },
        { kind: "verification", state: "settled", settled: 25, reserved: 0 },
      ]),
    ])
    expect(result.spend).toEqual({
      dispatch: 100,
      verification: 25,
      unspecified: 0,
      verificationShare: 0.2,
      coveredRuns: 1,
      partialRuns: 0,
    })
    // 算得出来的指标不进 unavailable：那里只列真的算不出来的。
    expect(result.unavailable).toEqual([])
  })

  it("keeps ledger rows without a kind out of both sides instead of guessing", () => {
    const result = report([
      // 老账本：条目存在，但没有 kind。它既不是派发也不是验证。
      sample(run("r1", "done", { usage: { settled: 140 } }), [], [
        { kind: "dispatch", state: "settled", settled: 60, reserved: 0 },
        { kind: "verification", state: "settled", settled: 40, reserved: 0 },
        { state: "settled", settled: 40, reserved: 0 },
      ]),
    ])
    expect(result.spend.dispatch).toBe(60)
    expect(result.spend.verification).toBe(40)
    expect(result.spend.unspecified).toBe(40)
    // 占比只在已区分的 100 里算；partialRuns 提醒读者这一版只覆盖新记录。
    expect(result.spend.verificationShare).toBe(0.4)
    expect(result.spend.partialRuns).toBe(1)
    expect(result.unavailable).toEqual([])
  })

  it("refuses a share when the summary reports spend the ledger cannot explain", () => {
    const result = report([sample(run("r1", "done", { usage: { settled: 100 } }))])
    // 汇总说花了 100，明细一条都没有：不拿总数去猜比例。
    expect(result.spend.verificationShare).toBeUndefined()
    expect(result.unavailable).toEqual([
      {
        metric: "验证开销占比",
        reason: "有 1 次运行的汇总用量超出了账本明细，无法区分派发与验证。",
      },
    ])
  })

  it("gives no share when nothing was settled", () => {
    const result = report([
      sample(run("r1", "done"), [], [{ kind: "dispatch", state: "reserved", settled: 0, reserved: 50 }]),
    ])
    // 只有预占、没有结算：分母为零，不给 0%（那会被读成「验证没花钱」）。
    expect(result.spend.verificationShare).toBeUndefined()
    expect(result.spend.coveredRuns).toBe(1)
    expect(result.unavailable).toEqual([])
  })

  it("sums only the costs that runs actually reported", () => {
    const result = report([
      sample(run("r1", "done", { usage: { settled: 100, unknown: 0, cost: 0.12 } })),
      sample(run("r2", "done", { usage: { settled: 50, unknown: 0, cost: 0.03 } })),
      // 老运行没有成本数据：不参与成本覆盖率，也不按 0 计。
      sample(run("r3", "done", { usage: { settled: 20, unknown: 0 } })),
      // 成本写坏了：当作缺失，不归零。
      sample(run("r4", "failed", { usage: { settled: 10, unknown: 0, cost: Number.NaN } })),
    ])

    // token 覆盖 4 次，成本只覆盖 2 次：两者是两笔账，不能互相代替。
    expect(result.tokens.covered).toBe(4)
    expect(result.tokens.costCovered).toBe(2)
    expect(result.tokens.cost).toBeCloseTo(0.15, 10)
  })

  it("ignores malformed usage instead of turning it into zero", () => {
    const result = report([
      sample(run("r1", "done", { usage: { settled: -5 } })),
      sample(run("r2", "done", { usage: { settled: Number.NaN, unknown: 10 } })),
    ])
    // 负数与 NaN 只可能是记录写错：那一项当作缺失，不归零、不编造。
    expect(result.tokens).toEqual({ settled: 0, unknown: 10, covered: 1, overrunRuns: 0, cost: 0, costCovered: 0 })
  })
})
