import { Context, Effect, Layer } from "effect"
import { and, eq, lt } from "drizzle-orm"
import { Database } from "@/storage/db"
import type { SessionID } from "@/session/schema"
import { TeamRunOpTable } from "./run.sql"

/**
 * 工具操作日志：回答「这个工具到底执行了没有」。
 *
 * 恢复不能只到「任务做到哪一步」，必须到「最后一个工具调用有没有落地」。
 * 每次有副作用的调用在**执行前**写入（键为幂等键），执行后回填结果；
 * 进程崩溃留下的 `started` 记录在恢复时判为 `unknown`，
 * `unknown` 只能进人工/主智能体复核，**不能自动重试**（见设计文档 §8.5）。
 */

export type OpOutcome = "started" | "succeeded" | "failed" | "unknown"

export type Op = {
  id: string
  runID: string
  taskID?: string
  sessionID?: SessionID
  tool: string
  idempotencyKey: string
  startedAt: number
  finishedAt?: number
  outcome: OpOutcome
  effect?: Record<string, unknown>
  leaseEpoch?: number
}

export type BeginResult = {
  op: Op
  /**
   * 该幂等键此前已有记录：
   * - `succeeded` / `failed`：不需要再执行，直接沿用结果；
   * - `started`：同键调用仍在进行中，视为并发重复；
   * - `unknown`：上次执行结果不明，必须复核。
   */
  replayed: boolean
}

export interface Interface {
  readonly begin: (input: {
    runID: string
    taskID?: string
    sessionID?: SessionID
    tool: string
    idempotencyKey: string
    effect?: Record<string, unknown>
    leaseEpoch?: number
  }) => Effect.Effect<BeginResult>
  readonly finish: (input: {
    id: string
    outcome: Exclude<OpOutcome, "started">
    effect?: Record<string, unknown>
  }) => Effect.Effect<Op | undefined>
  /** 启动恢复：把超时仍停留在 `started` 的操作判为 `unknown`，返回条数。 */
  readonly markUnknown: (input: { runID?: string; olderThanMs: number }) => Effect.Effect<number>
  readonly get: (input: { runID: string; idempotencyKey: string }) => Effect.Effect<Op | undefined>
  readonly list: (runID: string) => Effect.Effect<Op[]>
  /** 需要复核的操作；主智能体在汇报前必须处理掉这些项。 */
  readonly needsReview: (runID: string) => Effect.Effect<Op[]>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/TeamOpLog") {}

const generateId = () => "op_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)

const toOp = (row: typeof TeamRunOpTable.$inferSelect): Op => ({
  id: row.id,
  runID: row.run_id,
  taskID: row.task_id ?? undefined,
  sessionID: row.session_id ?? undefined,
  tool: row.tool,
  idempotencyKey: row.idempotency_key,
  startedAt: row.started_at,
  finishedAt: row.finished_at ?? undefined,
  outcome: row.outcome as OpOutcome,
  effect: row.effect ?? undefined,
  leaseEpoch: row.lease_epoch ?? undefined,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const get: Interface["get"] = Effect.fn("TeamOpLog.get")(function* (input) {
      const row = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(TeamRunOpTable)
            .where(
              and(eq(TeamRunOpTable.run_id, input.runID), eq(TeamRunOpTable.idempotency_key, input.idempotencyKey)),
            )
            .all(),
        ),
      )
      return row[0] ? toOp(row[0]) : undefined
    })

    const list: Interface["list"] = Effect.fn("TeamOpLog.list")(function* (runID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(TeamRunOpTable)
            .where(eq(TeamRunOpTable.run_id, runID))
            .orderBy(TeamRunOpTable.started_at)
            .all(),
        ),
      )
      return rows.map(toOp)
    })

    const begin: Interface["begin"] = Effect.fn("TeamOpLog.begin")(function* (input) {
      // 幂等键唯一索引兜底：两个并发请求只有一个能插入成功，
      // 另一个读到已存在的记录并走 replay 分支。
      const result = yield* Effect.sync(() =>
        Database.transaction(
          (tx): BeginResult => {
            const existing = tx
              .select()
              .from(TeamRunOpTable)
              .where(
                and(eq(TeamRunOpTable.run_id, input.runID), eq(TeamRunOpTable.idempotency_key, input.idempotencyKey)),
              )
              .all()[0]
            if (existing) return { op: toOp(existing), replayed: true }
            const op: Op = {
              id: generateId(),
              runID: input.runID,
              taskID: input.taskID,
              sessionID: input.sessionID,
              tool: input.tool,
              idempotencyKey: input.idempotencyKey,
              startedAt: Date.now(),
              outcome: "started",
              effect: input.effect,
              leaseEpoch: input.leaseEpoch,
            }
            tx.insert(TeamRunOpTable)
              .values({
                id: op.id,
                run_id: op.runID,
                task_id: op.taskID ?? null,
                session_id: op.sessionID ?? null,
                tool: op.tool,
                idempotency_key: op.idempotencyKey,
                started_at: op.startedAt,
                outcome: op.outcome,
                effect: op.effect ?? null,
                lease_epoch: op.leaseEpoch ?? null,
              })
              .run()
            return { op, replayed: false }
          },
          { behavior: "immediate" },
        ),
      )
      return result
    })

    const finish: Interface["finish"] = Effect.fn("TeamOpLog.finish")(function* (input) {
      return yield* Effect.sync(() =>
        Database.transaction(
          (tx) => {
            const row = tx.select().from(TeamRunOpTable).where(eq(TeamRunOpTable.id, input.id)).all()[0]
            if (!row) return undefined
            // 只有仍处于 started 的记录才回填，避免延迟返回覆盖 already-unknown 的判定。
            if (row.outcome !== "started") return toOp(row)
            const finishedAt = Date.now()
            tx.update(TeamRunOpTable)
              .set({
                outcome: input.outcome,
                finished_at: finishedAt,
                effect: input.effect ?? row.effect,
              })
              .where(eq(TeamRunOpTable.id, input.id))
              .run()
            return {
              ...toOp(row),
              outcome: input.outcome,
              finishedAt,
              effect: input.effect ?? row.effect ?? undefined,
            }
          },
          { behavior: "immediate" },
        ),
      )
    })

    const markUnknown: Interface["markUnknown"] = Effect.fn("TeamOpLog.markUnknown")(function* (input) {
      const cutoff = Date.now() - input.olderThanMs
      const rows = yield* Effect.sync(() =>
        Database.transaction(
          (tx) => {
            const pending = tx
              .select()
              .from(TeamRunOpTable)
              .where(
                input.runID
                  ? and(
                      eq(TeamRunOpTable.run_id, input.runID),
                      eq(TeamRunOpTable.outcome, "started"),
                      lt(TeamRunOpTable.started_at, cutoff),
                    )
                  : and(eq(TeamRunOpTable.outcome, "started"), lt(TeamRunOpTable.started_at, cutoff)),
              )
              .all()
            for (const row of pending) {
              tx.update(TeamRunOpTable)
                .set({ outcome: "unknown", finished_at: cutoff })
                .where(eq(TeamRunOpTable.id, row.id))
                .run()
            }
            return pending
          },
          { behavior: "immediate" },
        ),
      )
      return rows.length
    })

    const needsReview: Interface["needsReview"] = Effect.fn("TeamOpLog.needsReview")(function* (runID) {
      const ops = yield* list(runID)
      return ops.filter((op) => op.outcome === "unknown" || op.outcome === "started")
    })

    return Service.of({ begin, finish, markUnknown, get, list, needsReview })
  }),
)

export const defaultLayer = layer
