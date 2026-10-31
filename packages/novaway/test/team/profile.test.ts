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

  it.effect("editing a template bumps the version and leaves the roster alone", () =>
    Effect.gen(function* () {
      const profiles = yield* ProfileService
      yield* profiles.seed()
      const [a, b] = yield* profiles.employees()
      const created = yield* profiles.create({
        name: "编辑前",
        description: "旧描述",
        captain: a.id,
        members: [{ employeeID: a.id }, { employeeID: b.id }],
      })
      const rosterBefore = yield* profiles.members(created.id)

      const updated = (yield* profiles.update({ profileID: created.id, name: "编辑后" }))!
      expect(updated.name).toBe("编辑后")
      // 版本只在真改东西时 +1。
      expect(updated.version).toBe(created.version + 1)
      // 没传的字段一概不动，名册也还是原来那两个人。
      expect(updated.description).toBe("旧描述")
      expect(updated.captainMember).toBe(a.id)
      expect((yield* profiles.members(created.id)).map((member) => member.employeeID)).toEqual(
        rosterBefore.map((member) => member.employeeID),
      )

      // 空串的语义是「清空」：落库成 null，读回来就是没有描述。
      const cleared = (yield* profiles.update({ profileID: created.id, description: "" }))!
      expect(cleared.description).toBeUndefined()
    }),
  )

  it.effect("an empty patch changes nothing, including the version", () =>
    Effect.gen(function* () {
      const profiles = yield* ProfileService
      yield* profiles.seed()
      const [a] = yield* profiles.employees()
      const created = yield* profiles.create({ name: "空补丁", captain: a.id, members: [{ employeeID: a.id }] })
      const untouched = (yield* profiles.update({ profileID: created.id }))!
      // 「打开编辑框再保存」不该让版本无意义地漂。
      expect(untouched.version).toBe(created.version)
      expect(untouched.updatedAt).toBe(created.updatedAt)
      // 不存在的模板不新建一个来接住这次修改。
      expect(yield* profiles.update({ profileID: "prof_missing", name: "x" })).toBeUndefined()
    }),
  )

  it.effect("replacing the roster rewrites rows and moves the captain mark", () =>
    Effect.gen(function* () {
      const profiles = yield* ProfileService
      yield* profiles.seed()
      const [a, b, c] = yield* profiles.employees()
      const created = yield* profiles.create({
        name: "小组",
        captain: a.id,
        members: [{ employeeID: a.id }, { employeeID: b.id }],
      })

      const updated = (yield* profiles.update({
        profileID: created.id,
        captain: c.id,
        members: [{ employeeID: b.id, duty: "复核" }, { employeeID: c.id }],
      }))!
      expect(updated.captainMember).toBe(c.id)
      expect(updated.version).toBe(created.version + 1)

      const members = yield* profiles.members(created.id)
      // 整表替换：顺序即 order，a 已不在名册里。
      expect(members.map((member) => member.employeeID)).toEqual([b.id, c.id])
      expect(members.map((member) => member.order)).toEqual([0, 1])
      expect(members.find((member) => member.employeeID === c.id)!.role).toBe("captain")
      expect(members.filter((member) => member.role === "captain")).toHaveLength(1)
    }),
  )

  it.effect("swapping the captain without a new roster retags the existing rows", () =>
    Effect.gen(function* () {
      const profiles = yield* ProfileService
      yield* profiles.seed()
      const [a, b] = yield* profiles.employees()
      const created = yield* profiles.create({
        name: "换队长",
        captain: a.id,
        members: [{ employeeID: a.id }, { employeeID: b.id }],
      })
      const updated = (yield* profiles.update({ profileID: created.id, captain: b.id }))!
      expect(updated.captainMember).toBe(b.id)

      const members = yield* profiles.members(created.id)
      // 名册行必须跟着走：模板说谁是队长，role 就是谁，不能各说各话。
      expect(members.filter((member) => member.role === "captain").map((member) => member.employeeID)).toEqual([b.id])
    }),
  )

  it.effect("a running run keeps the roster it copied before the edit", () =>
    Effect.gen(function* () {
      const profiles = yield* ProfileService
      yield* profiles.seed()
      const [a, b] = yield* profiles.employees()
      const created = yield* profiles.create({
        name: "快照组",
        captain: a.id,
        members: [{ employeeID: a.id }, { employeeID: b.id }],
      })
      const snapshot = (yield* profiles.snapshot(created.id))!

      yield* profiles.update({
        profileID: created.id,
        name: "改名并换人",
        captain: a.id,
        members: [{ employeeID: a.id }],
      })

      // 快照是发起时的编制：模板改了，已经在跑的运行仍按当时的名册解释自己。
      expect(snapshot.version).toBe(created.version)
      expect(snapshot.roster.map((entry) => entry.employee.id)).toEqual([a.id, b.id])
      const next = (yield* profiles.snapshot(created.id))!
      expect(next.version).toBe(created.version + 1)
      expect(next.roster).toHaveLength(1)
    }),
  )
})
