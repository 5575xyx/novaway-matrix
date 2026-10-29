import path from "path"
import { Effect, Option, Schema } from "effect"
import * as Stream from "effect/Stream"
import { NonNegativeInt } from "@novaway/core/schema"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./glob.txt"
import * as Tool from "./tool"
import { Reference } from "@/reference/reference"

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The glob pattern to match files against" }),
  path: Schema.optional(Schema.String).annotate({
    description: `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
  }),
  limit: Schema.optional(NonNegativeInt).annotate({
    description: "Maximum number of files to return (default 100).",
  }),
  offset: Schema.optional(NonNegativeInt).annotate({
    description: "Skip the first N results before applying limit, for pagination.",
  }),
})

export const GlobTool = Tool.define(
  "glob",
  Effect.gen(function* () {
    const rg = yield* Ripgrep.Service
    const fs = yield* AppFileSystem.Service
    const reference = yield* Reference.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pattern: string; path?: string; limit?: number; offset?: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          yield* ctx.ask({
            permission: "glob",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
            },
          })

          let search = params.path ?? ins.directory
          search = path.isAbsolute(search) ? search : path.resolve(ins.directory, search)
          yield* reference.ensure(search)
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (info?.type === "File") {
            throw new Error(`glob path must be a directory: ${search}`)
          }
          yield* assertExternalDirectoryEffect(ctx, search, {
            bypass: yield* reference.contains(search),
            kind: "directory",
          })

          const limit = params.limit ?? 100
          const offset = params.offset ?? 0
          let truncated = false
          const files = yield* rg.files({ cwd: search, glob: [params.pattern], signal: ctx.abort }).pipe(
            Stream.mapEffect((file) =>
              Effect.gen(function* () {
                const full = path.resolve(search, file)
                const info = yield* fs.stat(full).pipe(Effect.catch(() => Effect.succeed(undefined)))
                const mtime =
                  info?.mtime.pipe(
                    Option.map((date) => date.getTime()),
                    Option.getOrElse(() => 0),
                  ) ?? 0
                return { path: full, mtime }
              }),
            ),
            Stream.take(limit + offset + 1),
            Stream.runCollect,
            Effect.map((chunk) => [...chunk]),
          )

          if (files.length > offset + limit) {
            truncated = true
            files.length = offset + limit
          }
          files.sort((a, b) => b.mtime - a.mtime)
          const shown = offset === 0 ? files : files.slice(offset)

          const output = []
          if (shown.length === 0) output.push("No files found")
          if (shown.length > 0) {
            output.push(...shown.map((file) => file.path))
            if (truncated) {
              output.push("")
              output.push(
                `(Results are truncated: showing entries ${offset + 1}-${offset + shown.length}. Use offset=${offset + shown.length} to continue.)`,
              )
            }
          }

          return {
            title: path.relative(ins.worktree, search),
            metadata: {
              count: shown.length,
              truncated,
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
