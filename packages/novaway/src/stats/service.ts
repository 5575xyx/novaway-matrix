import { InstanceRef } from "@/effect/instance-ref"
import { Session } from "@/session/session"
import { SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { NotFoundError } from "@/storage/storage"
import { Context, Effect, Layer, Schema, Types } from "effect"

const Tokens = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  reasoning: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite,
    write: Schema.Finite,
  }),
}).annotate({ identifier: "StatsTokens" })

const ModelUsage = Schema.Struct({
  messages: Schema.Finite,
  tokens: Schema.Struct({
    input: Schema.Finite,
    output: Schema.Finite,
    cache: Schema.Struct({
      read: Schema.Finite,
      write: Schema.Finite,
    }),
  }),
  cost: Schema.Finite,
}).annotate({ identifier: "StatsModelUsage" })

export const Info = Schema.Struct({
  totalSessions: Schema.Finite,
  totalMessages: Schema.Finite,
  totalCost: Schema.Finite,
  totalTokens: Tokens,
  /** Tool id → invocation count, across every session in the window. */
  toolUsage: Schema.Record(Schema.String, Schema.Finite),
  /** `providerID/modelID` → usage, across every session in the window. */
  modelUsage: Schema.Record(Schema.String, ModelUsage),
  dateRange: Schema.Struct({
    earliest: Schema.Finite,
    latest: Schema.Finite,
  }),
  days: Schema.Finite,
  costPerDay: Schema.Finite,
  tokensPerSession: Schema.Finite,
  medianTokensPerSession: Schema.Finite,
}).annotate({ identifier: "StatsInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export const Query = Schema.Struct({
  /** Window in days. `0` means "since local midnight today"; omitted means all time. */
  days: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  /** Project id to filter by. Empty string means the current project. */
  project: Schema.optional(Schema.String),
}).annotate({ identifier: "StatsQuery" })
export type Query = Schema.Schema.Type<typeof Query>

