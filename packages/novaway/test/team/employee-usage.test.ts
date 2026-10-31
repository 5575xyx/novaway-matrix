import { describe, expect, test } from "bun:test"
import { summarize, type Row } from "@/team/employee-usage"

const row = (over: Partial<Row> & Pick<Row, "sessionID">): Row => ({
  cost: 0,
  tokens: 0,
  updatedAt: 1,
  ...over,
})

describe("employee usage", () => {
  test("groups the person's sessions by run and keeps unattributed spend of those runs separate", () => {
    const result = summarize({
      employeeID: "emp_xiaolin",
      rows: [
        // 小林参与的第 1 次运行：她自己的会话 + 她派生的子代理（继承同一个 employeeID）。
        row({ sessionID: "ses_1a", employeeID: "emp_xiaolin", runID: "run_1", tokens: 100, cost: 1, updatedAt: 10 }),
        row({ sessionID: "ses_1b", employeeID: "emp_xiaolin", runID: "run_1", tokens: 50, cost: 0.5, updatedAt: 20 }),
        // 同一次运行里没人认领的会话：验证与匿名派发。
        row({ sessionID: "ses_verify", runID: "run_1", tokens: 30, cost: 0.03, updatedAt: 30 }),
        // 另一次运行，另一个人：不属于小林，连未归属都算不上「她的运行」。
        row({ sessionID: "ses_2a", employeeID: "emp_other", runID: "run_2", tokens: 900, updatedAt: 40 }),
        row({ sessionID: "ses_2v", runID: "run_2", tokens: 400, updatedAt: 40 }),
        // 普通会话：没有归属也没有运行。
        row({ sessionID: "ses_plain", tokens: 1000, updatedAt: 50 }),
      ],
    })

    expect(result.totals).toEqual({ tokens: 150, cost: 1.5, sessions: 2 })
    expect(result.runs).toEqual([{ runID: "run_1", tokens: 150, cost: 1.5, sessions: 2, lastAt: 20 }])
    // 未归属只算她参与过的运行（run_1），不把 run_2 的验证开销也算进来。
    expect(result.unattributed).toEqual({ tokens: 30, cost: 0.03, sessions: 1 })
    expect(result.outsideRuns).toEqual({ tokens: 0, cost: 0, sessions: 0 })
    expect(result.lastUsedAt).toBe(20)
  })

  test("a session with attribution but no run is reported instead of silently dropped", () => {
    const result = summarize({
      employeeID: "emp_xiaolin",
      rows: [row({ sessionID: "ses_orphan", employeeID: "emp_xiaolin", tokens: 7, updatedAt: 5 })],
    })
    // 总量仍然算上它，但单列一格：有归属却没有运行坐标说明有写入路径漏了 runID。
    expect(result.totals).toEqual({ tokens: 7, cost: 0, sessions: 1 })
    expect(result.runs).toEqual([])
    expect(result.outsideRuns).toEqual({ tokens: 7, cost: 0, sessions: 1 })
  })

  test("no sessions means zero, not a missing field", () => {
    const result = summarize({ employeeID: "emp_nobody", rows: [] })
    expect(result).toEqual({
      totals: { tokens: 0, cost: 0, sessions: 0 },
      runs: [],
      unattributed: { tokens: 0, cost: 0, sessions: 0 },
      outsideRuns: { tokens: 0, cost: 0, sessions: 0 },
    })
  })
})
