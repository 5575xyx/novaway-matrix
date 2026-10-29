import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import type * as Scope from "effect/Scope"
import { PlanEnterTool } from "@/tool/plan"
import { Session } from "@/session/session"
import { Bus } from "@/bus"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { MessageID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import { SessionID } from "@/session/schema"
import { provideInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import type { Tool } from "@/tool/tool"
import * as Log from "@novaway/core/util/log"
import type { Permission } from "@/permission"

void Log.init({ print: false })

const layer = Layer.mergeAll(
  Session.layer.pipe(
    Layer.provide(Bus.layer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(SyncEvent.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
    Layer.provide(BackgroundJob.defaultLayer),
  ),
  CrossSpawnSpawner.defaultLayer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
)
const it = testEffect(layer)

const ctx = (asks: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []) => ({
  sessionID: SessionID.make("ses_plan_enter"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
    Effect.sync(() => {
      asks.push(req)
    }),
})

const model = { providerID: "test" as never, modelID: "test-model" as never }

describe("tool.plan_enter", () => {
  it.instance(
    "asks for the plan_enter permission and switches the session to the plan agent",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Plan", permission: [] })
        yield* sessions.updateMessage({
          id: MessageID.ascending(),
          sessionID: chat.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model,
        } satisfies MessageV2.User)

        const asks: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const info = yield* PlanEnterTool
        const tool = yield* info.init()
        const result = yield* tool.execute({}, { ...ctx(asks), sessionID: chat.id } as Tool.Context)

        expect(asks.map((item) => item.permission)).toContain("plan_enter")
        expect(result.title).toBe("Entered plan mode")
        expect(result.metadata).toMatchObject({ agent: "plan" })

        // The switch is recorded as a synthetic user turn carrying `agent: plan`
        // so the next loop step resolves the plan agent from lastUser.agent.
        const messages = yield* sessions.messages({ sessionID: chat.id })
        const last = messages.findLast((item) => item.info.role === "user")
        expect(last?.info.role === "user" && last.info.agent).toBe("plan")
        const text = last?.parts.find((part): part is MessageV2.TextPart => part.type === "text")
        expect(text?.synthetic).toBe(true)
        expect(text?.text).toContain("plan mode")
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "is a no-op when the session is already on the plan agent",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Plan 2", permission: [] })
        yield* sessions.updateMessage({
          id: MessageID.ascending(),
          sessionID: chat.id,
          role: "user",
          time: { created: Date.now() },
          agent: "plan",
          model,
        } satisfies MessageV2.User)

        const info = yield* PlanEnterTool
        const tool = yield* info.init()
        const result = yield* tool.execute({}, { ...ctx(), sessionID: chat.id } as Tool.Context)
        expect(result.title).toBe("Already in plan mode")
        const messages = yield* sessions.messages({ sessionID: chat.id })
        expect(messages.filter((item) => item.info.role === "user")).toHaveLength(1)
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )
})
