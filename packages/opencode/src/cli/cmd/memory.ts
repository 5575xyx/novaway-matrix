import type { Argv } from "yargs"
import { Effect, Schema } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { Memory } from "@/memory/service"
import { MemorySchema } from "@/memory/schema"

type OutputFormat = "table" | "json"
type MemoryTarget = "memory" | "user"
type MemoryScope = "global" | "project" | "session"
type ReviewStatus = "pending" | "applied" | "dismissed"

type MemoryListArgs = {
  target?: string
  scope?: string
  search?: string
  "include-archived"?: boolean
  includeArchived?: boolean
  limit?: number
  format?: string
}

type MemoryAddArgs = {
  content: string
  target?: string
  scope?: string
  summary?: string
  tags?: string
  importance?: number
  format?: string
}

type MemoryDeleteArgs = {
  memoryID: string
}

type ReviewListArgs = {
  status?: string
  limit?: number
  format?: string
}

type ReviewCandidateArgs = {
  candidateID: string
  format?: string
}

export const MemoryCommand = cmd({
  command: "memory",
  describe: "manage persistent memory",
  builder: (yargs: Argv) =>
    yargs
      .command(MemoryListCommand)
      .command(MemoryAddCommand)
      .command(MemorySearchCommand)
      .command(MemoryDeleteCommand)
      .command(MemoryReviewCommand)
      .demandCommand(),
  async handler() {},
})

export const MemoryListCommand = effectCmd({
  command: "list",
  describe: "list persistent memory entries",
  builder: (yargs) =>
    memoryListOptions(yargs).option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    }),
  handler: Effect.fn("Cli.memory.list")(function* (args: MemoryListArgs) {
    const items = yield* Memory.Service.use((memory) =>
      memory.list({
        target: memoryTarget(args.target),
        scope: memoryScope(args.scope),
        search: args.search,
        includeArchived: args.includeArchived ?? args["include-archived"],
        limit: args.limit,
      }),
    )
    console.log(formatMemoryList(items, outputFormat(args.format)))
  }),
})

