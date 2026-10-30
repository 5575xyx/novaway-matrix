import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import fs from "node:fs/promises"
import { Service as MissionService, defaultLayer as MissionLayer } from "@/team/mission"
import { commit } from "@/team/worktree"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(MissionLayer)

describe("team mission", () => {
  it.instance("numbers are allocated monotonically per workspace and never reused", () =>
    Effect.gen(function* () {
      const missions = yield* MissionService
      const instance = yield* TestInstance
      const first = yield* missions.create({ directory: instance.directory, goal: "把下载流程改好" })
      const second = yield* missions.create({ directory: instance.directory, goal: "补上回归测试" })
      // 编号是全局的：换一个仓库也不会冒出第二个 `M-001`。
      const other = yield* missions.create({ directory: instance.directory + "-other", goal: "另一个目标" })
      expect(first.number).toBe(1)
      expect(second.number).toBe(2)
      expect(other.number).toBe(3)
      // 删除/停用之后号码不复用：历史记录始终指得回去。
      yield* missions.setStatus({ missionID: second.id, status: "abandoned" })
      const third = yield* missions.create({ directory: instance.directory, goal: "第三个目标" })
      expect(third.number).toBe(4)
    }),
  )

  it.instance("status is independent of any run", () =>
    Effect.gen(function* () {
      const missions = yield* MissionService
      const instance = yield* TestInstance
      const mission = yield* missions.create({ directory: instance.directory, goal: "长期目标" })
      expect(mission.status).toBe("active")
      const updated = yield* missions.setStatus({ missionID: mission.id, status: "done" })
      expect(updated?.status).toBe("done")
      expect((yield* missions.get(mission.id))?.status).toBe("done")
      expect(yield* missions.setStatus({ missionID: "mis_missing", status: "done" })).toBeUndefined()
    }),
  )

  it.instance(
    "prepares one worktree, reuses it, and rebuilds at the same base commit",
    () =>
      Effect.gen(function* () {
        const missions = yield* MissionService
        const instance = yield* TestInstance
        const mission = yield* missions.create({ directory: instance.directory, goal: "跨运行的工作区" })
        expect(mission.baseSHA).toBeTruthy()

        const first = yield* missions.prepare(mission.id)
        expect(first.kind).toBe("ready")
        if (first.kind !== "ready") return
        expect(first.mission.worktree).toBeTruthy()
        expect(first.mission.branch).toMatch(/^novaway\/mission\//)
        // 起点冻结：每次准备都用同一个 baseSHA，而不是「现在的 HEAD」。
        expect(first.mission.baseSHA).toBe(mission.baseSHA)

        const again = yield* missions.prepare(mission.id)
        expect(again.kind === "ready" && again.mission.worktree).toBe(first.mission.worktree)
      }),
    { git: true },
  )

  it.instance(
    "reports the cumulative diff from the base commit to the current content",
    () =>
      Effect.gen(function* () {
        const missions = yield* MissionService
        const instance = yield* TestInstance
        // 起点里先有一个文件，目标才谈得上「累计差异」。
        yield* Effect.promise(() => fs.writeFile(path.join(instance.directory, "tracked.txt"), "base\n"))
        yield* Effect.promise(() => commit({ directory: instance.directory, message: "seed" }))

        const mission = yield* missions.create({ directory: instance.directory, goal: "累计差异" })
        const prepared = yield* missions.prepare(mission.id)
        if (prepared.kind !== "ready" || !prepared.mission.worktree) throw new Error("workspace missing")
        const worktree = prepared.mission.worktree

        yield* Effect.promise(() => fs.writeFile(path.join(worktree, "tracked.txt"), "changed\n"))
        const committed = yield* Effect.promise(() => commit({ directory: worktree, message: "tracked" }))
        // 提交之后再放一个新文件：它还没有被任何提交收录。
        yield* Effect.promise(() => fs.writeFile(path.join(worktree, "loose.txt"), "not committed\n"))

        if (committed.kind !== "committed") throw new Error("提交失败：" + committed.kind)
        const committedSHA = committed.sha
        const baseSHA = mission.baseSHA
        if (!baseSHA) throw new Error("目标缺少起点提交")
        const result = yield* missions.diff(mission.id)
        expect(result?.kind).toBe("diff")
        if (result?.kind !== "diff") return
        expect(result.diff.baseSHA).toBe(baseSHA)
        expect(committedSHA).toBe(result.diff.head)
        // 已纳入版本的改动进 files；未跟踪新文件单列，不混进改动统计。
        expect(result.diff.files.map((file) => file.path)).toContain("tracked.txt")
        expect(result.diff.untracked).toContain("loose.txt")
        expect(result.diff.files.map((file) => file.path)).not.toContain("loose.txt")
      }),
    { git: true },
  )

  it.instance("a mission outside a repository cannot pretend to have a workspace", () =>
    Effect.gen(function* () {
      const missions = yield* MissionService
      const instance = yield* TestInstance
      const mission = yield* missions.create({ directory: instance.directory, goal: "没有仓库" })
      const prepared = yield* missions.prepare(mission.id)
      // 没有固定起点就没有累计差异：返回原因，不降级成「在目录里跑」。
      expect(prepared.kind).toBe("skipped")
      expect(prepared.kind === "skipped" && prepared.reason.length > 0).toBe(true)
    }),
  )
})
