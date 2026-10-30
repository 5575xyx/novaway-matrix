import { Effect } from "effect"
import type { Interface as MissionInterface, Mission } from "./mission"
import { isTerminal, type Interface as RunInterface } from "./run"
import { create as createTeamWorktree, remove as removeWorktree, type Created, type Skipped } from "./worktree"

/**
 * 运行的前置准备（§3.2 / §10.1）。
 *
 * 这两步在「界面发起」与「会话里 `team_run` 发起」两条路径上完全一样，所以放在这里
 * 而不是各自抄一遍：目标校验少一条、worktree 少建一次，产出的运行就可能一边隔离、
 * 一边直接在用户目录里写 —— 同一个功能出现两种安全性，是最难排查的那类差异。
 */

export type Attached = { kind: "ready"; mission: Mission; worktree?: string } | { kind: "refused"; reason: string }

/**
 * 把运行挂到一个持久目标上，并准备好它的工作区。
 *
 * 四种拒绝都要给出原因：目标不存在、目录不符（跨项目「借用」目标）、目标已结束、
 * 目标上已有未结束的运行（两个运行会抢同一份 worktree 与同一个分支）。
 * 拒绝就不挂载 —— 不降级成「不带目标的一次性运行」，否则用户以为在做 M-003，
 * 实际做的是一次孤立的运行。
 */
export function attachMission(
  deps: { missions: MissionInterface; runs: RunInterface },
  input: { missionID: string; directory: string },
): Effect.Effect<Attached> {
  return Effect.gen(function* () {
    const mission = yield* deps.missions.get(input.missionID)
    if (!mission) return { kind: "refused", reason: "目标不存在：" + input.missionID } satisfies Attached
    if (mission.directory !== input.directory)
      return { kind: "refused", reason: "目标属于另一个目录：" + mission.directory } satisfies Attached
    if (mission.status !== "active")
      return { kind: "refused", reason: "目标已结束（" + mission.status + "）" } satisfies Attached
    const busy = (yield* deps.runs.list({ missionID: mission.id })).some((run) => !isTerminal(run.state))
    if (busy) return { kind: "refused", reason: "该目标已有未结束的运行" } satisfies Attached

    const prepared = yield* deps.missions.prepare(mission.id)
    if (prepared.kind === "skipped") return { kind: "refused", reason: prepared.reason } satisfies Attached
    return { kind: "ready", mission: prepared.mission, worktree: prepared.mission.worktree } satisfies Attached
  })
}

export type Cleaned = { kind: "removed" } | { kind: "nothing" } | { kind: "refused"; reason: string }

/**
 * 清理已放弃目标的工作区（§3.2）。
 *
 * 只有用户明确放弃的目标才能清：`active` 的目标随时可能有下一次运行要从这份工作区接着做，
 * `done` 的目标还要靠它回答「总共改了什么」。还有未结束的运行在用它时同样拒绝 ——
 * 删掉正在被写的目录不是清理，是事故。
 *
 * 删除失败（目录已被外部删掉之类）也返回原因，调用方决定怎么提示；
 * 不假装删成功，也不因此把目标记录弄丢。
 */
export function cleanupMission(
  deps: { missions: MissionInterface; runs: RunInterface },
  missionID: string,
): Effect.Effect<Cleaned> {
  return Effect.gen(function* () {
    const mission = yield* deps.missions.get(missionID)
    if (!mission) return { kind: "refused", reason: "目标不存在：" + missionID } satisfies Cleaned
    if (mission.status !== "abandoned")
      return {
        kind: "refused",
        reason: "只有已放弃的目标才清理工作区（当前：" + mission.status + "）",
      } satisfies Cleaned
    const busy = (yield* deps.runs.list({ missionID })).some((run) => !isTerminal(run.state))
    if (busy) return { kind: "refused", reason: "该目标还有未结束的运行" } satisfies Cleaned
    const worktree = mission.worktree
    if (!worktree) return { kind: "nothing" } satisfies Cleaned

    const removed = yield* Effect.promise(() =>
      removeWorktree({ base: mission.directory, directory: worktree, branch: mission.branch }),
    )
    if (!removed.ok) return { kind: "refused", reason: removed.error || "删除工作区失败" } satisfies Cleaned
    // 记录必须跟着目录一起消失：留着一个不存在的路径会让界面显示假的工作区。
    yield* deps.missions.forget(mission.id)
    return { kind: "removed" } satisfies Cleaned
  })
}

/**
 * 建团队 worktree 并记事件。
 *
 * 建不出来（不是 git 仓库、空仓库、git 不可用）**不阻塞运行**：返回原因并写
 * `worktree.skipped`，调用方在用户目录里跑。静默降级才是错的 —— 事件里必须能查到
 * 「这次为什么没有隔离」。
 */
export function prepareWorktree(
  deps: { runs: RunInterface },
  input: { runID: string; base: string; name: string },
): Effect.Effect<Created | Skipped> {
  return Effect.gen(function* () {
    const created = yield* Effect.promise(() => createTeamWorktree(input))
    if (created.kind === "created") {
      yield* deps.runs.appendEvent({
        runID: input.runID,
        kind: "worktree.created",
        payload: {
          directory: created.worktree.directory,
          branch: created.worktree.branch,
          baseSHA: created.worktree.baseSHA,
        },
      })
    } else {
      yield* deps.runs.appendEvent({
        runID: input.runID,
        kind: "worktree.skipped",
        payload: { reason: created.reason },
      })
    }
    return created
  })
}
