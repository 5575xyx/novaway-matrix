import type { Argv } from "yargs"
import { Effect, Schema } from "effect"
import { Config } from "@/config/config"
import { Evolution } from "@/evolution/service"
import * as EvolutionSchema from "@/evolution/schema"
import { InstanceRef } from "@/effect/instance-ref"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"

type OutputFormat = "table" | "json"
type CandidateStatus = "pending" | "applied" | "dismissed"
type CandidateKind = "skill" | "agent" | "workflow" | "prompt" | "tool" | "project"
type CandidateContentFormat = "content" | "unified_diff"

type CuratorRunArgs = {
  content: string
  kind?: string
  target?: string
  title?: string
  reason?: string
  tags?: string
  contentFormat?: string
  "content-format"?: string
  format?: string
}

type CandidateListArgs = {
  kind?: string
  status?: string
  limit?: number
  format?: string
}

type CandidateIDArgs = {
  candidateID: string
  format?: string
}

export const CuratorCommand = cmd({
  command: "curator",
  describe: "manage self-evolution candidates",
  builder: (yargs: Argv) =>
    yargs
      .command(CuratorRunCommand)
      .command(CuratorStatusCommand)
      .command(CuratorListCommand)
      .command(CuratorPreviewCommand)
      .command(CuratorDryRunCommand)
      .command(CuratorApplyCommand)
      .command(CuratorApplyFileCommand)
      .command(CuratorDismissCommand)
      .command(CuratorPauseCommand)
      .command(CuratorResumeCommand)
      .demandCommand(),
  async handler() {},
})

export const CuratorRunCommand = effectCmd({
  command: "run <content>",
  describe: "create a self-evolution candidate from manual curator input",
  builder: (yargs) =>
    yargs
      .positional("content", {
        describe: "candidate content",
        type: "string",
        demandOption: true,
      })
      .option("kind", {
        describe: "candidate kind",
        type: "string",
        choices: ["skill", "agent", "workflow", "prompt", "tool", "project"],
        default: "project",
      })
      .option("target", {
        describe: "candidate target",
        type: "string",
        default: "manual-curator",
      })
      .option("title", {
        describe: "candidate title",
        type: "string",
      })
      .option("reason", {
        describe: "candidate reason",
        type: "string",
      })
      .option("tags", {
        describe: "comma-separated tags",
        type: "string",
      })
      .option("content-format", {
        describe: "candidate content format",
        type: "string",
        choices: ["content", "unified_diff"],
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: Effect.fn("Cli.curator.run")(function* (args: CuratorRunArgs) {
    if (!args.content.trim()) return yield* fail("Curator candidate content is required")
    const ctx = yield* requireInstance()
    const candidates = yield* Evolution.Service.use((evolution) =>
      evolution.review({
        projectID: ctx.project.id,
        proposals: [
          {
            kind: candidateKind(args.kind) ?? "project",
            target: args.target ?? "manual-curator",
            title: args.title ?? "Manual curator candidate",
            content: args.content,
            contentFormat: candidateContentFormat(args.contentFormat ?? args["content-format"]),
            reason: args.reason ?? "Created from the curator CLI.",
            tags: parseTags(args.tags),
          },
        ],
      }),
    )
    console.log(formatEvolutionCandidates(candidates, outputFormat(args.format)))
  }),
})

export const CuratorStatusCommand = effectCmd({
  command: "status",
  describe: "show self-evolution curator status",
  builder: (yargs) =>
    yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    }),
  handler: Effect.fn("Cli.curator.status")(function* (args: { format?: string }) {
    const config = yield* Config.Service.use((cfg) => cfg.get())
    const status = yield* Evolution.Service.use((evolution) => evolution.status())
    console.log(formatCuratorStatus({ config: config.evolution ?? {}, status }, outputFormat(args.format)))
  }),
})

