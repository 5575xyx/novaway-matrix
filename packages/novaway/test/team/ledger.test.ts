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
