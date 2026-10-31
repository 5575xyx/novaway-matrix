import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { Service as LedgerService, defaultLayer as LedgerLayer } from "@/team/ledger"
import { Service as OpLogService, defaultLayer as OpLogLayer } from "@/team/op-log"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(LedgerLayer, OpLogLayer))

const runID = () => "run_" + Math.random().toString(36).slice(2, 9)

describe("team ledger", () => {
  it.effect("reserves and settles against the committed total", () =>
    Effect.gen(function* () {
      const ledger = yield* LedgerService
      const id = runID()
      const cap = { tokens: 100 }
      const first = yield* ledger.reserve({ runID: id, actor: "team-a", tokens: 40, cap })
      // 预占尚未结算，也要占住额度：并发调用不能一起通过检查。
      const second = yield* ledger.reserve({ runID: id, actor: "team-b", tokens: 40, cap })
      expect(second.id).not.toBe(first.id)

      const refused = yield* Effect.exit(ledger.reserve({ runID: id, actor: "team-c", tokens: 40, cap }))
      expect(Exit.isFailure(refused)).toBe(true)

      yield* ledger.settle({ id: first.id, tokens: 30 })
      const usage = yield* ledger.usage({ runID: id, cap })
      expect(usage.reserved).toBe(40)
      expect(usage.settled).toBe(30)
      expect(usage.committed).toBe(70)
      expect(usage.remaining).toBe(30)
    }),
  )

  it.effect("releasing a reservation frees budget again", () =>
    Effect.gen(function* () {
      const ledger = yield* LedgerService
      const id = runID()
      const cap = { tokens: 50 }
      const entry = yield* ledger.reserve({ runID: id, actor: "team-a", tokens: 50, cap })
      yield* ledger.release({ id: entry.id })
      const usage = yield* ledger.usage({ runID: id, cap })
      expect(usage.committed).toBe(0)
      const again = yield* ledger.reserve({ runID: id, actor: "team-b", tokens: 50, cap })
      expect(again.state).toBe("reserved")
    }),
  )

  it.effect("records spend that never went through a reservation", () =>
    Effect.gen(function* () {
      const ledger = yield* LedgerService
      const id = runID()
      // 验证器不在派发预占里，但它确实花钱：补记后额度判断必须看得到它。
      yield* ledger.record({ runID: id, actor: "team-a", kind: "verification", tokens: 30 })
      const usage = yield* ledger.usage({ runID: id, cap: { tokens: 100 } })
      expect(usage.settled).toBe(30)
      expect(usage.reserved).toBe(0)
      expect(usage.committed).toBe(30)
      expect(usage.remaining).toBe(70)
    }),
  )

  it.effect("labels reservations as dispatch and records verification separately", () =>
    Effect.gen(function* () {
      const ledger = yield* LedgerService
      const id = runID()
      // 「验证开销占比」靠这一列才拆得开：派发与验证是同一笔账里的两种用途。
      const reservation = yield* ledger.reserve({ runID: id, actor: "team-a", tokens: 40, cap: { tokens: 100 } })
      expect(reservation.kind).toBe("dispatch")
      yield* ledger.settle({ id: reservation.id, tokens: 35 })
      yield* ledger.record({ runID: id, actor: "team-a", kind: "verification", tokens: 15 })

      const entries = yield* ledger.entries(id)
      // 不依赖数据库返回顺序：这里只关心每一项的用途与金额。
      expect(entries.map((entry) => [entry.kind, entry.settledTokens]).sort()).toEqual([
        ["dispatch", 35],
        ["verification", 15],
      ])
    }),
  )

  it.effect("a zero-token record writes nothing", () =>
    Effect.gen(function* () {
      const ledger = yield* LedgerService
      const id = runID()
      // 读不到用量的验证不该在账本里留一行 0：那会让「有几笔花费」变成噪声。
      yield* ledger.record({ runID: id, actor: "team-a", kind: "verification", tokens: 0 })
      expect(yield* ledger.entries(id)).toEqual([])
    }),
  )

  it.effect("marks settlement above the reservation as overrun", () =>
    Effect.gen(function* () {
      const ledger = yield* LedgerService
      const id = runID()
      const entry = yield* ledger.reserve({ runID: id, actor: "team-a", tokens: 10, cap: { tokens: 100 } })
      const settled = yield* ledger.settle({ id: entry.id, tokens: 25 })
      expect(settled?.state).toBe("overrun")
      const usage = yield* ledger.usage({ runID: id, cap: { tokens: 100 } })
      expect(usage.settled).toBe(25)
      expect(usage.overrun).toBe(false)
    }),
  )

  it.effect("treats a zero cap as unlimited", () =>
    Effect.gen(function* () {
      const ledger = yield* LedgerService
      const id = runID()
      yield* ledger.reserve({ runID: id, actor: "team-a", tokens: 1_000_000, cap: { tokens: 0 } })
      const usage = yield* ledger.usage({ runID: id, cap: { tokens: 0 } })
      expect(usage.overrun).toBe(false)
      expect(usage.remaining).toBe(Number.POSITIVE_INFINITY)
    }),
  )
})

