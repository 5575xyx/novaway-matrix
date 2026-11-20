import { Effect } from "effect"
import type { Interface as SuperAgentStoreInterface, StoredSuperAgentRun } from "./store"
import { canTransitionRun } from "./types"

export type SuperAgentWatchdogOptions = {
  heartbeatEscalationThreshold?: number
  onError?: (error: unknown) => void
}

export type HeartbeatDiagnostic = {
  runID: string
  taskID: string
  childTaskID: string
  message: string
  count: number
  escalated: boolean
}

/**
 * Deterministic watchdog policy for long-lived Agent operations. Every missed
 * lease is converted to a durable diagnostic; repeated child heartbeat misses
 * escalate the parent Run to needs_review instead of silently retrying it.
 */
export class SuperAgentWatchdog {
  private readonly heartbeatMisses = new Map<string, number>()
  private readonly threshold: number

  constructor(
    private readonly store: SuperAgentStoreInterface,
    options: SuperAgentWatchdogOptions = {},
  ) {
    this.threshold = Math.max(1, options.heartbeatEscalationThreshold ?? 2)
  }

  async recordHeartbeatFailure(input: Omit<HeartbeatDiagnostic, "count" | "escalated">): Promise<HeartbeatDiagnostic> {
    const key = `${input.runID}:${input.taskID}:${input.childTaskID}`
    const count = (this.heartbeatMisses.get(key) ?? 0) + 1
    this.heartbeatMisses.set(key, count)
    const run = await Effect.runPromise(this.store.get(input.runID))
    const escalated = count >= this.threshold && !!run && canTransitionRun(run.status, "needs_review")
    await Effect.runPromise(
      this.store.appendEvent({
        runID: input.runID,
        type: "child_agent_heartbeat_failed",
        at: Date.now(),
        payload: { ...input, count, escalated },
      }),
    )
    if (escalated) await Effect.runPromise(this.store.transition(input.runID, "needs_review"))
    return { ...input, count, escalated }
  }

  async tick(runID?: string, at = Date.now()) {
    const operations = await Effect.runPromise(this.store.recoverExpiredOperations(runID, at))
    const escalated: StoredSuperAgentRun[] = []
    for (const operation of operations) {
      await Effect.runPromise(
        this.store.appendEvent({
          runID: operation.runID,
          type: "operation_lease_expired",
          at,
          payload: { operationID: operation.id, instructionID: operation.instructionID, reason: operation.reason },
        }),
      )
      const run = await Effect.runPromise(this.store.get(operation.runID))
      if (run && canTransitionRun(run.status, "needs_review")) {
        const updated = await Effect.runPromise(this.store.transition(operation.runID, "needs_review"))
        if (updated) escalated.push(updated)
      }
    }
    return { operations, escalated }
  }
}

/** Host lifecycle wrapper; stop always clears the only timer it owns. */
export class SuperAgentWatchdogHost {
  private timer: ReturnType<typeof setInterval> | undefined
  private running = false

  constructor(
    private readonly store: SuperAgentStoreInterface,
    private readonly watchdog: SuperAgentWatchdog,
    private readonly options: { intervalMs?: number; directory?: string; onError?: (error: unknown) => void } = {},
  ) {}

  start() {
    if (this.timer) return
    this.timer = setInterval(() => {
      if (this.running) return
      this.running = true
      void Effect.runPromise(
        this.options.directory === undefined ? this.store.listAll() : this.store.list(this.options.directory),
      )
        .then((runs) => Promise.all(runs.map((run) => this.watchdog.tick(run.id))))
        .catch((error) => this.options.onError?.(error))
        .finally(() => {
          this.running = false
        })
    }, Math.max(50, this.options.intervalMs ?? 1_000))
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.running = false
  }

  get active() {
    return this.timer !== undefined
  }
}
