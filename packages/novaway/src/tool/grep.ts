import path from "path"
import { Schema } from "effect"
import { Effect, Option } from "effect"
import { NonNegativeInt } from "@novaway/core/schema"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./grep.txt"
import * as Tool from "./tool"
import { Reference } from "@/reference/reference"

const MAX_LINE_LENGTH = 2000
const DEFAULT_HEAD_LIMIT = 250

const Count = Schema.optional(NonNegativeInt)

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The regex pattern to search for in file contents" }),
  path: Schema.optional(Schema.String).annotate({
    description: "The directory to search in. Defaults to the current working directory.",
  }),
  include: Schema.optional(Schema.String).annotate({
    description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
  }),
  type: Schema.optional(Schema.String).annotate({
    description: 'Restrict to a ripgrep file type, e.g. "ts", "js", "py", "rust".',
  }),
  output_mode: Schema.optional(Schema.Literals(["content", "files_with_matches", "count"])).annotate({
    description:
      'Output mode: "content" shows matching lines (supports -A/-B/-C context and -n line numbers), "files_with_matches" shows file paths (default), "count" shows match counts per file.',
  }),
  "-A": Count.annotate({ description: 'Lines after each match (ripgrep -A). Requires output_mode: "content".' }),
  "-B": Count.annotate({ description: 'Lines before each match (ripgrep -B). Requires output_mode: "content".' }),
  "-C": Count.annotate({ description: "Alias for context: lines before and after each match." }),
  context: Count.annotate({
    description: 'Lines before and after each match (ripgrep -C). Requires output_mode: "content".',
  }),
  "-n": Schema.optional(Schema.Boolean).annotate({
    description: 'Show line numbers. Requires output_mode: "content". Defaults to true.',
  }),
  head_limit: Count.annotate({
    description:
      "Limit output to the first N entries. Works across all output modes. Defaults to 250. Pass 0 for unlimited.",
  }),
  offset: Count.annotate({ description: "Skip the first N entries before applying head_limit. Defaults to 0." }),
  multiline: Schema.optional(Schema.Boolean).annotate({
    description: "Allow patterns to span lines (ripgrep -U). Use [\s\S]*? for cross-line matches.",
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>

type Entry = { path: string; line: number; text: string; kind: "match" | "context" }

function slice<T>(items: T[], offset: number, headLimit: number) {
  return headLimit === 0 ? items.slice(offset) : items.slice(offset, offset + headLimit)
}

function pageFooter(shown: number, total: number, offset: number) {
  if (shown >= total) return undefined
  return `(Showing ${shown} of ${total} entries. Use offset=${offset + shown} to continue.)`
}

export const GrepTool = Tool.define(
  "grep",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const rg = yield* Ripgrep.Service
    const reference = yield* Reference.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const empty = {
            title: params.pattern,
            metadata: { matches: 0, files: 0, truncated: false },
            output: "No files found",
          }
          if (!params.pattern) {
            throw new Error("pattern is required")
          }

          yield* ctx.ask({
            permission: "grep",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
              include: params.include,
              type: params.type,
              output_mode: params.output_mode,
            },
          })

          const ins = yield* InstanceState.context
          const requested = path.isAbsolute(params.path ?? ins.directory)
            ? (params.path ?? ins.directory)
            : path.join(ins.directory, params.path ?? ".")
          yield* reference.ensure(requested)
          const requestedInfo = yield* fs.stat(requested).pipe(Effect.catch(() => Effect.succeed(undefined)))
          yield* assertExternalDirectoryEffect(ctx, requested, {
            bypass: yield* reference.contains(requested),
            kind: requestedInfo?.type === "Directory" ? "directory" : "file",
          })

          const search = AppFileSystem.resolve(requested)
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const cwd = info?.type === "Directory" ? search : path.dirname(search)
          const file = info?.type === "Directory" ? undefined : [path.relative(cwd, search)]

          const mode = params.output_mode ?? "files_with_matches"
          const headLimit = params.head_limit ?? DEFAULT_HEAD_LIMIT
          const offset = params.offset ?? 0
          const context = params["-C"] ?? params.context
          const before = params["-B"] ?? context
          const after = params["-A"] ?? context
          const lineNumbers = params["-n"] ?? true

          const result = yield* rg.search({
            cwd,
            pattern: params.pattern,
            glob: params.include ? [params.include] : undefined,
            type: params.type,
            multiline: params.multiline,
            context: mode === "content" ? { before, after } : undefined,
            file,
            signal: ctx.abort,
          })
          if (result.items.length === 0) return empty

          const rows: Entry[] = result.rows.map((row) => ({
            path: AppFileSystem.resolve(path.isAbsolute(row.path) ? row.path : path.join(cwd, row.path)),
            line: row.line,
            text: row.text,
            kind: row.kind,
          }))

          const files = [...new Set(rows.map((row) => row.path))]
          const times = new Map(
            (yield* Effect.forEach(
              files,
              Effect.fnUntraced(function* (file) {
                const info = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (!info || info.type === "Directory") return undefined
                return [file, Option.getOrElse(info.mtime, () => new Date(0)).getTime()] as const
              }),
              { concurrency: 16 },
            )).filter((entry): entry is readonly [string, number] => Boolean(entry)),
          )
          const fileOrder = new Map(
            files
              .sort((a, b) => (times.get(b) ?? 0) - (times.get(a) ?? 0))
              .map((file, index) => [file, index] as const),
          )
          rows.sort((a, b) => {
            const order = (fileOrder.get(a.path) ?? 0) - (fileOrder.get(b.path) ?? 0)
            return order !== 0 ? order : a.line - b.line
          })

          const matches = rows.filter((row) => row.kind === "match").length
          const limitText = (text: string) =>
            text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + "..." : text

          const output: string[] = []

          if (mode === "files_with_matches") {
            const paths = [...new Set(rows.map((row) => row.path))]
            const shown = slice(paths, offset, headLimit)
            output.push(`Found ${matches} matches in ${paths.length} files`)
            output.push("", ...shown)
            const footer = pageFooter(shown.length, paths.length, offset)
            if (footer) output.push("", footer)
          } else if (mode === "count") {
            const counts = new Map<string, number>()
            for (const row of rows) {
              if (row.kind !== "match") continue
              counts.set(row.path, (counts.get(row.path) ?? 0) + 1)
            }
            const entries = [...counts.entries()]
            const shown = slice(entries, offset, headLimit)
            output.push(`Found ${matches} matches in ${entries.length} files`)
            output.push("", ...shown.map(([file, count]) => `${file}: ${count}`))
            const footer = pageFooter(shown.length, entries.length, offset)
            if (footer) output.push("", footer)
          } else {
            const shown = slice(rows, offset, headLimit)
            output.push(
              `Found ${matches} matches${rows.length !== matches ? ` (+${rows.length - matches} context lines)` : ""}`,
            )
            let current = ""
            for (const row of shown) {
              if (current !== row.path) {
                if (current !== "") output.push("")
                current = row.path
                output.push(`${row.path}:`)
              }
              const text = limitText(row.text)
              output.push(
                row.kind === "match"
                  ? `  ${lineNumbers ? `Line ${row.line}: ` : ""}${text}`
                  : `  ${lineNumbers ? `${row.line}- ` : ""}${text}`,
              )
            }
            const footer = pageFooter(shown.length, rows.length, offset)
            if (footer) output.push("", footer)
          }

          if (result.partial) {
            output.push("")
            output.push("(Some paths were inaccessible and skipped)")
          }

          return {
            title: params.pattern,
            metadata: {
              matches,
              files: files.length,
              truncated: offset + (headLimit === 0 ? rows.length : headLimit) < rows.length,
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
