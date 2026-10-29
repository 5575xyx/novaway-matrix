import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"
import { create as createWorktree, remove as removeWorktree, state } from "./worktree-helper"
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
  action: Schema.optional(Schema.Literals(["keep", "remove"])).annotate({
    description:
      'keep (default) leaves the worktree directory and branch on disk. remove deletes both — use it for a clean exit when the work is done or abandoned.',
  }),
  discard_changes: Schema.optional(Schema.Boolean).annotate({
    description:
      'Only meaningful with action: "remove". The worktree is refused when it has uncommitted files or unmerged commits unless this is true.',
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
  action?: string
}

function describeWork(info: { files: string[]; ahead: number }) {
  const parts: string[] = []
  if (info.files.length > 0) {
    parts.push(`${info.files.length} uncommitted change${info.files.length === 1 ? "" : "s"}`)
  }
  if (info.ahead > 0) parts.push(`${info.ahead} commit${info.ahead === 1 ? "" : "s"} not on the main branch`)
  return parts.join(" and ")
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
        "Leave the current worktree and switch this session back to the project's main checkout (or the given directory). action: \"keep\" (default) leaves the worktree and its branch on disk; action: \"remove\" deletes both, refusing when there are uncommitted files or unmerged commits unless discard_changes is true.",
      parameters: ExitParameters,
      capabilities: { concurrencySafe: false },
      execute: (params: Schema.Schema.Type<typeof ExitParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const current = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
          const instance = yield* InstanceState.context
          const target = params.directory ?? instance.worktree ?? instance.directory
          const hooks = Option.getOrUndefined(yield* Effect.serviceOption(HookService))
          const action = params.action ?? "keep"

          let removed: { branch?: string } | undefined
          if (action === "remove") {
            const info = yield* Effect.promise(() => state(current.directory, target))
            if ((info.files.length > 0 || info.ahead > 0) && !params.discard_changes) {
              // Refuse instead of silently discarding work: the model has to
              // show the user what would be lost, then re-invoke explicitly.
              throw new Error(
                [
                  `Worktree ${current.directory} has ${describeWork(info)}.`,
                  "Removing it discards this work permanently. Confirm with the user, then re-invoke with discard_changes: true",
                  'or use action: "keep" to preserve the worktree.',
                ].join(" "),
              )
            }
            // Removing a worktree deletes files and a branch: ask like the
            // create path does, so the user sees the target before it's gone.
            yield* ctx.ask({
              permission: "worktree",
              patterns: [current.directory],
              always: [current.directory],
              metadata: {
                action: "remove",
                directory: current.directory,
                branch: info.branch,
                discard_changes: Boolean(params.discard_changes),
              },
            })
            const result = yield* Effect.promise(() => removeWorktree(target, current.directory, info.branch))
            if (!result.ok) throw new Error(`Could not remove worktree: ${result.error}`)
            removed = { branch: info.branch }
            if (hooks) {
              yield* hooks
                .trigger({
                  event: "WorktreeRemove",
                  sessionID: ctx.sessionID,
                  cwd: target,
                  metadata: { worktree_path: current.directory, branch: info.branch },
                })
                .pipe(Effect.ignore)
            }
          }

          yield* sessions.setDirectory({ sessionID: ctx.sessionID, directory: target }).pipe(Effect.orDie)

          return {
            title: target,
            output: [
              `Working directory changed: ${current.directory} → ${target}`,
              action === "remove"
                ? `Worktree removed${removed?.branch ? ` (branch ${removed.branch} deleted)` : ""}.`
                : "The worktree is kept on disk so you can inspect or remove it later.",
            ].join("\n"),
            metadata: { directory: target, previous: current.directory, action },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
