import { afterEach, describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { MessageID, SessionID } from "../../src/session/schema"
import { Truncate } from "@/tool/truncate"
import { CronCreateTool, CronDeleteTool, CronListTool } from "../../src/tool/cron"
import { Service as CronService, layer as CronLayer } from "../../src/cron/service"
import * as Tasks from "../../src/cron/tasks"
import { disposeAllInstances, provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  Tasks.reset()
  await disposeAllInstances()
})

const it = testEffect(
  Layer.mergeAll(CronLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer),
)

const ctx = {
  sessionID: SessionID.make("ses_cron_tool"),
  messageID: MessageID.make("msg_cron_tool"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const create = (args: { cron: string; prompt: string; recurring?: boolean; durable?: boolean }) =>
  Effect.gen(function* () {
    const info = yield* CronCreateTool
    const tool = yield* info.init()
    return yield* tool.execute(args, ctx)
  })

const list = () =>
  Effect.gen(function* () {
    const info = yield* CronListTool
    const tool = yield* info.init()
    return yield* tool.execute({}, ctx)
  })

const remove = (id: string) =>
  Effect.gen(function* () {
    const info = yield* CronDeleteTool
    const tool = yield* info.init()
    return yield* tool.execute({ id }, ctx)
  })

describe("tool.cron", () => {
  it.instance("cron_create schedules a job and reports the next run", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const result = yield* provideInstance(dir)(create({ cron: "*/5 * * * *", prompt: "check the build" }))
      expect(result.output).toContain("Scheduled job")
      expect(result.output).toContain("Session-only")
      expect(result.metadata.cron).toBe("*/5 * * * *")
      expect(result.metadata.recurring).toBe(true)
      expect(result.metadata.next).not.toBe("unknown")
    }),
  )

  it.instance("cron_create rejects a malformed expression", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const exit = yield* provideInstance(dir)(create({ cron: "every 5 minutes", prompt: "x" }).pipe(Effect.exit))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(Tasks.all()).toHaveLength(0)
    }),
  )

  it.instance("durable jobs are written to the project's scheduled_tasks.json", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const result = yield* provideInstance(dir)(create({ cron: "7 * * * *", prompt: "hourly", durable: true }))
      expect(result.output).toContain("Durable")
      const file = yield* Effect.promise(() => import("node:fs/promises")).pipe(
        Effect.flatMap((fs) => Effect.promise(() => fs.readFile(`${dir}/.claude/scheduled_tasks.json`, "utf8"))),
      )
      const parsed = JSON.parse(file)
      expect(parsed.tasks).toHaveLength(1)
      expect(parsed.tasks[0].cron).toBe("7 * * * *")
    }),
  )

  it.instance("cron_list shows scheduled jobs and cron_delete removes them", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const empty = yield* provideInstance(dir)(list())
      expect(empty.output).toBe("No cron jobs scheduled.")

      const created = yield* provideInstance(dir)(create({ cron: "30 14 * * *", prompt: "line one\nline two" }))
      const id = created.metadata.id!
      const shown = yield* provideInstance(dir)(list())
      expect(shown.output).toContain(id)
      expect(shown.output).toContain("line one")
      expect(shown.output).not.toContain("line two")
      expect(shown.metadata.count).toBe(1)

      const deleted = yield* provideInstance(dir)(remove(id))
      expect(deleted.output).toContain(`Deleted cron job ${id}`)
      expect((yield* provideInstance(dir)(list())).metadata.count).toBe(0)
    }),
  )

  it.instance("cron_delete reports unknown ids", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const result = yield* provideInstance(dir)(remove("deadbeef"))
      expect(result.metadata.removed).toBe(false)
      expect(result.output).toContain("No cron job with id deadbeef")
    }),
  )

  it.instance("list only returns jobs from the current session", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const cron = yield* CronService
      yield* cron.create({ sessionID: "ses_other", directory: dir, cron: "*/5 * * * *", prompt: "other" })
      const result = yield* provideInstance(dir)(list())
      expect(result.metadata.count).toBe(0)
    }),
  )
})
