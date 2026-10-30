import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Service as HookService, defaultLayer as HookLayer } from "@/hook/service"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"

const it = testEffect(Layer.mergeAll(HookLayer, RuntimeFlags.defaultLayer))

/**
 * `Elicitation` / `ElicitationResult` 的钩子契约：
 * 拿到 `hookSpecificOutput.action` 就直接回答，不再打扰用户。
 */
describe("hook.elicitation", () => {
  it.instance("Elicitation hook can answer on the user's behalf", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "hooks.json"),
          JSON.stringify({
            Elicitation: [
              {
                matcher: "github",
                hooks: [
                  {
                    type: "command",
                    command: `printf '%s' '{"hookSpecificOutput":{"hookEventName":"Elicitation","action":"accept","content":{"token":"t-1"}}}'`,
                  },
                ],
              },
            ],
          }),
        ),
      )
      const hooks = yield* HookService
      yield* hooks.reload()
      const result = yield* hooks.trigger({
        event: "Elicitation",
        cwd: dir,
        metadata: { mcp_server_name: "github", message: "token please" },
      })
      expect(result.elicitation).toEqual({ action: "accept", content: { token: "t-1" } })
      expect(result.blocked).toBe(false)
    }),
  )

  it.instance("Elicitation hook is skipped for other servers", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "hooks.json"),
          JSON.stringify({
            Elicitation: [
              {
                matcher: "github",
                hooks: [
                  {
                    type: "command",
                    command: `printf '%s' '{"hookSpecificOutput":{"hookEventName":"Elicitation","action":"accept"}}'`,
                  },
                ],
              },
            ],
          }),
        ),
      )
      const hooks = yield* HookService
      yield* hooks.reload()
      const result = yield* hooks.trigger({
        event: "Elicitation",
        cwd: dir,
        metadata: { mcp_server_name: "linear", message: "?" },
      })
      expect(result.elicitation).toBeUndefined()
      expect(result.ran).toBe(false)
    }),
  )

  it.instance("ElicitationResult hook can override the user's answer", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "hooks.json"),
          JSON.stringify({
            ElicitationResult: [
              {
                hooks: [
                  {
                    type: "command",
                    command: `printf '%s' '{"hookSpecificOutput":{"hookEventName":"ElicitationResult","action":"decline"}}'`,
                  },
                ],
              },
            ],
          }),
        ),
      )
      const hooks = yield* HookService
      yield* hooks.reload()
      const result = yield* hooks.trigger({
        event: "ElicitationResult",
        cwd: dir,
        metadata: { mcp_server_name: "github", action: "accept" },
      })
      expect(result.elicitation).toEqual({ action: "decline" })
    }),
  )

  it.instance("a non-elicitation JSON payload is not treated as an answer", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "hooks.json"),
          JSON.stringify({
            Elicitation: [
              {
                hooks: [
                  {
                    type: "command",
                    command: `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"a":1}}}'`,
                  },
                ],
              },
            ],
          }),
        ),
      )
      const hooks = yield* HookService
      yield* hooks.reload()
      const result = yield* hooks.trigger({ event: "Elicitation", cwd: dir, metadata: { mcp_server_name: "x" } })
      // 事件名不匹配时不能把 `updatedInput` 之类误读成 elicitation 答案。
      expect(result.elicitation).toBeUndefined()
    }),
  )
})
