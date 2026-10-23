import { Context, Deferred, Effect, Layer, SynchronizedRef } from "effect"
import type { SessionID } from "@/session/schema"

type Waiter = Deferred.Deferred<void>

type Entry = {
  readers: number
  writer: boolean
  waiters: Waiter[]
}

type State = Map<SessionID, Entry>

export interface Interface {
  /**
   * Acquire a read (shared) or write (exclusive) permit for a session.
   * Returns an effect that releases the permit when it completes.
   */
  readonly acquire: (sessionID: SessionID, mode: "read" | "write") => Effect.Effect<Effect.Effect<void>>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/ToolLock") {}

const empty = (): Entry => ({ readers: 0, writer: false, waiters: [] })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* SynchronizedRef.make<State>(new Map())

    const wake = (waiters: Waiter[]) =>
      Effect.forEach(waiters, (waiter) => Deferred.succeed(waiter, undefined), { discard: true })

    const acquire: Interface["acquire"] = Effect.fn("ToolLock.acquire")(function* (sessionID, mode) {
      while (true) {
        const acquired = yield* SynchronizedRef.modify(state, (map) => {
          const entry = map.get(sessionID) ?? empty()
          if (mode === "read" && !entry.writer) {
            return [true, new Map(map).set(sessionID, { ...entry, readers: entry.readers + 1 })] as const
          }
          if (mode === "write" && !entry.writer && entry.readers === 0) {
            return [true, new Map(map).set(sessionID, { ...entry, writer: true })] as const
          }
          return [false, map] as const
        })
        if (acquired) break

        const waiter = yield* Deferred.make<void>()
        yield* SynchronizedRef.update(state, (map) => {
          const entry = map.get(sessionID) ?? empty()
          return new Map(map).set(sessionID, { ...entry, waiters: [...entry.waiters, waiter] })
        })
        yield* Deferred.await(waiter)
      }

      const release = Effect.fnUntraced(function* () {
        const waiters = yield* SynchronizedRef.modify(state, (map) => {
          const entry = map.get(sessionID)
          if (!entry) return [[] as Waiter[], map] as const
          const next: Entry =
            mode === "read" ? { ...entry, readers: Math.max(0, entry.readers - 1) } : { ...entry, writer: false }
          const pending = next.waiters
          next.waiters = []
          return [pending, new Map(map).set(sessionID, next)] as const
        })
        yield* wake(waiters)
      })
      return release()
    })

    return Service.of({ acquire })
  }),
)

export const defaultLayer = layer

export * as ToolLock from "./lock"