export const CuratorListCommand = effectCmd({
  command: "list",
  describe: "list self-evolution candidates",
  builder: (yargs) =>
    yargs
      .option("kind", {
        describe: "candidate kind",
        type: "string",
        choices: ["skill", "agent", "workflow", "prompt", "tool", "project"],
      })
      .option("status", {
        describe: "candidate status",
        type: "string",
        choices: ["pending", "applied", "dismissed"],
      })
      .option("limit", {
        describe: "maximum number of candidates",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: Effect.fn("Cli.curator.list")(function* (args: CandidateListArgs) {
    const candidates = yield* Evolution.Service.use((evolution) =>
      evolution.list({
        kind: candidateKind(args.kind),
        status: candidateStatus(args.status),
        limit: args.limit,
      }),
    )
    console.log(formatEvolutionCandidates(candidates, outputFormat(args.format)))
  }),
})

export const CuratorPreviewCommand = effectCmd({
  command: "preview <candidateID>",
  describe: "preview a self-evolution candidate",
  builder: candidateIDBuilder,
  handler: Effect.fn("Cli.curator.preview")(function* (args: CandidateIDArgs) {
    const preview = yield* Evolution.Service.use((evolution) =>
      evolution.preview(Schema.decodeUnknownSync(EvolutionSchema.EvolutionCandidateID)(args.candidateID)),
    )
    if (!preview) return yield* fail(`Self-evolution candidate not found: ${args.candidateID}`)
    console.log(outputFormat(args.format) === "json" ? JSON.stringify(preview, null, 2) : preview.diff)
  }),
})

export const CuratorDryRunCommand = effectCmd({
  command: "dry-run <candidateID>",
  describe: "show file changes for a self-evolution candidate without writing files",
  builder: candidateIDBuilder,
  handler: Effect.fn("Cli.curator.dry-run")(function* (args: CandidateIDArgs) {
    const ctx = yield* requireInstance()
    const dryRun = yield* Evolution.Service.use((evolution) =>
      evolution.dryRun(Schema.decodeUnknownSync(EvolutionSchema.EvolutionCandidateID)(args.candidateID), {
        directory: ctx.directory,
        worktree: ctx.worktree,
      }),
    )
    if (!dryRun) return yield* fail(`Self-evolution candidate not found: ${args.candidateID}`)
    console.log(formatDryRun(dryRun, outputFormat(args.format)))
  }),
})

export const CuratorApplyCommand = effectCmd({
  command: "apply <candidateID>",
  describe: "mark a self-evolution candidate as applied",
  builder: candidateIDBuilder,
  handler: Effect.fn("Cli.curator.apply")(function* (args: CandidateIDArgs) {
    const candidate = yield* Evolution.Service.use((evolution) =>
      evolution.apply(Schema.decodeUnknownSync(EvolutionSchema.EvolutionCandidateID)(args.candidateID)),
    )
    if (!candidate) return yield* fail(`Self-evolution candidate not found or not pending: ${args.candidateID}`)
    console.log(formatEvolutionCandidates([candidate], outputFormat(args.format)))
  }),
})

export const CuratorApplyFileCommand = effectCmd({
  command: "apply-file <candidateID>",
  describe: "write a self-evolution candidate to disk and mark it as applied",
  builder: candidateIDBuilder,
  handler: Effect.fn("Cli.curator.apply-file")(function* (args: CandidateIDArgs) {
    const ctx = yield* requireInstance()
    const result = yield* Evolution.Service.use((evolution) =>
      evolution.applyToDisk(Schema.decodeUnknownSync(EvolutionSchema.EvolutionCandidateID)(args.candidateID), {
        directory: ctx.directory,
        worktree: ctx.worktree,
      }),
    )
    if (!result) return yield* fail(`Self-evolution candidate not found or not pending: ${args.candidateID}`)
    console.log(outputFormat(args.format) === "json" ? JSON.stringify(result, null, 2) : formatAppliedFiles(result))
  }),
})

export const CuratorDismissCommand = effectCmd({
  command: "dismiss <candidateID>",
  describe: "dismiss a self-evolution candidate",
  builder: candidateIDBuilder,
  handler: Effect.fn("Cli.curator.dismiss")(function* (args: CandidateIDArgs) {
    const candidate = yield* Evolution.Service.use((evolution) =>
      evolution.dismiss(Schema.decodeUnknownSync(EvolutionSchema.EvolutionCandidateID)(args.candidateID)),
    )
    if (!candidate) return yield* fail(`Self-evolution candidate not found or not pending: ${args.candidateID}`)
    console.log(formatEvolutionCandidates([candidate], outputFormat(args.format)))
  }),
})

export const CuratorPauseCommand = effectCmd({
  command: "pause",
  describe: "disable automatic self-evolution review for this project",
  handler: Effect.fn("Cli.curator.pause")(function* () {
    yield* updateEvolutionEnabled(false)
    console.log("Self-evolution review paused.")
  }),
})

export const CuratorResumeCommand = effectCmd({
  command: "resume",
  describe: "enable automatic self-evolution review for this project",
  handler: Effect.fn("Cli.curator.resume")(function* () {
    yield* updateEvolutionEnabled(true)
    console.log("Self-evolution review resumed.")
  }),
})

function candidateIDBuilder(yargs: Argv) {
  return yargs
    .positional("candidateID", {
      describe: "candidate ID",
      type: "string",
      demandOption: true,
    })
    .option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    })
}

