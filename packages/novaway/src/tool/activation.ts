import { Context, Effect, Layer, SynchronizedRef } from "effect"
import type { SessionID } from "@/session/schema"

/**
 * Deferred-tool activation.
 *
 * A tool with `capabilities.deferLoading` is left out of the request until the
 * model asks `tool_search` for it. That keeps the initial tool block small:
 * long-tail tools (browser automation, media generation) cost tokens on every
 * turn even though most sessions never use them.
 *
 * Activation is per session and lives in memory: a fresh session starts with
 * only the searchable names, and the model re-activates what it needs.
 */
export interface Interface {
  readonly active: (sessionID: SessionID, toolID: string) => Effect.Effect<boolean>
  readonly activate: (sessionID: SessionID, toolIDs: readonly string[]) => Effect.Effect<void>
  readonly list: (sessionID: SessionID) => Effect.Effect<string[]>
  readonly clear: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/ToolActivation") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* SynchronizedRef.make<Map<string, Set<string>>>(new Map())

    const active: Interface["active"] = Effect.fn("ToolActivation.active")(function* (sessionID, toolID) {
      const map = yield* SynchronizedRef.get(state)
      return map.get(sessionID)?.has(toolID) ?? false
    })

    const activate: Interface["activate"] = Effect.fn("ToolActivation.activate")(function* (sessionID, toolIDs) {
      if (toolIDs.length === 0) return
      yield* SynchronizedRef.update(state, (map) => {
        const next = new Map(map)
        const set = new Set(map.get(sessionID) ?? [])
        for (const id of toolIDs) set.add(id)
        next.set(sessionID, set)
        return next
      })
    })

    const list: Interface["list"] = Effect.fn("ToolActivation.list")(function* (sessionID) {
      const map = yield* SynchronizedRef.get(state)
      return [...(map.get(sessionID) ?? [])]
    })

    const clear: Interface["clear"] = Effect.fn("ToolActivation.clear")(function* (sessionID) {
      yield* SynchronizedRef.update(state, (map) => {
        if (!map.has(sessionID)) return map
        const next = new Map(map)
        next.delete(sessionID)
        return next
      })
    })

    return Service.of({ active, activate, list, clear })
  }),
)

export const defaultLayer = layer

export * as ToolActivation from "./activation"
