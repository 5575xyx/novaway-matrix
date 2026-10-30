import { describe, expect, test } from "bun:test"
import { brief } from "@/team/profile"
import { fromLive } from "@/team/roster"

const member = (sessionID: string, name: string, agent: string, role: "lead" | "worker", status = "idle") => ({
  sessionID,
  name,
  agent,
  role,
  status,
})

describe("team roster", () => {
  test("a live team becomes a roster snapshot with its lead as captain", () => {
    const snapshot = fromLive({
      teamID: "team_1",
      name: "支付改造",
      members: [member("ses_a", "小明", "build", "worker"), member("ses_b", "小红", "plan", "lead")],
    })
    expect(snapshot).toBeTruthy()
    if (!snapshot) return
    // 快照记的是「谁当队长」，不是「谁是第一个」。
    expect(snapshot.captain).toBe("ses_b")
    expect(snapshot.roster.map((entry) => entry.employee.name)).toEqual(["小明", "小红"])
    expect(snapshot.roster.map((entry) => entry.role)).toEqual(["worker", "captain"])
    // 岗位从成员的 agent 来：派发时队长的岗位就是这里读出来的。
    expect(snapshot.roster.map((entry) => entry.employee.job)).toEqual(["build", "plan"])
    // 没有 lead 时的职责说明要写「未指定」，不能空着让人以为有。
    expect(brief(snapshot)).toEqual(["- 小明（build）：未指定职责"])
  })

  test("archived members are left out: they are no longer in this team", () => {
    const snapshot = fromLive({
      teamID: "team_1",
      name: "t",
      members: [member("ses_a", "小明", "build", "lead"), member("ses_gone", "旧成员", "build", "worker", "archived")],
    })
    expect(snapshot?.roster.map((entry) => entry.employee.name)).toEqual(["小明"])
  })

  test("a team without members has no roster instead of a fabricated captain", () => {
    // 编一个队长会让派发落到默认 agent 上，而运行看起来一切正常 —— 这是最危险的假象。
    expect(fromLive({ teamID: "team_1", name: "t", members: [] })).toBeUndefined()
    expect(
      fromLive({ teamID: "team_1", name: "t", members: [member("ses_a", "小明", "build", "worker", "archived")] }),
    ).toBeUndefined()
  })

  test("live members are never auto-dispatchable: the team has not declared that", () => {
    const snapshot = fromLive({
      teamID: "team_1",
      name: "t",
      members: [member("ses_a", "小明", "build", "lead")],
    })
    expect(snapshot?.roster.every((entry) => entry.canAutoDispatch === false)).toBe(true)
  })
})