export interface Interface {
  readonly aggregate: (query: Query) => Effect.Effect<Info>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/Stats") {}

const MS_IN_DAY = 24 * 60 * 60 * 1000

const allSessions = Effect.sync(() =>
  Database.use((db) => db.select().from(SessionTable).all()).map((row) => Session.fromRow(row)),
)

const emptyTokens = () => ({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

/**
 * Fold every session in the window into one aggregate.
 *
 * Reads message history per session; concurrency is bounded so a large
 * database does not open hundreds of cursors at once.
 */
export const layer: Layer.Layer<Service, never, Session.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service

    const aggregate = Effect.fn("Stats.aggregate")(function* (query: Query) {
      const days = query.days
      const cutoff =
        days === undefined
          ? 0
          : days === 0
            ? (() => {
                const now = new Date()
                now.setHours(0, 0, 0, 0)
                return now.getTime()
              })()
            : Date.now() - days * MS_IN_DAY
      const windowDays = days === undefined ? undefined : days === 0 ? 1 : days

      let selected =
        cutoff > 0 ? (yield* allSessions).filter((item) => item.time.updated >= cutoff) : yield* allSessions

      if (query.project !== undefined) {
        if (query.project === "") {
          // Empty string means "the project this request is scoped to". The
          // instance middleware always provides it; without one we cannot
          // resolve the filter, so fail loudly instead of returning all projects.
          const current = yield* InstanceRef
          if (!current) return yield* Effect.die(new Error("stats: project filter requires an instance context"))
          selected = selected.filter((item) => item.projectID === current.project.id)
        } else {
          selected = selected.filter((item) => item.projectID === query.project)
        }
      }

      const stats: Types.DeepMutable<Info> = {
        totalSessions: selected.length,
        totalMessages: 0,
        totalCost: 0,
        totalTokens: emptyTokens(),
        toolUsage: {},
        modelUsage: {},
        dateRange: { earliest: Date.now(), latest: Date.now() },
        days: windowDays ?? 0,
        costPerDay: 0,
        tokensPerSession: 0,
        medianTokensPerSession: 0,
      }

      if (selected.length === 0) return stats

      const results = yield* Effect.forEach(
        selected,
        (session) =>
          Effect.gen(function* () {
            const messages = yield* sessions
              .messages({ sessionID: session.id })
              .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed([])))

            const sessionTokens = session.tokens ?? emptyTokens()
            const toolUsage: Record<string, number> = {}
            const modelUsage: Record<
              string,
              {
                messages: number
                tokens: { input: number; output: number; cache: { read: number; write: number } }
                cost: number
              }
            > = {}

            for (const message of messages) {
              if (message.info.role === "assistant") {
                const key = `${message.info.providerID}/${message.info.modelID}`
                const entry = (modelUsage[key] ??= {
                  messages: 0,
                  tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                  cost: 0,
                })
                entry.messages++
                entry.cost += message.info.cost || 0
                if (message.info.tokens) {
                  entry.tokens.input += message.info.tokens.input || 0
                  // Reasoning tokens are billed as output; roll them in so the
                  // per-model numbers add up to the session totals.
                  entry.tokens.output += (message.info.tokens.output || 0) + (message.info.tokens.reasoning || 0)
                  entry.tokens.cache.read += message.info.tokens.cache?.read || 0
                  entry.tokens.cache.write += message.info.tokens.cache?.write || 0
                }
              }

              for (const part of message.parts) {
                if (part.type === "tool" && part.tool) toolUsage[part.tool] = (toolUsage[part.tool] || 0) + 1
              }
            }

            return {
              messageCount: messages.length,
              cost: session.cost ?? 0,
              tokens: sessionTokens,
              totalTokens:
                sessionTokens.input +
                sessionTokens.output +
                sessionTokens.reasoning +
                sessionTokens.cache.read +
                sessionTokens.cache.write,
              toolUsage,
              modelUsage,
              earliest: cutoff > 0 ? session.time.updated : session.time.created,
              latest: session.time.updated,
            }
          }),
        { concurrency: 20 },
      )

      let earliest = Date.now()
      let latest = 0
      const perSession: number[] = []

      for (const result of results) {
        earliest = Math.min(earliest, result.earliest)
        latest = Math.max(latest, result.latest)
        perSession.push(result.totalTokens)

        stats.totalMessages += result.messageCount
        stats.totalCost += result.cost
        stats.totalTokens.input += result.tokens.input
        stats.totalTokens.output += result.tokens.output
        stats.totalTokens.reasoning += result.tokens.reasoning
        stats.totalTokens.cache.read += result.tokens.cache.read
        stats.totalTokens.cache.write += result.tokens.cache.write

        for (const [tool, count] of Object.entries(result.toolUsage)) {
          stats.toolUsage[tool] = (stats.toolUsage[tool] || 0) + count
        }

        for (const [model, usage] of Object.entries(result.modelUsage)) {
          const entry = (stats.modelUsage[model] ??= {
            messages: 0,
            tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            cost: 0,
          })
          entry.messages += usage.messages
          entry.tokens.input += usage.tokens.input
          entry.tokens.output += usage.tokens.output
          entry.tokens.cache.read += usage.tokens.cache.read
          entry.tokens.cache.write += usage.tokens.cache.write
          entry.cost += usage.cost
        }
      }

      const rangeDays = Math.max(1, Math.ceil((latest - earliest) / MS_IN_DAY))
      stats.dateRange = { earliest, latest }
      stats.days = windowDays ?? rangeDays
      stats.costPerDay = stats.totalCost / stats.days
      const total =
        stats.totalTokens.input +
        stats.totalTokens.output +
        stats.totalTokens.reasoning +
        stats.totalTokens.cache.read +
        stats.totalTokens.cache.write
      stats.tokensPerSession = selected.length > 0 ? total / selected.length : 0
      perSession.sort((a, b) => a - b)
      const mid = Math.floor(perSession.length / 2)
      stats.medianTokensPerSession =
        perSession.length === 0
          ? 0
          : perSession.length % 2 === 0
            ? (perSession[mid - 1] + perSession[mid]) / 2
            : perSession[mid]

      return stats
    })

    return Service.of({ aggregate })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Session.defaultLayer))

export * as Stats from "./service"
