import { describe, expect, it } from "bun:test"
import { TaskBoard } from "@/team/task-board"
import type { Task, TaskStatus } from "@/team/task-list"

let seq = 0
function task(input: { subject: string; status?: TaskStatus; owner?: string }): Task {
  seq++
  return {
    id: "task_" + seq,
    teamID: "team_run_1",
    subject: input.subject,
    description: "描述不该出现在注入里",
    status: input.status ?? "pending",
    ...(input.owner ? { ownerSessionID: input.owner as Task["ownerSessionID"] } : {}),
    blocks: [],
    blockedBy: [],
    metadata: {},
    createdAt: seq,
    updatedAt: seq,
  }
}

describe("task-board", () => {
  it("tells a member only about the tasks it owns", () => {
    const mine = task({ subject: "查资料", status: "in_progress", owner: "ses_me" })
    const other = task({ subject: "写报告", owner: "ses_other" })
    const view = TaskBoard.view({ captain: false, sessionID: "ses_me", tasks: [mine, other] })
    expect(view.text).toContain("查资料")
    expect(view.text).not.toContain("写报告")
    expect(view.shown).toBe(1)
    expect(view.omitted).toBe(0)
  })

  it("shows the captain the whole team, and marks tasks nobody claimed", () => {
    const unowned = task({ subject: "整理素材" })
    const mine = task({ subject: "查资料", owner: "ses_captain" })
    const other = task({ subject: "写报告", owner: "ses_other" })
    const view = TaskBoard.view({ captain: true, sessionID: "ses_captain", tasks: [unowned, mine, other] })
    expect(view.text).toContain("整理素材（未认领）")
    expect(view.text).toContain("查资料")
    expect(view.text).toContain("写报告")
    expect(view.text).toContain("队长视角")
  })

  it("never mentions finished work", () => {
    const done = task({ subject: "已完成的事", status: "completed", owner: "ses_me" })
    const failed = task({ subject: "失败的事", status: "failed", owner: "ses_me" })
    const cancelled = task({ subject: "取消的事", status: "cancelled", owner: "ses_me" })
    const view = TaskBoard.view({ captain: true, sessionID: "ses_me", tasks: [done, failed, cancelled] })
    expect(view.text).toContain("当前无待办")
    expect(view.text).not.toContain("已完成的事")
    expect(view.text).not.toContain("失败的事")
    expect(view.text).not.toContain("取消的事")
  })

  it("says a real empty board out loud instead of injecting nothing", () => {
    const view = TaskBoard.view({ captain: false, sessionID: "ses_me", tasks: [] })
    expect(view.text).toContain("当前无待办")
    expect(view.shown).toBe(0)
    expect(view.omitted).toBe(0)
  })

  it("counts what it cut off without naming it", () => {
    const tasks = Array.from({ length: 5 }, (_, index) => task({ subject: "任务" + index }))
    const view = TaskBoard.view({ captain: true, sessionID: "ses_me", tasks, limits: { count: 2, chars: 10_000 } })
    expect(view.shown).toBe(2)
    expect(view.omitted).toBe(3)
    expect(view.text).toContain("另有 3 项未列出")
    // 截断不能顺带把被排除的 id / 标题泄露出去。
    expect(view.text).not.toContain("任务2")
    expect(view.text).not.toContain(tasks[2]!.id)
  })

  it("stops on the character budget, not on a line boundary", () => {
    const tasks = [task({ subject: "一二三四五六七八九十" }), task({ subject: "甲乙丙丁戊己庚辛壬癸" })]
    const view = TaskBoard.view({ captain: true, sessionID: "ses_me", tasks, limits: { count: 10, chars: 12 } })
    expect(view.shown).toBe(1)
    expect(view.omitted).toBe(1)
    expect(view.text).toContain("另有 1 项未列出")
  })

  it("keeps the order it was given instead of resorting by update time", () => {
    const first = task({ subject: "先建的" })
    const second = task({ subject: "后建的" })
    second.updatedAt = 1
    const view = TaskBoard.view({ captain: true, sessionID: "ses_me", tasks: [first, second] })
    expect(view.text.indexOf("先建的")).toBeLessThan(view.text.indexOf("后建的"))
  })

  it("only re-injects when what the model would read changed", () => {
    const one = task({ subject: "查资料", status: "in_progress", owner: "ses_me" })
    const base = TaskBoard.view({ captain: false, sessionID: "ses_me", tasks: [one] })
    const same = TaskBoard.view({ captain: false, sessionID: "ses_me", tasks: [{ ...one, description: "改过描述" }] })
    expect(same.signature).toBe(base.signature)
    const moved = TaskBoard.view({ captain: false, sessionID: "ses_me", tasks: [{ ...one, status: "pending" }] })
    expect(moved.signature).not.toBe(base.signature)
  })
})
