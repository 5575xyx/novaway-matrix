import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { MessageID, SessionID } from "../../src/session/schema"
import { SleepTool, clampDuration } from "../../src/tool/sleep"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

const ctx = (abort = new AbortController()) => ({
  sessionID: SessionID.make("ses_test-sleep"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: abort.signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

const run = (duration_ms: number, context = ctx()) =>
  Effect.gen(function* () {
    const info = yield* SleepTool
    const tool = yield* info.init()
    return yield* tool.execute({ duration_ms }, context)
  })

describe("tool.sleep", () => {
  it.instance("waits for the requested duration", () =>
    Effect.gen(function* () {
      const start = Date.now()
      const result = yield* run(30)
      expect(Date.now() - start).toBeGreaterThanOrEqual(20)
      expect(result.output).toContain("Slept for")
      expect(result.metadata.duration_ms).toBe(30)
    }),
  )

  it.instance("zero and negative durations return immediately", () =>
    Effect.gen(function* () {
      const zero = yield* run(0)
      const negative = yield* run(-500)
      expect(zero.output).toBe("Nothing to wait for.")
      expect(negative.metadata.duration_ms).toBe(0)
    }),
  )

  it.instance("clamps long waits to five minutes", () =>
    Effect.gen(function* () {
      expect(clampDuration(400_000)).toBe(300_000)
      expect(clampDuration(Number.POSITIVE_INFINITY)).toBe(0)
      expect(clampDuration(Number.NaN)).toBe(0)
    }),
  )

  it.instance("is interrupted when the caller aborts", () =>
    Effect.gen(function* () {
      const abort = new AbortController()
      const fiber = yield* Effect.forkScoped(run(60_000, ctx(abort)))
      yield* Effect.sleep("20 millis")
      abort.abort()
      const exit = yield* Fiber.await(fiber)
      expect(exit._tag).toBe("Failure")
      expect(String(exit)).toContain("Interrupt")
    }),
  )
})
