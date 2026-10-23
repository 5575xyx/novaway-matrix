import { describe, expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { MonitorTool } from "@/tool/monitor"
import { Service as BackgroundService, defaultLayer as BackgroundLayer } from "@/background/job"
import { Service as MailboxService, defaultLayer as MailboxLayer } from "@/team/mailbox"
import { defaultLayer as StatusLayer, Service as StatusService } from "@/session/status"
import { defaultLayer as TruncateLayer } from "@/tool/truncate"
import { defaultLayer as AgentLayer } from "@/agent/agent"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import * as Tool from "@/tool/tool"
import { MessageID, SessionID } from "@/session/schema"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    BackgroundLayer,
    MailboxLayer,
    StatusLayer,
    TruncateLayer,
    AgentLayer,
    CrossSpawnSpawner.defaultLayer,
  ) as never,
)

const sessionID = SessionID.make("ses_monitor")

const context = (directory: string, extra?: Record<string, unknown>): Tool.Context => ({
  sessionID,
  messageID: MessageID.make("msg_monitor"),
  agent: "build",
  directory,
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
  ...(extra ? { extra } : {}),
})

describe("monitor tool", () => {
  it.instance("wakes the session when a pattern matches", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const monitor = yield* (yield* MonitorTool).init()
      const background = yield* BackgroundService
      const mailbox = yield* MailboxService

      const output = yield* monitor.execute(
        {
          command: `node -e "console.log('READY'); setTimeout(() => {}, 10000)"`,
          pattern: "^READY$",
          timeout: 30,
        },
        context(dir),
      )
      const job = yield* background.wait({ id: output.metadata.jobID!, timeout: 15_000 })
      expect(job.timedOut).toBe(false)
      expect(job.info?.status).toBe("completed")

      const messages = yield* mailbox.drain(sessionID)
      expect(messages).toHaveLength(1)
      expect(messages[0]!.content).toContain("<monitor-notification")
      expect(messages[0]!.content).toContain("state: matched")
      expect(messages[0]!.content).toContain("READY")
    }),
  )

  it.instance("reports the exit code when the command finishes on its own", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const monitor = yield* (yield* MonitorTool).init()
      const background = yield* BackgroundService
      const mailbox = yield* MailboxService

      const output = yield* monitor.execute(
        { command: `node -e "console.log('bye'); process.exit(3)"`, timeout: 30 },
        context(dir),
      )
      const job = yield* background.wait({ id: output.metadata.jobID!, timeout: 15_000 })
      expect(job.info?.status).toBe("completed")

      const messages = yield* mailbox.drain(sessionID)
      expect(messages[0]!.content).toContain("state: exit (code 3)")
    }),
  )

  it.instance("resumes an idle session and leaves a busy one alone", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const monitor = yield* (yield* MonitorTool).init()
      const background = yield* BackgroundService
      const status = yield* StatusService
      const calls = yield* Ref.make(0)
      const ops = {
        loop: () => Ref.update(calls, (value) => value + 1).pipe(Effect.asVoid),
      }

      // Idle: the loop is resumed.
      const first = yield* monitor.execute(
        { command: `node -e "process.exit(0)"`, timeout: 30 },
        context(dir, { promptOps: ops }),
      )
      yield* background.wait({ id: first.metadata.jobID!, timeout: 15_000 })
      yield* Effect.sleep("300 millis")
      expect(yield* Ref.get(calls)).toBe(1)

      // Busy: the message is still queued, but no second loop starts.
      yield* status.set(sessionID, { type: "busy" })
      const second = yield* monitor.execute(
        { command: `node -e "process.exit(0)"`, timeout: 30 },
        context(dir, { promptOps: ops }),
      )
      yield* background.wait({ id: second.metadata.jobID!, timeout: 15_000 })
      yield* Effect.sleep("300 millis")
      expect(yield* Ref.get(calls)).toBe(1)
    }),
  )
})

describe("monitor resume", () => {
  it.instance("restarts a finished monitor from its recorded command", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const monitor = yield* (yield* MonitorTool).init()
      const background = yield* BackgroundService

      const first = yield* monitor.execute(
        { command: `node -e "process.exit(0)"`, pattern: "never", timeout: 20, description: "resumable" },
        context(dir),
      )
      yield* background.wait({ id: first.metadata.jobID!, timeout: 15_000 })

      const again = yield* monitor.execute({ resume: first.metadata.jobID! }, context(dir))
      expect(again.metadata.jobID).not.toBe(first.metadata.jobID)
      expect(again.metadata.pattern).toBe("never")
      expect(again.metadata.timeout).toBe(20)

      const job = yield* background.wait({ id: again.metadata.jobID!, timeout: 15_000 })
      expect(job.info?.status).toBe("completed")
    }),
  )

  it.instance("asks for a command when the recorded job is unknown", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const monitor = yield* (yield* MonitorTool).init()
      const result = yield* monitor.execute({ resume: "job_missing" }, context(dir))
      expect(result.title).toBe("No command")
      expect(result.output).toContain("job_missing")
    }),
  )
})
