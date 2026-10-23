import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect, Fiber, Layer } from "effect"
import { Service as HookService, defaultLayer as HookLayer } from "@/hook/service"
import { Bus } from "@/bus"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { TestInstance } from "../fixture/fixture"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    HookLayer.pipe(Layer.provideMerge(Bus.layer)),
    RuntimeFlags.defaultLayer,
    TestConfig.layer({} as never),
  ) as never,
)

const write = async (file: string, content: string) => Bun.write(file, content)

describe("hook status reporting", () => {
  it.instance("tracks hooks that declare a statusMessage", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const marker = path.join(dir, "slow-hook.txt")
      yield* Effect.promise(() =>
        write(
          path.join(dir, "hooks.json"),
          JSON.stringify({
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    statusMessage: "整理会话摘要…",
                    command: `node -e "setTimeout(() => require('fs').writeFileSync(process.argv[1], 'done'), 600)" "${marker}"`,
                  },
                ],
              },
            ],
          }),
        ),
      )
      const hooks = yield* HookService
      yield* hooks.reload()
      expect(yield* hooks.active()).toEqual([])

      const running = yield* Effect.forkChild(hooks.trigger({ event: "Stop", cwd: dir }))
      yield* Effect.sleep("200 millis")
      const during = yield* hooks.active()
      expect(during).toHaveLength(1)
      expect(during[0]!.message).toBe("整理会话摘要…")
      expect(during[0]!.event).toBe("Stop")

      yield* Fiber.join(running)
      expect(yield* hooks.active()).toEqual([])
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(true)
    }),
  )

  it.instance("ignores hooks without a statusMessage", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() =>
        write(
          path.join(dir, "hooks.json"),
          JSON.stringify({
            Stop: [{ hooks: [{ type: "command", command: "exit 0" }] }],
          }),
        ),
      )
      const hooks = yield* HookService
      yield* hooks.reload()
      const running = yield* Effect.forkChild(hooks.trigger({ event: "Stop", cwd: dir }))
      yield* Effect.sleep("100 millis")
      // Nothing to report: the status line only shows opted-in hooks.
      expect(yield* hooks.active()).toEqual([])
      yield* Fiber.join(running)
    }),
  )

  it.instance("clears the status when the hook fails", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() =>
        write(
          path.join(dir, "hooks.json"),
          JSON.stringify({
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    statusMessage: "failing…",
                    command: `node -e "setTimeout(()=>process.exit(1),300)"`,
                  },
                ],
              },
            ],
          }),
        ),
      )
      const hooks = yield* HookService
      yield* hooks.reload()
      const running = yield* Effect.forkChild(hooks.trigger({ event: "Stop", cwd: dir }))
      yield* Effect.sleep("100 millis")
      expect((yield* hooks.active()).length).toBe(1)
      yield* Fiber.join(running)
      expect(yield* hooks.active()).toEqual([])
    }),
  )
})
