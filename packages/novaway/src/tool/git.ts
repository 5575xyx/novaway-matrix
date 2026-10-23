import { Git } from "@/git"
import { InstanceState } from "@/effect/instance-state"
import { formatSetupReport, setupFailure, type SetupReport, type SetupStepView } from "@/setup/report"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * Git 操作（结构化，不经过 shell）。
 *
 * 与让 Agent 跑 `git ...` 相比的好处：参数不经过 shell 转义、输出有固定形状、
 * 写操作能按动作粒度走权限。只读动作（status / diff / log / branches）自动放行。
 */
type GitMetadata = {
  action: string
  exitCode: number
}

const Parameters = Schema.Struct({
  action: Schema.Literals([
    "status",
    "diff",
    "log",
    "branches",
    "add",
    "commit",
    "checkout",
    "push",
    "pull",
    "stash",
  ]).annotate({
    description: "status/diff/log/branches are read-only; add/commit/checkout/push/pull/stash change the repository.",
  }),
  message: Schema.optional(Schema.String).annotate({ description: "Commit message for action=commit." }),
  files: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Paths for action=add. Omit to stage everything (-A).",
  }),
  branch: Schema.optional(Schema.String).annotate({
    description: "Branch name for checkout (created if create=true), and optional ref for push/pull.",
  }),
  create: Schema.optional(Schema.Boolean).annotate({ description: "With action=checkout, create the branch (-b)." }),
  remote: Schema.optional(Schema.String).annotate({ description: "Remote name for push/pull. Defaults to origin." }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Number of commits for action=log (default 20)." }),
  staged: Schema.optional(Schema.Boolean).annotate({
    description: "With action=diff, show staged changes (--cached).",
  }),
})

const MAX_OUTPUT = 20_000

/** git 子命令拼装，单独抽出来便于测试。 */
export function gitArgs(params: {
  action: string
  message?: string
  files?: readonly string[]
  branch?: string
  create?: boolean
  remote?: string
  limit?: number
  staged?: boolean
}) {
  switch (params.action) {
    case "status":
      return ["status", "--short", "--branch"]
    case "diff":
      return ["diff", ...(params.staged ? ["--cached"] : []), "--no-color"]
    case "log":
      return ["log", "--oneline", "--decorate", "-n", String(params.limit ?? 20)]
    case "branches":
      return ["branch", "--all", "--verbose", "--no-color"]
    case "add":
      return ["add", ...(params.files?.length ? params.files : ["-A"])]
    case "commit":
      return ["commit", "-m", params.message ?? ""]
    case "checkout":
      return ["checkout", ...(params.create ? ["-b"] : []), params.branch ?? ""]
    case "push":
      return ["push", params.remote ?? "origin", ...(params.branch ? [params.branch] : [])]
    case "pull":
      return ["pull", params.remote ?? "origin", ...(params.branch ? [params.branch] : [])]
    case "stash":
      return ["stash", "push", "-u", "-m", params.message ?? "novaway stash"]
    default:
      return []
  }
}

const READ_ONLY = new Set(["status", "diff", "log", "branches"])

function clip(text: string) {
  return text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) + String.fromCharCode(10) + "… (truncated)" : text
}

function step(name: string, status: string, detail?: string): SetupStepView {
  return { step: name, status, ...(detail ? { detail } : {}) }
}

export const GitTool = Tool.define(
  "git",
  Effect.gen(function* () {
    const git = yield* Git.Service

    return {
      description: [
        "Run git operations in the current project without going through the shell.",
        "Read-only: status, diff, log, branches. Write: add, commit, checkout, push, pull, stash.",
        "Prefer this over `shell` for git: arguments are not shell-escaped and output is structured.",
        "Write actions ask for permission first. Never force-push, never reset --hard, and never commit secrets.",
        "Commit messages are written in the language the user is using.",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<GitMetadata>> =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const cwd = ctx.directory ?? instance.directory

          if (params.action === "commit" && !params.message?.trim()) {
            throw new Error("action=commit 需要 message")
          }
          if (params.action === "checkout" && !params.branch?.trim()) {
            throw new Error("action=checkout 需要 branch")
          }

          if (!READ_ONLY.has(params.action)) {
            yield* ctx.ask({
              permission: "git",
              patterns: [params.action],
              always: ["*"],
              metadata: { action: params.action, ...(params.branch ? { branch: params.branch } : {}) },
            })
          }

          const args = gitArgs(params)
          const result = yield* git.run(args, { cwd })
          const text = clip(result.text().trim())

          if (params.action === "status") {
            const items = yield* git.status(cwd)
            const branch = (yield* git.branch(cwd)) ?? "(detached)"
            const report: SetupReport = {
              domain: "git",
              ready: true,
              phase: "status",
              summary: branch + " · " + items.length + " 个改动" + (text.includes("ahead") ? "（有未推送提交）" : ""),
              steps: items.map((item) => step(item.file, item.status, item.code)),
              facts: text ? { raw: text } : undefined,
            }
            return {
              title: "Git status",
              metadata: { action: "status", exitCode: result.exitCode },
              output: formatSetupReport(report),
            }
          }

          if (result.exitCode !== 0) {
            throw new Error(
              setupFailure({
                domain: "git",
                ready: false,
                phase: "failed",
                summary: "git " + params.action + " 失败（exit " + result.exitCode + "）",
                error: clip((result.stderr.toString() || result.text()).trim()),
                next: "按错误信息处理（常见：没有上游分支、有冲突、工作区不干净）。",
              }),
            )
          }

          return {
            title: "git " + params.action,
            metadata: { action: params.action, exitCode: result.exitCode },
            output: formatSetupReport({
              domain: "git",
              ready: true,
              phase: params.action,
              summary: "git " + params.action + " 完成",
              facts: { command: "git " + args.join(" ") },
              steps: text ? [{ step: "output", status: "ok", detail: text }] : undefined,
            }),
          }
        }),
    }
  }),
)
