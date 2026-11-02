import { describe, expect, test } from "bun:test"
import { buildDrill, type DrillAcceptance } from "./team-drilldown.logic"
import type { GraphLaneInput, GraphTask } from "./team-graph.layout"

const task = (id: string, status: string, ownerName?: string): GraphTask => ({
  id,
  subject: "任务 " + id,
  status,
  ...(ownerName ? { owner: "sess_" + ownerName, ownerName, ownerJob: "岗位 " + ownerName, ownerRole: "worker" } : {}),
})

const lane: GraphLaneInput = {
  id: "team_1",
  name: "内容组",
  phase: "executing",
  round: 2,
  members: [
    { id: "sess_cap", name: "阿明", job: "队长", role: "captain" },
    { id: "sess_小周", name: "小周", job: "文案", role: "worker" },
    { id: "sess_小吴", name: "小吴", job: "设计", role: "worker" },
  ],
  tasks: [
    task("t1", "completed", "小周"),
    task("t2", "in_progress", "小吴"),
    task("t3", "pending", "小周"),
    task("t4", "pending"),
  ],
}

const acceptances: DrillAcceptance[] = [
  { id: "a1", taskID: "t1", text: "标题通过审核", kind: "rubric", outcome: "pass" },
  { id: "a2", taskID: "t1", text: "标题不含违禁词", kind: "rubric", outcome: "fail" },
  { id: "a3", taskID: "t2", text: "配图尺寸正确", kind: "rubric", outcome: "unverified" },
  { id: "a4", text: "整队验收", kind: "rubric", outcome: "pass" },
]

describe("buildDrill", () => {
  test("点任务节点：只回这一步、认领人，以及挂在它身上的验收（没过的在前）", () => {
    const view = buildDrill({ nodeID: "task:t1", lane, acceptances })
    expect(view?.kind).toBe("task")
    expect(view?.title).toBe("任务 t1")
    expect(view?.person).toEqual({ name: "小周", job: "岗位 小周", role: "worker" })
    expect(view?.ownerSessionID).toBe("sess_小周")
    expect(view?.lines).toHaveLength(1)
    expect(view?.lines[0]?.acceptances.map((item) => item.outcome)).toEqual(["fail", "pass"])
    // 整队级验收没有 taskID，不属于任何一步。
    expect(view?.lines[0]?.acceptances).toHaveLength(2)
  })

  test("点成员节点：这个人的全部任务，完成的排在前面，不混入别人的活", () => {
    const view = buildDrill({ nodeID: "member:小周", lane, acceptances })
    expect(view?.kind).toBe("member")
    expect(view?.title).toBe("小周")
    expect(view?.lines.map((line) => line.task.id)).toEqual(["t1", "t3"])
    expect(view?.ownerSessionID).toBe("sess_小周")
  })

  test("点队长节点：整条泳道的任务都归他派发，含还没人认领的那条", () => {
    const view = buildDrill({ nodeID: "captain:team_1", lane, acceptances })
    expect(view?.kind).toBe("captain")
    expect(view?.title).toBe("阿明")
    expect(view?.lines.map((line) => line.task.id)).toEqual(["t1", "t2", "t3", "t4"])
    expect(view?.unassigned).toBe(1)
  })

  test("点未认领节点：任务仍然列出来，标题交给界面说「还没人认领」", () => {
    const view = buildDrill({ nodeID: "member:unclaimed", lane, acceptances })
    expect(view?.unclaimed).toBe(true)
    expect(view?.title).toBe("")
    expect(view?.lines.map((line) => line.task.id)).toEqual(["t4"])
  })

  test("认不出的节点不画空面板", () => {
    expect(buildDrill({ nodeID: "task:missing", lane, acceptances })).toBeUndefined()
    expect(buildDrill({ nodeID: "nope", lane, acceptances })).toBeUndefined()
  })
})
