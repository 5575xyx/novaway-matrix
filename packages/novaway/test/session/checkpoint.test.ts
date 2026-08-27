import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session } from "@/session/session"
import { Snapshot } from "@/snapshot"
import { layer as checkpointLayer, Service as CheckpointService } from "@/session/checkpoint"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import * as Log from "@novaway/core/util/log"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

// Checkpoint 需要 Session + Snapshot;三者共享同一 base 实例(引用相同 → Layer 构建时 memo)。
const base = Layer.mergeAll(Session.defaultLayer, Snapshot.defaultLayer)
const combined = Layer.mergeAll(checkpointLayer.pipe(Layer.provide(base)), base)

const it = testEffect(combined)

// 追加一条带文本的 user 消息。
const addUser = Effect.fn("Test.addUser")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const id = MessageID.ascending()
  yield* session.updateMessage({
    id,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as MessageV2.Info)
  yield* session.updatePart({ id: PartID.ascending(), sessionID, messageID: id, type: "text", text })
  return id
})

const textsOf = (messages: readonly MessageV2.WithParts[]) =>
  messages.flatMap((m) => m.parts.filter((p): p is MessageV2.TextPart => p.type === "text").map((p) => p.text))

describe("checkpoint restore round-trip", () => {
  it.instance("restores session messages to the captured checkpoint state (in-place overwrite)", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const checkpoint = yield* CheckpointService

      const created = yield* session.create({})
      const sessionID = created.id

      yield* addUser(sessionID, "first")
      yield* addUser(sessionID, "second")

      const atCheckpoint = yield* session.messages({ sessionID })
      expect(textsOf(atCheckpoint)).toEqual(["first", "second"])

      // 捕获检查点(不带文件快照,避免依赖 git)。
      const cp = yield* checkpoint.create({ sessionId: sessionID, name: "cp1", messages: atCheckpoint })

      // 变更会话:再追加一条消息。
      yield* addUser(sessionID, "third")
      const afterMutation = yield* session.messages({ sessionID })
      expect(textsOf(afterMutation)).toEqual(["first", "second", "third"])

      // 原地恢复:覆盖当前会话回到检查点态。
      yield* checkpoint.restore(cp.id)

      const restored = yield* session.messages({ sessionID })
      expect(textsOf(restored)).toEqual(["first", "second"])
      expect(restored.map((m) => m.info.id)).toEqual(atCheckpoint.map((m) => m.info.id))

      yield* session.remove(sessionID).pipe(Effect.ignore)
    }),
  )

  it.instance("autoDue honors the interval and returns true only on multiples", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const checkpoint = yield* CheckpointService
      const created = yield* session.create({})
      const sessionID = created.id

      const first = yield* checkpoint.autoDue({ sessionId: sessionID, interval: 2 })
      const second = yield* checkpoint.autoDue({ sessionId: sessionID, interval: 2 })
      const third = yield* checkpoint.autoDue({ sessionId: sessionID, interval: 2 })
      const fourth = yield* checkpoint.autoDue({ sessionId: sessionID, interval: 2 })

      expect(first).toBe(false)
      expect(second).toBe(true)
      expect(third).toBe(false)
      expect(fourth).toBe(true)

      // interval<=0 恒 false
      expect(yield* checkpoint.autoDue({ sessionId: sessionID, interval: 0 })).toBe(false)

      yield* session.remove(sessionID).pipe(Effect.ignore)
    }),
  )
})
