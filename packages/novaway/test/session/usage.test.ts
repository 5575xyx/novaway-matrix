import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Session as SessionNs } from "@/session/session"
import { SessionUsage } from "@/session/usage"
import { SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { Bus } from "@/bus"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { Evolution } from "@/evolution/service"
import { Memory } from "@/memory/service"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    SessionUsage.defaultLayer,
    SessionNs.layer.pipe(
      Layer.provide(Bus.layer),
      Layer.provide(Storage.defaultLayer),
      Layer.provide(SyncEvent.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
    ),
    Evolution.defaultLayer,
    Memory.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
  ),
)

const seed = (
  id: SessionNs.Info["id"],
  values: { cost: number; input: number; output: number; reasoning?: number; cacheRead?: number; cacheWrite?: number },
) =>
  Effect.sync(() =>
    Database.use((db) =>
      db
        .update(SessionTable)
        .set({
          cost: values.cost,
          tokens_input: values.input,
          tokens_output: values.output,
          tokens_reasoning: values.reasoning ?? 0,
          tokens_cache_read: values.cacheRead ?? 0,
          tokens_cache_write: values.cacheWrite ?? 0,
        })
        .where(eq(SessionTable.id, id))
        .run(),
    ),
  )

describe("session usage", () => {
  it.instance("reads a single session row", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const usage = yield* SessionUsage.Service
      const info = yield* sessions.create({ title: "solo" })
      yield* seed(info.id, { cost: 0.25, input: 1_000, output: 200, reasoning: 50, cacheRead: 300, cacheWrite: 10 })

      const entry = yield* usage.get(info.id)
      expect(entry?.cost).toBeCloseTo(0.25)
      expect(entry?.tokens).toEqual({
        input: 1_000,
        output: 200,
        reasoning: 50,
        cacheRead: 300,
        cacheWrite: 10,
        total: 1_560,
      })
    }),
  )

  it.instance("rolls the whole descendant tree into one total", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const usage = yield* SessionUsage.Service
      const root = yield* sessions.create({ title: "root" })
      const child = yield* sessions.create({ parentID: root.id, title: "child" })
      const grandchild = yield* sessions.create({ parentID: child.id, title: "grandchild" })
      const sibling = yield* sessions.create({ title: "sibling" })

      yield* seed(root.id, { cost: 0.1, input: 100, output: 10 })
      yield* seed(child.id, { cost: 0.2, input: 200, output: 20 })
      yield* seed(grandchild.id, { cost: 0.3, input: 300, output: 30 })
      yield* seed(sibling.id, { cost: 0.4, input: 400, output: 40 })

      const tree = yield* usage.tree(root.id)
      expect(tree.sessions.map((entry) => entry.sessionID).sort()).toEqual([root.id, child.id, grandchild.id].sort())
      expect(tree.total.cost).toBeCloseTo(0.6)
      expect(tree.total.tokens.input).toBe(600)
      expect(tree.total.tokens.total).toBe(660)

      const childTree = yield* usage.tree(child.id)
      expect(childTree.sessions.map((entry) => entry.sessionID).sort()).toEqual([child.id, grandchild.id].sort())
      expect(childTree.total.cost).toBeCloseTo(0.5)
    }),
  )

  it.instance("returns an empty total for unknown sessions", () =>
    Effect.gen(function* () {
      const usage = yield* SessionUsage.Service
      const tree = yield* usage.tree("ses_missing" as never)
      expect(tree.sessions).toEqual([])
      expect(tree.total).toEqual(SessionUsage.empty())
    }),
  )
})

describe("usage helpers", () => {
  const value = (cost: number, input: number, output = 0): SessionUsage.Value => ({
    cost,
    tokens: { input, output, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: input + output },
  })

  test("sum and add accumulate every bucket", () => {
    const total = SessionUsage.sum([value(1, 10, 1), value(2, 20, 2)])
    expect(total.cost).toBe(3)
    expect(total.tokens.input).toBe(30)
    expect(total.tokens.total).toBe(33)
    expect(SessionUsage.sum([])).toEqual(SessionUsage.empty())
  })

  test("delta reports spend since a mark and clamps reverts", () => {
    expect(SessionUsage.delta(value(5, 100), value(2, 40)).cost).toBe(3)
    expect(SessionUsage.delta(value(5, 100), value(2, 40)).tokens.input).toBe(60)
    // A revert subtracts from the session row; never report a negative spend.
    expect(SessionUsage.delta(value(1, 10), value(4, 40))).toEqual(SessionUsage.empty())
    expect(SessionUsage.delta(value(1, 10), undefined)).toEqual(value(1, 10))
  })

  test("readMark tolerates partial or hostile metadata", () => {
    expect(SessionUsage.readMark(undefined)).toBeUndefined()
    expect(SessionUsage.readMark({ cost: "nope" })).toBeUndefined()
    expect(SessionUsage.readMark({ cost: 0.5 })).toBeUndefined()
    const mark = SessionUsage.readMark({ cost: 0.5, tokens: { input: 10 }, at: 123 })
    expect(mark?.cost).toBe(0.5)
    expect(mark?.tokens.input).toBe(10)
    expect(mark?.tokens.output).toBe(0)
    expect(mark?.at).toBe(123)
  })

  test("attribute rolls nested sessions onto their nearest owner", () => {
    const entry = (id: string, parentID: string | undefined, cost: number): SessionUsage.Entry => ({
      sessionID: id as never,
      parentID: parentID as never,
      updatedAt: 0,
      cost,
      tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    })
    const totals = SessionUsage.attribute(
      [
        entry("ses_lead", undefined, 1),
        entry("ses_worker", "ses_lead", 2),
        // A worker's own subagent still belongs to the worker.
        entry("ses_helper", "ses_worker", 4),
        entry("ses_orphan", "ses_gone", 8),
      ],
      ["ses_lead", "ses_worker"],
    )
    // Each member owns its own row; only descendants roll upwards.
    expect(totals.get("ses_lead")?.cost).toBe(1)
    expect(totals.get("ses_worker")?.cost).toBe(6)
    expect(totals.size).toBe(2)
  })
})
