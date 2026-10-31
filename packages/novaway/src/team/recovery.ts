import { and, eq, lt } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@/storage/db"
import { TeamRunTable } from "./run.sql"
import { Service as RunService } from "./run"
import { Service as OpLogService } from "./op-log"

/**
 * 重启恢复（§8.1 `paused` / §8.5 / G3）。
 *
 * 进程被杀时，内存里的编排循环一起没了，但库里的运行还停在 `running`，团队还停在
 * `executing`。此前这两件事都没有人处理：
 *
 * - 运行既不能继续（`canStart` 看到过期的 `phase` 就拒绝），也不在终态，看板上永远「正在跑」；
 * - 工具操作停在 `started`，`needs_review` 永远是空 —— 「这个工具到底执行了没有」没有人回答。
 *
 * 这一刀只做进程重启后**必须**做的事，不做重跑：
 *
 * 1. **只认上一个进程留下的运行。** 判据是 `time_updated < since`（`since` 是本进程的启动时间）。
 *    本轮进程里正在跑的运行一定会被持续写时间，所以不会被误判成「遗留」。
 * 2. **在途操作一律标 `unknown`。** 中止就是中止，不能假设它没执行过（§8.5 表）。
 * 3. **有未知操作 → `needs_review`，没有 → `paused`。** 后者等人点「继续」，前者要求人先核对
 *    副作用；两种都不自动重跑。
 * 4. **未完成的团队回到 `queued`。** 已交付 / 失败 / 超限 / 已取消的团队保持原状 —— 那是事实，
 *    恢复不该把它们抹掉。
 * 5. **不改账本、不结算。** 重启时我们还不知道在途调用花了多少，编一个数会把「用量不明」变成谎言。
 *    账本条目留在 `reserved`，续跑时的额度判断因此仍然保守。
 */

export type RecoveredRun = { runID: string; unknownOps: number }

export type Recovery = {
  /** 没有未知操作：等用户点「继续」。 */
  paused: RecoveredRun[]
  /** 有未知操作：先核对副作用，再决定继续或收尾。 */
  needsReview: RecoveredRun[]
}

/** 进程启动时刻：只恢复在这之前就没有更新的运行。 */
export const PROCESS_START = Date.now()

/** 团队阶段里「已经结束、恢复不该改」的那部分。 */
const SETTLED_PHASES = new Set(["delivered", "failed", "exceeded", "cancelled"])

export const recover = (input: { since?: number; directory?: string }) =>
  Effect.gen(function* () {
    const runs = yield* RunService
    const ops = yield* OpLogService
    const since = input.since ?? PROCESS_START

    const stale = yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .select()
          .from(TeamRunTable)
          .where(
            // 只有「还在跑」的运行需要处理：终态不碰，未开始的也没被中断过。
            input.directory
              ? and(
                  eq(TeamRunTable.state, "running"),
                  eq(TeamRunTable.directory, input.directory),
                  lt(TeamRunTable.time_updated, since),
                )
              : and(eq(TeamRunTable.state, "running"), lt(TeamRunTable.time_updated, since)),
          )
          .all(),
      ),
    )

    const recovery: Recovery = { paused: [], needsReview: [] }
    for (const row of stale) {
      // 在途操作先定性：标 unknown 之后 `needsReview` 才看得到它们。
      const unknownOps = yield* ops.markUnknown({ runID: row.id, olderThanMs: 0 })
      for (const team of yield* runs.teams(row.id)) {
        if (SETTLED_PHASES.has(team.phase)) continue
        yield* runs.updateTeam({ id: team.id, phase: "queued" })
      }
      const state = unknownOps > 0 ? "needs_review" : "paused"
      yield* runs.update({
        runID: row.id,
        state,
        phase: null,
        terminalReason: unknownOps > 0 ? "restarted-needs-review" : "restarted",
        error: unknownOps > 0 ? "进程重启：有 " + unknownOps + " 项工具操作结果不明，请先核对副作用" : null,
      })
      yield* runs.appendEvent({
        runID: row.id,
        kind: "run.recovered",
        payload: { state, unknownOps, from: row.state, phase: row.phase ?? undefined },
      })
      const entry = { runID: row.id, unknownOps }
      if (state === "needs_review") recovery.needsReview.push(entry)
      else recovery.paused.push(entry)
    }
    return recovery
  })
