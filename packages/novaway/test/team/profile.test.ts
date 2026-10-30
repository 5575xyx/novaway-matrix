import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Service as ProfileService, defaultLayer as ProfileLayer, BUILTIN_PROFILE_ID } from "@/team/profile"
import { testEffect } from "../lib/effect"

const it = testEffect(ProfileLayer)

describe("team profile", () => {
  it.effect("seeds the built-in code review team once", () =>
    Effect.gen(function* () {
      const profiles = yield* ProfileService
      yield* profiles.seed()
      yield* profiles.seed()

      const list = yield* profiles.list()
      expect(list.filter((profile) => profile.id === BUILTIN_PROFILE_ID)).toHaveLength(1)
      const builtin = list.find((profile) => profile.id === BUILTIN_PROFILE_ID)!
      expect(builtin.name).toBe("代码审查团队")
      // 开箱可用：内置模板默认不进 Auto 池（§20.2：Auto 是显式选择加入）。
      expect(builtin.autoEligible).toBe(false)

      const roster = yield* profiles.roster(BUILTIN_PROFILE_ID)
      expect(roster).toHaveLength(5)
      expect(roster.filter((entry) => entry.role === "captain")).toHaveLength(1)
      expect(roster[0].employee.id).toBe(builtin.captainMember)
      expect(new Set(roster.map((entry) => entry.employee.job)).size).toBeGreaterThan(2)
    }),
  )

  it.effect("snapshot is a copy: later template edits cannot leak into a running run", () =>
    Effect.gen(function* () {
      const profiles = yield* ProfileService
      yield* profiles.seed()
      const first = yield* profiles.snapshot(BUILTIN_PROFILE_ID)
      expect(first).toBeDefined()
      const second = yield* profiles.snapshot(BUILTIN_PROFILE_ID)
      // 每次取快照都是独立对象：运行里改它不会污染下一次。
      expect(second).not.toBe(first)
      expect(second!.roster).not.toBe(first!.roster)
      expect(second!.roster[0].employee).not.toBe(first!.roster[0].employee)
      second!.roster[0].employee.name = "改名了"
      expect((yield* profiles.snapshot(BUILTIN_PROFILE_ID))!.roster[0].employee.name).not.toBe("改名了")
    }),
  )

  it.effect("unknown profile has no snapshot instead of an empty roster", () =>
    Effect.gen(function* () {
      const profiles = yield* ProfileService
      expect(yield* profiles.snapshot("prof_missing")).toBeUndefined()
    }),
  )

  it.effect("creating a profile marks its captain row and keeps member order", () =>
    Effect.gen(function* () {
      const profiles = yield* ProfileService
      yield* profiles.seed()
      const people = yield* profiles.employees()
      const [a, b] = people
      const created = yield* profiles.create({
        name: "临时审查组",
        captain: a.id,
        members: [{ employeeID: b.id, duty: "只看测试" }, { employeeID: a.id }],
      })
      const members = yield* profiles.members(created.id)
      expect(members.map((member) => member.order)).toEqual([0, 1])
      expect(members.find((member) => member.employeeID === a.id)!.role).toBe("captain")
      expect(members.find((member) => member.employeeID === b.id)!.duty).toBe("只看测试")
    }),
  )
})