export const MemorySearchCommand = effectCmd({
  command: "search <query>",
  describe: "search persistent memory entries",
  builder: (yargs) =>
    memoryListOptions(yargs)
      .positional("query", {
        describe: "search query",
        type: "string",
        demandOption: true,
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: Effect.fn("Cli.memory.search")(function* (args: MemoryListArgs & { query: string }) {
    const items = yield* Memory.Service.use((memory) =>
      memory.list({
        target: memoryTarget(args.target),
        scope: memoryScope(args.scope),
        search: args.query,
        includeArchived: args.includeArchived ?? args["include-archived"],
        limit: args.limit,
      }),
    )
    console.log(formatMemoryList(items, outputFormat(args.format)))
  }),
})

export const MemoryAddCommand = effectCmd({
  command: "add <content>",
  describe: "add a persistent memory entry",
  builder: (yargs) =>
    yargs
      .positional("content", {
        describe: "memory content",
        type: "string",
        demandOption: true,
      })
      .option("target", {
        describe: "memory target",
        type: "string",
        choices: ["memory", "user"],
      })
      .option("scope", {
        describe: "memory scope",
        type: "string",
        choices: ["global", "project", "session"],
      })
      .option("summary", {
        describe: "short summary",
        type: "string",
      })
      .option("tags", {
        describe: "comma-separated tags",
        type: "string",
      })
      .option("importance", {
        describe: "importance score between 0 and 1",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: Effect.fn("Cli.memory.add")(function* (args: MemoryAddArgs) {
    if (!args.content.trim()) return yield* fail("Memory content is required")
    const item = yield* Memory.Service.use((memory) =>
      memory.add({
        content: args.content,
        target: memoryTarget(args.target),
        scope: memoryScope(args.scope),
        summary: args.summary,
        tags: parseTags(args.tags),
        importance: args.importance,
        source: "manual",
        createdBy: "cli",
      }),
    )
    console.log(formatMemoryList([item], outputFormat(args.format)))
  }),
})

export const MemoryDeleteCommand = effectCmd({
  command: "delete <memoryID>",
  describe: "delete a persistent memory entry",
  builder: (yargs) =>
    yargs.positional("memoryID", {
      describe: "memory ID",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.memory.delete")(function* (args: MemoryDeleteArgs) {
    const removed = yield* Memory.Service.use((memory) => memory.remove(Schema.decodeUnknownSync(MemorySchema.MemoryID)(args.memoryID)))
    if (!removed) return yield* fail(`Memory entry not found: ${args.memoryID}`)
    console.log(`Deleted memory entry ${args.memoryID}`)
  }),
})

export const MemoryReviewCommand = cmd({
  command: "review",
  describe: "manage memory review candidates",
  builder: (yargs: Argv) =>
    yargs
      .command(MemoryReviewStatusCommand)
      .command(MemoryReviewListCommand)
      .command(MemoryReviewApplyCommand)
      .command(MemoryReviewDismissCommand)
      .demandCommand(),
  async handler() {},
})

export const MemoryReviewStatusCommand = effectCmd({
  command: "status",
  describe: "show memory review status",
  builder: (yargs) =>
    yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    }),
  handler: Effect.fn("Cli.memory.review.status")(function* (args: { format?: string }) {
    const status = yield* Memory.Service.use((memory) => memory.reviewStatus())
    console.log(formatMemoryReviewStatus(status, outputFormat(args.format)))
  }),
})

export const MemoryReviewListCommand = effectCmd({
  command: "list",
  describe: "list memory review candidates",
  builder: (yargs) =>
    yargs
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
  handler: Effect.fn("Cli.memory.review.list")(function* (args: ReviewListArgs) {
    const candidates = yield* Memory.Service.use((memory) =>
      memory.listReviewCandidates({
        status: reviewStatus(args.status),
        limit: args.limit,
      }),
    )
    console.log(formatMemoryReviewCandidates(candidates, outputFormat(args.format)))
  }),
})

export const MemoryReviewApplyCommand = effectCmd({
  command: "apply <candidateID>",
  describe: "apply a memory review candidate",
  builder: reviewCandidateBuilder,
  handler: Effect.fn("Cli.memory.review.apply")(function* (args: ReviewCandidateArgs) {
    const item = yield* Memory.Service.use((memory) =>
      memory.applyReviewCandidate(Schema.decodeUnknownSync(MemorySchema.ReviewCandidateID)(args.candidateID)),
    )
    if (!item) return yield* fail(`Memory review candidate not found or not pending: ${args.candidateID}`)
    console.log(formatMemoryList([item], outputFormat(args.format)))
  }),
})

export const MemoryReviewDismissCommand = effectCmd({
  command: "dismiss <candidateID>",
  describe: "dismiss a memory review candidate",
  builder: reviewCandidateBuilder,
  handler: Effect.fn("Cli.memory.review.dismiss")(function* (args: ReviewCandidateArgs) {
    const candidate = yield* Memory.Service.use((memory) =>
      memory.dismissReviewCandidate(Schema.decodeUnknownSync(MemorySchema.ReviewCandidateID)(args.candidateID)),
    )
    if (!candidate) return yield* fail(`Memory review candidate not found or not pending: ${args.candidateID}`)
    console.log(formatMemoryReviewCandidates([candidate], outputFormat(args.format)))
  }),
})

function memoryListOptions<T>(yargs: Argv<T>) {
  return yargs
    .option("target", {
      describe: "memory target",
      type: "string",
      choices: ["memory", "user"],
    })
    .option("scope", {
      describe: "memory scope",
      type: "string",
      choices: ["global", "project", "session"],
    })
    .option("search", {
      describe: "search query",
      type: "string",
    })
    .option("include-archived", {
      describe: "include archived entries",
      type: "boolean",
    })
    .option("limit", {
      describe: "maximum number of entries",
      type: "number",
    })
}

function reviewCandidateBuilder(yargs: Argv) {
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

function parseTags(input: string | undefined) {
  return input
    ?.split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function outputFormat(input: string | undefined): OutputFormat {
  if (input === "json") return "json"
  return "table"
}

function memoryTarget(input: string | undefined): MemoryTarget | undefined {
  if (input === "memory" || input === "user") return input
  return undefined
}

function memoryScope(input: string | undefined): MemoryScope | undefined {
  if (input === "global" || input === "project" || input === "session") return input
  return undefined
}

function reviewStatus(input: string | undefined): ReviewStatus | undefined {
  if (input === "pending" || input === "applied" || input === "dismissed") return input
  return undefined
}

function truncate(input: string | undefined, length = 80) {
  const text = input?.replace(/\s+/g, " ").trim() ?? ""
  if (text.length <= length) return text
  return `${text.slice(0, Math.max(length - 3, 0))}...`
}

export function formatMemoryList(items: readonly MemorySchema.Info[], format: OutputFormat) {
  if (format === "json") return JSON.stringify(items, null, 2)
  if (items.length === 0) return "No memory entries found."
  return [
    ["ID", "Target", "Scope", "Importance", "Updated", "Content"].join("\t"),
    ...items.map((item) =>
      [
        item.id,
        item.target,
        item.scope,
        item.importance.toFixed(2),
        String(item.time.updated),
        truncate(item.summary || item.content),
      ].join("\t"),
    ),
  ].join("\n")
}

export function formatMemoryReviewCandidates(items: readonly MemorySchema.ReviewCandidate[], format: OutputFormat) {
  if (format === "json") return JSON.stringify(items, null, 2)
  if (items.length === 0) return "No memory review candidates found."
  return [
    ["ID", "Status", "Target", "Scope", "Updated", "Content"].join("\t"),
    ...items.map((item) =>
      [item.id, item.status, item.target, item.scope, String(item.time.updated), truncate(item.summary || item.content)].join("\t"),
    ),
  ].join("\n")
}

export function formatMemoryReviewStatus(status: MemorySchema.ReviewStatus, format: OutputFormat) {
  if (format === "json") return JSON.stringify(status, null, 2)
  return [
    ["Status", "Count"].join("\t"),
    ["pending", status.pending].join("\t"),
    ["applied", status.applied].join("\t"),
    ["dismissed", status.dismissed].join("\t"),
    ["total", status.total].join("\t"),
  ].join("\n")
}
