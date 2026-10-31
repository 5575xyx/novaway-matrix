import { Context, Effect, Layer, Schema } from "effect"
import { and, eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { TeamRunLedgerTable } from "./run.sql"

/**
 * 预算账本：预占 + 结算。
 *
 * 为什么不能只用「已用」计数：一次模型调用在发起时还不知道实际消耗，
 * 如果只在实际返回后才累加，多个成员的并发调用会同时通过额度检查，
 * 一起超支。所以调用前先 `reserve()`，返回后 `settle()` 用实际值替换预占。
 * 额度判断看的是 `reserved + settled` 的总和（见设计文档 §7.1）。
 */

/**
 * `unknown` 表示调用已经发生、但提供方没有给出可信用量。
 * 这种条目按预占额计入承诺（避免超支），但**不计入已结算**，
 * 因为它不是"实际花了多少"，只是一个上界（见设计文档 §7.1）。
 */
export type LedgerState = "reserved" | "settled" | "released" | "overrun" | "unknown"

/**
 * 这笔钱花在哪（§12「验证开销占比」）。
 *
 * 派发与验证都记在团队这个 actor 上 —— 归属是对的（验证是「这支队交付是否成立」的成本），
 * 但只按 actor 汇总，就把两笔完全不同的开销混成了一个数。分开记之后，
 * 才能回答「这次运行里有多少钱花在验证上」，而不是编一个比例。
 */
export type EntryKind = "dispatch" | "verification"

const KINDS: readonly EntryKind[] = ["dispatch", "verification"]

/** 老账本没有这一列：读不到就是未区分，不当成派发。 */
const toKind = (value: string | null): EntryKind | undefined =>
  value === null ? undefined : KINDS.find((kind) => kind === value)

export type Entry = {
  id: string
  runID: string
  actor: string
  /** 未区分（老账本）时为 `undefined`。 */
  kind?: EntryKind
  reservedTokens: number
  settledTokens: number
  state: LedgerState
  at: number
}

export type Cap = {
  /** 本次运行允许的总 token 数；0 表示不限。 */
  tokens: number
}

export type Usage = {
  reserved: number
  /** 只有提供方权威回报的用量才记在这里。 */
  settled: number
  /** 已发生但用量不明，按预占额保守计入承诺，单独呈现。 */
  unknown: number
  /** 已承诺 = 预占 + 已结算 + 用量不明；并发判断只看这个数。 */
  committed: number
  cap: number
  remaining: number
  overrun: boolean
}

export class BudgetExceeded extends Schema.TaggedErrorClass<BudgetExceeded>()("TeamBudgetExceeded", {
  runID: Schema.String,
  actor: Schema.String,
  cap: Schema.Number,
  committed: Schema.Number,
  requested: Schema.Number,
}) {}

export interface Interface {
  readonly reserve: (input: {
    runID: string
    actor: string
    tokens: number
    cap: Cap
  }) => Effect.Effect<Entry, BudgetExceeded>
  /**
   * 结算。`tokens` 缺省表示提供方没有可信用量：记为 `unknown`，
   * **绝不**用预占额或估算值冒充实际花费。
   */
  readonly settle: (input: { id: string; tokens?: number }) => Effect.Effect<Entry | undefined>
  readonly release: (input: { id: string }) => Effect.Effect<void>
  /**
   * 直接记一笔已结算的消耗，不走「预占 → 结算」。
   *
   * 用于不经过派发预占、但确实花掉的钱（例如验证器）：把它补进账本，
   * 预算判断（`reserved + settled + unknown`）才覆盖得到它。
   * 少了这一步，「上限」只约束得到派发，约束不到验证。
   *
   * `kind` 必填：调用方必须说清这笔是派发还是验证。给它一个默认值，
   * 下一个记账的人就会顺手把它写错，指标也跟着错。
   */
  readonly record: (input: { runID: string; actor: string; kind: EntryKind; tokens: number }) => Effect.Effect<Entry>
  readonly usage: (input: { runID: string; cap?: Cap }) => Effect.Effect<Usage>
  /**
   * 本次运行的全部账本条目。
   *
   * 用量归属（§10.3）要按 actor 汇总，不能只看总数：总数回答「花了多少」，
   * 条目才回答「谁花的」。条目是只读快照，不改状态。
   */
  readonly entries: (runID: string) => Effect.Effect<Entry[]>
  /** 在当前承诺量上再加 `delta` 是否会越过额度；用于只读预估。 */
  readonly wouldExceed: (input: { runID: string; delta: number; cap: Cap }) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/TeamLedger") {}

const generateId = () => "led_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)

const toEntry = (row: typeof TeamRunLedgerTable.$inferSelect): Entry => {
  const kind = toKind(row.kind)
  return {
    id: row.id,
    runID: row.run_id,
    actor: row.actor,
    ...(kind ? { kind } : {}),
    reservedTokens: row.reserved_tokens,
    settledTokens: row.settled_tokens,
    state: row.state as LedgerState,
    at: row.at,
  }
}

const rows = (runID: string) =>
  Database.use((db) => db.select().from(TeamRunLedgerTable).where(eq(TeamRunLedgerTable.run_id, runID)).all())

/** 同步计算，供事务内调用；`Database.use` 在事务上下文里会自动复用同一个事务。 */
function usageOf(entries: Entry[], cap?: Cap): Usage {
  let reserved = 0
  let settled = 0
  let unknown = 0
  for (const entry of entries) {
    if (entry.state === "reserved") reserved += entry.reservedTokens
    if (entry.state === "settled" || entry.state === "overrun") settled += entry.settledTokens
    if (entry.state === "unknown") unknown += entry.reservedTokens
  }
  const committed = reserved + settled + unknown
  const limit = cap?.tokens ?? 0
  return {
    reserved,
    settled,
    unknown,
    committed,
    cap: limit,
    remaining: limit === 0 ? Number.POSITIVE_INFINITY : Math.max(0, limit - committed),
    overrun: limit !== 0 && committed > limit,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const reserve: Interface["reserve"] = Effect.fn("TeamLedger.reserve")(function* (input) {
      // 事务用 immediate 语义，避免两个成员同时通过额度检查后再各自插入。
      // 超额不抛异常，而是带着当时的承诺量返回，交给外面转成类型化错误。
      const result = yield* Effect.sync(() =>
        Database.transaction(
          (tx): { entry: Entry } | { committed: number } => {
            const entries = tx
              .select()
              .from(TeamRunLedgerTable)
              .where(eq(TeamRunLedgerTable.run_id, input.runID))
              .all()
              .map(toEntry)
            const current = usageOf(entries, input.cap)
            if (input.cap.tokens !== 0 && current.committed + input.tokens > input.cap.tokens) {
              return { committed: current.committed }
            }
            const entry: Entry = {
              id: generateId(),
              runID: input.runID,
              actor: input.actor,
              // 预占只发生在派发前；验证是事后补记，不走这里。
              kind: "dispatch",
              reservedTokens: input.tokens,
              settledTokens: 0,
              state: "reserved",
              at: Date.now(),
            }
            tx.insert(TeamRunLedgerTable)
              .values({
                id: entry.id,
                run_id: entry.runID,
                actor: entry.actor,
                kind: entry.kind,
                reserved_tokens: entry.reservedTokens,
                settled_tokens: 0,
                state: entry.state,
                at: entry.at,
              })
              .run()
            return { entry }
          },
          { behavior: "immediate" },
        ),
      )
      if ("committed" in result) {
        return yield* Effect.fail(
          new BudgetExceeded({
            runID: input.runID,
            actor: input.actor,
            cap: input.cap.tokens,
            committed: result.committed,
            requested: input.tokens,
          }),
        )
      }
      return result.entry
    })

    const settle: Interface["settle"] = Effect.fn("TeamLedger.settle")(function* (input) {
      return yield* Effect.sync(() =>
        Database.transaction(
          (tx) => {
            const row = tx.select().from(TeamRunLedgerTable).where(eq(TeamRunLedgerTable.id, input.id)).all()[0]
            if (!row) return undefined
            // 用量不明就如实记 unknown：预占仍占着额度，但不能伪装成已结算的花费。
            if (input.tokens === undefined) {
              tx.update(TeamRunLedgerTable).set({ state: "unknown" }).where(eq(TeamRunLedgerTable.id, input.id)).run()
              return { ...toEntry(row), state: "unknown" as LedgerState }
            }
            const state: LedgerState = input.tokens > row.reserved_tokens ? "overrun" : "settled"
            tx.update(TeamRunLedgerTable)
              .set({ settled_tokens: input.tokens, state })
              .where(eq(TeamRunLedgerTable.id, input.id))
              .run()
            return { ...toEntry(row), settledTokens: input.tokens, state }
          },
          { behavior: "immediate" },
        ),
      )
    })

    const entries: Interface["entries"] = Effect.fn("TeamLedger.entries")(function* (runID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(TeamRunLedgerTable).where(eq(TeamRunLedgerTable.run_id, runID)).all()),
      )
      return rows.map(toEntry)
    })

    const release: Interface["release"] = Effect.fn("TeamLedger.release")(function* (input) {
      yield* Effect.sync(() =>
        Database.transaction(
          (tx) => {
            tx.update(TeamRunLedgerTable)
              .set({ state: "released" })
              .where(and(eq(TeamRunLedgerTable.id, input.id), eq(TeamRunLedgerTable.state, "reserved")))
              .run()
          },
          { behavior: "immediate" },
        ),
      )
    })

    const record: Interface["record"] = Effect.fn("TeamLedger.record")(function* (input) {
      // 预占 0、结算 N：这不是「超支」，而是「没预占过的一笔实际花费」。
      // 用 overrun 表达会被误读成「估算太保守」，所以状态记 settled。
      const entry: Entry = {
        id: generateId(),
        runID: input.runID,
        actor: input.actor,
        kind: input.kind,
        reservedTokens: 0,
        settledTokens: input.tokens,
        state: "settled",
        at: Date.now(),
      }
      if (input.tokens <= 0) return entry
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(TeamRunLedgerTable)
            .values({
              id: entry.id,
              run_id: entry.runID,
              actor: entry.actor,
              kind: entry.kind,
              reserved_tokens: 0,
              settled_tokens: entry.settledTokens,
              state: entry.state,
              at: entry.at,
            })
            .run(),
        ),
      )
      return entry
    })

    const usage: Interface["usage"] = Effect.fn("TeamLedger.usage")(function* (input) {
      const entries = yield* Effect.sync(() => rows(input.runID))
      return usageOf(entries.map(toEntry), input.cap)
    })

    const wouldExceed: Interface["wouldExceed"] = Effect.fn("TeamLedger.wouldExceed")(function* (input) {
      const current = yield* usage({ runID: input.runID, cap: input.cap })
      if (input.cap.tokens === 0) return false
      return current.committed + input.delta > input.cap.tokens
    })

    return Service.of({ reserve, settle, release, record, usage, wouldExceed, entries })
  }),
)

export const defaultLayer = layer
