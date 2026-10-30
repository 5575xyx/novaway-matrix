import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Service as MissionService, defaultLayer as MissionLayer } from "@/team/mission"
import { Service as RunService, defaultLayer as RunLayer } from "@/team/run"
import { attachMission, prepareWorktree } from "@/team/setup"
import { SessionID } from "@/session/schema"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(MissionLayer, RunLayer))

describe("run setup", () => {
  it.instance(
    "attaching a mission prepares its workspace and refuses a second live run",
    () =>
      Effect.gen(function* () {
        const missions = yield* MissionService
        const runs = yield* RunService
        const instance = yield* TestInstance
        const mission = yield* missions.create({ directory: instance.directory, goal: "跨运行的目标" })

        const attached = yield* attachMission(
          { missions, runs },
          { missionID: mission.id, directory: instance.directory },
        )
        expect(attached.kind).toBe("ready")
        if (attached.kind !== "ready") return
        expect(attached.worktree).toBeTruthy()
        // 挂载就是准备：目标工作区在这里建好，起点不漂移。
        expect(attached.mission.worktree).toBe(attached.worktree)
        expect(attached.mission.baseSHA).toBe(mission.baseSHA)

        // 同一目标上开第二个运行会抢同一份工作区与分支：拒绝，并说明为什么。
        const busy = yield* runs.create({
          sessionID: SessionID.make("ses_busy"),
          directory: instance.directory,
          missionID: mission.id,
          mode: "team",
          goal: "第二个运行",
        })
        expect(busy.state).toBe("planning")
        const refused = yield* attachMission(
          { missions, runs },
          { missionID: mission.id, directory: instance.directory },
        )
        expect(refused.kind === "refused" && refused.reason).toContain("未结束")
      }),
    { git: true },
  )

  it.instance("a finished mission is not silently reused", () =>
    Effect.gen(function* () {
      const missions = yield* MissionService
      const runs = yield* RunService
      const instance = yield* TestInstance
      const mission = yield* missions.create({ directory: instance.directory, goal: "已结束" })
      yield* missions.setStatus({ missionID: mission.id, status: "done" })

      const attached = yield* attachMission(
        { missions, runs },
        { missionID: mission.id, directory: instance.directory },
      )
      expect(attached.kind).toBe("refused")
      expect(attached.kind === "refused" && attached.reason).toContain("已结束")

      // 目录不符同样拒绝：别的项目的目标不能被「借」来用。
      const elsewhere = yield* attachMission(
        { missions, runs },
        { missionID: mission.id, directory: instance.directory + "-other" },
      )
      expect(elsewhere.kind === "refused" && elsewhere.reason).toContain("另一个目录")

      const missing = yield* attachMission(
        { missions, runs },
        { missionID: "mis_missing", directory: instance.directory },
      )
      expect(missing.kind === "refused" && missing.reason).toContain("不存在")
    }),
  )

  it.instance(
    "the worktree step records why isolation did not happen",
    () =>
      Effect.gen(function* () {
        const runs = yield* RunService
        const instance = yield* TestInstance
        const run = yield* runs.create({
          sessionID: SessionID.make("ses_setup"),
          directory: instance.directory,
          mode: "team",
          goal: "隔离",
        })

        const created = yield* prepareWorktree({ runs }, { runID: run.id, base: instance.directory, name: "alpha" })
        expect(created.kind).toBe("created")
        const events = yield* runs.events({ runID: run.id })
        const event = events.find((item) => item.kind === "worktree.created")
        expect(event?.payload).toMatchObject({
          directory: created.kind === "created" ? created.worktree.directory : "",
          branch: created.kind === "created" ? created.worktree.branch : "",
        })
      }),
    { git: true },
  )

  it.instance("a non-git directory yields a recorded skip, not a silent fallback", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const instance = yield* TestInstance
      const run = yield* runs.create({
        sessionID: SessionID.make("ses_setup"),
        directory: instance.directory,
        mode: "team",
        goal: "没有仓库",
      })

      const skipped = yield* prepareWorktree({ runs }, { runID: run.id, base: instance.directory, name: "alpha" })
      expect(skipped.kind).toBe("skipped")
      const events = yield* runs.events({ runID: run.id })
      const event = events.find((item) => item.kind === "worktree.skipped")
      expect(event?.payload?.reason).toBeTruthy()
    }),
  )
})
