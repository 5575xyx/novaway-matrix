import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Service as HookService, defaultLayer as HookLayer } from "@/hook/service"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"

const it = testEffect(Layer.mergeAll(HookLayer, RuntimeFlags.defaultLayer))

async function write(file: string, content: string) {
  await Bun.write(file, content)
}

describe("hook", () => {
  it.instance("command hook exit 2 blocks the action", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() =>
        write(
          path.join(dir, "hooks.json"),
          JSON.stringify({
            PreToolUse: [{ matcher: "write", hooks: [{ type: "command", command: "exit 2" }] }],
          }),
        ),
      )
      const hooks = yield* HookService
      yield* hooks.reload()
      const result = yield* hooks.trigger({ event: "PreToolUse", sessionID: "s", tool: "write", cwd: dir })
      expect(result.blocked).toBe(true)
      expect(result.decision).toBe("deny")
    }),
  )

  it.instance("command hook stdout JSON can rewrite tool input", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() =>
        write(
          path.join(dir, "hooks.json"),
          JSON.stringify({
            PreToolUse: [
              {
                matcher: ".*",
                hooks: [
                  {
                    type: "command",
                    command: `printf '%s' '{\"hookSpecificOutput\":{\"updatedInput\":{\"filePath\":\"rewritten.txt\"},\"additionalContext\":\"ctx\"}}'`,
                  },
                ],
              },
            ],
          }),
        ),
      )
      const hooks = yield* HookService
      yield* hooks.reload()
      const result = yield* hooks.trigger({ event: "PreToolUse", sessionID: "s", tool: "write", cwd: dir })
      expect(result.blocked).toBe(false)
      expect(result.updatedInput).toEqual({ filePath: "rewritten.txt" })
      expect(result.additionalContext).toBe("ctx")
    }),
  )

  it.instance("matcher only runs matching tools", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() =>
        write(
          path.join(dir, "hooks.json"),
          JSON.stringify({
            PreToolUse: [{ matcher: "shell", hooks: [{ type: "command", command: "exit 2" }] }],
          }),
        ),
      )
      const hooks = yield* HookService
      yield* hooks.reload()
      const allowed = yield* hooks.trigger({ event: "PreToolUse", sessionID: "s", tool: "write", cwd: dir })
      const blocked = yield* hooks.trigger({ event: "PreToolUse", sessionID: "s", tool: "shell", cwd: dir })
      expect(allowed.blocked).toBe(false)
      expect(blocked.blocked).toBe(true)
    }),
  )
})
