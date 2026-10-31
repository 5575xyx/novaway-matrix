import { describe, expect, it } from "bun:test"
import { fromLive, problems, describe as describeProblems } from "@/team/roster"
import type { Employee, RosterEntry, Snapshot } from "@/team/profile"

const employee = (id: string, name: string, archived = false): Employee => ({
  id,
  name,
  job: "build",
  archived,
})

const entry = (id: string, name: string, order: number, archived = false): RosterEntry => ({
  employee: employee(id, name, archived),
  role: order === 0 ? "captain" : "worker",
  order,
  canAutoDispatch: true,
})

const snapshot = (roster: RosterEntry[], captain = roster[0]?.employee.id ?? "emp_none"): Snapshot => ({
  profileID: "prof_1",
  name: "审查团队",
  version: 1,
  captain,
  roster,
})

describe("roster addressing: who can still take work", () => {
  it("passes when everyone is still in the library", () => {
    const roster = snapshot([entry("emp_a", "小明", 0), entry("emp_b", "小红", 1)])
    expect(problems(roster, [employee("emp_a", "小明"), employee("emp_b", "小红")])).toEqual([])
  })

  it("refuses a member archived after the snapshot was taken", () => {
    const roster = snapshot([entry("emp_a", "小明", 0), entry("emp_b", "小红", 1)])
    // 快照复制时小红还在，之后被归档：派发前必须发现，而不是照原样派下去。
    const found = problems(roster, [employee("emp_a", "小明"), employee("emp_b", "小红", true)])
    expect(found).toEqual([{ employeeID: "emp_b", name: "小红", job: "build", reason: "archived" }])
    expect(describeProblems(found)).toContain("小红")
    expect(describeProblems(found)).toContain("已归档")
  })

  it("refuses a member who was already archived when the roster was copied", () => {
    const roster = snapshot([entry("emp_a", "小明", 0), entry("emp_b", "小红", 1, true)])
    // 库里没有这个人也不影响判定：快照自己写着「已归档」。
    expect(problems(roster, [employee("emp_a", "小明")]).map((item) => item.employeeID)).toEqual(["emp_b"])
  })

  it("uses the library's current name so the board shows a name people recognise", () => {
    const roster = snapshot([entry("emp_a", "小明", 0), entry("emp_b", "小红", 1)])
    const found = problems(roster, [employee("emp_a", "小明"), employee("emp_b", "小明明", true)])
    expect(found[0].name).toBe("小明明")
  })

  it("does not judge people the library has never heard of", () => {
    // 员工只归档、不物理删除，所以「查不到」只可能是临时团队的会话成员。
    const roster = snapshot([entry("ses_a", "会话成员", 0)])
    expect(problems(roster, [])).toEqual([])
  })

  it("refuses when the captain is not in the roster at all", () => {
    const roster = snapshot([entry("emp_a", "小明", 0)], "emp_gone")
    // 找不到队长就退回默认 agent，等于静默改派给别人。
    expect(problems(roster, [employee("emp_a", "小明")])).toEqual([{ employeeID: "emp_gone", reason: "missing" }])
  })

  it("never flags a live team: its members are sessions, not employees", () => {
    const live = fromLive({
      teamID: "t_1",
      name: "临时团队",
      members: [
        { sessionID: "ses_a", name: "队长", agent: "build", role: "lead" },
        { sessionID: "ses_b", name: "成员", agent: "general", role: "worker" },
      ],
    })
    expect(live).toBeDefined()
    expect(problems(live!, [])).toEqual([])
  })
})
