import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"
import { create as createWorktree } from "./worktree-helper"
import { Session } from "@/session/session"
import { InstanceState } from "@/effect/instance-state"
import { Service as HookService } from "@/hook/service"

const EnterParameters = Schema.Struct({
  name: Schema.optional(Schema.String).annotate({
    description: "Short name for the worktree (used in the branch and directory name)",
  }),
  base: Schema.optional(Schema.String).annotate({
    description: "Repository to branch from; defaults to the session's main worktree",
  }),
})

const ExitParameters = Schema.Struct({
  directory: Schema.optional(Schema.String).annotate({
    description: "Directory to return to; defaults to the project's main worktree",
  }),
})

type EnterMetadata = {
  directory?: string
  branch?: string
  base?: string
}

type ExitMetadata = {
  directory?: string
  previous?: string
}

/**
 * Create a git worktree and move this session into it.
 *
 * The worktree lives under the global data directory, so the main checkout is
 * never touched. Every later tool call (shell/read/write/glob…) uses the new
 * directory because tools read the session row.
 */
export const WorktreeEnterTool = Tool.define<typeof EnterParameters, EnterMetadata, Session.Service>(
  "enter_worktree",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return {
      description:
        "Create an isolated git worktree and switch this session into it. Use exit_worktree to return to the main checkout.",
      parameters: EnterParameters,
      capabilities: { concurrencySafe: false, destructive: false },
      execute: (params: Schema.Schema.Type<typeof EnterParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const session = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
          const instance = yield* InstanceState.context
          const base = params.base ?? instance.worktree ?? session.directory
          yield* ctx.ask({
            permission: "worktree",
            patterns: [base],
            always: [base],
            metadata: { action: "create", base, name: params.name },
          })

          const created = yield* Effect.promise(() => createWorktree(base, params.name ?? "session"))
          if (!created) {
            return {
              title: "Worktree unavailable",
              output: `Could not create a git worktree from ${base}. Make sure it is a git repository with at least one commit.`,
              metadata: { base },
            }
          }

          yield* sessions.setDirectory({ sessionID: ctx.sessionID, directory: created.directory }).pipe(Effect.orDie)
          const hooks = Option.getOrUndefined(yield* Effect.serviceOption(HookService))
          if (hooks) {
            yield* hooks
              .trigger({
                event: "WorktreeCreate",
                sessionID: ctx.sessionID,
                cwd: created.directory,
                metadata: { branch: created.branch, directory: created.directory, base },
              })
              .pipe(Effect.ignore)
          }

          return {
            title: created.directory,
            output: [
              `Worktree created: ${created.directory}`,
              `Branch: ${created.branch}`,
              `Base: ${base}`,
              "This session now runs there. Use exit_worktree to return.",
            ].join("\n"),
            metadata: { directory: created.directory, branch: created.branch, base },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

/** Move the session back to the main checkout (or an explicit directory). */
export const WorktreeExitTool = Tool.define<typeof ExitParameters, ExitMetadata, Session.Service>(
  "exit_worktree",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return {
      description:
        "Leave the current worktree and switch this session back to the project's main checkout (or the given directory).",
      parameters: ExitParameters,
      capabilities: { concurrencySafe: false },
      execute: (params: Schema.Schema.Type<typeof ExitParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const current = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
          const instance = yield* InstanceState.context
          const target = params.directory ?? instance.worktree ?? instance.directory
          yield* sessions.setDirectory({ sessionID: ctx.sessionID, directory: target }).pipe(Effect.orDie)

          return {
            title: target,
            output: [
              `Working directory changed: ${current.directory} → ${target}`,
              "The worktree is kept on disk so you can inspect or remove it later.",
            ].join("\n"),
            metadata: { directory: target, previous: current.directory },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
