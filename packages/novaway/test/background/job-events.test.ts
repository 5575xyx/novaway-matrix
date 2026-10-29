import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer, Schema } from "effect"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { testEffect } from "../lib/effect"

// Expose Bus AND BackgroundJob. BackgroundJob.defaultLayer already satisfies its own Bus dependency,
// and we merge Bus.layer alongside so the test can yield Bus.Service directly.
const it = testEffect(Layer.mergeAll(Bus.layer, BackgroundJob.defaultLayer))

type StartedInfo = Schema.Schema.Type<(typeof BackgroundJob.Event.Started)["properties"]>
type UpdatedInfo = Schema.Schema.Type<(typeof BackgroundJob.Event.Updated)["properties"]>
type CompletedInfo = Schema.Schema.Type<(typeof BackgroundJob.Event.Completed)["properties"]>

describe("background.job events", () => {
  it.instance("emits background.started when a job is created", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const bus = yield* Bus.Service
      const events: StartedInfo[] = []
      const latch = yield* Deferred.make<void>()

      const unsub = yield* bus.subscribeCallback(BackgroundJob.Event.Started, (e) => {
        events.push(e.properties)
        Deferred.doneUnsafe(latch, Effect.void)
      })

      const job = yield* jobs.start({ type: "test", run: Effect.never })

      yield* Deferred.await(latch).pipe(Effect.timeout("2 seconds"))
      expect(events).toHaveLength(1)
      expect(events[0].info.id).toBe(job.id)
      expect(events[0].info.status).toBe("running")

      yield* jobs.cancel(job.id)
      yield* Effect.sync(unsub)
    }),
  )

  it.instance("emits background.updated when the run pushes progress", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const bus = yield* Bus.Service
      const events: UpdatedInfo[] = []
      const latch = yield* Deferred.make<void>()

      const unsub = yield* bus.subscribeCallback(BackgroundJob.Event.Updated, (e) => {
        events.push(e.properties)
        Deferred.doneUnsafe(latch, Effect.void)
      })

      const job = yield* jobs.start({ type: "test", run: Effect.never })
      yield* jobs.update(job.id, { output: "hello" })

      yield* Deferred.await(latch).pipe(Effect.timeout("2 seconds"))
      expect(events).toHaveLength(1)
      expect(events[0].info.output).toBe("hello")

      yield* jobs.cancel(job.id)
      yield* Effect.sync(unsub)
    }),
  )

  it.instance("does not emit background.updated after the job finished", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const bus = yield* Bus.Service
      const events: UpdatedInfo[] = []

      const unsub = yield* bus.subscribeCallback(BackgroundJob.Event.Updated, (e) => {
        events.push(e.properties)
      })

      const job = yield* jobs.start({ type: "test", run: Effect.succeed("done") })
      yield* jobs.wait({ id: job.id })
      yield* jobs.update(job.id, { output: "after-the-fact" })

      expect(events).toHaveLength(0)
      yield* Effect.sync(unsub)
    }),
  )

  it.instance("emits background.completed for each terminal state", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const bus = yield* Bus.Service

      // Completed
      {
        const events: CompletedInfo[] = []
        const latch = yield* Deferred.make<void>()
        const unsub = yield* bus.subscribeCallback(BackgroundJob.Event.Completed, (e) => {
          events.push(e.properties)
          Deferred.doneUnsafe(latch, Effect.void)
        })
        const job = yield* jobs.start({ type: "test", run: Effect.succeed("ok") })
        yield* Deferred.await(latch).pipe(Effect.timeout("2 seconds"))
        expect(events).toHaveLength(1)
        expect(events[0].info.status).toBe("completed")
        expect(events[0].info.id).toBe(job.id)
        yield* Effect.sync(unsub)
      }

      // Error
      {
        const events: CompletedInfo[] = []
        const latch = yield* Deferred.make<void>()
        const unsub = yield* bus.subscribeCallback(BackgroundJob.Event.Completed, (e) => {
          events.push(e.properties)
          Deferred.doneUnsafe(latch, Effect.void)
        })
        const job = yield* jobs.start({ type: "test", run: Effect.fail(new Error("boom")) })
        yield* Deferred.await(latch).pipe(Effect.timeout("2 seconds"))
        expect(events).toHaveLength(1)
        expect(events[0].info.status).toBe("error")
        expect(events[0].info.error).toBe("boom")
        expect(events[0].info.id).toBe(job.id)
        yield* Effect.sync(unsub)
      }

      // Cancelled
      {
        const events: CompletedInfo[] = []
        const latch = yield* Deferred.make<void>()
        const unsub = yield* bus.subscribeCallback(BackgroundJob.Event.Completed, (e) => {
          events.push(e.properties)
          Deferred.doneUnsafe(latch, Effect.void)
        })
        const job = yield* jobs.start({ type: "test", run: Effect.never })
        yield* jobs.cancel(job.id)
        yield* Deferred.await(latch).pipe(Effect.timeout("2 seconds"))
        expect(events).toHaveLength(1)
        expect(events[0].info.status).toBe("cancelled")
        yield* Effect.sync(unsub)
      }
    }),
  )
})
