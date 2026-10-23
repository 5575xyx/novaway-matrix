import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session } from "../../src/session/session"
import { SessionID, MessageID } from "../../src/session/schema"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { BackgroundJob } from "@/background/job"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { SessionStatus } from "@/session/status"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { SyncEvent } from "@/sync"
import { Storage } from "@/storage/storage"
import { Memory } from "@/memory/service"
import { Evolution } from "@/evolution/service"
import { ToolLock } from "@/tool/lock"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    Session.defaultLayer,
    Agent.defaultLayer,
    Truncate.defaultLayer,
    Bus.defaultLayer,
    BackgroundJob.defaultLayer,
    Config.defaultLayer,
    Provider.defaultLayer,
    SessionStatus.defaultLayer,
    RuntimeFlags.defaultLayer,
    SyncEvent.defaultLayer,
    Storage.defaultLayer,
    Memory.defaultLayer,
    Evolution.defaultLayer,
    ToolLock.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
  ) as any,
)

const user = (sessionID: SessionID, text: string) => ({
  id: MessageID.ascending(),
  sessionID,
  role: "user" as const,
  agent: "build",
  model: { providerID: "test" as any, modelID: "test" as any },
  time: { created: Date.now() },
  text,
})

describe("fork cache prefix", () => {
  it.instance("fork copies the whole transcript including the running tool call", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "parent" })

      const first = user(session.id, "first")
      yield* sessions.updateMessage({ ...first, text: undefined } as any)

      const second = user(session.id, "second")
      yield* sessions.updateMessage({ ...second, text: undefined } as any)

      // Fork without `before`: everything is copied, so the child's request
      // prefix matches the parent's up to the last message.
      const forked = yield* sessions.fork({
        sessionID: session.id,
        parentID: session.id,
        title: "fork",
      })

      const original = yield* sessions.messages({ sessionID: session.id })
      const copied = yield* sessions.messages({ sessionID: forked.id })
      expect(copied.length).toBe(original.length)
      expect(forked.parentID).toBe(session.id)
    }),
  )

  it.instance("fork respects before-exclusive slicing", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "parent" })

      yield* sessions.updateMessage({ ...user(session.id, "a"), text: undefined } as any)
      const cut = user(session.id, "b")
      yield* sessions.updateMessage({ ...cut, text: undefined } as any)
      yield* sessions.updateMessage({ ...user(session.id, "c"), text: undefined } as any)

      const forked = yield* sessions.fork({ sessionID: session.id, before: cut.id, title: "sliced" })
      const copied = yield* sessions.messages({ sessionID: forked.id })
      expect(copied.length).toBe(1)
    }),
  )
})
