import { describe, expect, test } from "bun:test"
import { identify } from "@/team/identity"
import type { Snapshot } from "@/team/profile"

const roster = (people: Array<{ id: string; name: string; job: string }>, captain: string): Snapshot => ({
  profileID: "prof_1",
  name: "审查组",
  version: 1,
  captain,
  roster: people.map((person, index) => ({
    employee: { ...person, archived: false },
    role: person.id === captain ? "captain" : "worker",
    order: index,
    canAutoDispatch: true,
  })),
})

const people = [
  { id: "emp_captain", name: "老周", job: "build" },
  { id: "emp_review", name: "小林", job: "review" },
]

describe("team identity", () => {
  test("the captain's helper inherits the captain instead of becoming another person", () => {
    // 非队长派生的会话（成员自己的助手、队长自己的临时助手）只继承，不按名字重新指认。
    expect(
      identify({ roster: roster(people, "emp_captain"), captain: false, name: "小林", parentEmployeeID: "emp_captain" }),
    ).toBe("emp_captain")
    expect(identify({ roster: roster(people, "emp_captain"), captain: false })).toBeUndefined()
  })

  test("a unique name is a declaration; the work is booked to that person", () => {
    expect(identify({ roster: roster(people, "emp_captain"), captain: true, name: "小林" })).toBe("emp_review")
    // 前后空格不影响指认 —— 名字来自模型输出，不能要求它逐字精确。
    expect(identify({ roster: roster(people, "emp_captain"), captain: true, name: " 小林 " })).toBe("emp_review")
  })

  test("a duplicate name is not guessed", () => {
    const duplicated = roster(
      [...people, { id: "emp_other", name: "小林", job: "review" }],
      "emp_captain",
    )
    // 同名多人时宁可显示「未归属」，也不把工时算到其中一个头上。
    expect(identify({ roster: duplicated, captain: true, name: "小林" })).toBeUndefined()
  })

  test("no name, no roster, or a name outside the roster means unattributed", () => {
    expect(identify({ roster: roster(people, "emp_captain"), captain: true })).toBeUndefined()
    expect(identify({ roster: roster(people, "emp_captain"), captain: true, name: "   " })).toBeUndefined()
    expect(identify({ roster: roster(people, "emp_captain"), captain: true, name: "路人" })).toBeUndefined()
    expect(identify({ captain: true, name: "小林", parentEmployeeID: "emp_captain" })).toBeUndefined()
  })
})
