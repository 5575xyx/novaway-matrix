import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import {
  Service as BackgroundService,
  defaultLayer as BackgroundLayer,
  type Interface as BackgroundInterface,
} from "@/background/job"
import { startMonitor } from "@/background/watchers"
import type { SessionID } from "@/session/schema"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(BackgroundLayer, CrossSpawnSpawner.defaultLayer) as never)

const SESSION = "ses_watchers" as SessionID

const monitor = (
  background: BackgroundInterface,
  spawner: ChildProcessSpawner["Service"],
  input: {
    command: string
    pattern?: string
    timeout?: number
  },
) =>
  startMonitor(
    {
      command: input.command,
      ...(input.pattern !== undefined ? { pattern: input.pattern } : {}),
      timeout: input.timeout ?? 20,
      label: "watch",
      sessionID: SESSION,
    },
    { background, spawner },
  )

describe("background monitor", () => {
  it.instance("reports the job as failed when the watched command exits non-zero", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundService
      const spawner = yield* ChildProcessSpawner

      const started = yield* monitor(background, spawner, {
        command: `node -e "console.error('kaput'); process.exit(3)"`,
        pattern: "never",
      })

      const result = yield* background.wait({ id: started.id, timeout: 15_000 })

      // 非 0 退出以前一律记成 completed，右侧状态卡就显示绿色的谎话。
      expect(result.info?.status).toBe("error")
      expect(result.info?.error).toContain("code 3")
      expect(result.info?.output).toContain("state: exit (code 3)")
    }),
  )

  it.instance("reports the job as failed when the pattern never matches", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundService
      const spawner = yield* ChildProcessSpawner

      const started = yield* monitor(background, spawner, {
        command: `node -e "setInterval(() => {}, 1000)"`,
        pattern: "never",
        timeout: 1,
      })

      const result = yield* background.wait({ id: started.id, timeout: 15_000 })

      expect(result.info?.status).toBe("error")
      expect(result.info?.error).toContain("timed out")
      expect(result.info?.output).toContain("state: timeout")
    }),
  )

  it.instance("keeps a matched exit as completed", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundService
      const spawner = yield* ChildProcessSpawner

      const started = yield* monitor(background, spawner, {
        command: `node -e "console.log('ready'); process.exit(0)"`,
        pattern: "ready",
      })

      const result = yield* background.wait({ id: started.id, timeout: 15_000 })

      expect(result.info?.status).toBe("completed")
      expect(result.info?.output).toContain("state: matched")
    }),
  )

  it.instance("writes live output while the monitor is running", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundService
      const spawner = yield* ChildProcessSpawner

      const started = yield* monitor(background, spawner, {
        command: `node -e "setInterval(() => console.log('tick'), 100)"`,
        pattern: "never",
      })

      // 面板靠 job.output 显示进度；没有这条线，卡片上只有"运行中"加一片空白。
      const output = yield* pollWithTimeout(
        Effect.gen(function* () {
          const value = (yield* background.get(started.id))?.output
          return value?.includes("tick") ? value : undefined
        }),
        "monitor never wrote live output",
        "10 seconds",
      )

      expect(output).toContain("tick")

      expect((yield* background.cancel(started.id))?.status).toBe("cancelled")
    }),
  )
})
