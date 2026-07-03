import { afterEach, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Deferred, Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Evolution } from "../../src/evolution/service"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(Bus.layer, Evolution.layer, CrossSpawnSpawner.defaultLayer).pipe(Layer.provide(Bus.layer)),
)

describe("evolution events", () => {
  afterEach(() => disposeAllInstances())

  it.instance("publishes an update event when pending candidates are created", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const evolution = yield* Evolution.Service
      const marker = Date.now()
      const eventType = yield* Deferred.make<string>()
      const unsubscribe = yield* bus.subscribeCallback(Evolution.Event.Updated, (event) =>
        Deferred.doneUnsafe(eventType, Effect.succeed(event.type)),
      )
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))

      const candidates = yield* evolution.review({
        proposals: [
          {
            kind: "project",
            target: `event-refresh-${marker}`,
            title: `cover event refresh ${marker}`,
            content: `candidate changes should refresh desktop status queries ${marker}.`,
            reason: "P22 protects the memory/evolution header indicators.",
          },
        ],
      })

      expect(candidates).toHaveLength(1)
      expect(yield* Deferred.await(eventType)).toBe("evolution.updated")
    }),
  )
})
