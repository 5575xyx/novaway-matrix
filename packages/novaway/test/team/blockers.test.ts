import { describe, expect, test } from "bun:test"
import { from, swappable } from "@/team/blockers"
import type { RunEvent } from "@/team/run"

const event = (seq: number, kind: string, payload?: Record<string, unknown>): RunEvent => ({
  id: "evt_" + seq,
  runID: "run_1",
  seq,
  at: 1000 + seq,
  kind,
  payload,
})

describe("run blockers", () => {
  test("denials, commit failures, budget and conflicts reach the board in event order", () => {
    const blockers = from([
      event(1, "team.dispatched", { teamID: "rt_1" }),
      event(2, "tool.denied", { tool: "edit", taskID: "acc_1", reason: "只读运行不允许破坏性操作（edit）" }),
      event(3, "integration.commit_failed", { teamID: "rt_1", message: "hook 拒绝提交" }),
      event(4, "budget.exceeded", { teamID: "rt_2" }),
      event(5, "team.conflict", { team: "tests", files: ["a.ts", "b.ts"] }),
    ])
    expect(blockers.map((item) => item.kind)).toEqual([
      "tool.denied",
      "integration.commit_failed",
      "budget.exceeded",
      "team.conflict",
    ])
    // 原因用事件里的原文，不在这里重写：当时发生什么就显示什么。
    expect(blockers[0].tool).toBe("edit")
    expect(blockers[0].reason).toContain("只读运行不允许")
    expect(blockers[1].reason).toBe("hook 拒绝提交")
    expect(blockers[3].files).toBe(2)
    expect(blockers[3].reason).toBe("tests")
  })

  test("a denial cannot be fixed by swapping members", () => {
    // 权限类换人等于提权（§11.2）：界面要明说「需要用户放行」。
    expect(swappable("tool.denied")).toBe(false)
    expect(swappable("team.conflict")).toBe(true)
    expect(swappable("budget.exceeded")).toBe(true)
    expect(swappable("integration.commit_failed")).toBe(true)
  })

  test("an event without a payload still yields a blocker instead of being dropped", () => {
    const blockers = from([event(7, "tool.denied")])
    expect(blockers.length).toBe(1)
    expect(blockers[0].tool).toBeUndefined()
    expect(blockers[0].reason).toBeUndefined()
  })
})
