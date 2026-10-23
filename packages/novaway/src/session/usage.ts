import { Context, Effect, Layer } from "effect"
import { eq, inArray } from "drizzle-orm"
import { Database } from "@/storage/db"
import { SessionTable } from "./session.sql"
import type { SessionID } from "./schema"

/**
 * Token/cost accounting for sessions.
 *
 * The `session` row already carries a running total: projectors fold every
 * `step-finish` part into `cost` and the `tokens_*` columns. Reading the row is
 * therefore both cheaper and more accurate than re-scanning messages, and it
 * works for child sessions (subagents) that ran in another process.
 */
export namespace SessionUsage {
  export type Tokens = {
    readonly input: number
    readonly output: number
    readonly reasoning: number
    readonly cacheRead: number
    readonly cacheWrite: number
    readonly total: number
  }

  export type Value = {
    readonly cost: number
    readonly tokens: Tokens
  }

  export type Entry = Value & {
    readonly sessionID: SessionID
    readonly parentID?: SessionID
    readonly agent?: string
    readonly updatedAt: number
  }

  export type Tree = {
    readonly total: Value
    readonly sessions: Entry[]
  }

  /** A point-in-time reading, used to attribute spend to a task. */
  export type Mark = Value & { readonly at: number }

  export interface Interface {
    readonly list: (sessionIDs: readonly SessionID[]) => Effect.Effect<Entry[]>
    readonly get: (sessionID: SessionID) => Effect.Effect<Entry | undefined>
    /** The session plus every descendant, with the combined total. */
    readonly tree: (sessionID: SessionID) => Effect.Effect<Tree>
  }

  export class Service extends Context.Service<Service, Interface>()("@NovaWay/SessionUsage") {}

  export function emptyTokens(): Tokens {
    return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }

  export function empty(): Value {
    return { cost: 0, tokens: emptyTokens() }
  }

  export function add(base: Value, value: Value): Value {
    const a = base.tokens
    const b = value.tokens
    return {
      cost: base.cost + value.cost,
      tokens: {
        input: a.input + b.input,
        output: a.output + b.output,
        reasoning: a.reasoning + b.reasoning,
        cacheRead: a.cacheRead + b.cacheRead,
        cacheWrite: a.cacheWrite + b.cacheWrite,
        total: a.total + b.total,
      },
    }
  }

  export function sum(values: Iterable<Value>): Value {
    let total = empty()
    for (const value of values) total = add(total, value)
    return total
  }

  /**
   * Spend between two readings. Reverts subtract from the session row, so a
   * negative delta is clamped instead of reported.
   */
  export function delta(after: Value, before: Value | undefined): Value {
    const base = before ?? empty()
    return {
      cost: Math.max(0, after.cost - base.cost),
      tokens: {
        input: Math.max(0, after.tokens.input - base.tokens.input),
        output: Math.max(0, after.tokens.output - base.tokens.output),
        reasoning: Math.max(0, after.tokens.reasoning - base.tokens.reasoning),
        cacheRead: Math.max(0, after.tokens.cacheRead - base.tokens.cacheRead),
        cacheWrite: Math.max(0, after.tokens.cacheWrite - base.tokens.cacheWrite),
        total: Math.max(0, after.tokens.total - base.tokens.total),
      },
    }
  }

  export function mark(entry: Value): Mark {
    return { cost: entry.cost, tokens: entry.tokens, at: Date.now() }
  }

  /**
   * Roll a session tree up onto a set of owner sessions (team members).
   *
   * Each entry counts towards its nearest owner ancestor: a worker's own
   * subagents therefore accrue to that worker, while the root's spend accrues
   * to the lead. Entries with no owner in their ancestry are left out.
   */
  export function attribute(entries: Iterable<Entry>, owners: readonly string[]): Map<string, Value> {
    const all = [...entries]
    const byID = new Map(all.map((entry) => [entry.sessionID as string, entry]))
    const roots = new Set(owners)
    const result = new Map<string, Value>()
    for (const entry of all) {
      let current: string | undefined = entry.sessionID
      let owner: string | undefined
      const seen = new Set<string>()
      while (current && !seen.has(current)) {
        if (roots.has(current)) {
          owner = current
          break
        }
        seen.add(current)
        current = byID.get(current)?.parentID
      }
      if (!owner) continue
      result.set(owner, add(result.get(owner) ?? empty(), entry))
    }
    return result
  }

  /** Read a mark back from task metadata (stored as JSON, so untrusted). */
  export function readMark(input: unknown): Mark | undefined {
    if (!input || typeof input !== "object") return undefined
    const value = input as Record<string, unknown>
    if (typeof value.cost !== "number") return undefined
    const tokens = value.tokens
    if (!tokens || typeof tokens !== "object") return undefined
    const t = tokens as Record<string, unknown>
    const read = (key: string) => (typeof t[key] === "number" ? (t[key] as number) : 0)
    return {
      cost: value.cost,
      tokens: {
        input: read("input"),
        output: read("output"),
        reasoning: read("reasoning"),
        cacheRead: read("cacheRead"),
        cacheWrite: read("cacheWrite"),
        total: read("total"),
      },
      at: typeof value.at === "number" ? value.at : 0,
    }
  }

  export function toEntry(row: typeof SessionTable.$inferSelect): Entry {
    const tokens: Tokens = {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cacheRead: row.tokens_cache_read,
      cacheWrite: row.tokens_cache_write,
      total:
        row.tokens_input + row.tokens_output + row.tokens_reasoning + row.tokens_cache_read + row.tokens_cache_write,
    }
    return {
      sessionID: row.id,
      parentID: row.parent_id ?? undefined,
      agent: row.agent ?? undefined,
      updatedAt: row.time_updated,
      cost: row.cost,
      tokens,
    }
  }

  export const layer = Layer.succeed(
    Service,
    Service.of({
      list: (sessionIDs) =>
        Effect.sync(() => {
          const ids = [...new Set(sessionIDs)]
          if (ids.length === 0) return []
          return Database.use((db) =>
            db.select().from(SessionTable).where(inArray(SessionTable.id, ids)).all().map(toEntry),
          )
        }),

      get: (sessionID) =>
        Effect.sync(() => {
          const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
          return row ? toEntry(row) : undefined
        }),

      tree: (sessionID) =>
        Effect.sync(() => {
          const entries: Entry[] = []
          const seen = new Set<string>()
          let frontier: SessionID[] = [sessionID]
          while (frontier.length > 0) {
            const level = frontier
            const ids = level.filter((id) => !seen.has(id))
            if (ids.length === 0) break
            const rows = Database.use((db) => db.select().from(SessionTable).where(inArray(SessionTable.id, ids)).all())
            for (const row of rows) {
              if (seen.has(row.id)) continue
              seen.add(row.id)
              entries.push(toEntry(row))
            }
            const children = Database.use((db) =>
              db.select({ id: SessionTable.id }).from(SessionTable).where(inArray(SessionTable.parent_id, ids)).all(),
            )
            frontier = children.map((row) => row.id).filter((id) => !seen.has(id))
          }
          return { total: sum(entries), sessions: entries }
        }),
    }),
  )

  export const defaultLayer = layer
}
