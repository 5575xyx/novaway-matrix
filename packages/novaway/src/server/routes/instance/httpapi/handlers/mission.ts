import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Service as MissionService, type Mission } from "@/team/mission"
import { Service as RunService } from "@/team/run"

const pad = (number: number) => "M-" + String(number).padStart(3, "0")

/**
 * Mission 接口。
 *
 * 这里只做「记录目标」与「改状态」。工作区在第一次运行时才准备（`run` 接口负责），
 * 因为「准备」意味着在用户的仓库里建分支，不该在建目标这一下就发生。
 */
export const missionHandlers = HttpApiBuilder.group(InstanceHttpApi, "mission", (handlers) =>
  Effect.gen(function* () {
    const missions = yield* MissionService
    const runs = yield* RunService

    const view = (mission: Mission) =>
      Effect.gen(function* () {
        const related = yield* runs.list({ missionID: mission.id })
        return {
          id: mission.id,
          number: mission.number,
          label: pad(mission.number),
          directory: mission.directory,
          goal: mission.goal,
          status: mission.status,
          baseSHA: mission.baseSHA,
          worktree: mission.worktree,
          branch: mission.branch,
          runCount: related.length,
          createdAt: mission.createdAt,
          updatedAt: mission.updatedAt,
        }
      })

    return handlers
      .handle("listMissions", (ctx) =>
        Effect.gen(function* () {
          const list = yield* missions.list({ directory: ctx.query.directory })
          return yield* Effect.forEach(list, view, { concurrency: 1 })
        }),
      )
      .handle("missionDetail", (ctx) =>
        Effect.gen(function* () {
          const mission = yield* missions.get(ctx.params.missionID)
          if (!mission) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return yield* view(mission)
        }),
      )
      .handle("missionDiff", (ctx) =>
        Effect.gen(function* () {
          const result = yield* missions.diff(ctx.params.missionID)
          if (!result) return yield* Effect.fail(new HttpApiError.NotFound({}))
          if (result.kind === "skipped")
            return { files: [], untracked: [], truncated: false, skippedReason: result.reason }
          return {
            baseSHA: result.diff.baseSHA,
            head: result.diff.head,
            files: result.diff.files,
            untracked: result.diff.untracked,
            truncated: result.diff.truncated,
          }
        }),
      )
      .handle("createMission", (ctx) =>
        Effect.gen(function* () {
          if (!ctx.payload.goal.trim()) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const mission = yield* missions.create({
            directory: ctx.payload.directory,
            goal: ctx.payload.goal.trim(),
          })
          return yield* view(mission)
        }),
      )
      .handle("updateMission", (ctx) =>
        Effect.gen(function* () {
          const updated = yield* missions.setStatus({
            missionID: ctx.params.missionID,
            status: ctx.payload.status,
          })
          if (!updated) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return yield* view(updated)
        }),
      )
  }),
)
