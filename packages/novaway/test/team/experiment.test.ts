import { describe, expect, it } from "bun:test"
import { report, type Group, type Observation, type Verdict } from "@/team/experiment"

const row = (taskID: string, group: Group, verdict: Verdict, extra: Partial<Observation> = {}): Observation => ({
  taskID,
  group,
  verdict,
  ...extra,
})

describe("team experiment report", () => {
  it("classifies the five layers and never lets unknown count as either verdict", () => {
    const result = report([
      row("t1", "A", "pass"),
      row("t1", "B", "pass"),
      row("t1", "C", "pass"),
      row("t2", "A", "fail"),
      row("t2", "B", "fail"),
      row("t2", "C", "pass"),
      row("t3", "A", "pass"),
      row("t3", "B", "fail"),
      row("t3", "C", "fail"),
      row("t4", "A", "fail"),
      row("t4", "B", "fail"),
      row("t4", "C", "fail"),
      // 团队那组没有结论：既不能算「只有团队通过」，也不能算失败。
      row("t5", "A", "fail"),
      row("t5", "B", "fail"),
      row("t5", "C", "unknown"),
      // 缺一组：证据不足。
      row("t6", "A", "pass"),
      row("t6", "C", "pass"),
    ])

    expect(result.layers).toEqual({
      both_pass: ["t1"],
      only_team_pass: ["t2"],
      only_single_pass: ["t3"],
      both_fail: ["t4"],
      indeterminate: ["t5", "t6"],
    })
    expect(result.comparable).toBe(1)
  })

  it("compares cost and time only where results are comparable, against B", () => {
    const result = report([
      row("both", "A", "pass", { cost: 1 }),
      row("both", "B", "pass", { cost: 5, wallMs: 80 }),
      // 团队那组没有 token 回报：该指标单列为缺失，不补零。
      row("both", "C", "pass", { cost: 10, wallMs: 100 }),
      // 结果不同：带着成本也不能比，避免「更快失败」被算成效率。
      row("diff", "A", "fail", { cost: 99 }),
      row("diff", "B", "fail", { cost: 99, wallMs: 10 }),
      row("diff", "C", "fail", { cost: 1, wallMs: 1 }),
    ])

    const both = result.tasks.find((task) => task.taskID === "both")!
    expect(both.layer).toBe("both_pass")
    expect(both.comparison?.cost).toEqual({ team: 10, baseline: 5, delta: 5, ratio: 2 })
    expect(both.comparison?.wallMs).toEqual({ team: 100, baseline: 80, delta: 20, ratio: 1.25 })
    expect(both.comparison?.missing).toEqual(["tokens"])

    const diff = result.tasks.find((task) => task.taskID === "diff")!
    expect(diff.layer).toBe("both_fail")
    expect(diff.comparison).toBeUndefined()

    // 覆盖率跟着一起报：tokens 在 both_pass 里 0/1 覆盖，不能当成「用量一样」。
    expect(result.coverage).toEqual({
      cost: { covered: 1, total: 1 },
      tokens: { covered: 0, total: 1 },
      wallMs: { covered: 1, total: 1 },
    })
  })

  it("says plainly that nothing is comparable instead of printing an empty table", () => {
    const result = report([row("x", "A", "fail"), row("x", "B", "pass"), row("x", "C", "fail")])
    expect(result.comparable).toBe(0)
    expect(result.note).toContain("没有 both_pass")
    expect(result.coverage.cost).toEqual({ covered: 0, total: 0 })
  })

  it("omits the ratio when the baseline is zero but still reports the difference", () => {
    const result = report([
      row("free", "A", "pass", { cost: 0 }),
      row("free", "B", "pass", { cost: 0 }),
      row("free", "C", "pass", { cost: 2 }),
    ])
    expect(result.tasks[0].comparison?.cost).toEqual({ team: 2, baseline: 0, delta: 2 })
  })

  it("refuses malformed records instead of picking one and moving on", () => {
    // 同一任务同一组出现两次：是记录错误，不是「后来者覆盖前者」。
    expect(() => report([row("dup", "C", "pass"), row("dup", "C", "fail")])).toThrow(/重复/)
    // 负的耗时只可能是记录写错。
    expect(() =>
      report([row("bad", "A", "pass"), row("bad", "B", "pass"), row("bad", "C", "pass", { wallMs: -1 })]),
    ).toThrow(/不合法/)
  })
})
