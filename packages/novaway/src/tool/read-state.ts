import { Context, Effect, Layer, SynchronizedRef } from "effect"
import { AppFileSystem } from "@novaway/core/filesystem"
import type { SessionID } from "@/session/schema"

/**
 * Per-session record of files the model has actually read.
 *
 * Edit/Write consult this before touching a file, mirroring Claude Code's
 * `readFileState`:
 *
 * - an unread file must be read first;
 * - a partial read (offset/limit or a truncated response) is not enough to
 *   justify an edit — the model may be reasoning about content it never saw;
 * - a file modified after the read (by the user, a watcher, or another tool)
 *   is stale, so the edit is rejected instead of silently applied to a
 *   different version.
 *
 * State is in-memory and scoped to a session. A restart simply makes the
 * model read again, which is the safe direction.
 */
export type Entry = {
  /** Absolute path as the caller supplied it (filled in by `record`). */
  path?: string
  /** Wall clock when the read completed. */
  timestamp: number
  /** File mtime observed at read time (epoch ms), 0 when unavailable. */
  mtime: number
  /** File size at read time. */
  size: number
  /** The read did not cover the whole file. */
  partial: boolean
  offset?: number
  limit?: number
}

export interface Interface {
  readonly get: (sessionID: SessionID, filePath: string) => Effect.Effect<Entry | undefined>
  readonly record: (sessionID: SessionID, filePath: string, entry: Entry) => Effect.Effect<void>
  /** Every file this session has read, with its absolute path. */
  readonly list: (sessionID: SessionID) => Effect.Effect<{ path: string; entry: Entry }[]>
  /** Forget a single file (used when it changed on disk behind our back). */
  readonly forget: (sessionID: SessionID, filePath: string) => Effect.Effect<void>
  readonly clear: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/ReadState") {}

function key(filePath: string) {
  const resolved = AppFileSystem.resolve(filePath)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* SynchronizedRef.make<Map<string, Map<string, Entry>>>(new Map())

    const get: Interface["get"] = Effect.fn("ReadState.get")(function* (sessionID, filePath) {
      const map = yield* SynchronizedRef.get(state)
      return map.get(sessionID)?.get(key(filePath))
    })

    const record: Interface["record"] = Effect.fn("ReadState.record")(function* (sessionID, filePath, entry) {
      const stored: Entry = { ...entry, path: entry.path ?? AppFileSystem.resolve(filePath) }
      yield* SynchronizedRef.update(state, (map) => {
        const next = new Map(map)
        const entries = new Map(map.get(sessionID) ?? [])
        entries.set(key(filePath), stored)
        next.set(sessionID, entries)
        return next
      })
    })

    const list: Interface["list"] = Effect.fn("ReadState.list")(function* (sessionID) {
      const map = yield* SynchronizedRef.get(state)
      const entries = map.get(sessionID)
      if (!entries) return []
      return Array.from(entries.entries(), ([key, entry]) => ({ path: entry.path ?? key, entry }))
    })

    const forget: Interface["forget"] = Effect.fn("ReadState.forget")(function* (sessionID, filePath) {
      yield* SynchronizedRef.update(state, (map) => {
        const entries = map.get(sessionID)
        if (!entries?.has(key(filePath))) return map
        const next = new Map(map)
        const updated = new Map(entries)
        updated.delete(key(filePath))
        next.set(sessionID, updated)
        return next
      })
    })

    const clear: Interface["clear"] = Effect.fn("ReadState.clear")(function* (sessionID) {
      yield* SynchronizedRef.update(state, (map) => {
        if (!map.has(sessionID)) return map
        const next = new Map(map)
        next.delete(sessionID)
        return next
      })
    })

    return Service.of({ get, record, list, forget, clear })
  }),
)

export const defaultLayer = layer

export * as ReadState from "./read-state"
