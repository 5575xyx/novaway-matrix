import { Effect } from "effect"
import type { Interface as SuperAgentStoreInterface, SuperAgentOutboxRecord } from "./store"

export type SuperAgentEventPublisher = (event: SuperAgentOutboxRecord) => Effect.Effect<void, unknown>

export type SuperAgentOutboxDrainResult = {
  published: readonly SuperAgentOutboxRecord[]
  failed: readonly { event: SuperAgentOutboxRecord; error: string; retryAt: number }[]
}

/**
 * Delivers the durable event outbox without losing events on publisher failure.
 * A fresh worker can call drain/replay after restart; retry state lives in the store.
 */
export type SuperAgentOutboxHostOptions = {
  intervalMs?: number
  limitPerRun?: number
  directory?: string
  onError?: (error: unknown) => void
}

/**
 * Host-owned publisher loop. It owns exactly one timer, can be stopped without
 * leaving a pending interval, and discovers every durable run on each tick so
 * events survive instance/backend restarts.
 */
export class SuperAgentOutboxHost {
  private timer: ReturnType<typeof setInterval> | undefined
  private draining = false

  constructor(
    private readonly store: SuperAgentStoreInterface,
    private readonly publisher: SuperAgentEventPublisher,
    private readonly options: SuperAgentOutboxHostOptions = {},
  ) {}

  async drainOnce(at = Date.now()): Promise<SuperAgentOutboxDrainResult> {
    if (this.draining) return { published: [], failed: [] }
    this.draining = true
    try {
      const runs = await Effect.runPromise(
        this.options.directory === undefined ? this.store.listAll() : this.store.list(this.options.directory),
      )
      const published: SuperAgentOutboxRecord[] = []
      const failed: { event: SuperAgentOutboxRecord; error: string; retryAt: number }[] = []
      for (const run of runs) {
        const result = await Effect.runPromise(
          new SuperAgentOutboxWorker(this.store, this.publisher, {
            limit: this.options.limitPerRun,
          }).drain(run.id, at),
        )
        published.push(...result.published)
        failed.push(...result.failed)
      }
      return { published, failed }
    } finally {
      this.draining = false
    }
  }

  start() {
    if (this.timer) return
    const interval = Math.max(25, this.options.intervalMs ?? 1_000)
    this.timer = setInterval(() => {
      void this.drainOnce().catch((error) => this.options.onError?.(error))
    }, interval)
    void this.drainOnce().catch((error) => this.options.onError?.(error))
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  get active() {
    return this.timer !== undefined
  }
}
export class SuperAgentOutboxWorker {
  constructor(
    private readonly store: SuperAgentStoreInterface,
    private readonly publisher: SuperAgentEventPublisher,
    private readonly options: { limit?: number; baseBackoffMs?: number; maxBackoffMs?: number } = {},
  ) {}

  drain(runID: string, at = Date.now()) {
    const limit = this.options.limit ?? 100
    const baseBackoffMs = Math.max(1, this.options.baseBackoffMs ?? 100)
    const maxBackoffMs = Math.max(baseBackoffMs, this.options.maxBackoffMs ?? 30_000)
    const store = this.store
    const publisher = this.publisher
    return Effect.gen(function* () {
      const pending = yield* store.outbox(runID, limit, at)
      const published: SuperAgentOutboxRecord[] = []
      const failed: { event: SuperAgentOutboxRecord; error: string; retryAt: number }[] = []
      for (const event of pending) {
        const result = yield* publisher(event).pipe(
          Effect.match({
            onFailure: (error) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }),
            onSuccess: () => ({ ok: true as const }),
          }),
        )
        if (result.ok) {
          const acknowledged = yield* store.ackOutbox(event.eventID)
          if (acknowledged) published.push(acknowledged)
          continue
        }
        const retryAt = at + Math.min(maxBackoffMs, baseBackoffMs * 2 ** Math.min(event.attempts, 16))
        const retried = yield* store.failOutbox(event.eventID, result.error, retryAt)
        failed.push({ event: retried ?? event, error: result.error, retryAt })
      }
      return { published, failed }
    })
  }

  replay(runID: string, at = Date.now()) {
    return this.drain(runID, at)
  }
}