describe("team op log", () => {
  it.effect("replays an existing idempotency key instead of running twice", () =>
    Effect.gen(function* () {
      const ops = yield* OpLogService
      const id = runID()
      const first = yield* ops.begin({ runID: id, tool: "bash", idempotencyKey: "k1" })
      expect(first.replayed).toBe(false)
      yield* ops.finish({ id: first.op.id, outcome: "succeeded", effect: { exit: 0 } })

      const second = yield* ops.begin({ runID: id, tool: "bash", idempotencyKey: "k1" })
      expect(second.replayed).toBe(true)
      expect(second.op.id).toBe(first.op.id)
      expect(second.op.outcome).toBe("succeeded")
    }),
  )

  it.effect("turns abandoned started operations into unknown for review", () =>
    Effect.gen(function* () {
      const ops = yield* OpLogService
      const id = runID()
      yield* ops.begin({ runID: id, tool: "bash", idempotencyKey: "k1" })
      const marked = yield* ops.markUnknown({ runID: id, olderThanMs: -1000 })
      expect(marked).toBe(1)
      const review = yield* ops.needsReview(id)
      expect(review.map((op) => op.outcome)).toEqual(["unknown"])
    }),
  )

  it.effect("does not let a late result overwrite an unknown verdict", () =>
    Effect.gen(function* () {
      const ops = yield* OpLogService
      const id = runID()
      const started = yield* ops.begin({ runID: id, tool: "bash", idempotencyKey: "k1" })
      yield* ops.markUnknown({ runID: id, olderThanMs: -1000 })
      const late = yield* ops.finish({ id: started.op.id, outcome: "succeeded" })
      expect(late?.outcome).toBe("unknown")
    }),
  )
})

describe("team ledger: unsettled usage", () => {
  it.effect("records unknown usage instead of inventing a settled amount", () =>
    Effect.gen(function* () {
      const ledger = yield* LedgerService
      const id = runID()
      const entry = yield* ledger.reserve({ runID: id, actor: "team-a", tokens: 40, cap: { tokens: 100 } })
      // 提供方没有回报用量：不能拿预占额冒充花费。
      const settled = yield* ledger.settle({ id: entry.id })
      expect(settled?.state).toBe("unknown")
      expect(settled?.settledTokens).toBe(0)

      const usage = yield* ledger.usage({ runID: id, cap: { tokens: 100 } })
      expect(usage.settled).toBe(0)
      expect(usage.unknown).toBe(40)
      // 但仍然保守占住额度，避免后续派发超支。
      expect(usage.committed).toBe(40)
      expect(usage.remaining).toBe(60)
    }),
  )
})

describe("team ledger: cost", () => {
  it.effect("keeps settled cost next to tokens and sums it for the run", () =>
    Effect.gen(function* () {
      const ledger = yield* LedgerService
      const id = runID()
      // 成本调用前不可知，所以预占只占 token；成本在结算时如实记。
      const entry = yield* ledger.reserve({ runID: id, actor: "team-a", tokens: 100, cap: { tokens: 1_000 } })
      expect(entry.settledCost).toBe(0)
      const settled = yield* ledger.settle({ id: entry.id, tokens: 80, cost: 0.25 })
      expect(settled?.settledCost).toBe(0.25)
      expect(settled?.settledTokens).toBe(80)

      yield* ledger.record({ runID: id, actor: "team-a", kind: "verification", tokens: 20, cost: 0.05 })
      const usage = yield* ledger.usage({ runID: id, cap: { tokens: 1_000 } })
      expect(usage.settledCost).toBeCloseTo(0.3, 10)
      // 成本不参与 token 额度判断：两者是两笔账。
      expect(usage.committed).toBe(100)
    }),
  )

  it.effect("records a verification that only reported cost", () =>
    Effect.gen(function* () {
      const ledger = yield* LedgerService
      const id = runID()
      // 只拿到成本、没拿到 token 也是一笔真实开销：不能因为 tokens 是 0 就丢掉。
      yield* ledger.record({ runID: id, actor: "team-a", kind: "verification", tokens: 0, cost: 0.02 })
      const entries = yield* ledger.entries(id)
      expect(entries.length).toBe(1)
      expect(entries[0].settledCost).toBeCloseTo(0.02, 10)
      expect((yield* ledger.usage({ runID: id })).settledCost).toBeCloseTo(0.02, 10)
    }),
  )

  it.effect("counts cost even when the provider gave no token numbers", () =>
    Effect.gen(function* () {
      const ledger = yield* LedgerService
      const id = runID()
      const entry = yield* ledger.reserve({ runID: id, actor: "team-a", tokens: 40, cap: { tokens: 100 } })
      // 用量不明不等于成本不明：钱确实花了，计数口径仍然按「已结算」。
      const settled = yield* ledger.settle({ id: entry.id, cost: 0.1 })
      expect(settled?.state).toBe("unknown")
      const usage = yield* ledger.usage({ runID: id, cap: { tokens: 100 } })
      expect(usage.unknown).toBe(40)
      expect(usage.settledCost).toBeCloseTo(0.1, 10)
    }),
  )

  it.effect("ignores a released reservation's cost and never invents one", () =>
    Effect.gen(function* () {
      const ledger = yield* LedgerService
      const id = runID()
      const entry = yield* ledger.reserve({ runID: id, actor: "team-a", tokens: 10, cap: { tokens: 100 } })
      yield* ledger.release({ id: entry.id })
      const usage = yield* ledger.usage({ runID: id, cap: { tokens: 100 } })
      // 没有提供方回报 = 没有成本数据，不是「花了 0」。
      expect(usage.settledCost).toBe(0)
    }),
  )
})
