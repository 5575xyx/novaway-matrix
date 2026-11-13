import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config/config"
import { ConfigArena } from "@/config/arena"
import { ConfigSandbox } from "@/config/sandbox"
import { Arena, type ContenderSpec } from "@/arena/arena"
import { ArenaStore } from "@/arena/store"
import { makeRunAgent, type RunAgentPromptOps } from "@/session/agent-step"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { MessageV2 } from "@/session/message-v2"
import { InstanceState } from "@/effect/instance-state"
import { commit, create, cumulativeDiff, remove } from "@/team/worktree"
import { execute } from "@/team/command-verifier"

const Parameters = Schema.Struct({
  task: Schema.String.annotate({
    description: "The task to run for every contender. Keep it self-contained: each contender sees it verbatim.",
  }),
  contenders: Schema.optional(Schema.String).annotate({
    description:
      'JSON array of {"id":string,"model"?:"provider/model","agent"?:string}. Omit to use arena.models from config.',
  }),
  concurrency: Schema.optional(Schema.Number).annotate({ description: "How many contenders run in parallel." }),
  verify_command: Schema.optional(Schema.String).annotate({
    description: "Optional command run in every contender worktree. Exit 0 = pass. Without it no winner is declared.",
  }),
  keep_worktrees: Schema.optional(Schema.Boolean).annotate({
    description: "Keep contender worktrees for manual review (default: config keep_worktrees).",
  }),
})

type Metadata = {
  runID?: string
  winner?: string
  contenders?: number
}

function parseModel(value: string): ContenderSpec["model"] | undefined {
  const index = value.indexOf("/")
  if (index <= 0 || index === value.length - 1) return undefined
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) }
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "contender"
  )
}

function parseContenders(raw: string | undefined, models: readonly string[], max: number): ContenderSpec[] {
  if (raw) {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error("contenders must be a JSON array")
    const contenders = parsed.map((item: unknown) => {
      if (!item || typeof item !== "object") throw new Error("each contender must be an object")
      const id = Reflect.get(item, "id")
      const model = Reflect.get(item, "model")
      const agent = Reflect.get(item, "agent")
      if (typeof id !== "string" || !id.trim()) throw new Error("contender.id must be a non-empty string")
      if (model !== undefined && typeof model !== "string") throw new Error("contender.model must be a string")
      if (agent !== undefined && typeof agent !== "string") throw new Error("contender.agent must be a string")
      const parsedModel = model ? parseModel(model) : undefined
      if (model && !parsedModel) throw new Error(`invalid contender model: ${model}`)
      return {
        id: id.trim(),
        ...(parsedModel ? { model: parsedModel } : {}),
        ...(agent ? { agent } : {}),
      }
    })
    if (contenders.length > max) throw new Error(`arena allows at most ${max} contenders`)
    return contenders
  }

  const fromConfig = models.map((model) => {
    const parsed = parseModel(model)
    if (!parsed) throw new Error(`invalid arena model in config: ${model}`)
    return { id: slug(model), model: parsed }
  })
  if (fromConfig.length > max) throw new Error(`arena allows at most ${max} contenders`)
  return fromConfig
}

export const ArenaTool = Tool.define<typeof Parameters, Metadata, Config.Service | Session.Service | Agent.Service>(
  "arena_run",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service

    return {
      description:
        "Run the same task with several models in isolated git worktrees, then compare their diffs. " +
        "Disabled by default (config arena.enabled). Only declares a winner when verify_command is provided.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const cfg = yield* config.get()
          const arena = ConfigArena.resolve(cfg.arena)
          if (!arena.enabled) {
            return yield* Effect.die(new Error("arena is disabled; set arena.enabled = true in config"))
          }

          const contenders = parseContenders(params.contenders, arena.models, arena.max_contenders)
          if (contenders.length === 0) {
            return yield* Effect.die(
              new Error("arena needs contenders: pass contenders JSON or configure arena.models"),
            )
          }

          const message = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
            Effect.orDie,
          )
          if (message.info.role !== "assistant") {
            return yield* Effect.die(new Error("arena_run must execute inside an assistant turn"))
          }
          const ops = ctx.extra?.promptOps as RunAgentPromptOps | undefined
          if (!ops) {
            return yield* Effect.die(new Error("arena_run requires promptOps in ctx.extra"))
          }

          const instance = yield* InstanceState.context
          const sandbox = ConfigSandbox.resolve(cfg.sandbox)
          const base = ctx.directory ?? instance.directory
          const runID = "arena-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
          const runAgent = makeRunAgent({
            ops,
            sessions,
            agents,
            parentSessionID: ctx.sessionID,
            defaultModel: { providerID: message.info.providerID, modelID: message.info.modelID },
            defaultAgent: ctx.agent,
          })

          const result = yield* Arena.run(
            {
              runID,
              task: params.task,
              contenders,
              concurrency: params.concurrency ?? arena.concurrency,
              keepWorktrees: params.keep_worktrees ?? arena.keep_worktrees,
            },
            {
              createWorktree: ({ name }) => Effect.promise(() => create({ base, runID, name })),
              runAgent,
              commit: ({ directory }) =>
                Effect.promise(() => commit({ directory, message: `arena ${runID}: ${params.task.slice(0, 60)}` })),
              diff: ({ directory, baseSHA }) => Effect.promise(() => cumulativeDiff({ directory, baseSHA })),
              removeWorktree: ({ base: repository, directory, branch }) =>
                Effect.promise(() => remove({ base: repository, directory, branch })),
              ...(params.verify_command
                ? {
                    verify: ({ result }: { result: { directory?: string } }) =>
                      result.directory
                        ? Effect.promise(async () => {
                            const verified = await execute({
                              directory: result.directory!,
                              spec: { kind: "command", run: params.verify_command!, timeoutMs: 120_000 },
                              sandbox,
                            })
                            return { pass: verified.code === 0 && !verified.timedOut }
                          })
                        : Effect.succeed({ pass: false }),
                  }
                : {}),
            },
          ).pipe(Effect.orDie)

          // 历史记录是附加信息:写库失败不影响这次运行的结果。
          yield* Effect.sync(() => ArenaStore.record(result)).pipe(Effect.ignore)

          const lines = [
            `arena: ${result.runID}`,
            `task: ${result.task}`,
            `contenders: ${result.contenders.length}`,
            "",
            ...result.contenders.map((item) => {
              const diff = item.diff
                ? ` files=${item.diff.files.length} +${item.diff.files.reduce((sum, file) => sum + file.added, 0)}/-${item.diff.files.reduce((sum, file) => sum + file.removed, 0)}`
                : ""
              const verdict = item.verdict ? ` verdict=${item.verdict}` : ""
              const score = item.score !== undefined ? ` score=${item.score}` : ""
              const error = item.error ? ` error=${item.error}` : ""
              return `- ${item.id} [${item.status}]${verdict}${score}${diff}${error}`
            }),
            "",
            result.winner ? `winner: ${result.winner}` : "winner: (none)",
            ...(result.note ? [`note: ${result.note}`] : []),
          ]

          return {
            title: `Arena ${result.runID}`,
            output: lines.join("\n"),
            metadata: {
              runID: result.runID,
              ...(result.winner ? { winner: result.winner } : {}),
              contenders: result.contenders.length,
            },
          }
        }),
    }
  }),
)
