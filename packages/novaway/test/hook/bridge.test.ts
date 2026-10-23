import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Service as HookService, defaultLayer as HookLayer } from "@/hook/service"
import { Service as PluginService } from "@/plugin"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

/**
 * Minimal plugin service whose only hook is the generic `hook` bridge: it
 * records every event it sees and can deny on demand.
 */
const fakePlugin = (record: string[], denyOn?: string) =>
  Layer.succeed(
    PluginService,
    PluginService.of({
      trigger: (name: string, _input: unknown, output: any) =>
        Effect.sync(() => {
          if (name !== "hook") return output
          const event = String((_input as { event: string }).event)
          record.push(event)
          if (denyOn && event === denyOn) {
            output.result.decision = "deny"
            output.result.reason = "blocked by plugin"
          }
          return output
        }),
      list: () => Effect.succeed([]),
      init: () => Effect.void,
      reload: () => Effect.void,
    }) as never,
  )

const record: string[] = []
const it = testEffect(
  Layer.mergeAll(HookLayer.pipe(Layer.provide(fakePlugin(record, "PreToolUse"))), RuntimeFlags.defaultLayer),
)

describe("hook bridge", () => {
  it.instance("plugins observe every event and can block", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const service = yield* HookService
      yield* service.reload()

      const allowed = yield* service.trigger({ event: "Stop", sessionID: "s", cwd: dir })
      expect(allowed.blocked).toBe(false)

      const blocked = yield* service.trigger({ event: "PreToolUse", sessionID: "s", tool: "write", cwd: dir })
      expect(blocked.blocked).toBe(true)
      expect(blocked.reason).toBe("blocked by plugin")

      // Both events reached the plugin, including ones with no legacy hook.
      expect(record).toContain("Stop")
      expect(record).toContain("PreToolUse")
    }),
  )

  it.instance("json hooks still run when no plugin is present", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "hooks.json"),
          JSON.stringify({ PreToolUse: [{ hooks: [{ type: "command", command: "exit 2" }] }] }),
        ),
      )
      const service = yield* HookService
      yield* service.reload()
      const result = yield* service.trigger({ event: "PreToolUse", sessionID: "s", tool: "write", cwd: dir })
      expect(result.blocked).toBe(true)
    }),
  )
})
