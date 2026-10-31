import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Service as RunService, defaultLayer as RunLayer, canStart, type Interface as RunInterface } from "@/team/run"
import { Service as OpLogService, defaultLayer as OpLogLayer } from "@/team/op-log"
import { recover } from "@/team/recovery"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(RunLayer, OpLogLayer))

const sessionID = () => SessionID.make("ses_" + Math.random().toString(36).slice(2, 9))

/** 造一次「上一个进程跑到一半被杀」的运行：state = running，phase 还停着。 */
const interrupted = (runs: RunInterface, input?: { directory?: string }) =>
  Effect.gen(function* () {
    const run = yield* runs.create({
      sessionID: sessionID(),
      directory: input?.directory ?? "/tmp/run",
      mode: "team",
      goal: "重启前没跑完",
    })
    yield* runs.update({ runID: run.id, plan: { teams: [{ name: "alpha" }] }, planVersion: 1 })
    yield* runs.update({ runID: run.id, state: "running", phase: "executing" })
    const team = yield* runs.addTeam({ runID: run.id })
    yield* runs.updateTeam({ id: team.id, phase: "executing" })
    return { run, team }
  })

describe("team recovery", () => {
  it.effect("pauses an interrupted run instead of leaving it running forever", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const { run, team } = yield* interrupted(runs)

      // since 取未来：模拟「这条记录是上一个进程留下的」。
      const result = yield* recover({ since: Date.now() + 1_000 })
      expect(result.paused.map((item) => item.runID)).toContain(run.id)
      expect(result.needsReview).toEqual([])

      const after = yield* runs.get(run.id)
      expect(after?.state).toBe("paused")
      expect(after?.phase).toBeUndefined()
      // 暂停的运行必须能续跑，否则「恢复」只是换了个说法卡住。
      expect(canStart(after!.state, after!.phase)).toBe(true)
      // 未完成的团队回到可派发的排队状态；已交付的事实不该被抹掉。
      expect((yield* runs.teams(run.id))[0].phase).toBe("queued")
      expect((yield* runs.teams(run.id))[0].id).toBe(team.id)

      const events = yield* runs.events({ runID: run.id })
      const recoveredEvent = events.find((event) => event.kind === "run.recovered")
      expect(recoveredEvent?.payload?.state).toBe("paused")
      expect(recoveredEvent?.payload?.unknownOps).toBe(0)
    }),
  )

  it.effect("sends a run with unknown tool effects to needs_review instead of resuming it", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const ops = yield* OpLogService
      const { run } = yield* interrupted(runs)

      // 工具已经开始但没写回结果：我们不知道它到底执行了没有（§8.5 表）。
      yield* ops.begin({ runID: run.id, tool: "bash", idempotencyKey: "k1" })

      const result = yield* recover({ since: Date.now() + 1_000 })
      expect(result.needsReview.map((item) => item.runID)).toContain(run.id)
      expect(result.needsReview[0].unknownOps).toBe(1)

      const after = yield* runs.get(run.id)
      // 不自动续跑：先让人核对副作用。
      expect(after?.state).toBe("needs_review")
      expect(after?.terminalReason).toBe("restarted-needs-review")
      expect(after?.error).toContain("结果不明")
      const review = yield* ops.needsReview(run.id)
      expect(review.map((op) => op.outcome)).toEqual(["unknown"])
    }),
  )

  it.effect("leaves runs that this process is still driving alone", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const { run } = yield* interrupted(runs)

      // since 取过去：这条运行的时间戳比它新，说明有进程正在写它。
      const result = yield* recover({ since: Date.now() - 60_000 })
      expect(result.paused).toEqual([])
      expect((yield* runs.get(run.id))?.state).toBe("running")
      expect((yield* runs.get(run.id))?.phase).toBe("executing")
    }),
  )

  it.effect("only recovers runs in the directory it was asked about", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const mine = yield* interrupted(runs, { directory: "/tmp/project-a" })
      const other = yield* interrupted(runs, { directory: "/tmp/project-b" })

      const result = yield* recover({ since: Date.now() + 1_000, directory: "/tmp/project-a" })
      expect(result.paused.map((item) => item.runID)).toEqual([mine.run.id])
      expect((yield* runs.get(other.run.id))?.state).toBe("running")
    }),
  )

  it.effect("keeps teams that already ended as they are", () =>
    Effect.gen(function* () {
      const runs = yield* RunService
      const { run } = yield* interrupted(runs)
      const done = yield* runs.addTeam({ runID: run.id })
      yield* runs.updateTeam({ id: done.id, phase: "delivered" })

      yield* recover({ since: Date.now() + 1_000 })
      const phases = (yield* runs.teams(run.id)).map((team) => team.phase).sort()
      // 已交付是事实：恢复只把「还在跑」的团队退回排队。
      expect(phases).toEqual(["delivered", "queued"])
    }),
  )
})
