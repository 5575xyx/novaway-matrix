import { Schema } from "effect"

/**
 * Stable subset of Claude Code compatible hook events.
 * Keep names in PascalCase to match `.claude/settings.json` files.
 */
export const EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "Stop",
  "StopFailure",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PermissionDenied",
  "Elicitation",
  "ElicitationResult",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "Notification",
  "TaskCreated",
  "TaskCompleted",
  "TeammateIdle",
  "InstructionsLoaded",
  "FileChanged",
  "CwdChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "ConfigChange",
] as const

export const Event = Schema.Literals(EVENTS).annotate({ identifier: "HookEvent" })
export type Event = Schema.Schema.Type<typeof Event>

export const CommandHook = Schema.Struct({
  type: Schema.Literal("command"),
  command: Schema.String,
  if: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
  async: Schema.optional(Schema.Boolean),
  once: Schema.optional(Schema.Boolean),
  statusMessage: Schema.optional(Schema.String),
}).annotate({ identifier: "HookCommandCommand" })

export const HttpHook = Schema.Struct({
  type: Schema.Literal("http"),
  url: Schema.String,
  if: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  allowedEnvVars: Schema.optional(Schema.Array(Schema.String)),
  once: Schema.optional(Schema.Boolean),
  statusMessage: Schema.optional(Schema.String),
}).annotate({ identifier: "HookCommandHttp" })

export const PromptHook = Schema.Struct({
  type: Schema.Literal("prompt"),
  prompt: Schema.String,
  if: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
  once: Schema.optional(Schema.Boolean),
  statusMessage: Schema.optional(Schema.String),
}).annotate({ identifier: "HookCommandPrompt" })

export const AgentHook = Schema.Struct({
  type: Schema.Literal("agent"),
  prompt: Schema.String,
  if: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
  once: Schema.optional(Schema.Boolean),
  statusMessage: Schema.optional(Schema.String),
}).annotate({ identifier: "HookCommandAgent" })

export const Command = Schema.Union([CommandHook, HttpHook, PromptHook, AgentHook]).annotate({
  identifier: "HookCommand",
})
export type Command = Schema.Schema.Type<typeof Command>

export const Matcher = Schema.Struct({
  matcher: Schema.optional(Schema.String),
  hooks: Schema.Array(Command),
}).annotate({ identifier: "HookMatcher" })
export type Matcher = Schema.Schema.Type<typeof Matcher>

export const Config = Schema.Record(Schema.String, Schema.Array(Matcher)).annotate({ identifier: "HooksConfig" })
export type Config = Schema.Schema.Type<typeof Config>

/**
 * Hook 对 MCP elicitation 的直接回答。
 *
 * 有它就不必打扰用户：例如本地脚本知道某个服务器要的 token，可以在
 * `Elicitation` 钩子里直接 `accept`；`ElicitationResult` 钩子则可以改写或
 * 拦截用户的选择（拦截 = `deny`，等价于 `decline`）。
 */
export const ElicitationReply = Schema.Struct({
  action: Schema.Literals(["accept", "decline", "cancel"]),
  content: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "HookElicitationReply" })
export type ElicitationReply = Schema.Schema.Type<typeof ElicitationReply>

export type TriggerInput = {
  event: Event
  sessionID?: string
  cwd?: string
  tool?: string
  args?: unknown
  result?: string
  error?: string
  prompt?: string
  metadata?: Record<string, unknown>
}

export type Result = {
  /** Blocking decision. `deny` prevents the action, `ask` forces a prompt. */
  decision?: "allow" | "deny" | "ask"
  reason?: string
  blocked: boolean
  updatedInput?: unknown
  additionalContext?: string
  /** Only produced by `Elicitation` / `ElicitationResult` hooks. */
  elicitation?: ElicitationReply
  /** Whether any hook ran. */
  ran: boolean
}

export type Registered = {
  event: string
  matcher?: string
  source: string
  hooks: Command[]
}

export function empty(): Result {
  return { blocked: false, ran: false }
}

export function merge(target: Result, next: Result): Result {
  const merged: Result = {
    ...target,
    blocked: target.blocked || next.blocked,
    ran: target.ran || next.ran,
    ...(next.decision ? { decision: next.decision } : {}),
    ...(next.reason ? { reason: next.reason } : {}),
    ...(next.updatedInput !== undefined ? { updatedInput: next.updatedInput } : {}),
    ...(next.additionalContext
      ? {
          additionalContext: [target.additionalContext, next.additionalContext].filter(Boolean).join("\n\n"),
        }
      : {}),
    ...(next.elicitation ? { elicitation: next.elicitation } : {}),
  }
  if (next.decision === "deny") return { ...merged, blocked: true }
  return merged
}
