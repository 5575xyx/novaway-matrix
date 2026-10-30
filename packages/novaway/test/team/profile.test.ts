import { describe, expect } from "bun:test"
import { Effect } from "effect"
import {
  Service as ProfileService,
  defaultLayer as ProfileLayer,
  BUILTIN_PROFILE_ID,
  brief,
  snapshotFrom,
} from "@/team/profile"
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

  it.effect("the captain brief lists the other members with their duty, not the captain", () =>
    Effect.gen(function* () {
      const profiles = yield* ProfileService
      yield* profiles.seed()
      const snapshot = (yield* profiles.snapshot(BUILTIN_PROFILE_ID))!
      const lines = brief(snapshot)
      // 5 人编制里 1 名队长，剩下 4 个角度都要出现在队长提示词里。
      expect(lines).toHaveLength(4)
      expect(lines.join("\n")).toContain("安全审查")
      expect(lines.join("\n")).toContain("注入 / 越权 / 凭据")
      expect(lines.join("\n")).not.toContain("审查队长")
    }),
  )

  it.effect("a stored snapshot survives a round trip and garbage degrades to nothing", () =>
    Effect.gen(function* () {
      const profiles = yield* ProfileService
      yield* profiles.seed()
      const snapshot = (yield* profiles.snapshot(BUILTIN_PROFILE_ID))!
      // 落库再读回：字段齐全时逐项还原，顺序按 order。
      const restored = snapshotFrom(JSON.parse(JSON.stringify(snapshot)))
      expect(restored?.captain).toBe(snapshot.captain)
      expect(restored?.roster.map((entry) => entry.employee.id)).toEqual(
        snapshot.roster.map((entry) => entry.employee.id),
      )

      // 缺字段 / 类型不对：当没有，而不是拿半份名册派发。
      expect(snapshotFrom(undefined)).toBeUndefined()
      expect(snapshotFrom("snap")).toBeUndefined()
      expect(snapshotFrom({ profileID: "p", name: "n", version: 1, captain: "c" })).toBeUndefined()
      expect(snapshotFrom({ ...snapshot, roster: [{ order: 0 }, { order: 1, employee: { id: 1 } }] })?.roster).toEqual(
        [],
      )
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
