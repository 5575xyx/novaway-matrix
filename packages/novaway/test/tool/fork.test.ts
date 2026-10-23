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
    CrossSpawnSpawner.defaultLayer,
  ) as any,
)

describe("session fork", () => {
  it.instance("copies history before the given message", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "parent" })

      const first = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        agent: "build",
        model: { providerID: "test" as any, modelID: "test" as any },
        time: { created: Date.now() },
      })
      yield* sessions.updatePart({
        id: "prt_1" as any,
        messageID: first.id,
        sessionID: session.id,
        type: "text",
        text: "first turn",
      })

      const second = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        agent: "build",
        model: { providerID: "test" as any, modelID: "test" as any },
        time: { created: Date.now() },
      })
      yield* sessions.updatePart({
        id: "prt_2" as any,
        messageID: second.id,
        sessionID: session.id,
        type: "text",
        text: "second turn",
      })

      const forked = yield* sessions.fork({
        sessionID: session.id,
        before: second.id,
        parentID: session.id,
        title: "fork",
      })

      expect(forked.parentID).toBe(session.id)
      expect(forked.title).toBe("fork")
      const messages = yield* sessions.messages({ sessionID: forked.id })
      expect(messages.length).toBe(1)
      expect(messages[0]!.parts.some((part) => part.type === "text" && part.text === "first turn")).toBe(true)
    }),
  )
})
