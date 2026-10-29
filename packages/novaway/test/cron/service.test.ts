import { afterEach, describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import * as Tasks from "../../src/cron/tasks"
import { Service as CronService, layer as CronLayer } from "../../src/cron/service"
import { testEffect } from "../lib/effect"

const it = testEffect(CronLayer)

afterEach(() => {
  Tasks.reset()
})

const session = "ses_cron_test"
const directory = "/tmp/cron-project"

describe("cron.service", () => {
  it.effect("create rejects an invalid expression", () =>
    Effect.gen(function* () {
      const cron = yield* CronService
      const exit = yield* cron
        .create({ sessionID: session, directory, cron: "not a cron", prompt: "hi" })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(Tasks.all()).toHaveLength(0)
    }),
  )

  it.effect("create stores a recurring task with a 7-day expiry", () =>
    Effect.gen(function* () {
      const cron = yield* CronService
      const task = yield* cron.create({ sessionID: session, directory, cron: "*/5 * * * *", prompt: "ping" })
      expect(task.recurring).toBe(true)
      expect(task.durable).toBe(false)
      expect(task.expiresAt).toBeDefined()
      expect(task.expiresAt! - task.createdAt).toBe(Tasks.RECURRING_MAX_AGE_MS)
      expect(yield* cron.list({ sessionID: session, directory })).toHaveLength(1)
    }),
  )

  it.effect("one-shot tasks have no expiry", () =>
    Effect.gen(function* () {
      const cron = yield* CronService
      const task = yield* cron.create({
        sessionID: session,
        directory,
        cron: "30 14 10 3 *",
        prompt: "remind",
        recurring: false,
      })
      expect(task.recurring).toBe(false)
      expect(task.expiresAt).toBeUndefined()
    }),
  )

  it.effect("list only returns tasks for the given session", () =>
    Effect.gen(function* () {
      const cron = yield* CronService
      yield* cron.create({ sessionID: "ses_a", directory, cron: "*/5 * * * *", prompt: "a" })
      yield* cron.create({ sessionID: "ses_b", directory, cron: "*/5 * * * *", prompt: "b" })
      expect((yield* cron.list({ sessionID: "ses_a", directory })).map((task) => task.prompt)).toEqual(["a"])
      expect(yield* cron.list({ directory })).toHaveLength(2)
    }),
  )

  it.effect("remove cancels a task and reports unknown ids", () =>
    Effect.gen(function* () {
      const cron = yield* CronService
      const task = yield* cron.create({ sessionID: session, directory, cron: "*/5 * * * *", prompt: "x" })
      expect(yield* cron.remove({ id: task.id, directory })).toBe(true)
      expect(yield* cron.remove({ id: task.id, directory })).toBe(false)
      expect(Tasks.all()).toHaveLength(0)
    }),
  )

  it.effect("tick leaves tasks queued when no runtime can deliver them", () =>
    Effect.gen(function* () {
      const cron = yield* CronService
      const created = new Date("2026-03-10T09:01:00").getTime()
      const task = yield* cron.create({ sessionID: session, directory, cron: "*/5 * * * *", prompt: "tick" })
      // Move the task into the past so it is due now.
      task.createdAt = created
      const fired = yield* cron.tick({ now: new Date("2026-03-10T09:05:30").getTime() })
      expect(fired).toHaveLength(0)
      expect(Tasks.get(task.id)).toBeDefined()
    }),
  )
})
