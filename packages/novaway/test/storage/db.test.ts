import { describe, expect } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { Global } from "@novaway/core/global"
import { InstallationChannel } from "@novaway/core/installation/version"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@/storage/db"
import { it } from "../lib/effect"

describe("Database.getChannelPath", () => {
  it.effect("returns database path for the current channel", () =>
    Effect.gen(function* () {
      const previous = Global.Path.data
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "novaway-db-test-")))
      Global.Path.data = tmp
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          Global.Path.data = previous
          await fs.rm(tmp, { recursive: true, force: true })
        }),
      )
      const flags = yield* RuntimeFlags.Service
      const expected = ["latest", "beta", "prod"].includes(InstallationChannel)
        ? path.join(Global.Path.data, "novaway.db")
        : path.join(Global.Path.data, `novaway-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)

      expect(Database.getChannelPath(flags)).toBe(expected)
    }).pipe(Effect.provide(RuntimeFlags.layer())),
  )

  it.effect("uses the shared database path when channel databases are disabled", () =>
    Effect.gen(function* () {
      const previous = Global.Path.data
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "novaway-db-test-")))
      Global.Path.data = tmp
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          Global.Path.data = previous
          await fs.rm(tmp, { recursive: true, force: true })
        }),
      )
      const flags = yield* RuntimeFlags.Service

      expect(Database.getChannelPath(flags)).toBe(path.join(Global.Path.data, "novaway.db"))
    }).pipe(Effect.provide(RuntimeFlags.layer({ disableChannelDb: true }))),
  )

  it.effect("accepts RuntimeFlags with skipMigrations for database callers", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service

      expect(flags.skipMigrations).toBe(true)
      expect(Database.getChannelPath(flags)).toBe(Database.getChannelPath({ disableChannelDb: flags.disableChannelDb }))
    }).pipe(Effect.provide(RuntimeFlags.layer({ skipMigrations: true }))),
  )
})
