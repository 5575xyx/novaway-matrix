import { Context, Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import { and, eq, lt } from "drizzle-orm"
import { Database } from "@/storage/db"
import type { SessionID } from "@/session/schema"
import { TeamRunOpTable } from "./run.sql"
import { InstanceState } from "@/effect/instance-state"

/**
 * 工具操作日志：回答「这个工具到底执行了没有」。
 *
 * 恢复不能只到「任务做到哪一步」，必须到「最后一个工具调用有没有落地」。
 * 每次有副作用的调用在**执行前**写入（键为幂等键），执行后回填结果；
 * 进程崩溃留下的 `started` 记录在恢复时判为 `unknown`，
 * `unknown` 只能进人工/主智能体复核，**不能自动重试**（见设计文档 §8.5）。
 */

/** 工具调用归属的编排坐标：决定哪些调用「算同一次」。 */
export type Scope = {
  runID: string
  taskID?: string
  attempt?: number
  /**
   * 本次运行的策略（只读 / 可写），随坐标一起登记。
   *
   * 放在这里而不是每次执行都查库：工具漏斗是热路径，而策略在一次运行内不会变
   * （改策略等于改计划，得重新批准、重新登记）。缺失按只读处理。
   */
  readOnly?: boolean
}

/**
 * 幂等键：`run_id + task_id + attempt + tool + 参数哈希`（设计文档 §8.5）。
 *
 * 参数先做稳定序列化（键排序）再哈希：同一份参数即使键顺序不同，也必须落在
 * 同一个键上，否则「重放」会退化成「重跑」。
 */
export function idempotencyKey(input: { scope: Scope; tool: string; args: unknown }) {
  const digest = createHash("sha256").update(stable(input.args)).digest("hex").slice(0, 16)
  return [input.scope.runID, input.scope.taskID ?? "-", input.scope.attempt ?? 0, input.tool, digest].join(":")
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]"
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return "{" + entries.map(([key, item]) => JSON.stringify(key) + ":" + stable(item)).join(",") + "}"
}

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
  /**
   * 登记「这个子会话属于哪次运行/哪个任务」。
   *
   * 工具漏斗只知道会话，不知道编排坐标；派发方在创建子会话时登记一次，
   * 之后该会话里所有有副作用的工具调用都会自动带上幂等键。
   * 这是进程内的映射：重启后旧会话本来也不会复用，保护靠 `markUnknown` +
   * `needsReview`（未知项阻止 `done`），不靠这份内存表。
   */
  readonly scope: (input: { sessionID: SessionID } & Scope) => Effect.Effect<void>
  readonly unscope: (sessionID: SessionID) => Effect.Effect<void>
  readonly scopeOf: (sessionID: SessionID) => Effect.Effect<Scope | undefined>
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
    type State = { scopes: Map<SessionID, Scope> }
    const state = yield* InstanceState.make<State>(() => Effect.succeed({ scopes: new Map() }))

    const scope: Interface["scope"] = Effect.fn("TeamOpLog.scope")(function* (input) {
      const scopes = (yield* InstanceState.get(state)).scopes
      scopes.set(input.sessionID, {
        runID: input.runID,
        ...(input.taskID ? { taskID: input.taskID } : {}),
        ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
        ...(input.readOnly !== undefined ? { readOnly: input.readOnly } : {}),
      })
    })

    const unscope: Interface["unscope"] = Effect.fn("TeamOpLog.unscope")(function* (sessionID) {
      ;(yield* InstanceState.get(state)).scopes.delete(sessionID)
    })

    const scopeOf: Interface["scopeOf"] = Effect.fn("TeamOpLog.scopeOf")(function* (sessionID) {
      return (yield* InstanceState.get(state)).scopes.get(sessionID)
    })

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

    return Service.of({ begin, finish, markUnknown, get, list, needsReview, scope, unscope, scopeOf })
  }),
)

export const defaultLayer = layer
