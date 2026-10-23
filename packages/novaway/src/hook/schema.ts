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
  }
  if (next.decision === "deny") return { ...merged, blocked: true }
  return merged
}
