import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import type * as Scope from "effect/Scope"
import { PlanEnterTool } from "@/tool/plan"
import { Session } from "@/session/session"
import { Bus } from "@/bus"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { defaultLayer as WorkflowPolicyLayer, Service as WorkflowPolicyService } from "@/workflow/policy"
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
  WorkflowPolicyLayer,
)
const it = testEffect(layer)

const ctx = (asks: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []) => ({
  sessionID: SessionID.make("ses_plan_enter"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "creova",
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
    "asks for plan_enter permission and sets plan permission mode without switching agents",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Plan", permission: [] })
        yield* sessions.updateMessage({
          id: MessageID.ascending(),
          sessionID: chat.id,
          role: "user",
          time: { created: Date.now() },
          agent: "creova",
          model,
        } satisfies MessageV2.User)

        const asks: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const info = yield* PlanEnterTool
        const tool = yield* info.init()
        const result = yield* tool.execute({}, { ...ctx(asks), sessionID: chat.id } as Tool.Context)

        expect(asks.map((item) => item.permission)).toContain("plan_enter")
        expect(result.title).toBe("Entered plan mode")
        expect(result.metadata).toMatchObject({ agent: "creova" })
        expect(yield* sessions.permissionModeOf(chat.id)).toBe("plan")

        const messages = yield* sessions.messages({ sessionID: chat.id })
        const last = messages.findLast((item) => item.info.role === "user")
        expect(last?.info.role === "user" && last.info.agent).toBe("creova")
        const text = last?.parts.find((part): part is MessageV2.TextPart => part.type === "text")
        expect(text?.synthetic).toBe(true)
        expect(text?.text).toContain("permission mode")
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )

  it.instance(
    "is a no-op when the session is already in plan permission mode",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const chat = yield* sessions.create({ title: "Plan 2", permission: [], permissionMode: "plan" })
        yield* sessions.updateMessage({
          id: MessageID.ascending(),
          sessionID: chat.id,
          role: "user",
          time: { created: Date.now() },
          agent: "creova",
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

  /**
   * 进出计划模式只改"权限档位"，不碰"工作流 phase"。
   *
   * 两者混着写就会出现本次线上事故的形态：切到计划模式 → phase 被判成 grill-me
   * → 门禁拦写工具 → 计划写不出来；退出计划模式后又残留一个 plan/implementation
   * 让门禁形同虚设。这条锁住"plan_enter 与 UI 切档都不写 phase"。
   */
  it.instance(
    "entering and leaving plan mode never rewrites the workflow phase",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const workflow = yield* WorkflowPolicyService
        const chat = yield* sessions.create({ title: "Plan phase", permission: [] })
        yield* sessions.updateMessage({
          id: MessageID.ascending(),
          sessionID: chat.id,
          role: "user",
          time: { created: Date.now() },
          agent: "creova",
          model,
        } satisfies MessageV2.User)

        // 上一轮已经把 phase 判成某个值（真实会话每轮都会走 beginTurn）。
        const before = yield* workflow.beginTurn({ sessionID: chat.id, turnID: "turn_before", text: "帮我看看这个仓库" })
        expect(before.phase).not.toBe("plan")

        const info = yield* PlanEnterTool
        const tool = yield* info.init()
        yield* tool.execute({}, { ...ctx(), sessionID: chat.id } as Tool.Context)
        expect(yield* sessions.permissionModeOf(chat.id)).toBe("plan")
        // 进计划模式不许动 phase（否则写计划文件的工具会被 phase 门禁拦住）。
        expect((yield* workflow.get(chat.id))?.phase).toBe(before.phase)

        // 用户在 UI 上把档位切回 default：改的只是档位。
        yield* sessions.setPermissionMode({ sessionID: chat.id, mode: "default" })
        expect(yield* sessions.permissionModeOf(chat.id)).toBe("default")
        expect((yield* workflow.get(chat.id))?.phase).toBe(before.phase)
      }).pipe(provideInstance(process.cwd())),
    30_000,
  )
})
