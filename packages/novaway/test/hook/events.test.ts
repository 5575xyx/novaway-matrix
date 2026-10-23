import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Service as HookService, defaultLayer as HookLayer } from "@/hook/service"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(HookLayer, RuntimeFlags.defaultLayer))

async function write(file: string, content: string) {
  await Bun.write(file, content)
}

const marker = (dir: string, event: string) => path.join(dir, `hook-${event}.txt`)

describe("hook events", () => {
  it.instance("dispatches every newly wired event", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const events = [
        "PermissionRequest",
        "PermissionDenied",
        "Stop",
        "TaskCreated",
        "TaskCompleted",
        "TeammateIdle",
        "Notification",
      ]
      const hooks: Record<string, unknown> = {}
      for (const event of events) {
        hooks[event] = [
          {
            hooks: [
              {
                type: "command",
                command: `node -e "require('fs').writeFileSync(process.argv[1],'x')" "${marker(dir, event)}"`,
              },
            ],
          },
        ]
      }
      yield* Effect.promise(() => write(path.join(dir, "hooks.json"), JSON.stringify(hooks)))

      const service = yield* HookService
      yield* service.reload()

      for (const event of events) {
        const result = yield* service.trigger({ event: event as never, sessionID: "s", cwd: dir })
        expect(result.ran, `${event} should run`).toBe(true)
        const exists = yield* Effect.promise(() =>
          Bun.file(marker(dir, event))
            .exists()
            .then((ok) => ok),
        )
        expect(exists, `${event} hook should have written its marker`).toBe(true)
      }
    }),
  )
})
