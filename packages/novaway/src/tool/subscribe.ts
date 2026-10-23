import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import { Service as BackgroundJobService } from "@/background/job"
import { Service as AgentMailboxService } from "@/team/mailbox"
import { SessionStatus } from "@/session/status"
import { startSubscribe, type PromptOps } from "@/background/watchers"

export const SubscribeParameters = Schema.Struct({
  url: Schema.String.annotate({ description: "HTTP(S) endpoint to poll (PR feed, CI status, deploy hook, JSON API)" }),
  every: Schema.optional(Schema.Number).annotate({
    description: "Seconds between polls (default 60, clamped to 1..3600)",
  }),
  match: Schema.optional(Schema.String).annotate({
    description:
      "Regular expression; notify as soon as the response body matches. Omit to notify on any change to the body.",
  }),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Extra request headers, e.g. an API token (never persisted, so a restart needs the tool again)",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Seconds before the subscription gives up (default 3600, clamped to 60..86400)",
  }),
  description: Schema.optional(Schema.String).annotate({ description: "Short label used in notifications" }),
})
export type SubscribeParameters = Schema.Schema.Type<typeof SubscribeParameters>

type Metadata = {
  jobID?: string
  url?: string
  pattern?: string
}

const DEFAULT_EVERY = 60
const DEFAULT_TIMEOUT = 3_600

const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(Math.max(Math.round(value ?? fallback), min), max)

/**
 * Poll an HTTP endpoint until something changes.
 *
 * This is the generic form of "subscribe to a PR": check a feed, a CI status
 * endpoint or a deploy hook on an interval, and wake the agent when the
 * response matches a pattern (or simply changes). Runs as a background job so
 * the tool returns immediately and the work is visible in the status panel.
 *
 * Requests without custom headers are resumable across restarts; with headers
 * the values are never written to the database, so the job is marked as needing
 * credentials instead of being silently polled unauthenticated.
 */
export const SubscribeTool = Tool.define<
  typeof SubscribeParameters,
  Metadata,
  BackgroundJobService | AgentMailboxService | SessionStatus.Service | HttpClient.HttpClient
>(
  "subscribe",
  Effect.gen(function* () {
    const background = yield* BackgroundJobService
    const mailbox = yield* AgentMailboxService
    const status = yield* SessionStatus.Service
    const http = yield* HttpClient.HttpClient

    return {
      description:
        "Poll an HTTP endpoint in the background and wake this session when the response matches a pattern or changes. Returns immediately. Use for PR feeds, CI status, deploy hooks.",
      parameters: SubscribeParameters,
      capabilities: { concurrencySafe: true },
      execute: (params: SubscribeParameters, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!/^https?:\/\//.test(params.url)) {
            return { title: "Invalid URL", output: "URL must start with http:// or https://", metadata: {} }
          }
          const every = clamp(params.every, DEFAULT_EVERY, 1, 3_600)
          const timeout = clamp(params.timeout, DEFAULT_TIMEOUT, 60, 86_400)
          const name = params.description ?? params.url
          const auth = params.headers && Object.keys(params.headers).length > 0

          yield* ctx.ask({ permission: "webfetch", patterns: [params.url], always: [params.url], metadata: {} })

          const info = yield* startSubscribe(
            {
              url: params.url,
              ...(params.match ? { match: params.match } : {}),
              every,
              timeout,
              label: name,
              sessionID: ctx.sessionID,
              ...(params.headers ? { headers: params.headers } : {}),
              ...(auth ? { auth: true } : {}),
            },
            {
              background,
              mailbox,
              status,
              http,
              ...(ctx.extra?.promptOps ? { ops: ctx.extra.promptOps as PromptOps } : {}),
            },
          )

          return {
            title: `Subscribed to ${name}`,
            output: [
              `Subscription started in the background (job ${info.id}).`,
              `Polling every ${every}s, giving up after ${timeout}s.`,
              params.match ? `Wakes on match: ${params.match}` : "Wakes on any change to the response body.",
              ...(auth
                ? ["Custom headers are not stored: after a restart this subscription must be started again."]
                : []),
            ].join("\n"),
            metadata: { jobID: info.id, url: params.url, pattern: params.match },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
