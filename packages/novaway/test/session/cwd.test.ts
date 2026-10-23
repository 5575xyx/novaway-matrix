import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Deferred } from "effect"
import { Session as SessionNs } from "@/session/session"
import { CwdTool } from "@/tool/cwd"
import { Service as HookService, defaultLayer as HookLayer } from "@/hook/service"
import { defaultLayer as TruncateLayer } from "@/tool/truncate"
import { defaultLayer as AgentLayer } from "@/agent/agent"
import * as Tool from "@/tool/tool"
import { Bus } from "@/bus"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { Evolution } from "@/evolution/service"
import { Memory } from "@/memory/service"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { MessageID } from "@/session/schema"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    SessionNs.layer.pipe(
      Layer.provide(Bus.layer),
      Layer.provide(Storage.defaultLayer),
      Layer.provide(SyncEvent.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
      // Session reads hooks through `serviceOption`, so the hook layer has to be
      // in this layer's context, not merely a sibling.
      Layer.provide(HookLayer.pipe(Layer.provide(Bus.layer))),
    ),
    Evolution.defaultLayer,
    Memory.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    HookLayer.pipe(Layer.provide(Bus.layer)),
    TruncateLayer,
    AgentLayer,
  ) as never,
)

const context = (sessionID: SessionNs.Info["id"], directory: string): Tool.Context => ({
  sessionID,
  messageID: MessageID.make("msg_cwd"),
  agent: "build",
  directory,
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

describe("session working directory", () => {
  it.instance("reads the current directory", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const info = yield* sessions.create({ title: "cwd-read" })
      const cwd = yield* (yield* CwdTool).init()
      const result = yield* cwd.execute({}, context(info.id, info.directory))
      expect(result.metadata.directory).toBe(info.directory)
      expect(result.output).toContain(info.directory)
    }),
  )

  it.instance("moves the session and fires CwdChanged", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const target = path.join(dir, "nested")
      yield* Effect.promise(() => fs.mkdir(target, { recursive: true }))
      const marker = path.join(dir, "cwd-changed.txt")
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "hooks.json"),
          JSON.stringify({
            CwdChanged: [
              {
                hooks: [
                  {
                    type: "command",
                    command: `node -e "require('fs').writeFileSync(process.argv[1], process.env.NOVAWAY_HOOK_EVENT)" "${marker}"`,
                  },
                ],
              },
            ],
          }),
        ),
      )
      yield* (yield* HookService).reload()

      const sessions = yield* SessionNs.Service
      const info = yield* sessions.create({ title: "cwd-move" })
      const cwd = yield* (yield* CwdTool).init()
      const result = yield* cwd.execute({ directory: target }, context(info.id, info.directory))

      expect(result.metadata.previous).toBe(info.directory)
      expect(result.metadata.directory).toBe(target)
      const stored = yield* sessions.get(info.id)
      expect(stored.directory).toBe(target)

      // The hook must actually run with the new directory in scope.
      yield* Effect.sleep("500 millis")
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(marker).text())).toBe("CwdChanged")
    }),
  )

  it.instance("rejects a path that is not a directory", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const file = path.join(dir, "plain.txt")
      yield* Effect.promise(() => Bun.write(file, "x"))
      const sessions = yield* SessionNs.Service
      const info = yield* sessions.create({ title: "cwd-invalid" })
      const cwd = yield* (yield* CwdTool).init()
      const result = yield* cwd.execute({ directory: file }, context(info.id, info.directory))
      expect(result.title).toBe("Invalid directory")
      expect((yield* sessions.get(info.id)).directory).toBe(info.directory)
    }),
  )

  it.instance("does nothing when the directory is unchanged", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const marker = path.join(dir, "no-change.txt")
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "hooks.json"),
          JSON.stringify({
            CwdChanged: [
              {
                hooks: [
                  {
                    type: "command",
                    command: `node -e "require('fs').writeFileSync(process.argv[1], 'x')" "${marker}"`,
                  },
                ],
              },
            ],
          }),
        ),
      )
      yield* (yield* HookService).reload()
      const sessions = yield* SessionNs.Service
      const info = yield* sessions.create({ title: "cwd-same" })
      const cwd = yield* (yield* CwdTool).init()
      yield* cwd.execute({ directory: info.directory }, context(info.id, info.directory))
      yield* Effect.sleep("300 millis")
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
    }),
  )
})
