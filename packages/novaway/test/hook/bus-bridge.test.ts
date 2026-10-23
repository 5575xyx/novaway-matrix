import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Service as HookService, defaultLayer as HookLayer } from "@/hook/service"
import { Event as FileWatcherEvent } from "@/file/watcher"
import { Config } from "@/config/config"
import { Event as PlanApprovalEvent, RequestID } from "@/session/plan-approval"
import { Bus } from "@/bus"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { TestInstance } from "../fixture/fixture"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const bus = Bus.layer
// `provideMerge` exposes the same Bus instance the hook service subscribes to.
const it = testEffect(
  Layer.mergeAll(
    HookLayer.pipe(Layer.provideMerge(bus)),
    RuntimeFlags.defaultLayer,
    TestConfig.layer({} as never),
  ) as never,
)

const script = (marker: string) =>
  `node -e "require('fs').writeFileSync(process.argv[1], process.env.NOVAWAY_HOOK_EVENT)" "${marker}"`

async function write(file: string, content: string) {
  await Bun.write(file, content)
}

async function waitFor(file: string, timeoutMs = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await Bun.file(file).exists()) return true
    await Bun.sleep(100)
  }
  return false
}

describe("hook bus bridge", () => {
  it.instance("file watcher events become FileChanged hooks", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const marker = path.join(dir, "file-changed.txt")
      yield* Effect.promise(() =>
        write(
          path.join(dir, "hooks.json"),
          JSON.stringify({ FileChanged: [{ hooks: [{ type: "command", command: script(marker) }] }] }),
        ),
      )

      const hooks = yield* HookService
      yield* hooks.reload()

      const events = yield* Bus.Service
      yield* events.publish(FileWatcherEvent.Updated, { file: path.join(dir, "a.ts"), event: "change" })

      expect(yield* Effect.promise(() => waitFor(marker))).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(marker).text())).toBe("FileChanged")
    }),
  )

  it.instance("config updates become ConfigChange hooks", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const marker = path.join(dir, "config-changed.txt")
      yield* Effect.promise(() =>
        write(
          path.join(dir, "hooks.json"),
          JSON.stringify({ ConfigChange: [{ hooks: [{ type: "command", command: script(marker) }] }] }),
        ),
      )
      const hooks = yield* HookService
      yield* hooks.reload()

      const events = yield* Bus.Service
      yield* events.publish(Config.Event.Updated, { scope: "project" })

      expect(yield* Effect.promise(() => waitFor(marker))).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(marker).text())).toBe("ConfigChange")
    }),
  )

  it.instance("plan approval requests become Notification hooks", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const marker = path.join(dir, "notification.txt")
      yield* Effect.promise(() =>
        write(
          path.join(dir, "hooks.json"),
          JSON.stringify({ Notification: [{ hooks: [{ type: "command", command: script(marker) }] }] }),
        ),
      )
      const hooks = yield* HookService
      yield* hooks.reload()

      const events = yield* Bus.Service
      yield* events.publish(PlanApprovalEvent.Requested, {
        id: RequestID.make("plan_test"),
        sessionID: "ses_child" as never,
        plan: "do the thing",
        createdAt: Date.now(),
      })

      expect(yield* Effect.promise(() => waitFor(marker))).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(marker).text())).toBe("Notification")
    }),
  )
})
