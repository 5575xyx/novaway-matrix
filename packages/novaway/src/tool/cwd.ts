import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"
import { AppFileSystem } from "@novaway/core/filesystem"

export const CwdParameters = Schema.Struct({
  directory: Schema.optional(Schema.String).annotate({
    description: "Absolute path to switch this session's working directory to; omit to read the current one",
  }),
})

type Metadata = {
  directory?: string
  previous?: string
}

/**
 * Inspect or change the session working directory.
 *
 * Tools read their cwd from the session row, so this really moves subsequent
 * tool calls (shell, read/write, glob…) rather than just recording a label.
 * It is also the only trigger point for the `CwdChanged` hook.
 *
 * Paths outside the project remain usable but stay subject to the usual
 * `external_directory` permission checks on the tools that touch them.
 */
export const CwdTool = Tool.define<typeof CwdParameters, Metadata, Session.Service>(
  "cwd",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return {
      description:
        "Read or change the working directory of this session. Changing it affects every later tool call and fires the CwdChanged hook.",
      parameters: CwdParameters,
      capabilities: { concurrencySafe: false },
      execute: (params: Schema.Schema.Type<typeof CwdParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const current = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
          if (!params.directory) {
            return {
              title: current.directory,
              output: `Working directory: ${current.directory}`,
              metadata: { directory: current.directory },
            }
          }

          const next = AppFileSystem.resolve(params.directory)
          const info = yield* sessions.setDirectory({ sessionID: ctx.sessionID, directory: next }).pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catchIf(
              (error) => error._tag === "SessionDirectoryError",
              (error) => Effect.succeed({ ok: false as const, error }),
            ),
          )
          if (!info.ok) {
            return {
              title: "Invalid directory",
              output: `${next} is not a directory.`,
              metadata: { directory: current.directory },
            }
          }
          return {
            title: info.value.directory,
            output: [
              `Working directory changed: ${current.directory} → ${info.value.directory}`,
              "Later tool calls (shell, read/write, glob, grep…) run from here.",
            ].join("\n"),
            metadata: { directory: info.value.directory, previous: current.directory },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
