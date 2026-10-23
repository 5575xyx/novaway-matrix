import { describe, expect } from "bun:test"
import { Deferred, Effect } from "effect"
import { BackgroundJob } from "@/background/job"
import { testEffect } from "../lib/effect"

const it = testEffect(BackgroundJob.defaultLayer)

describe("background.job", () => {
  it.instance("tracks started jobs through completion", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "test",
        title: "test job",
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      expect(job.id.startsWith("job_")).toBe(true)
      expect(job.status).toBe("running")
      expect(job.title).toBe("test job")

      yield* Deferred.succeed(latch, undefined)
      const done = yield* jobs.wait({ id: job.id })

      expect(done.timedOut).toBe(false)
      expect(done.info?.status).toBe("completed")
      expect(done.info?.output).toBe("done")
      expect((yield* jobs.list()).map((item) => item.id)).toEqual([job.id])
    }),
  )

  it.instance("returns a running snapshot when wait times out", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({
        type: "test",
        run: Effect.never,
      })

      const result = yield* jobs.wait({ id: job.id, timeout: 1 })

      expect(result.timedOut).toBe(true)
      expect(result.info?.status).toBe("running")
    }),
  )

  it.instance("deduplicates concurrent starts for a running id", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const started = yield* Deferred.make<void>()
      const id = "job_test"
      const [first, second] = yield* Effect.all(
        [
          jobs.start({
            id,
            type: "test",
            run: Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          }),
          jobs.start({
            id,
            type: "test",
            run: Effect.fail(new Error("duplicate started")),
          }),
        ],
        { concurrency: "unbounded" },
      )

      yield* Deferred.await(started)

      expect(first.id).toBe(id)
      expect(second.id).toBe(id)
      expect(first.status).toBe("running")
      expect(second.status).toBe("running")
      expect((yield* jobs.list()).map((item) => item.id)).toEqual([id])

      yield* jobs.cancel(id)
    }),
  )

  it.instance("records failed jobs", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({
        type: "test",
        run: Effect.fail(new Error("boom")),
      })

      const result = yield* jobs.wait({ id: job.id })

      expect(result.info?.status).toBe("error")
      expect(result.info?.error).toBe("boom")
    }),
  )

  it.instance("can cancel running jobs", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const interrupted = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "test",
        run: Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
      })

      const cancelled = yield* jobs.cancel(job.id)

      expect(cancelled?.status).toBe("cancelled")
      yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"))
      expect((yield* jobs.get(job.id))?.status).toBe("cancelled")
    }),
  )

  it.instance("returns immutable snapshots", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({
        type: "test",
        metadata: { value: "initial" },
        run: Effect.succeed("done"),
      })

      if (job.metadata) job.metadata.value = "changed"

      expect((yield* jobs.get(job.id))?.metadata?.value).toBe("initial")
    }),
  )

  it.instance("updates live output while running", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "shell",
        metadata: { parentSessionId: "ses_parent" },
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      yield* jobs.update(job.id, { output: "line 1" })
      expect((yield* jobs.get(job.id))?.output).toBe("line 1")

      yield* jobs.update(job.id, { output: "line 1\nline 2", metadata: { cwd: "/tmp" } })
      const live = yield* jobs.get(job.id)
      expect(live?.output).toBe("line 1\nline 2")
      expect(live?.metadata?.cwd).toBe("/tmp")

      yield* Deferred.succeed(latch, undefined)
      yield* jobs.wait({ id: job.id })
      // 完成后的迟到进度不应覆盖最终结果。
      expect(yield* jobs.update(job.id, { output: "late" })).toBeUndefined()
      expect((yield* jobs.get(job.id))?.output).toBe("done")
    }),
  )

  it.instance("runs the cancel hook before interrupting the job", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const aborted = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "shell",
        cancel: Deferred.succeed(aborted, undefined),
        run: Effect.never,
      })

      yield* jobs.cancel(job.id)
      yield* Deferred.await(aborted).pipe(Effect.timeout("1 second"))
      expect((yield* jobs.get(job.id))?.status).toBe("cancelled")
    }),
  )
})

describe("background.job persistence", () => {
  it.instance("get answers for a job that only exists as a row", () =>
    Effect.gen(function* () {
      const { Database } = yield* Effect.promise(() => import("@/storage/db"))
      const { BackgroundJobTable } = yield* Effect.promise(() => import("@/background/job.sql"))
      const jobs = yield* BackgroundJob.Service

      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(BackgroundJobTable)
            .values({
              id: "job_persisted",
              type: "test",
              title: "finished earlier",
              status: "completed",
              started_at: 1_000,
              completed_at: 2_000,
              output: "old output",
            })
            .run(),
        ),
      )

      const found = yield* jobs.get("job_persisted")
      expect(found?.status).toBe("completed")
      expect(found?.output).toBe("old output")

      // Live-only listing stays untouched; the panel asks for history explicitly.
      expect((yield* jobs.list()).some((item) => item.id === "job_persisted")).toBe(false)
      expect((yield* jobs.list({ includePersisted: true })).some((item) => item.id === "job_persisted")).toBe(true)
    }),
  )

  it.instance("live entries win over their persisted copy", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({ type: "test", title: "live", run: Deferred.await(latch).pipe(Effect.as("x")) })
      yield* jobs.update(job.id, { output: "streaming" })

      const listed = (yield* jobs.list({ includePersisted: true })).filter((item) => item.id === job.id)
      expect(listed).toHaveLength(1)
      expect(listed[0]!.status).toBe("running")
      expect(listed[0]!.output).toBe("streaming")

      yield* Deferred.succeed(latch, undefined)
      yield* jobs.wait({ id: job.id })
    }),
  )
})
