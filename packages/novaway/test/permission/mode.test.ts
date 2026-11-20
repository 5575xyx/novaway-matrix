import { describe, expect } from "bun:test"
import { Duration, Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Permission } from "../../src/permission"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { SessionID, MessageID } from "../../src/session/schema"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"

const bus = Bus.layer
const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const env = Layer.mergeAll(
  Permission.layer.pipe(Layer.provide(bus)),
  bus,
  CrossSpawnSpawner.defaultLayer,
  InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)),
)
const it = testEffect(env)

const sessionID = SessionID.make("ses_mode")
const messageID = MessageID.make("msg_mode")

const ask = (mode: Permission.Mode | undefined, permission = "edit") =>
  Effect.gen(function* () {
    const svc = yield* Permission.Service
    return yield* svc
      .ask({
        sessionID,
        permission,
        patterns: ["*"],
        always: ["*"],
        metadata: {},
        tool: { messageID, callID: "call_1" },
        // No ruleset: everything falls through to the mode decision.
        ruleset: [],
        ...(mode ? { mode } : {}),
      })
      .pipe(Effect.exit, Effect.timeoutOption(Duration.millis(250)))
  })

describe("permission mode", () => {
  it.instance("plan mode denies write tools", () =>
    Effect.gen(function* () {
      const out = yield* ask("plan", "edit")
      expect(out._tag).toBe("Some")
      if (out._tag === "Some") {
        expect(out.value._tag).toBe("Failure")
        if (out.value._tag === "Failure") {
          expect(out.value.cause.toString()).toContain("PermissionDeniedError")
        }
      }
    }),
  )

  it.instance("plan mode still allows read tools", () =>
    Effect.gen(function* () {
      // Falls through to the interactive ask flow: no reply arrives, so the
      // bounded wait times out instead of hard-denying.
      const out = yield* ask("plan", "read")
      expect(out._tag).toBe("None")
    }),
  )

  it.instance("acceptEdits lets write tools through without prompting", () =>
    Effect.gen(function* () {
      const out = yield* ask("acceptEdits", "edit")
      expect(out._tag).toBe("Some")
      if (out._tag === "Some") expect(out.value._tag).toBe("Success")
    }),
  )

  it.instance("bypassPermissions lets anything through", () =>
    Effect.gen(function* () {
      const out = yield* ask("bypassPermissions", "shell")
      expect(out._tag).toBe("Some")
      if (out._tag === "Some") expect(out.value._tag).toBe("Success")
    }),
  )

  it.instance("unattended also lets anything through", () =>
    Effect.gen(function* () {
      // 无人值守在权限这一层和 bypassPermissions 一样直接放行；
      // 「要不要问人拿主意」由 question / plan_exit / review_document 自己处理。
      for (const permission of ["shell", "edit", "external_directory"]) {
        const out = yield* ask("unattended", permission)
        expect(out._tag).toBe("Some")
        if (out._tag === "Some") expect(out.value._tag).toBe("Success")
      }
    }),
  )
})

// 安全分类器不是独立档位：它是自主审批（acceptEdits）的辅助判定开关。
// 下面用假语言模型固定分类器的回答，验证开关开/关时询问路径的行为。
const configLayer = (info: Config.Info) => Layer.mock(Config.Service, { get: () => Effect.succeed(info) })

const classifierLanguage = (text: string) =>
  ({
    specificationVersion: "v2",
    provider: "test",
    modelId: "classifier",
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }),
    doStream: async () => {
      throw new Error("stream not used")
    },
  }) as never

const classifierEnv = (text: string) => {
  const provider = ProviderTest.fake({
    getLanguage: Effect.fn("TestProvider.getLanguage")(() => Effect.succeed(classifierLanguage(text))),
  })
  return Layer.mergeAll(env, provider.layer, configLayer({ permission_auto: { classifier: true } } as Config.Info))
}

const itClassifierAllow = testEffect(classifierEnv('{"action":"allow","reason":"只读命令"}'))
const itClassifierDeny = testEffect(classifierEnv('{"action":"deny","reason":"破坏性风险"}'))
const itClassifierOff = testEffect(Layer.mergeAll(env, configLayer({} as Config.Info)))

describe("acceptEdits safety classifier", () => {
  itClassifierOff.instance("classifier off keeps asking for non-write tools", () =>
    Effect.gen(function* () {
      const out = yield* ask("acceptEdits", "webfetch")
      expect(out._tag).toBe("None")
    }),
  )

  itClassifierAllow.instance("enabled classifier allows clearly safe calls without asking", () =>
    Effect.gen(function* () {
      const out = yield* ask("acceptEdits", "webfetch")
      expect(out._tag).toBe("Some")
      if (out._tag === "Some") expect(out.value._tag).toBe("Success")
    }),
  )

  itClassifierDeny.instance("enabled classifier denial corrects the call instead of asking", () =>
    Effect.gen(function* () {
      const out = yield* ask("acceptEdits", "webfetch")
      expect(out._tag).toBe("Some")
      if (out._tag === "Some") {
        expect(out.value._tag).toBe("Failure")
        if (out.value._tag === "Failure") {
          expect(out.value.cause.toString()).toContain("PermissionCorrectedError")
        }
      }
    }),
  )
})
