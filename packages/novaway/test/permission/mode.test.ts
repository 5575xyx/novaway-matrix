import { describe, expect } from "bun:test"
import { Duration, Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { Bus } from "../../src/bus"
import { Permission } from "../../src/permission"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { SessionID, MessageID } from "../../src/session/schema"
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
})
