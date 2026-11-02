import { describe, expect, test } from "bun:test"
import { layoutLane, participants } from "./team-graph.layout"

const member = (id: string, name: string, role: "captain" | "worker" = "worker") => ({
  id,
  name,
  job: role === "captain" ? "team-lead" : "reviewer",
  role,
})
const task = (id: string, status: string, ownerName?: string) => ({
  id,
  subject: "task " + id,
  status,
  ...(ownerName ? { ownerName } : {}),
})

describe("layoutLane", () => {
  test("captain fans out to tasks, each task connects to its owner, finished work flows back", () => {
    const lane = layoutLane({
      id: "t1",
      name: "审查队",
      phase: "delivered",
      round: 1,
      members: [member("cap", "队长", "captain"), member("a", "阿甲"), member("b", "阿乙")],
      tasks: [task("1", "completed", "阿甲"), task("2", "completed", "阿乙"), task("3", "in_progress", "阿乙")],
    })
    expect(lane.nodes.filter((node) => node.kind === "captain")).toHaveLength(1)
    expect(lane.nodes.filter((node) => node.kind === "task")).toHaveLength(3)
    expect(lane.edges.filter((edge) => edge.kind === "assign")).toHaveLength(3)
    expect(lane.edges.filter((edge) => edge.kind === "work")).toHaveLength(3)
    // 阿甲的任务全部完成 → 一条交付回边；阿乙还有在做的 → 还没交付。
    const deliver = lane.edges.filter((edge) => edge.kind === "deliver")
    expect(deliver).toHaveLength(1)
    expect(deliver[0].done).toBe(true)
    expect(lane.participants).toBe(2)
  })

  test("a task without an owner still has a landing point", () => {
    const lane = layoutLane({
      id: "t1",
      name: "审查队",
      phase: "executing",
      round: 1,
      members: [member("cap", "队长", "captain")],
      tasks: [task("1", "pending")],
    })
    expect(lane.unassigned).toBe(1)
    expect(lane.nodes.some((node) => node.label === "未认领")).toBe(true)
    expect(lane.participants).toBe(0)
  })

  test("before any task is dispatched the roster is shown as idle", () => {
    const lane = layoutLane({
      id: "t1",
      name: "审查队",
      phase: "queued",
      round: 1,
      members: [member("cap", "队长", "captain"), member("a", "阿甲"), member("b", "阿乙")],
      tasks: [],
    })
    expect(lane.nodes.filter((node) => node.kind === "member")).toHaveLength(2)
    expect(lane.edges).toHaveLength(0)
    expect(lane.participants).toBe(0)
  })

  test("round number travels with every node and edge so rework is not mixed with round one", () => {
    const lane = layoutLane({
      id: "t1",
      name: "审查队",
      phase: "rework",
      round: 2,
      members: [member("cap", "队长", "captain")],
      tasks: [task("1", "in_progress", "阿甲")],
    })
    expect(lane.nodes.every((node) => node.round === 2)).toBe(true)
    expect(lane.edges.every((edge) => edge.round === 2)).toBe(true)
  })

  test("participants deduplicates people owning several tasks", () => {
    expect(participants([task("1", "completed", "阿甲"), task("2", "completed", "阿甲")])).toEqual(["阿甲"])
  })
})
