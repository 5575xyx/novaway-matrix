import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { Service as BackgroundService, defaultLayer as BackgroundLayer } from "@/background/job"
import { Service as MailboxService, defaultLayer as MailboxLayer } from "@/team/mailbox"
import { defaultLayer as StatusLayer } from "@/session/status"
import { defaultLayer as BackgroundResumeLayer, Service as ResumeService } from "@/background/resume"
import { BackgroundJobTable } from "@/background/job.sql"
import { Database } from "@/storage/db"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    BackgroundLayer,
    MailboxLayer,
    StatusLayer,
    BackgroundResumeLayer,
    CrossSpawnSpawner.defaultLayer,
    FetchHttpClient.layer,
  ) as never,
)

/** Tests share one in-memory database; start each case from a clean slate. */
const clearJobs = () => Effect.sync(() => Database.use((db) => db.delete(BackgroundJobTable).run()))

const insertInterrupted = (input: { id: string; type: string; title?: string; metadata: Record<string, unknown> }) =>
  Effect.sync(() =>
    Database.use((db) =>
      db
        .insert(BackgroundJobTable)
        .values({
          id: input.id,
          type: input.type,
          title: input.title ?? null,
          status: "cancelled",
          started_at: Date.now() - 60_000,
          completed_at: Date.now() - 59_000,
          error: "interrupted by restart",
          metadata: input.metadata,
        })
        .run(),
    ),
  )

describe("background resume", () => {
  it.instance("restarts a resumable monitor with its recorded command", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundService
      const resume = yield* ResumeService
      yield* clearJobs()
      yield* insertInterrupted({
        id: "job_monitor_old",
        type: "monitor",
        title: "watch build",
        metadata: {
          command: `node -e "process.exit(0)"`,
          pattern: "never",
          timeout: 20,
          sessionID: "ses_resume",
          resumable: true,
        },
      })

      const restored = yield* resume.restore()
      expect(restored).toHaveLength(1)
      expect(restored[0]!.type).toBe("monitor")
      expect(restored[0]!.jobID).not.toBe("job_monitor_old")

      const job = yield* background.wait({ id: restored[0]!.jobID, timeout: 15_000 })
      expect(job.info?.status).toBe("completed")
      expect(job.info?.metadata?.resumed).toBe(true)
    }),
  )

  it.instance("skips subscriptions that used headers and says why", () =>
    Effect.gen(function* () {
      const resume = yield* ResumeService
      yield* clearJobs()
      yield* insertInterrupted({
        id: "job_sub_auth",
        type: "subscribe",
        title: "private feed",
        metadata: {
          url: "https://example.com/private",
          every: 60,
          timeout: 600,
          sessionID: "ses_resume",
          resumable: true,
          auth: true,
        },
      })

      const restored = yield* resume.restore()
      expect(restored).toHaveLength(1)
      expect(restored[0]!.skipped).toBe("credentials")
    }),
  )

  it.instance("ignores jobs that were not resumable or ended normally", () =>
    Effect.gen(function* () {
      const resume = yield* ResumeService
      yield* clearJobs()
      yield* insertInterrupted({
        id: "job_normal",
        type: "shell",
        metadata: { command: "ls", sessionID: "ses_resume" },
      })
      expect(yield* resume.restore()).toEqual([])
    }),
  )

  it.instance("only restores once per instance", () =>
    Effect.gen(function* () {
      const resume = yield* ResumeService
      yield* clearJobs()
      yield* insertInterrupted({
        id: "job_monitor_once",
        type: "monitor",
        metadata: {
          command: `node -e "process.exit(0)"`,
          timeout: 5,
          sessionID: "ses_resume",
          resumable: true,
        },
      })
      const first = yield* resume.restore()
      const second = yield* resume.restore()
      expect(first.length).toBe(1)
      expect(second).toEqual([])
    }),
  )
})
