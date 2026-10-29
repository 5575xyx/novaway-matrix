import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { Service as CronService } from "@/cron/service"
import { Cron, Tasks } from "@/cron"
import CREATE from "./cron_create.txt"
import DELETE from "./cron_delete.txt"
import LIST from "./cron_list.txt"

const LF = String.fromCharCode(10)

const permissionRoot = (instance: { directory: string; worktree: string }) =>
  instance.worktree === "/" ? instance.directory : instance.worktree

const CreateParameters = Schema.Struct({
  cron: Schema.String.annotate({
    description:
      'Standard 5-field cron expression in local time: "minute hour day-of-month month day-of-week" (e.g. "*/5 * * * *", "0 9 * * 1-5").',
  }),
  prompt: Schema.String.annotate({ description: "The prompt to run when the job fires" }),
  recurring: Schema.optional(Schema.Boolean).annotate({
    description: "true (default) reschedules after firing; false fires once and deletes the job",
  }),
  durable: Schema.optional(Schema.Boolean).annotate({
    description: "true writes the job to .claude/scheduled_tasks.json so it survives restarts",
  }),
})

const DeleteParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Job ID returned by cron_create" }),
})

type CreateMetadata = {
  id?: string
  cron?: string
  next?: string
  recurring?: boolean
  durable?: boolean
}

export const CronCreateTool = Tool.define<typeof CreateParameters, CreateMetadata, CronService>(
  "cron_create",
  Effect.gen(function* () {
    const cron = yield* CronService
    return {
      description: CREATE,
      parameters: CreateParameters,
      capabilities: { concurrencySafe: false },
      execute: (params: Schema.Schema.Type<typeof CreateParameters>, ctx: Tool.Context<CreateMetadata>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const directory = permissionRoot(instance)
          yield* ctx.ask({
            permission: "cron",
            patterns: [params.cron],
            always: ["*"],
            metadata: { cron: params.cron, prompt: params.prompt },
          })

          const task = yield* cron
            .create({
              sessionID: ctx.sessionID,
              directory,
              cron: params.cron,
              prompt: params.prompt,
              recurring: params.recurring,
              durable: params.durable,
            })
            .pipe(
              Effect.catch((error) =>
                Effect.fail(
                  new Error(error instanceof Error ? error.message : `Invalid cron expression: ${params.cron}`),
                ),
              ),
            )

          // The tick loop needs this fiber's context (SessionPrompt lives there),
          // so it is started from the call that created the first job.
          yield* cron.start({ directory }).pipe(Effect.ignore)

          const next = Cron.nextRunAt(task.cron, new Date())
          const nextText = next === undefined ? "unknown" : new Date(next).toLocaleString()
          return {
            title: `Cron ${task.id}`,
            output: [
              `Scheduled job ${task.id}.`,
              `Cron: ${task.cron} (local time)`,
              `Next run: ${nextText}`,
              task.recurring
                ? `Recurring job; expires ${new Date(task.expiresAt ?? task.createdAt).toLocaleString()} (fires one last time, then is deleted).`
                : "One-shot job; it is deleted after firing.",
              task.durable
                ? `Durable: written to ${Tasks.STORE_FILE}; it resumes when this session is loaded again.`
                : "Session-only: nothing was written to disk.",
            ].join(LF),
            metadata: {
              id: task.id,
              cron: task.cron,
              next: nextText,
              recurring: task.recurring,
              durable: task.durable,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const ListParameters = Schema.Struct({})

type ListMetadata = { count?: number }

export const CronListTool = Tool.define<typeof ListParameters, ListMetadata, CronService>(
  "cron_list",
  Effect.gen(function* () {
    const cron = yield* CronService
    return {
      description: LIST,
      parameters: ListParameters,
      capabilities: { readOnly: true, concurrencySafe: true },
      execute: (_params: Schema.Schema.Type<typeof ListParameters>, ctx: Tool.Context<ListMetadata>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const tasks = yield* cron.list({ sessionID: ctx.sessionID, directory: permissionRoot(instance) })
          if (tasks.length === 0) {
            return {
              title: "0 cron jobs",
              output: "No cron jobs scheduled.",
              metadata: { count: 0 },
            }
          }

          const lines = tasks.map((task) => {
            const next = Cron.nextRunAt(task.cron, new Date(task.lastFiredAt ?? task.createdAt))
            const when = next === undefined ? "no next run" : new Date(next).toLocaleString()
            const kind = task.recurring ? "recurring" : "one-shot"
            return [
              `- ${task.id}  ${task.cron}  (${kind}${task.durable ? ", durable" : ""})`,
              `  prompt: ${task.prompt.split(LF)[0]}`,
              `  next: ${when}`,
            ].join(LF)
          })
          return {
            title: `${tasks.length} cron job${tasks.length === 1 ? "" : "s"}`,
            output: lines.join(LF),
            metadata: { count: tasks.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const CronDeleteTool = Tool.define<typeof DeleteParameters, { removed?: boolean }, CronService>(
  "cron_delete",
  Effect.gen(function* () {
    const cron = yield* CronService
    return {
      description: DELETE,
      parameters: DeleteParameters,
      capabilities: { concurrencySafe: true },
      execute: (params: Schema.Schema.Type<typeof DeleteParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const removed = yield* cron.remove({ id: params.id, directory: permissionRoot(instance) })
          const listed = yield* cron.list({ sessionID: ctx.sessionID, directory: permissionRoot(instance) })
          const remaining = listed.length
          return {
            title: removed ? `Deleted ${params.id}` : `Unknown job ${params.id}`,
            output: removed
              ? `Deleted cron job ${params.id}. ${remaining} job${remaining === 1 ? "" : "s"} left in this session.`
              : `No cron job with id ${params.id} in this session. Use cron_list to see the scheduled jobs.`,
            metadata: { removed },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
