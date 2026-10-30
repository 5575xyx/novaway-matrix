import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Ref } from "effect"
import { Service as WriterService, defaultLayer as WriterLayer } from "@/team/writer"
import { testEffect } from "../lib/effect"

const it = testEffect(WriterLayer)

const runID = () => "run_" + Math.random().toString(36).slice(2, 9)

describe("team writer", () => {
  it.live("write calls in the same run never overlap, even when they queue", () =>
    Effect.gen(function* () {
      const writer = yield* WriterService
      const id = runID()
      const running = yield* Ref.make(0)
      const peak = yield* Ref.make(0)

      // 六个「写」同时提交：如果没有串行，峰值会大于 1。
      yield* Effect.forEach(
        Array.from({ length: 6 }, (_, index) => index),
        (index) =>
          writer.serial(
            { runID: id, actor: "member_" + index },
            Effect.gen(function* () {
              const now = yield* Ref.updateAndGet(running, (value) => value + 1)
              yield* Ref.update(peak, (value) => Math.max(value, now))
              yield* Effect.sleep("2 millis")
              yield* Ref.update(running, (value) => value - 1)
            }),
          ),
        { concurrency: "unbounded" },
      )

      expect(yield* Ref.get(peak)).toBe(1)
      expect(writer.snapshot(id)).toEqual({ holder: undefined, waiting: 0 })
    }),
  )

  it.live("different runs still run in parallel", () =>
    Effect.gen(function* () {
      const writer = yield* WriterService
      // 两个 run 必须能同时持锁；若被错误地全局串行，
      // 先开始的那个会一直等第二个出现，从而超时失败。
      const bothStarted = yield* Deferred.make<void>()
      const started = yield* Ref.make(0)
      const body = Effect.gen(function* () {
        const count = yield* Ref.updateAndGet(started, (value) => value + 1)
        if (count === 2) yield* Deferred.succeed(bothStarted, undefined)
        yield* Deferred.await(bothStarted)
      })

      yield* Effect.forEach(
        [runID(), runID()],
        (id) => writer.serial({ runID: id, actor: "a" }, body).pipe(Effect.timeout("1 second")),
        { concurrency: 2 },
      )
    }),
  )

  it.live("releases the lock on failure, interruption, and after the holder finishes", () =>
    Effect.gen(function* () {
      const writer = yield* WriterService
      const id = runID()

      // 失败必须释放：否则一次写失败会把整队永久卡住。
      expect(Exit.isFailure(yield* Effect.exit(writer.serial({ runID: id, actor: "a" }, Effect.fail("boom"))))).toBe(
        true,
      )
      yield* writer.serial({ runID: id, actor: "a" }, Effect.succeed("after failure"))

      const acquired = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const holder = yield* Effect.forkChild(
        writer.serial(
          { runID: id, actor: "holder" },
          Effect.gen(function* () {
            yield* Deferred.succeed(acquired, undefined)
            yield* Deferred.await(release)
          }),
        ),
      )
      yield* Deferred.await(acquired)
      expect(writer.snapshot(id)).toEqual({ holder: "holder", waiting: 0 })

      // 排队者被中断：既不能被算作等待中，也不能抢走 holder 的锁。
      const queued = yield* Effect.forkChild(
        writer.serial({ runID: id, actor: "queued" }, Effect.void).pipe(Effect.delay(0)),
      )
      yield* Effect.sleep("1 millis")
      yield* Fiber.interrupt(queued)
      expect(writer.snapshot(id)).toEqual({ holder: "holder", waiting: 0 })

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(holder)
      expect(writer.snapshot(id)).toEqual({ holder: undefined, waiting: 0 })
    }),
  )
})
