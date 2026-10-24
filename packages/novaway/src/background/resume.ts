import { Context, Effect, Layer, Option } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { HttpClient } from "effect/unstable/http"
import { InstanceRef } from "@/effect/instance-ref"
import { Service as BackgroundJobService, type Info } from "./job"
import { Service as AgentMailboxService } from "@/team/mailbox"
import { SessionStatus } from "@/session/status"
import { startMonitor, startSubscribe } from "./watchers"
import type { SessionID } from "@/session/schema"

/**
 * Restart background watchers after a process restart.
 *
 * A monitor watching a dev server or a subscription waiting on CI should not
 * silently disappear because the desktop app was restarted. Jobs opt in by
 * setting `metadata.resumable = true` and recording everything needed to run
 * again.
 *
 * Jobs that used request headers are skipped: header values are deliberately
 * never persisted, so restarting them would poll unauthenticated and return
 * 401s forever. Those keep the explanatory error instead.
 *
 * Dependencies are resolved at call time with `serviceOption` so this service
 * can be provided anywhere in the route stack without dragging the whole
 * background/mailbox/process graph into the layer signature.
 */
export type Restored = {
  jobID: string
  type: string
  title?: string
  skipped?: "credentials"
}

export interface Interface {
  /** Restart every resumable job that was interrupted by a restart. */
  readonly restore: () => Effect.Effect<Restored[]>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/BackgroundResume") {}

const INTERRUPTED = "interrupted by restart"

/** One pass per instance: the middleware may call `restore` on every request. */
const done = new WeakSet<object>()

export const layer = Layer.succeed(
  Service,
  Service.of({
    restore: Effect.fn("BackgroundResume.restore")(function* () {
      const instance = Option.getOrUndefined(yield* Effect.serviceOption(InstanceRef))
      if (instance) {
        if (done.has(instance)) return []
        done.add(instance)
      }

      const background = Option.getOrUndefined(yield* Effect.serviceOption(BackgroundJobService))
      if (!background) return []
      const mailbox = Option.getOrUndefined(yield* Effect.serviceOption(AgentMailboxService))
      const status = Option.getOrUndefined(yield* Effect.serviceOption(SessionStatus.Service))
      const spawner = Option.getOrUndefined(yield* Effect.serviceOption(ChildProcessSpawner))
      const http = Option.getOrUndefined(yield* Effect.serviceOption(HttpClient.HttpClient))

      // BackgroundJob marks lingering `running` rows as cancelled at init; those
      // rows are ours to restart.
      const history = yield* background.history({ limit: 50 })
      const candidates = history.filter(
        (job: Info) => job.metadata?.resumable === true && job.status === "cancelled" && job.error === INTERRUPTED,
      )

      const restored: Restored[] = []
      for (const job of candidates) {
        const meta = (job.metadata ?? {}) as Record<string, unknown>
        const sessionID = typeof meta.sessionID === "string" ? (meta.sessionID as SessionID) : undefined
        if (!sessionID) continue

        if (job.type === "subscribe" && meta.auth === true) {
          restored.push({
            jobID: job.id,
            type: job.type,
            ...(job.title ? { title: job.title } : {}),
            skipped: "credentials",
          })
          continue
        }

        const result = yield* Effect.gen(function* () {
          if (job.type === "monitor") {
            const command = typeof meta.command === "string" ? meta.command : undefined
            if (!command) return undefined
            const info = yield* startMonitor(
              {
                id: job.id,
                command,
                ...(typeof meta.pattern === "string" ? { pattern: meta.pattern } : {}),
                timeout: typeof meta.timeout === "number" ? meta.timeout : 300,
                label: job.title ?? command,
                sessionID,
                resumed: true,
              },
              {
                background,
                ...(mailbox ? { mailbox } : {}),
                ...(status ? { status } : {}),
                ...(spawner ? { spawner } : {}),
              },
            )
            return { jobID: info.id, type: job.type, ...(job.title ? { title: job.title } : {}) } satisfies Restored
          }
          if (job.type === "subscribe") {
            const url =
              typeof meta.url === "string" ? meta.url : typeof meta.command === "string" ? meta.command : undefined
            if (!url) return undefined
            const info = yield* startSubscribe(
              {
                id: job.id,
                url,
                ...(typeof meta.pattern === "string" ? { match: meta.pattern } : {}),
                every: typeof meta.every === "number" ? meta.every : 60,
                timeout: typeof meta.timeout === "number" ? meta.timeout : 3600,
                label: job.title ?? url,
                sessionID,
                resumed: true,
              },
              { background, ...(mailbox ? { mailbox } : {}), ...(status ? { status } : {}), ...(http ? { http } : {}) },
            )
            return { jobID: info.id, type: job.type, ...(job.title ? { title: job.title } : {}) } satisfies Restored
          }
          return undefined
        }).pipe(Effect.catchCause(() => Effect.succeed(undefined)))

        if (result) restored.push(result)
      }

      if (restored.length > 0) yield* Effect.logInfo("restored background watchers", { count: restored.length })
      return restored
    }),
  }),
)

export const defaultLayer = layer

export * as BackgroundResume from "./resume"
