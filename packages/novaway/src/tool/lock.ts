import { Context, Deferred, Effect, Layer, SynchronizedRef } from "effect"

type Waiter = Deferred.Deferred<void>

type Entry = {
  readers: number
  writer: boolean
  waiters: Waiter[]
}

type State = Map<string, Entry>

/**
 * 锁的粒度是**一把钥匙**，不是会话（§10.1「团队内单写者」）。
 *
 * 同一队的成员是两个会话，却共用同一个 worktree：按会话加锁等于没锁，
 * 两个成员各自持有一把「独占」锁，同时写同一个文件。调用方给的键就是
 * 「这次写的是哪一份工作区」—— 运行内是团队坐标，运行外才是会话。
 */
export interface Interface {
  /**
   * Acquire a read (shared) or write (exclusive) permit for a key.
   * Returns an effect that releases the permit when it completes.
   */
  readonly acquire: (key: string, mode: "read" | "write") => Effect.Effect<Effect.Effect<void>>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/ToolLock") {}

const empty = (): Entry => ({ readers: 0, writer: false, waiters: [] })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* SynchronizedRef.make<State>(new Map())

    const wake = (waiters: Waiter[]) =>
      Effect.forEach(waiters, (waiter) => Deferred.succeed(waiter, undefined), { discard: true })

    const acquire: Interface["acquire"] = Effect.fn("ToolLock.acquire")(function* (key, mode) {
      while (true) {
        const acquired = yield* SynchronizedRef.modify(state, (map) => {
          const entry = map.get(key) ?? empty()
          if (mode === "read" && !entry.writer) {
            return [true, new Map(map).set(key, { ...entry, readers: entry.readers + 1 })] as const
          }
          if (mode === "write" && !entry.writer && entry.readers === 0) {
            return [true, new Map(map).set(key, { ...entry, writer: true })] as const
          }
          return [false, map] as const
        })
        if (acquired) break

        const waiter = yield* Deferred.make<void>()
        yield* SynchronizedRef.update(state, (map) => {
          const entry = map.get(key) ?? empty()
          return new Map(map).set(key, { ...entry, waiters: [...entry.waiters, waiter] })
        })
        yield* Deferred.await(waiter)
      }

      const release = Effect.fnUntraced(function* () {
        const waiters = yield* SynchronizedRef.modify(state, (map) => {
          const entry = map.get(key)
          if (!entry) return [[] as Waiter[], map] as const
          const next: Entry =
            mode === "read" ? { ...entry, readers: Math.max(0, entry.readers - 1) } : { ...entry, writer: false }
          const pending = next.waiters
          next.waiters = []
          return [pending, new Map(map).set(key, next)] as const
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
