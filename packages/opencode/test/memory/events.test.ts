import { afterEach, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Deferred, Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Memory } from "../../src/memory/service"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(Bus.layer, Memory.layer, CrossSpawnSpawner.defaultLayer).pipe(Layer.provide(Bus.layer)),
)

describe("memory events", () => {
  afterEach(() => disposeAllInstances())

  it.instance("publishes a review update event when pending candidates are created", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const memory = yield* Memory.Service
      const marker = Date.now()
      const eventType = yield* Deferred.make<string>()
      const unsubscribe = yield* bus.subscribeCallback(Memory.Event.ReviewUpdated, (event) =>
        Deferred.doneUnsafe(eventType, Effect.succeed(event.type)),
      )
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))

      const candidates = yield* memory.review({
        userContent: `remember that p22 memory event refresh is covered ${marker}`,
      })

      expect(candidates).toHaveLength(1)
      expect(yield* Deferred.await(eventType)).toBe("memory.review.updated")
    }),
  )
})
