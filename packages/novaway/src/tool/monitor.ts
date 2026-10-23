import { Effect, Schema } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import * as Tool from "./tool"
import { Service as BackgroundJobService } from "@/background/job"
import { Service as AgentMailboxService } from "@/team/mailbox"
import { SessionStatus } from "@/session/status"
import { startMonitor, type PromptOps } from "@/background/watchers"

export const MonitorParameters = Schema.Struct({
  command: Schema.optional(Schema.String).annotate({
    description: "Shell command to watch (e.g. a dev server or test run)",
  }),
  resume: Schema.optional(Schema.String).annotate({
    description: "Job id of a previous monitor to start again with the same command, pattern and timeout",
  }),
  pattern: Schema.optional(Schema.String).annotate({
    description: "Regular expression; finish as soon as an output line matches",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Seconds before giving up (default 300, clamped to 1..3600)",
  }),
  description: Schema.optional(Schema.String).annotate({ description: "Short label used in notifications" }),
})
export type MonitorParameters = Schema.Schema.Type<typeof MonitorParameters>

type Metadata = {
  jobID?: string
  pattern?: string
  timeout?: number
}

const DEFAULT_TIMEOUT = 300
const MAX_TIMEOUT = 3_600

const clampTimeout = (value: number | undefined) =>
  Math.min(Math.max(Math.round(value ?? DEFAULT_TIMEOUT), 1), MAX_TIMEOUT)

/**
 * Run a command in the background and wake the agent when it does something
 * interesting.
 *
 * Three ways to finish: a line matches `pattern` (the process is killed as soon
 * as it matches), the process exits on its own, or the timeout elapses. The
 * result is delivered through the agent mailbox, which the prompt loop drains
 * on every step, so a busy agent sees it at the next tool round and an idle
 * agent is resumed.
 *
 * The job is marked resumable: `background/resume.ts` restarts it after a
 * process restart, and `monitor({ resume: jobID })` restarts it on demand.
 */
export const MonitorTool = Tool.define<
  typeof MonitorParameters,
  Metadata,
  BackgroundJobService | AgentMailboxService | SessionStatus.Service | ChildProcessSpawner
>(
  "monitor",
  Effect.gen(function* () {
    const background = yield* BackgroundJobService
    const mailbox = yield* AgentMailboxService
    const status = yield* SessionStatus.Service
    const spawner = yield* ChildProcessSpawner

    return {
      description:
        "Watch a background command (dev server, test run, log tail) and wake this session when it matches a pattern, exits, or times out. Returns immediately. Survives restarts.",
      parameters: MonitorParameters,
      capabilities: { concurrencySafe: true },
      execute: (params: MonitorParameters, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // Resuming reuses the persisted metadata, so a monitor that died with
          // the previous process can be restarted without retyping the command.
          const previous = params.resume ? yield* background.get(params.resume) : undefined
          const command = params.command ?? (previous?.metadata?.command as string | undefined)
          if (!command) {
            return {
              title: "No command",
              output: params.resume
                ? `Monitor ${params.resume} has no recorded command; pass one explicitly.`
                : "Provide a command to monitor.",
              metadata: {},
            }
          }
          const pattern = params.pattern ?? (previous?.metadata?.pattern as string | undefined)
          const timeout = clampTimeout(params.timeout ?? (previous?.metadata?.timeout as number | undefined))
          const label = params.description ?? previous?.title ?? command

          // Ask under `monitor`: agents that are allowed to watch commands but
          // not to run arbitrary shell (the coordinator) can then use it, and
          // the prompt still shows the exact command being started.
          yield* ctx.ask({ permission: "monitor", patterns: [command], always: [command], metadata: {} })

          const info = yield* startMonitor(
            {
              command,
              ...(pattern ? { pattern } : {}),
              timeout,
              label,
              sessionID: ctx.sessionID,
              ...(ctx.directory ? { cwd: ctx.directory } : {}),
            },
            {
              background,
              mailbox,
              status,
              spawner,
              ...(ctx.extra?.promptOps ? { ops: ctx.extra.promptOps as PromptOps } : {}),
            },
          )

          return {
            title: `Monitoring ${label}`,
            output: [
              `Monitoring started in the background (job ${info.id}).`,
              `Pattern: ${pattern ?? "(exit only)"} · timeout: ${timeout}s`,
              "You will be notified when it matches, exits, or times out.",
            ].join("\n"),
            metadata: { jobID: info.id, pattern, timeout },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
