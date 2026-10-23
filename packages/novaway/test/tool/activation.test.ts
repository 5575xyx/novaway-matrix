import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Service as Activation, defaultLayer as ActivationLayer } from "../../src/tool/activation"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(ActivationLayer))

const a = SessionID.make("ses_a")
const b = SessionID.make("ses_b")

describe("tool activation", () => {
  it.effect("activation is scoped per session", () =>
    Effect.gen(function* () {
      const activation = yield* Activation
      expect(yield* activation.active(a, "generate_image")).toBe(false)
      yield* activation.activate(a, ["generate_image"])
      expect(yield* activation.active(a, "generate_image")).toBe(true)
      expect(yield* activation.active(b, "generate_image")).toBe(false)
      expect(yield* activation.list(a)).toEqual(["generate_image"])
    }),
  )

  it.effect("activate is additive and idempotent", () =>
    Effect.gen(function* () {
      const activation = yield* Activation
      yield* activation.activate(a, ["generate_image"])
      yield* activation.activate(a, ["generate_image", "browser_click"])
      yield* activation.activate(a, [])
      expect((yield* activation.list(a)).sort()).toEqual(["browser_click", "generate_image"])
    }),
  )

  it.effect("clear resets a session", () =>
    Effect.gen(function* () {
      const activation = yield* Activation
      yield* activation.activate(a, ["generate_image"])
      yield* activation.clear(a)
      expect(yield* activation.list(a)).toEqual([])
      expect(yield* activation.active(a, "generate_image")).toBe(false)
    }),
  )
})
