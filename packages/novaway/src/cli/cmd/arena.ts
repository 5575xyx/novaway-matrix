import type { Argv } from "yargs"
import { Effect } from "effect"
import { Config } from "@/config/config"
import { ConfigArena } from "@/config/arena"
import { ConfigSandbox } from "@/config/sandbox"
import { Arena, type ContenderSpec } from "@/arena/arena"
import { ArenaStore } from "@/arena/store"
import { makeRunAgent } from "@/session/agent-step"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { Agent } from "@/agent/agent"
import { InstanceRef } from "@/effect/instance-ref"
import { commit, create, cumulativeDiff, remove } from "@/team/worktree"
import { execute } from "@/team/command-verifier"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

type Args = {
  task: string
  model?: string[]
  concurrency?: number
  verify?: string
  keep?: boolean
  json?: boolean
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

export const ArenaCommand = effectCmd({
  command: "arena <task>",
  describe: "run the same task with several models in isolated worktrees",
  builder: (yargs: Argv) =>
    yargs
      .positional("task", {
        describe: "task to run for every contender",
        type: "string",
        demandOption: true,
      })
      .option("model", {
        describe: 'contender model in "provider/model" form; repeat for multiple contenders',
        type: "array",
        string: true,
      })
      .option("concurrency", {
        describe: "how many contenders run in parallel",
        type: "number",
      })
      .option("verify", {
        describe: "command run in each worktree; exit 0 = pass (no winner without it)",
        type: "string",
      })
      .option("keep", {
        describe: "keep contender worktrees for manual review",
        type: "boolean",
      })
      .option("json", {
        describe: "print the full result as JSON",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.arena")(function* (args: Args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("arena requires a project directory")

    const config = yield* Config.Service
    const cfg = yield* config.get()
    const arena = ConfigArena.resolve(cfg.arena)
    if (!arena.enabled) return yield* fail("arena is disabled; set arena.enabled = true in config")

    const models = (args.model?.length ? args.model : arena.models).map((model) => {
      const parsed = parseModel(model)
      if (!parsed) return undefined
      return { id: slug(model), model: parsed }
    })
    if (models.some((item) => !item)) return yield* fail("model must be in provider/model form")
    const contenders = models.flatMap((item) => (item ? [item] : []))
    if (contenders.length === 0) return yield* fail("pass --model provider/model (or set arena.models)")
    if (contenders.length > arena.max_contenders)
      return yield* fail(`arena allows at most ${arena.max_contenders} contenders`)

    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const prompt = yield* SessionPrompt.Service
    const root = yield* sessions.create({
      title: `Arena: ${args.task.slice(0, 40)}`,
      ...(cfg.default_agent ? { agent: cfg.default_agent } : {}),
    })
    const fallback = contenders.find((item) => item.model)?.model
    if (!fallback) return yield* fail("at least one contender needs an explicit model")

    const runAgent = makeRunAgent({
      ops: {
        resolvePromptParts: (template) => prompt.resolvePromptParts(template),
        prompt: (input) => prompt.prompt(input).pipe(Effect.orDie),
      },
      sessions,
      agents,
      parentSessionID: root.id,
      defaultModel: fallback,
      defaultAgent: root.agent ?? cfg.default_agent ?? "build",
    })

    const sandbox = ConfigSandbox.resolve(cfg.sandbox)
    const runID = "arena-" + Date.now().toString(36)
    const result = yield* Arena.run(
      {
        runID,
        task: args.task,
        contenders,
        concurrency: args.concurrency ?? arena.concurrency,
        keepWorktrees: args.keep ?? arena.keep_worktrees,
      },
      {
        createWorktree: ({ name }) => Effect.promise(() => create({ base: ctx.directory, runID, name })),
        runAgent,
        commit: ({ directory }) =>
          Effect.promise(() => commit({ directory, message: `arena ${runID}: ${args.task.slice(0, 60)}` })),
        diff: ({ directory, baseSHA }) => Effect.promise(() => cumulativeDiff({ directory, baseSHA })),
        removeWorktree: ({ base: repository, directory, branch }) =>
          Effect.promise(() => remove({ base: repository, directory, branch })),
        ...(args.verify
          ? {
              verify: ({ result }: { result: { directory?: string } }) =>
                result.directory
                  ? Effect.promise(async () => {
                      const verified = await execute({
                        directory: result.directory!,
                        spec: { kind: "command", run: args.verify!, timeoutMs: 120_000 },
                        sandbox,
                      })
                      return { pass: verified.code === 0 && !verified.timedOut }
                    })
                  : Effect.succeed({ pass: false }),
            }
          : {}),
      },
    ).pipe(Effect.orDie)

    yield* Effect.sync(() => ArenaStore.record(result)).pipe(Effect.ignore)

    if (args.json) {
      UI.println(JSON.stringify(result, null, 2))
      return
    }

    UI.println(`arena: ${result.runID}`)
    for (const item of result.contenders) {
      const verdict = item.verdict ? ` ${item.verdict}` : ""
      const files = item.diff?.files.length ?? 0
      const error = item.error ? ` — ${item.error}` : ""
      UI.println(`- ${item.id} [${item.status}]${verdict} files=${files}${error}`)
    }
    UI.println(result.winner ? `winner: ${result.winner}` : "winner: (none)")
    if (result.note) UI.println(`note: ${result.note}`)
  }),
})
