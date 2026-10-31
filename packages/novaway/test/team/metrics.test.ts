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

const sample = (r: Sample["run"], events: EventSample[] = []): Sample => ({ run: r, events })

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
    expect(result.tokens).toEqual({ settled: 170, unknown: 30, covered: 3, overrunRuns: 1 })
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

  it("says which metric it cannot compute instead of inventing one", () => {
    const result = report([sample(run("r1", "done"))])
    expect(result.unavailable).toEqual([
      {
        metric: "验证开销占比",
        reason: "账本按团队汇总，验证与成员会话用同一个 actor，无法把验证花费单独拆出来。",
      },
    ])
  })

  it("ignores malformed usage instead of turning it into zero", () => {
    const result = report([
      sample(run("r1", "done", { usage: { settled: -5 } })),
      sample(run("r2", "done", { usage: { settled: Number.NaN, unknown: 10 } })),
    ])
    // 负数与 NaN 只可能是记录写错：那一项当作缺失，不归零、不编造。
    expect(result.tokens).toEqual({ settled: 0, unknown: 10, covered: 1, overrunRuns: 0 })
  })
})
