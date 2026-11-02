import { Context, Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import { and, eq, lte } from "drizzle-orm"
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
  /**
   * 这次团队声明的任务范围（§11.1）：相对 `root` 的路径前缀。
   *
   * 与策略一起登记，理由相同：一次运行内范围不会变（改范围等于改计划），
   * 而工具漏斗是热路径。空表示不限 —— 只有写操作会被它拦。
   */
  paths?: readonly string[]
  /** 相对路径的基准目录（团队 worktree；没有 worktree 时是运行目录）。 */
  root?: string
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

/**
 * 工具写锁的钥匙（§10.1「团队内单写者」）。
 *
 * 同一队的成员是两个会话、共用一个 worktree：按会话加锁等于没锁 ——
 * 两人各自持有一把「独占」锁，同时改同一个文件。所以运行内按**团队坐标**加锁，
 * 运行外才退回会话（那边的写本来就只影响自己）。
 *
 * 没有团队坐标的会话（比如队长的临时助手）与队长共用本队的钥匙：它写的是同一份工作区。
 */
export function lockKey(scope: Scope | undefined, sessionID: string): string {
  if (!scope) return "session:" + sessionID
  return "run:" + scope.runID + ":task:" + (scope.taskID ?? "-")
}

/**
 * 操作结果。
 *
 * `unknown` 是「执行了没有」本身不知道；`abandoned` 是人复核之后给出的结论：
 * 这次调用**没有落地**，同一个键可以重新执行。两者都不参与自动重试 ——
 * 区别只在于「谁来定这个性」：前者等复核，后者已经有人定了。
 */
export type OpOutcome = "started" | "succeeded" | "failed" | "unknown" | "abandoned"

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
   * - `unknown`：上次执行结果不明，必须复核；
   * - `abandoned`：复核确认没有落地，重置为 `started` 后**重新执行**（这里回 `false`）。
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
    outcome: Exclude<OpOutcome, "started" | "abandoned">
    effect?: Record<string, unknown>
  }) => Effect.Effect<Op | undefined>
  /** 启动恢复：把超时仍停留在 `started` 的操作判为 `unknown`，返回条数。 */
  readonly markUnknown: (input: { runID?: string; olderThanMs: number }) => Effect.Effect<number>
  readonly get: (input: { runID: string; idempotencyKey: string }) => Effect.Effect<Op | undefined>
  readonly list: (runID: string) => Effect.Effect<Op[]>
  /** 需要复核的操作；主智能体在汇报前必须处理掉这些项。 */
  readonly needsReview: (runID: string) => Effect.Effect<Op[]>
  /**
   * 人工复核：给一条「结果不明」的操作定性。
   *
   * - `succeeded`：调用确实落地了 —— 同键重放会被跳过，不会重复执行；
   * - `abandoned`：调用没有落地 —— 同键的下一次调用可以真的执行。
   *
   * 只能复核 `started` / `unknown` 的记录：已经有结论的事实不能被改写。
   * 返回 `undefined` 表示这条记录不属于该运行（或不存在）。
   */
  readonly review: (input: {
    runID: string
    id: string
    verdict: "succeeded" | "abandoned"
  }) => Effect.Effect<Op | undefined>
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
        ...(input.paths?.length ? { paths: [...input.paths] } : {}),
        ...(input.root ? { root: input.root } : {}),
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
            if (existing) {
              if (existing.outcome === "abandoned") {
                // 复核确认上一次没有落地：同一个键可以重新执行。
                // 重置为 `started` 而不是删记录 —— 这次执行途中再崩溃，恢复仍然会把它
                // 判成 `unknown`，而不是因为「有过一条记录」就假装知道结果。
                const startedAt = Date.now()
                tx.update(TeamRunOpTable)
                  .set({
                    outcome: "started",
                    started_at: startedAt,
                    finished_at: null,
                    session_id: input.sessionID ?? null,
                    effect: input.effect ?? null,
                    lease_epoch: input.leaseEpoch ?? null,
                  })
                  .where(eq(TeamRunOpTable.id, existing.id))
                  .run()
                return {
                  op: {
                    ...toOp(existing),
                    outcome: "started",
                    startedAt,
                    finishedAt: undefined,
                    sessionID: input.sessionID,
                    effect: input.effect,
                    leaseEpoch: input.leaseEpoch,
                  },
                  replayed: false,
                }
              }
              return { op: toOp(existing), replayed: true }
            }
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

    /**
     * 把仍在 `started` 的操作标成 `unknown`。
     *
     * 判据是「开始时间 **不晚于** cutoff」：恢复调用常用 `olderThanMs: 0`，
     * 而「刚刚才开始」正是最需要定性的那一类 —— 用严格小于会把与恢复同一毫秒
     * 开始的操作漏掉，随后被当成「没执行过」，而这恰恰是不能假设的事（§8.5）。
     */
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
                      lte(TeamRunOpTable.started_at, cutoff),
                    )
                  : and(eq(TeamRunOpTable.outcome, "started"), lte(TeamRunOpTable.started_at, cutoff)),
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

    const review: Interface["review"] = Effect.fn("TeamOpLog.review")(function* (input) {
      return yield* Effect.sync(() =>
        Database.transaction(
          (tx): Op | undefined => {
            const row = tx
              .select()
              .from(TeamRunOpTable)
              .where(and(eq(TeamRunOpTable.id, input.id), eq(TeamRunOpTable.run_id, input.runID)))
              .all()[0]
            if (!row) return undefined
            // 只有「还没定性」的记录能复核：已经成功/失败的事实不能被这次复核改写。
            if (row.outcome !== "unknown" && row.outcome !== "started") return toOp(row)
            const finishedAt = Date.now()
            tx.update(TeamRunOpTable)
              .set({ outcome: input.verdict, finished_at: finishedAt })
              .where(eq(TeamRunOpTable.id, row.id))
              .run()
            return { ...toOp(row), outcome: input.verdict, finishedAt }
          },
          { behavior: "immediate" },
        ),
      )
    })

    return Service.of({ begin, finish, markUnknown, get, list, needsReview, review, scope, unscope, scopeOf })
  }),
)

export const defaultLayer = layer