function updateEvolutionEnabled(enabled: boolean) {
  return Config.Service.use((cfg) =>
    Effect.gen(function* () {
      const config = yield* cfg.get()
      yield* cfg.update({
        evolution: {
          ...(config.evolution ?? {}),
          enabled,
        },
      } as Config.Info)
    }),
  )
}

function parseTags(input: string | undefined) {
  return input
    ?.split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function requireInstance() {
  return Effect.gen(function* () {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Project instance context is required")
    return ctx
  })
}

function outputFormat(input: string | undefined): OutputFormat {
  if (input === "json") return "json"
  return "table"
}

function candidateStatus(input: string | undefined): CandidateStatus | undefined {
  if (input === "pending" || input === "applied" || input === "dismissed") return input
  return undefined
}

function candidateKind(input: string | undefined): CandidateKind | undefined {
  if (
    input === "skill" ||
    input === "agent" ||
    input === "workflow" ||
    input === "prompt" ||
    input === "tool" ||
    input === "project"
  )
    return input
  return undefined
}

function candidateContentFormat(input: string | undefined): CandidateContentFormat | undefined {
  if (input === "content" || input === "unified_diff") return input
  return undefined
}

function truncate(input: string | undefined, length = 80) {
  const text = input?.replace(/\s+/g, " ").trim() ?? ""
  if (text.length <= length) return text
  return `${text.slice(0, Math.max(length - 3, 0))}...`
}

export function formatEvolutionCandidates(items: readonly EvolutionSchema.Candidate[], format: OutputFormat) {
  if (format === "json") return JSON.stringify(items, null, 2)
  if (items.length === 0) return "No self-evolution candidates found."
  return [
    ["ID", "Status", "Kind", "Target", "Updated", "Title"].join("\t"),
    ...items.map((item) =>
      [item.id, item.status, item.kind, item.target, String(item.time.updated), truncate(item.title)].join("\t"),
    ),
  ].join("\n")
}

export function formatCuratorStatus(
  input: { config: Config.Info["evolution"]; status: EvolutionSchema.StatusSummary },
  format: OutputFormat,
) {
  if (format === "json") return JSON.stringify(input, null, 2)
  return [
    ["Field", "Value"].join("\t"),
    ["enabled", String(input.config?.enabled ?? false)].join("\t"),
    ["review_llm", String(input.config?.review_llm ?? false)].join("\t"),
    ["review_interval", String(input.config?.review_interval ?? 3)].join("\t"),
    ["pending", String(input.status.pending)].join("\t"),
    ["applied", String(input.status.applied)].join("\t"),
    ["dismissed", String(input.status.dismissed)].join("\t"),
    ["total", String(input.status.total)].join("\t"),
  ].join("\n")
}

export function formatDryRun(input: EvolutionSchema.CandidateDryRun, format: OutputFormat) {
  if (format === "json") return JSON.stringify(input, null, 2)
  return input.files.map((file) => file.diff).join("\n\n")
}

function formatAppliedFiles(input: EvolutionSchema.CandidateFileApply) {
  return [
    `Applied self-evolution candidate ${input.candidate.id}.`,
    ...input.dryRun.files.map((file) => `Wrote ${file.path}`),
  ].join("\n")
}
