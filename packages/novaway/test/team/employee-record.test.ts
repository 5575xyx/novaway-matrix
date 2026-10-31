import { describe, expect, it } from "bun:test"
import { reasonsOf, record, type AcceptanceResult, type Participation } from "@/team/employee-record"

const participation = (input: Partial<Participation> & { runID: string; teamID: string }): Participation => ({
  captain: false,
  source: "roster",
  at: 1_700_000_000_000,
  ...input,
})

describe("employee facts", () => {
  it("counts distinct runs and teams, and how often this person captained", () => {
    const result = record({
      employeeID: "emp_1",
      participations: [
        participation({ runID: "run_1", teamID: "t1", captain: true }),
        // 同一次运行里的另一支队：运行只算一次，团队算两次。
        participation({ runID: "run_1", teamID: "t2", at: 1_700_000_005_000 }),
        participation({ runID: "run_2", teamID: "t3" }),
      ],
      reworks: [],
      acceptances: [],
      runs: [],
    })
    expect(result.participations).toEqual({ runs: 2, teams: 3, asCaptain: 1, lastAt: 1_700_000_005_000 })
  })

  it("attributes rework and first-pass only to the teams this person was on", () => {
    const result = record({
      employeeID: "emp_1",
      participations: [participation({ runID: "run_1", teamID: "t1" })],
      reworks: [
        { runID: "run_1", teamID: "t1", reasons: ["没有高危问题", "没有高危问题"] },
        { runID: "run_1", teamID: "t1", reasons: ["合并后重验未通过"] },
        // 另一支队的返工与他无关。
        { runID: "run_1", teamID: "t2", reasons: ["无关的驳回"] },
      ],
      acceptances: [
        { runID: "run_1", owner: "t1", outcome: "pass" },
        { runID: "run_1", owner: "t1", outcome: "fail" },
        // 首次就没有验证记录：计入分母，但不算通过（未验证不是通过）。
        { runID: "run_1", owner: "t1" },
        { runID: "run_1", owner: "t2", outcome: "pass" },
      ],
      runs: [],
    })

    expect(result.rework).toEqual({
      total: 3,
      runs: 1,
      top: [
        { reason: "没有高危问题", count: 2 },
        { reason: "合并后重验未通过", count: 1 },
      ],
    })
    expect(result.firstPass).toEqual({ lines: 3, passed: 1, rate: 1 / 3 })
  })

  it("measures only finished runs and never claims it is personal work time", () => {
    const result = record({
      employeeID: "emp_1",
      participations: [
        participation({ runID: "run_1", teamID: "t1" }),
        participation({ runID: "run_2", teamID: "t2" }),
        participation({ runID: "run_3", teamID: "t3" }),
      ],
      reworks: [],
      acceptances: [],
      runs: [
        { id: "run_1", startedAt: 1_000, endedAt: 61_000 },
        { id: "run_2", startedAt: 2_000, endedAt: 32_000 },
        // 未结束：没有结束时间，不计入平均值。
        { id: "run_3", startedAt: 3_000 },
        // 没有参与过的运行不计入。
        { id: "run_4", startedAt: 4_000, endedAt: 9_000 },
      ],
    })
    expect(result.wall).toEqual({ measured: 2, totalMs: 90_000, avgMs: 45_000 })
    expect(result.caveats.join("\n")).toContain("不是个人工时")
    expect(result.caveats.join("\n")).toContain("不是对个人的评价")
  })

  it("gives no rate when there is no acceptance line", () => {
    const result = record({
      employeeID: "emp_1",
      participations: [participation({ runID: "run_1", teamID: "t1" })],
      reworks: [],
      acceptances: [],
      runs: [],
    })
    // 分母为零不给百分比：0 条验收 ≠ 0% 一次通过。
    expect(result.firstPass).toEqual({ lines: 0, passed: 0 })
    expect(result.firstPass.rate).toBeUndefined()
    expect(result.wall.avgMs).toBeUndefined()
  })

  it("says which participations could not be confirmed by a roster", () => {
    const result = record({
      employeeID: "emp_1",
      participations: [
        participation({ runID: "run_1", teamID: "t1" }),
        participation({ runID: "run_2", teamID: "", source: "session" }),
      ],
      reworks: [],
      acceptances: [],
      runs: [],
    })
    // 会话兜底的参与仍算「参与过」，但要在 caveats 里说明来源。
    expect(result.participations.runs).toBe(2)
    expect(result.caveats.join("\n")).toContain("会话归属")
  })

  it("reads rejection reasons from the structured field first", () => {
    expect(reasonsOf({ failed: [{ text: "没有高危问题" }, { text: " " }] })).toEqual(["没有高危问题"])
    expect(reasonsOf({ reason: "merged-verification" })).toEqual(["合并后重验未通过"])
    expect(reasonsOf({ reason: "提交失败：/home/user/x" })).toEqual(["未分类"])
    expect(reasonsOf(undefined)).toEqual(["未分类"])
  })

  it("does not invent a rate from acceptances owned by someone else", () => {
    const result = record({
      employeeID: "emp_1",
      participations: [participation({ runID: "run_1", teamID: "t1" })],
      reworks: [],
      acceptances: [{ runID: "run_1", owner: "t2", outcome: "pass" } satisfies AcceptanceResult],
      runs: [],
    })
    expect(result.firstPass).toEqual({ lines: 0, passed: 0 })
  })
})
