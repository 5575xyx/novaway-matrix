import { Context, Effect, Layer, Option, Scope } from "effect"
import { SuperAgentStore } from "@/super-agent"
import { isTerminal, Service as RunService } from "./run"
import { Service as AssignmentService, type Assignment } from "./assignment"

/**
 * Lease watchdog for employee dispatches.
 *
 * A request-triggered sweep is useful as a safety net, but it is not enough:
 * a run can lose its worker while the UI is idle. This service keeps one
 * scoped ticker per loaded workspace and converts expired active assignments
 * into an explicit `needs_review` decision. It never creates a retry and it
 * never replays an unknown external side effect.
 */

const DEFAULT_INTERVAL_MS = 15_000
const MIN_INTERVAL_MS = 1_000
const MAX_INTERVAL_MS = 5 * 60_000

export type LeaseReview = {
  runID: string
  assignments: Assignment[]
}

export interface Interface {
  /** Sweep one workspace once. Safe to call from request recovery as well. */
  readonly tick: (input: { directory?: string; now?: number }) => Effect.Effect<LeaseReview[]>
  /** Start the durable-in-process ticker. Repeated calls for a directory are no-ops. */
  readonly start: (input: { directory: string }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@novaway/TeamAssignmentWatchdog") {}

const interval = () => {
  const value = Number(process.env.NOVAWAY_ASSIGNMENT_WATCHDOG_INTERVAL_MS)
  if (!Number.isFinite(value)) return DEFAULT_INTERVAL_MS
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(value)))
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const runs = yield* RunService
    const assignments = yield* AssignmentService
    const superAgent = Option.getOrUndefined(yield* Effect.serviceOption(SuperAgentStore))
    const scope = yield* Scope.Scope
    const context = yield* Effect.context()
    const runningDirectories = new Set<string>()

    const tick: Interface["tick"] = Effect.fn("TeamAssignmentWatchdog.tick")(function* (input) {
      const reviews: LeaseReview[] = []
      const candidates = yield* runs.list()

      for (const candidate of candidates) {
        if ((input.directory && candidate.directory !== input.directory) || isTerminal(candidate.state)) continue
        const expired = yield* assignments.expireDue({
          runID: candidate.id,
          now: input.now,
          status: "needs_review",
        })
        if (expired.length === 0) continue

        const current = yield* runs.get(candidate.id)
        if (!current || isTerminal(current.state) || current.state === "needs_review") continue
        if (current.state !== "running" && current.state !== "blocked") continue

        yield* runs.update({
          runID: candidate.id,
          state: "needs_review",
          phase: null,
          terminalReason: "assignment-lease-expired",
          error: `有 ${expired.length} 项员工派工租约过期，结果不明，请先核对后再创建新 attempt`,
          event: {
            kind: "employee.assignment.lease_review_required",
            payload: { count: expired.length, assignmentIDs: expired.map((item) => item.id) },
          },
        })
        reviews.push({ runID: candidate.id, assignments: expired })
      }

      return reviews
    })

    const start: Interface["start"] = Effect.fn("TeamAssignmentWatchdog.start")(function* (input) {
      if (runningDirectories.has(input.directory)) return
      runningDirectories.add(input.directory)

      // Repair projections left behind by a process crash before the normal
      // lease sweep. TaskNode remains the source of truth; this only rebuilds
      // the disposable AgentTask board.
      if (superAgent) yield* superAgent.rebuildTaskProjections(input.directory).pipe(Effect.ignore)

      // Sweep immediately so a lease that expired while the workspace was idle
      // is not delayed until the first interval.
      yield* tick(input).pipe(Effect.ignore)

      yield* Effect.forever(
        Effect.sleep(`${interval()} millis`).pipe(
          Effect.andThen(tick(input)),
          Effect.ignore,
        ),
      ).pipe(Effect.provide(context), Effect.forkIn(scope, { startImmediately: true }), Effect.asVoid)
    })

    yield* Effect.addFinalizer(() => Effect.sync(() => runningDirectories.clear()))
    return Service.of({ tick, start })
  }),
)

export const defaultLayer = layer
