import path from "path"
import os from "os"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import * as Log from "@novaway/core/util/log"
import { SessionRevert } from "./revert"
import * as Session from "./session"
import { Todo } from "./todo"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import {
  type Tool as AITool,
  tool,
  jsonSchema,
  type ToolExecutionOptions,
  asSchema,
  generateObject,
  streamObject,
  type ModelMessage,
} from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import { Bus } from "../bus"
import { ProviderTransform } from "@/provider/transform"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { OutputStyle } from "./output-style"
import { Plugin } from "../plugin"
import PROMPT_PLAN from "../session/prompt/plan.txt"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { ToolRegistry } from "@/tool/registry"
import { ToolJsonSchema } from "@/tool/json-schema"
import { shouldDeferMcpTools } from "@/tool/mcp-defer"
import { Token } from "@/util/token"
import { MCP } from "../mcp"
import { ReadState } from "@/tool/read-state"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { Git } from "@/git"
import { ConfigMemory } from "@/config/memory"
import { ConfigEvolution } from "@/config/evolution"
import { Service as CronService, defaultLayer as CronDefaultLayer } from "@/cron/service"
import { ConfigGoal } from "@/config/goal"
import { ConfigCheckpoint } from "@/config/checkpoint"
import { ConfigDream } from "@/config/dream"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { SessionMemoryNotes } from "./memory-notes"
import { NamedError } from "@novaway/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Service as HookServiceService, defaultLayer as HookServiceLayer } from "@/hook/service"
import { Service as ToolLockServiceService, defaultLayer as ToolLockServiceLayer } from "@/tool/lock"
import { Service as AgentMailboxService, defaultLayer as AgentMailboxLayer } from "@/team/mailbox"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Memory } from "@/memory/service"
import { injectMemoryContext } from "@/memory/context"
import { ProjectContext } from "@/context/project-context"
import { Evolution } from "@/evolution/service"
import { Shell } from "@/shell/shell"
import { ShellID } from "@/tool/shell/id"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Truncate } from "@/tool/truncate"
import { Image } from "@/image/image"
import { decodeDataUrl, decodeDataUrlBytes } from "@/util/data-url"
import { extractOfficeDocumentText, isOfficeDocument } from "@/util/office-document"
import { Process } from "@/util/process"
import { Cause, Effect, Exit, Latch, Layer, Option, Scope, Context, Schema, Types } from "effect"
import * as EffectLogger from "@novaway/core/effect/logger"
import { InstanceState } from "@/effect/instance-state"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { BackgroundJob } from "@/background/job"
import { ToolBudget } from "./tool-budget"
import { contextBudget, pendingTokens } from "./overflow"
import { PlanApproval } from "./plan-approval"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2 } from "@novaway/core/event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionEvent } from "@novaway/core/session-event"
import { ModelV2 } from "@novaway/core/model"
import { ProviderV2 } from "@novaway/core/provider"
import { AgentAttachment, FileAttachment, ReferenceAttachment, Source } from "@novaway/core/session-prompt"
import { Reference } from "@/reference/reference"
import * as DateTime from "effect/DateTime"
import { eq } from "@/storage/db"
import * as Database from "@/storage/db"
import { SessionTable } from "./session.sql"
import { Auth } from "@/auth"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

/**
 * 单次用户请求内允许连续自动压缩的次数。
 *
 * 正常长会话里，压缩一次后上下文会明显下降。连续多次说明固定前缀
 * （system + 工具 schema）本身已经超过可用窗口，压缩无法收敛；
 * 再继续只会无限循环（每轮先输出几十个 token 又触发压缩）。
 */
const MAX_CONSECUTIVE_AUTO_COMPACTIONS = 3
/** Continue a truncated response at most this many times per turn. */
const MAX_LENGTH_CONTINUATIONS = 2
/**
 * A blocking Stop hook (lint, typecheck, tests) feeds its reason back to the
 * model and keeps the turn going, mirroring Claude Code. Bound it so a hook
 * that always fails cannot trap the turn forever.
 */
const MAX_STOP_HOOK_BLOCKS = 3

const buildGoalContext = Effect.fn("SystemPrompt.buildGoalContext")(function* (goalService: any, sessionId: string) {
  if (!goalService) return ""

  const goals = yield* goalService.list(sessionId)

  if (goals.length === 0) return ""

  const activeGoals = goals.filter((g: any) => g.status === "in_progress" || g.status === "pending")
  if (activeGoals.length === 0) return ""

  const goalText = activeGoals.map((g: any) => `- ${g.title} [${g.status}] ${g.progress}% 完成`).join("\n")

  return `\n\n## 当前目标\n${goalText}\n\n请优先完成上述目标，或根据目标分解任务。`
})

const decodeMessageInfo = Schema.decodeUnknownExit(MessageV2.Info)
const decodeMessagePart = Schema.decodeUnknownExit(MessageV2.Part)

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

// 图片识别子代理的系统提示词：主模型不支持图片输入时，由具备多模态能力的
// 模型先识别附件图片，再把识别结果以文本注入对话，供主模型继续处理。
const VISION_DESCRIBE_SYSTEM_PROMPT = [
  "你是一个图片识别子代理，用户选择的主模型不支持图片输入。",
  "请用简体中文仔细识别附件中的每一张图片，并输出图片内容：",
  "画面主体与布局、图中的文字（逐字转写）、数字、图表、人物、动作，",
  "以及与用户问题相关的细节。",
  "只输出图片识别结果，不要询问、不要回复与识别无关的内容。",
].join("\n")

const VISION_DESCRIPTION_MARKER = "[图片内容识别结果]"
const NL = String.fromCharCode(10)

type HookResult = {
  blocked: boolean
  ran: boolean
  decision?: "allow" | "deny" | "ask"
  reason?: string
  updatedInput?: unknown
  additionalContext?: string
}

const EMPTY_HOOK: HookResult = { blocked: false, ran: false }

/**
 * What a hook wants the model to read. `reason` only counts when the hook
 * actually blocked the call (`deny` from JSON, exit code 2 from a command);
 * a hook that merely failed keeps its stderr in the logs, because reporting it
 * to the model would look like a tool failure that never happened.
 */
function hookNotes(result: HookResult) {
  const notes: string[] = []
  if (result.additionalContext) notes.push(result.additionalContext)
  if (result.reason && (result.decision === "deny" || result.blocked)) notes.push(result.reason)
  return notes
}

const TODO_TOOL_IDS = new Set(["todowrite", "todoedit"])

const hasTodoToolCall = (message: MessageV2.WithParts) =>
  message.parts.some((part) => part.type === "tool" && TODO_TOOL_IDS.has(part.tool))

/**
 * Periodic "you have not touched the todo list in a while" nudge.
 *
 * Mirrors Claude Code's `todo_reminder` attachment: it fires only after
 * {@link TODO_REMINDER_TURNS_SINCE_WRITE} assistant turns without a todo tool
 * call, and at most once every {@link TODO_REMINDER_TURNS_BETWEEN} turns. The
 * point is to keep long multi-step work tracked — statuses are expected to be
 * finalized item-by-item as the work happens, so drift is the only thing left
 * to prod.
 */
export const TODO_REMINDER_MARKER = "[待办清单提醒]"
const TODO_REMINDER_TURNS_SINCE_WRITE = 10
const TODO_REMINDER_TURNS_BETWEEN = 10

const hasTodoReminder = (message: MessageV2.WithParts) =>
  message.parts.some((part) => part.type === "text" && part.synthetic && part.text.includes(TODO_REMINDER_MARKER))

export function decideTodoReminder(input: { messages: MessageV2.WithParts[]; enabled: boolean }): boolean {
  if (!input.enabled || input.messages.length === 0) return false
  const assistantTurnsSince = (index: number) =>
    input.messages.slice(index + 1).filter((message) => message.info.role === "assistant").length
  return (
    assistantTurnsSince(input.messages.findLastIndex(hasTodoToolCall)) >= TODO_REMINDER_TURNS_SINCE_WRITE &&
    assistantTurnsSince(input.messages.findLastIndex(hasTodoReminder)) >= TODO_REMINDER_TURNS_BETWEEN
  )
}

/**
 * Background shell jobs finish after their tool call already returned. CC tells
 * the model once through a `<task-notification>` block instead of making it
 * poll; this tracks the jobs already announced so a re-listed job (or a restart)
 * does not repeat the message.
 */
const notifiedJobs = new Map<string, Set<string>>()

/** Test hook: forget which background jobs were already announced. */
export function resetBackgroundNotifications(sessionID?: string) {
  if (sessionID === undefined) notifiedJobs.clear()
  else notifiedJobs.delete(sessionID)
}

function notificationText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

export function backgroundNotification(job: BackgroundJob.Info) {
  const description = job.title ?? "background command"
  const exit = typeof job.metadata?.exit === "number" ? job.metadata.exit : undefined
  const summary =
    job.status === "completed"
      ? `Background command "${description}" completed${exit !== undefined ? ` (exit code ${exit})` : ""}`
      : job.status === "cancelled"
        ? `Background command "${description}" was stopped`
        : `Background command "${description}" failed${exit !== undefined ? ` with exit code ${exit}` : ""}`
  const outputPath = typeof job.metadata?.outputPath === "string" ? job.metadata.outputPath : undefined
  return [
    "<task-notification>",
    `<task-id>${job.id}</task-id>`,
    ...(outputPath ? [`<output-file>${outputPath}</output-file>`] : []),
    `<status>${job.status === "error" ? "failed" : job.status}</status>`,
    `<summary>${notificationText(summary)}</summary>`,
    "</task-notification>",
  ].join("\n")
}

export function todoReminder(todos: Todo.Info[]): string {
  const items = todos.map((todo, index) => `${index + 1}. [${todo.status}] ${todo.content}`).join("\n")
  return [
    TODO_REMINDER_MARKER,
    `最近 ${TODO_REMINDER_TURNS_SINCE_WRITE} 个回合没有更新待办清单。如果当前工作是多步骤任务,请用 todowrite 建立清单并用 todoedit 按真实进度更新;如果不需要追踪,忽略这条提醒即可。`,
    "更新时按真实进度逐项收尾:当前这项做完并验证过就立刻 complete,再 progress 下一项;清单不能停在旧状态。",
    items ? `当前清单:\n${items}` : "当前还没有待办清单。",
    "不要向用户提起这条提醒。",
  ].join("\n")
}

/**
 * 修复模型返回的 JSON。
 *
 * `generateObject` 只接受裸 JSON，但不少模型习惯包一层 ```json 代码块
 * （弱网/小模型尤其常见），会直接抛 `AI_NoObjectGeneratedError`，
 * 而调用方把错误吞掉后表现成"记忆/进化从不生成候选"。
 * 这里去掉代码块围栏并截取最外层对象后再解析；仍然失败就返回 null 走原错误。
 */
export function repairJsonText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : trimmed).trim()
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  const body = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate
  try {
    JSON.parse(body)
    return body
  } catch {
    return null
  }
}

/**
 * 结构化输出模型经常不完全按 schema 返回（例如把 content 写成 fact）。
 * 这里把常见别名归一化，避免整批候选因为一个字段名被 TypeValidationError 丢弃。
 */
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const textOf = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined

const MEMORY_KINDS = [
  "episodic",
  "semantic",
  "preference",
  "goal",
  "decision",
  "relationship",
  "lesson",
  "procedure",
] as const
const MEMORY_DOMAINS = ["general", "coding", "office", "personal", "research", "ops"] as const
const MEMORY_TARGETS = ["memory", "user"] as const
const MEMORY_SCOPES = ["global", "project", "session"] as const
const MEMORY_OPERATIONS = ["add", "update", "archive", "confirm"] as const
const EVOLUTION_KINDS = [
  "skill",
  "agent",
  "workflow",
  "prompt",
  "tool",
  "project",
  "strategy",
  "habit",
  "knowledge",
] as const

/** 归一化记忆候选（generateObject 的 repairText 回调）。 */
export function repairMemoryReviewJson(text: string): string | null {
  const body = repairJsonText(text)
  if (!body) return null
  const parsed = asRecord(JSON.parse(body))
  if (!parsed || !Array.isArray(parsed.candidates)) return null
  const candidates = parsed.candidates.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return []
    const content = textOf(record, ["content", "fact", "text", "description", "memory"])
    if (!content) return []
    return [
      {
        ...record,
        content,
        target: pick(record.target, MEMORY_TARGETS) ?? "memory",
        domain: pick(record.domain, MEMORY_DOMAINS) ?? "general",
        kind: pick(record.kind, MEMORY_KINDS) ?? "semantic",
        scope: pick(record.scope, MEMORY_SCOPES),
        operation: pick(record.operation, MEMORY_OPERATIONS) ?? "add",
        confidence: typeof record.confidence === "number" ? record.confidence : 0.7,
      },
    ]
  })
  if (!candidates.length) return null
  return JSON.stringify({ ...parsed, candidates })
}

/** 归一化进化候选：模型常把 target/title 写进 content 或漏 reason。 */
export function repairEvolutionReviewJson(text: string): string | null {
  const body = repairJsonText(text)
  if (!body) return null
  const parsed = asRecord(JSON.parse(body))
  if (!parsed || !Array.isArray(parsed.candidates)) return null
  const candidates = parsed.candidates.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return []
    const content = textOf(record, ["content", "body", "description", "proposal"])
    if (!content) return []
    return [
      {
        ...record,
        kind: pick(record.kind, EVOLUTION_KINDS) ?? "skill",
        target: textOf(record, ["target", "name", "title"]) ?? "novaway",
        title: textOf(record, ["title", "name", "target"]) ?? content.slice(0, 40),
        content,
        reason: textOf(record, ["reason", "why", "rationale"]) ?? `${content.slice(0, 40)}（自动进化建议）`,
      },
    ]
  })
  if (!candidates.length) return null
  return JSON.stringify({ ...parsed, candidates })
}

const log = Log.create({ service: "session.prompt" })
const elog = EffectLogger.create({ service: "session.prompt" })

const MemoryReviewCandidateDraft = Schema.Struct({
  target: Schema.optional(Schema.Literals(["memory", "user"])),
  scope: Schema.optional(Schema.Literals(["global", "project", "session"])),
  domain: Schema.optional(Schema.Literals(["general", "coding", "office", "personal", "research", "ops"])),
  kind: Schema.optional(
    Schema.Literals(["episodic", "semantic", "preference", "goal", "decision", "relationship", "lesson", "procedure"]),
  ),
  entities: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String, type: Schema.optional(Schema.String) }))),
  content: Schema.String,
  summary: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  importance: Schema.optional(Schema.Number),
  confidence: Schema.optional(Schema.Number),
  factKey: Schema.optional(Schema.String),
  operation: Schema.optional(Schema.Literals(["add", "update", "archive", "confirm"])),
  reason: Schema.optional(Schema.String),
})

const MemoryReviewResult = Schema.Struct({
  candidates: Schema.Array(MemoryReviewCandidateDraft),
})

type MemoryReviewCandidateDraft = Schema.Schema.Type<typeof MemoryReviewCandidateDraft>

const EvolutionReviewCandidateDraft = Schema.Struct({
  kind: Schema.Literals(["skill", "agent", "workflow", "prompt", "tool", "project", "strategy", "habit", "knowledge"]),
  scope: Schema.optional(Schema.Literals(["global", "project"])),
  target: Schema.String,
  title: Schema.String,
  content: Schema.String,
  reason: Schema.String,
  tags: Schema.optional(Schema.Array(Schema.String)),
  expectedOutcomes: Schema.optional(Schema.Array(Schema.String)),
})

const EvolutionReviewResult = Schema.Struct({
  candidates: Schema.Array(EvolutionReviewCandidateDraft),
})

// 目标裁判:判断活动目标是否已达成,未达成时给出下一步动作建议。
const GoalJudgeResult = Schema.Struct({
  goalMet: Schema.Boolean,
  reasoning: Schema.String,
  nextAction: Schema.optional(Schema.String),
})

type EvolutionReviewCandidateDraft = Schema.Schema.Type<typeof EvolutionReviewCandidateDraft>

function textFromParts(parts: MessageV2.Part[]) {
  return parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
}

// dream 反思的进程内轮次计数:按会话累加,turn % interval === 0 时触发。重启后归零,属软节流可接受。
const dreamTurns = new Map<string, number>()
function dreamDue(sessionID: string, interval: number) {
  if (interval <= 0) return false
  const next = (dreamTurns.get(sessionID) ?? 0) + 1
  dreamTurns.set(sessionID, next)
  return next % interval === 0
}

type ReferencePromptMetadata = {
  name: string
  kind: "local" | "git" | "invalid"
  path?: string
  repository?: string
  branch?: string
  target?: string
  targetPath?: string
  problem?: string
  source: { value: string; start: number; end: number }
}

function stringField(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? record[key] : undefined
}

function referencePromptMetadata(input: unknown): ReferencePromptMetadata | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  const record = input as Record<string, unknown>
  const name = stringField(record, "name")
  const kind = stringField(record, "kind")
  if (!name || (kind !== "local" && kind !== "git" && kind !== "invalid")) return
  if (!record.source || typeof record.source !== "object" || Array.isArray(record.source)) return
  const source = record.source as Record<string, unknown>
  const value = stringField(source, "value")
  if (!value || typeof source.start !== "number" || typeof source.end !== "number") return
  return {
    name,
    kind,
    path: stringField(record, "path"),
    repository: stringField(record, "repository"),
    branch: stringField(record, "branch"),
    target: stringField(record, "target"),
    targetPath: stringField(record, "targetPath"),
    problem: stringField(record, "problem"),
    source: { value, start: source.start, end: source.end },
  }
}

function referenceTextPart(input: {
  reference: Reference.Resolved
  source: ReferencePromptMetadata["source"]
  target?: string
  targetPath?: string
  problem?: string
}): MessageV2.TextPartInput {
  const metadata: ReferencePromptMetadata = {
    name: input.reference.name,
    kind: input.reference.kind,
    ...(input.reference.kind === "invalid"
      ? { repository: input.reference.repository }
      : { path: input.reference.path }),
    ...(input.reference.kind === "git"
      ? { repository: input.reference.repository, branch: input.reference.branch }
      : {}),
    ...(input.target === undefined ? {} : { target: input.target }),
    ...(input.targetPath ? { targetPath: input.targetPath } : {}),
    problem: input.problem ?? (input.reference.kind === "invalid" ? input.reference.message : undefined),
    source: input.source,
  }
  const label = metadata.target === undefined ? `@${metadata.name}` : `@${metadata.name}/${metadata.target}`
  return {
    type: "text",
    synthetic: true,
    text: [
      `Referenced configured reference ${label}.`,
      ...(metadata.kind === "local" ? ["Kind: local directory"] : []),
      ...(metadata.kind === "git" ? ["Kind: git repository"] : []),
      ...(metadata.repository ? [`Repository: ${metadata.repository}`] : []),
      ...(metadata.branch ? [`Branch/ref: ${metadata.branch}`] : []),
      ...(metadata.path ? [`Reference root: ${metadata.path}`] : []),
      ...(metadata.targetPath ? [`Resolved path: ${metadata.targetPath}`] : []),
      ...(metadata.problem
        ? [`Problem: ${metadata.problem}`]
        : [
            "For targeted context, inspect the reference path directly with Read, Glob, and Grep. For broader research, call the task tool with subagent scout and include this reference path.",
          ]),
    ].join("\n"),
    metadata: { reference: metadata },
  }
}

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts, Image.Error>
  readonly resume: (sessionID: SessionID) => Effect.Effect<MessageV2.WithParts>
  readonly loop: (input: LoopInput) => Effect.Effect<MessageV2.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts, Session.BusyError>
  readonly command: (input: CommandInput) => Effect.Effect<MessageV2.WithParts, Image.Error>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/SessionPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const auth = Option.getOrUndefined(yield* Effect.serviceOption(Auth.Service))
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const todo = yield* Todo.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const fsys = yield* AppFileSystem.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    // Collaboration hooks/locks/mailbox are optional: embedders that compose a
    // minimal layer stack still get a working prompt loop, just without them.
    const hooks = Option.getOrUndefined(yield* Effect.serviceOption(HookServiceService))
    // Instructions rarely change; remember what each session loaded so
    // `InstructionsLoaded` fires on the first turn and on change, not per request.
    const instructionSignatures = new Map<string, string>()
    // Tool hooks run while the tool call is in flight, when there is no new user
    // message to attach context to. Their notes are queued per session and
    // drained by `insertReminders` on the next request, matching the timing and
    // shape of Claude Code's `hook_blocking_error` attachment.
    const pendingHookNotes = new Map<SessionID, { tool: string; text: string }[]>()
    const PENDING_HOOK_NOTES_MAX = 10
    const rememberHookNotes = (sessionID: SessionID, tool: string, notes: string[]) => {
      if (!notes.length) return
      const list = pendingHookNotes.get(sessionID) ?? []
      for (const text of notes) list.push({ tool, text })
      if (list.length > PENDING_HOOK_NOTES_MAX) list.splice(0, list.length - PENDING_HOOK_NOTES_MAX)
      pendingHookNotes.set(sessionID, list)
    }
    const takeHookNotes = (sessionID: SessionID) => {
      const list = pendingHookNotes.get(sessionID)
      if (!list?.length) return []
      pendingHookNotes.delete(sessionID)
      return list
    }
    const toolLock = Option.getOrUndefined(yield* Effect.serviceOption(ToolLockServiceService))
    const mailbox = Option.getOrUndefined(yield* Effect.serviceOption(AgentMailboxService))
    const planApproval = Option.getOrUndefined(yield* Effect.serviceOption(PlanApproval.Service))
    const git = yield* Effect.serviceOption(Git.Service)
    const truncate = yield* Truncate.Service
    const image = yield* Image.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    // 注意：不要在层构造期解析 Memory/Evolution。
    // Layer.mergeAll 的兄弟层互不可见，`SessionPrompt` 构造时这里永远拿到 None，
    // 于是记忆/进化的所有副作用都被静默跳过（工具能用到是因为它在运行期解析）。
    // 统一改为在每轮副作用（runTurnLearning / prefetch）里按运行上下文解析。
    const references = yield* Reference.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const { GoalService } = yield* Effect.tryPromise({
      try: () => import("./goal"),
      catch: () => ({ GoalService: undefined as any }),
    }).pipe(Effect.catch(() => Effect.succeed({ GoalService: undefined })))
    const goalService = GoalService ? Option.getOrUndefined(yield* Effect.serviceOption(GoalService)) : undefined
    const { SessionCheckpoint } = yield* Effect.tryPromise({
      try: () => import("./checkpoint"),
      catch: () => ({ SessionCheckpoint: undefined as any }),
    }).pipe(Effect.catch(() => Effect.succeed({ SessionCheckpoint: undefined })))
    const checkpointService = SessionCheckpoint
      ? Option.getOrUndefined(yield* Effect.serviceOption(SessionCheckpoint.Service))
      : undefined
    const runner = Effect.fn("SessionPrompt.runner")(function* () {
      return yield* EffectBridge.make()
    })
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
        loop: (input: LoopInput) => loop(input),
      } satisfies TaskPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* elog.info("cancel", { sessionID })
      // Release anything a subagent is blocked on, otherwise its fiber would
      // keep a pending plan approval alive after the turn is cancelled.
      if (planApproval) yield* planApproval.clear(sessionID).pipe(Effect.ignore)
      yield* state.cancel(sessionID)
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      const mentionSource = (match: RegExpMatchArray) => {
        const start = match.index ?? 0
        return { value: match[0], start, end: start + match[0].length }
      }
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          if (seen.has(name)) return
          seen.add(name)

          const slash = name.indexOf("/")
          const alias = slash === -1 ? name : name.slice(0, slash)
          const reference = yield* references.get(alias)
          if (reference) {
            const source = mentionSource(match)
            if (reference.kind === "invalid") {
              parts.push(
                referenceTextPart({ reference, source, target: slash === -1 ? undefined : name.slice(slash + 1) }),
              )
              return
            }

            yield* references.ensure(reference.path)
            if (slash === -1) {
              parts.push(referenceTextPart({ reference, source }))
              return
            }

            const target = name.slice(slash + 1)
            const targetPath = path.resolve(reference.path, target)
            if (!AppFileSystem.contains(reference.path, targetPath)) {
              parts.push(
                referenceTextPart({
                  reference,
                  source,
                  target,
                  targetPath,
                  problem: `Path escapes configured reference @${alias}: ${target}`,
                }),
              )
              return
            }

            const info = yield* fsys.stat(targetPath).pipe(Effect.option)
            if (Option.isNone(info)) {
              parts.push(
                referenceTextPart({
                  reference,
                  source,
                  target,
                  targetPath,
                  problem: `Path does not exist inside configured reference @${alias}: ${target}`,
                }),
              )
              return
            }

            parts.push({
              type: "file",
              url: pathToFileURL(targetPath).href,
              filename: name,
              mime: info.value.type === "Directory" ? "application/x-directory" : "text/plain",
            })
            return
          }

          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: MessageV2.WithParts[]
      providerID: ProviderID
      modelID: ModelID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: MessageV2.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return
      if (input.history.filter(real).length !== 1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is MessageV2.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* agents.get("title")
      if (!ag) return
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* provider.getSmallModel(input.providerID)) ??
          (yield* provider.getModel(input.providerID, input.modelID)))
      const msgs = onlySubtasks
        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
        : yield* MessageV2.toModelMessagesEffect(context, mdl)
      const text = yield* llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
        })
        .pipe(
          Stream.filter((e): e is Extract<LLM.Event, { type: "text-delta" }> => e.type === "text-delta"),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
        )
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => elog.error("failed to generate title", { error: Cause.squash(cause) })))
    })

    const insertReminders = Effect.fn("SessionPrompt.insertReminders")(function* (input: {
      messages: MessageV2.WithParts[]
      agent: Agent.Info
      session: Session.Info
    }) {
      const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
      if (!userMessage) return input.messages

      // Files the model read earlier may have changed on disk (the user edited
      // them, a build regenerated them, another agent touched them). Claude
      // Code surfaces this as an attachment so the model does not reason from
      // stale contents; we say so once and invalidate the read entry, which
      // also makes a later Edit demand a fresh read instead of silently
      // applying an offset-based patch to a changed file.
      const readState = Option.getOrUndefined(yield* Effect.serviceOption(ReadState.Service))
      if (readState) {
        const tracked = yield* readState.list(input.session.id)
        const changed: string[] = []
        for (const item of tracked.slice(-200)) {
          const info = yield* fsys.stat(item.path).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const mtime = info?.mtime.pipe(Option.map((date) => date.getTime()), Option.getOrElse(() => 0)) ?? 0
          const size = info ? Number(info.size) : -1
          if (!info) {
            changed.push(`${item.path} (deleted)`)
            yield* readState.forget(input.session.id, item.path)
            continue
          }
          if (mtime !== item.entry.mtime || size !== item.entry.size) {
            changed.push(item.path)
            yield* readState.forget(input.session.id, item.path)
          }
        }
        if (changed.length > 0) {
          const shown = changed.slice(0, 10)
          const part = yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            synthetic: true,
            text: [
              "<system-reminder>",
              `The following file${changed.length === 1 ? " has" : "s have"} changed on disk since you last read ${
                changed.length === 1 ? "it" : "them"
              }, so the contents you have are stale:`,
              ...shown.map((file) => `- ${file}`),
              ...(changed.length > shown.length ? [`- ...and ${changed.length - shown.length} more`] : []),
              "Read each one again before relying on its contents or editing it.",
              "</system-reminder>",
            ].join("\n"),
          })
          userMessage.parts.push(part)
        }
      }

      // Background commands that finished since the last request. The tail of
      // their output is already in the job (and the full text on disk when it
      // was truncated); the point is to stop the model from polling task_status.
      const background = Option.getOrUndefined(yield* Effect.serviceOption(BackgroundJob.Service))
      if (background) {
        const seen = notifiedJobs.get(input.session.id) ?? new Set<string>()
        const jobs = (yield* background.list()).filter(
          (job) =>
            job.type === "shell" &&
            job.metadata?.background === true &&
            job.metadata?.sessionId === input.session.id &&
            (job.status === "completed" || job.status === "error" || job.status === "cancelled") &&
            !seen.has(job.id),
        )
        if (jobs.length > 0) {
          const announced = jobs.slice(0, 20)
          for (const job of announced) seen.add(job.id)
          notifiedJobs.set(input.session.id, seen)
          const part = yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            synthetic: true,
            text: [
              "<system-reminder>",
              "Background command status changed since the last message:",
              ...announced.map(backgroundNotification),
              "Read the reported output (or the output file) instead of polling the job; the user can also see it in the status panel.",
              "</system-reminder>",
            ].join("\n"),
          })
          userMessage.parts.push(part)
        }
      }

      // Plan mode forbids the todo tools, so the nudge would only be noise.
      if (input.agent.name !== "plan" && !Permission.disabled(["todowrite"], input.agent.permission).has("todowrite")) {
        if (decideTodoReminder({ messages: input.messages, enabled: true })) {
          const todos = yield* todo.get(input.session.id).pipe(Effect.catch(() => Effect.succeed([] as Todo.Info[])))
          const part = yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            text: todoReminder(todos),
            synthetic: true,
          })
          userMessage.parts.push(part)
        }
      }

      // Hook notes produced while tool calls ran this turn (blocked PostToolUse,
      // PostToolUseFailure reasons, additionalContext). Delivered before the
      // next request so the model can act on them, mirroring Claude Code's
      // `hook_blocking_error` / `hook_additional_context` attachments.
      const hookNotes = takeHookNotes(input.session.id)
      if (hookNotes.length > 0) {
        const part = yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          synthetic: true,
          text: [
            "<system-reminder>",
            "Feedback from tool hooks in this turn:",
            ...hookNotes.map((note) => `[${note.tool}] ${note.text}`),
            "</system-reminder>",
          ].join("\n"),
        })
        userMessage.parts.push(part)
      }

      if (!flags.experimentalPlanMode) {
        if (input.agent.name === "plan") {
          const ctx = yield* InstanceState.context
          const plan = Session.plan(input.session, ctx)
          userMessage.parts.push({
            id: PartID.ascending(),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            text: `${PROMPT_PLAN}\n\n## 计划文件\n你必须把当前实现计划写入并持续更新这个唯一计划文件：${plan}\n\n允许写入范围仅限这个计划文件。除该计划文件外，仍然禁止修改任何项目文件。每次用户要求调整计划时，更新同一份文件，不要新建重复计划。`,
            synthetic: true,
          })
        }
        const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
        if (wasPlan && input.agent.name === "build") {
          userMessage.parts.push({
            id: PartID.ascending(),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            text: BUILD_SWITCH,
            synthetic: true,
          })
        }
        return input.messages
      }

      const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")
      if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
        const ctx = yield* InstanceState.context
        const plan = Session.plan(input.session, ctx)
        if (!(yield* fsys.existsSafe(plan))) return input.messages
        const part = yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: `${BUILD_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`,
          synthetic: true,
        })
        userMessage.parts.push(part)
        return input.messages
      }

      if (input.agent.name !== "plan" || assistantMessage?.info.agent === "plan") return input.messages

      const ctx = yield* InstanceState.context
      const plan = Session.plan(input.session, ctx)
      const exists = yield* fsys.existsSafe(plan)
      if (!exists) yield* fsys.ensureDir(path.dirname(plan)).pipe(Effect.catch(Effect.die))
      const part = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: `<system-reminder>
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File Info:
${exists ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.` : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the explore subagent type.

1. Focus on understanding the user's request and the code associated with their request

2. **Launch up to 3 explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
 - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
 - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
 - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
 - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigates testing patterns

3. After exploring the code, use the question tool to clarify ambiguities in the user request up front.

### Phase 2: Design
Goal: Design an implementation approach.

Launch general agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 1 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)

Examples of when to use multiple agents:
- The task touches multiple parts of the codebase
- It's a large refactor or architectural change
- There are many edge cases to consider
- You'd benefit from exploring different approaches

Example perspectives by task type:
- New feature: simplicity vs performance vs maintainability
- Bug fix: root cause vs workaround vs prevention
- Refactoring: minimal change vs clean architecture

In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use question tool to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)

### Phase 5: Call plan_exit tool
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call plan_exit to indicate to the user that you are done planning.
This is critical - your turn should only end with either asking the user a question or calling plan_exit. Do not stop unless it's for these 2 reasons.

**Important:** Use question tool to clarify requirements/approach, use plan_exit to request plan approval. Do NOT use question tool to ask "Is this plan okay?" - that's what plan_exit does.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
</system-reminder>`,
        synthetic: true,
      })
      userMessage.parts.push(part)
      return input.messages
    })

    const touchedPaths = (messages: MessageV2.WithParts[]) => {
      const result = new Set<string>()
      for (const message of messages) {
        for (const part of message.parts) {
          if (part.type !== "tool") continue
          const input = (part.state as { input?: Record<string, unknown> } | undefined)?.input
          if (!input || typeof input !== "object") continue
          for (const [key, value] of Object.entries(input)) {
            if (!/path$/i.test(key)) continue
            if (typeof value === "string" && value.trim()) result.add(value)
          }
        }
      }
      return [...result]
    }

    const resolveTools = Effect.fn("SessionPrompt.resolveTools")(function* (input: {
      agent: Agent.Info
      model: Provider.Model
      session: Session.Info
      tools?: Record<string, boolean>
      processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
      bypassAgentCheck: boolean
      messages: MessageV2.WithParts[]
    }) {
      using _ = log.time("resolveTools")
      const tools: Record<string, AITool> = {}
      const run = yield* runner()
      const promptOps = yield* ops()

      const context = (args: any, options: ToolExecutionOptions): Tool.Context => ({
        sessionID: input.session.id,
        directory: input.session.directory,
        abort: options.abortSignal!,
        messageID: input.processor.message.id,
        callID: options.toolCallId,
        extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, promptOps },
        agent: input.agent.name,
        messages: input.messages,
        metadata: (val) =>
          input.processor.updateToolCall(options.toolCallId, (match) => {
            if (!["running", "pending"].includes(match.state.status)) return match
            return {
              ...match,
              state: {
                title: val.title,
                metadata: val.metadata,
                status: "running",
                input: args,
                time: { start: Date.now() },
              },
            }
          }),
        ask: (req) =>
          permission
            .ask({
              ...req,
              sessionID: input.session.id,
              tool: { messageID: input.processor.message.id, callID: options.toolCallId },
              ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
              // Session mode wins; the store falls back to config when unset.
              ...(input.session.permissionMode ? { mode: input.session.permissionMode } : {}),
            })
            .pipe(Effect.orDie),
      })

      for (const item of yield* registry.tools({
        modelID: ModelID.make(input.model.api.id),
        providerID: input.model.providerID,
        agent: input.agent,
        sessionID: input.session.id,
      })) {
        const schema = ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item))
        tools[item.id] = tool({
          description: item.description,
          inputSchema: jsonSchema(schema),
          execute(args, options) {
            return run.promise(
              Effect.gen(function* () {
                const ctx = context(args, options)
                const mode = Tool.concurrencySafe(item, args) ? "read" : "write"
                const release = toolLock ? yield* toolLock.acquire(input.session.id, mode) : Effect.void
                return yield* Effect.gen(function* () {
                  const capability = item.capabilities
                  yield* capability?.validateInput?.(args, ctx) ?? Effect.void
                  const decision = capability?.checkPermissions
                    ? yield* capability.checkPermissions(args, ctx)
                    : "allow"
                  if (decision === "deny") {
                    return yield* Effect.fail(new Error(`The ${item.id} tool is not allowed in the current context.`))
                  }
                  if (decision === "ask") {
                    yield* ctx.ask({
                      permission: item.id,
                      patterns: ["*"],
                      always: ["*"],
                      metadata: {},
                    })
                  }

                  const pre: HookResult = hooks
                    ? yield* hooks.trigger({
                        event: "PreToolUse",
                        sessionID: ctx.sessionID,
                        cwd: input.session.directory,
                        tool: item.id,
                        args,
                      })
                    : EMPTY_HOOK
                  if (pre.decision === "deny") {
                    return yield* Effect.fail(
                      new Error(pre.reason || `The ${item.id} tool call was blocked by a PreToolUse hook.`),
                    )
                  }
                  // `ask` from a hook is a request for human approval for this
                  // one call, exactly like `checkPermissions` returning "ask".
                  if (pre.decision === "ask") {
                    yield* ctx.ask({
                      permission: item.id,
                      patterns: ["*"],
                      always: ["*"],
                      metadata: pre.reason ? { hookReason: pre.reason } : {},
                    })
                  }
                  const effective = (pre.updatedInput ?? args) as typeof args

                  yield* plugin.trigger(
                    "tool.execute.before",
                    { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
                    { args: effective },
                  )
                  // Tool failures must still reach hooks, then propagate unchanged:
                  // `PostToolUseFailure` is observational, not a recovery channel.
                  // Whatever the hook says about the failure is queued and shown
                  // at the next request; the error object itself is untouched so
                  // permission rejections keep their identity for denial counting.
                  const result = yield* item.execute(effective, ctx).pipe(
                    Effect.catchCause((cause) =>
                      Effect.gen(function* () {
                        if (hooks) {
                          const failed = yield* hooks
                            .trigger({
                              event: "PostToolUseFailure",
                              sessionID: ctx.sessionID,
                              cwd: input.session.directory,
                              tool: item.id,
                              args: effective,
                              error: Cause.pretty(cause),
                            })
                            .pipe(Effect.catchCause(() => Effect.succeed(EMPTY_HOOK)))
                          rememberHookNotes(ctx.sessionID, item.id, hookNotes(failed))
                        }
                        return yield* Effect.failCause(cause)
                      }),
                    ),
                  )
                  // PostToolUse runs before the result is handed to the model so
                  // its `additionalContext` (lint output, formatter notes, …) can
                  // be appended as a system reminder. Claude Code surfaces it the
                  // same way; storing it only in metadata would hide it from the
                  // model entirely.
                  const post = hooks
                    ? yield* hooks.trigger({
                        event: "PostToolUse",
                        sessionID: ctx.sessionID,
                        cwd: input.session.directory,
                        tool: item.id,
                        args: effective,
                        result: result.output,
                      })
                    : EMPTY_HOOK
                  // `pre` and `post` both run before the result reaches the
                  // model, so their notes are appended to the tool output
                  // itself; only a blocked PostToolUse has a reason worth
                  // showing (a hook that merely failed keeps its stderr in logs).
                  const context = [pre.additionalContext, ...hookNotes(post)].filter(
                    (text): text is string => !!text,
                  )
                  const output = {
                    ...result,
                    ...(context.length
                      ? {
                          output: [result.output, ...context.map((text) => `<system-reminder>\n${text}\n</system-reminder>`)]
                            .filter(Boolean)
                            .join("\n\n"),
                          metadata: {
                            ...result.metadata,
                            hookContext: context.join("\n\n"),
                          },
                        }
                      : {}),
                    attachments: result.attachments?.map((attachment) => ({
                      ...attachment,
                      id: PartID.ascending(),
                      sessionID: ctx.sessionID,
                      messageID: input.processor.message.id,
                    })),
                  }
                  yield* plugin.trigger(
                    "tool.execute.after",
                    { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args: effective },
                    output,
                  )
                  if (options.abortSignal?.aborted) {
                    yield* input.processor.completeToolCall(options.toolCallId, output)
                  }
                  return output
                }).pipe(Effect.ensuring(release))
              }),
            )
          },
        })
      }

      const mcpTools = yield* mcp.tools()
      type McpEntry = { key: string; item: any; execute: any; schema: JSONSchema7 }
      const mcpEntries: McpEntry[] = []
      for (const [key, item] of Object.entries(mcpTools)) {
        const execute = item.execute
        if (!execute) continue
        const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
        mcpEntries.push({
          key,
          item,
          execute,
          schema: ProviderTransform.schema(input.model, schema),
        })
      }

      // MCP 工具全量直出时，光 schema 就可能吃掉 60k+ tokens。小窗口模型
      // （内置网关 128k）会因此永远高于压缩阈值，压缩无法收敛（见
      // overflow.ts 的说明）。超过阈值时改为按需激活：首轮只带
      // mcp_tool_search，模型搜索后下一轮才拿完整 schema。
      const cfg = yield* config.get()
      const mcpSchemaTokens = Token.estimate(
        JSON.stringify(
          mcpEntries.map((entry) => ({
            name: entry.key,
            description: entry.item.description,
            parameters: entry.schema,
          })),
        ),
      )
      const deferMcp = shouldDeferMcpTools({
        configured: cfg.experimental?.defer_mcp_loading,
        schemaTokens: mcpSchemaTokens,
      })
      const activeMcp = deferMcp ? new Set(yield* registry.activeTools(input.session.id)) : undefined
      const deferredMcp = deferMcp ? mcpEntries.filter((entry) => !activeMcp?.has(entry.key)) : []
      if (deferMcp) {
        log.info("mcp tools deferred", {
          total: mcpEntries.length,
          active: activeMcp?.size ?? 0,
          schemaTokens: mcpSchemaTokens,
        })
      }

      if (deferMcp && deferredMcp.length > 0) {
        // 名字清单只用于让模型知道「有哪些工具」；真正的占用是 schema。
        // 极端情况下（几百个 MCP 工具）仍给清单设置上限，避免搜索工具本身膨胀。
        const deferredNames = deferredMcp.map((entry) => entry.key)
        const listed = deferredNames.slice(0, 120).join(", ")
        const suffix = deferredNames.length > 120 ? ` (+${deferredNames.length - 120} more; search with keywords)` : ""
        tools["mcp_tool_search"] = tool({
          description: [
            "Search and activate MCP tools. MCP tool schemas are loaded on demand to keep the prompt small.",
            `Available MCP tools (deferred): ${listed}${suffix}`,
            'Call with keywords or "select:<tool_id>". Activated tools become available on your next step.',
          ].join("\n"),
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              query: { type: "string", description: 'Keywords, or "select:<tool_id>" for a direct match.' },
              max_results: { type: "number", description: "Maximum results (default 5, max 8)." },
            },
            required: ["query"],
          }),
          execute: (args) =>
            run.promise(
              Effect.gen(function* () {
                const query = String((args as { query?: unknown }).query ?? "").trim()
                const limit = Math.max(
                  1,
                  Math.min(Number((args as { max_results?: unknown }).max_results ?? 5) || 5, 8),
                )
                const select = /^select:(.+)$/i.exec(query)
                const q = query.toLowerCase()
                const words = q.split(/\s+/).filter(Boolean)
                const matched = deferredMcp
                  .map((entry) => {
                    const id = entry.key.toLowerCase()
                    const text = `${entry.key} ${entry.item.description ?? ""}`.toLowerCase()
                    const score = select
                      ? entry.key === select[1]?.trim()
                        ? 100
                        : 0
                      : id === q
                        ? 100
                        : id.includes(q)
                          ? 80
                          : words.length > 0 && words.every((word) => text.includes(word))
                            ? 60
                            : 0
                    return { entry, score }
                  })
                  .filter((item) => item.score > 0)
                  .sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key))
                  .slice(0, limit)
                if (matched.length > 0) {
                  yield* registry.activateTools(
                    input.session.id,
                    matched.map((item) => item.entry.key),
                  )
                }
                const output =
                  matched.length === 0
                    ? `No MCP tools matched "${query}". Try a broader keyword.`
                    : matched
                        .map(
                          (item) =>
                            `- ${item.entry.key}: ${(item.entry.item.description ?? "").split("\n")[0]?.slice(0, 160)}`,
                        )
                        .join("\n")
                return {
                  title: `${matched.length} MCP tools`,
                  output,
                  metadata: { matches: matched.map((item) => item.entry.key), total: deferredMcp.length },
                }
              }).pipe(Effect.orDie),
            ),
        })
      }

      for (const { key, item, execute, schema } of mcpEntries) {
        if (deferMcp && !activeMcp?.has(key)) continue
        item.inputSchema = jsonSchema(schema)
        item.execute = (args: any, opts: ToolExecutionOptions) =>
          run.promise(
            Effect.gen(function* () {
              const ctx = context(args, opts)
              yield* plugin.trigger(
                "tool.execute.before",
                { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
                { args },
              )
              const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.gen(function* () {
                yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
                return yield* Effect.promise(() => execute(args, opts))
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.gen(function* () {
                    if (hooks) {
                      yield* hooks
                        .trigger({
                          event: "PostToolUseFailure",
                          sessionID: ctx.sessionID,
                          cwd: input.session.directory,
                          tool: key,
                          args,
                          error: Cause.pretty(cause),
                        })
                        .pipe(Effect.ignore)
                    }
                    return yield* Effect.failCause(cause)
                  }),
                ),
                Effect.withSpan("Tool.execute", {
                  attributes: {
                    "tool.name": key,
                    "tool.call_id": opts.toolCallId,
                    "session.id": ctx.sessionID,
                    "message.id": input.processor.message.id,
                  },
                }),
              )
              yield* plugin.trigger(
                "tool.execute.after",
                { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
                result,
              )

              const textParts: string[] = []
              const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []
              for (const contentItem of result.content) {
                if (contentItem.type === "text") textParts.push(contentItem.text)
                else if (contentItem.type === "image") {
                  attachments.push({
                    type: "file",
                    mime: contentItem.mimeType,
                    url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
                  })
                } else if (contentItem.type === "resource") {
                  const { resource } = contentItem
                  if (resource.text) textParts.push(resource.text)
                  if (resource.blob) {
                    attachments.push({
                      type: "file",
                      mime: resource.mimeType ?? "application/octet-stream",
                      url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                      filename: resource.uri,
                    })
                  }
                }
              }

              const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
              const metadata = {
                ...result.metadata,
                truncated: truncated.truncated,
                ...(truncated.truncated && { outputPath: truncated.outputPath }),
              }

              const output = {
                title: "",
                metadata,
                output: truncated.content,
                attachments: attachments.map((attachment) => ({
                  ...attachment,
                  id: PartID.ascending(),
                  sessionID: ctx.sessionID,
                  messageID: input.processor.message.id,
                })),
                content: result.content,
              }
              if (opts.abortSignal?.aborted) {
                yield* input.processor.completeToolCall(opts.toolCallId, output)
              }
              return output
            }),
          )
        tools[key] = item
      }

      return tools
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: MessageV2.SubtaskPart
      model: Provider.Model
      lastUser: MessageV2.User
      sessionID: SessionID
      session: Session.Info
      msgs: MessageV2.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops()
      const { task: taskTool } = yield* registry.named()
      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
      const assistantMessage: MessageV2.Assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      let part: MessageV2.ToolPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies MessageV2.ToolPart)
            }),
          ask: (req: any) =>
            permission
              .ask({
                ...req,
                sessionID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
            return Effect.void
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies MessageV2.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies MessageV2.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies MessageV2.ToolPart)
      }

      if (!task.command) return

      const summaryUserMsg: MessageV2.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model,
      }
      yield* sessions.updateMessage(summaryUserMsg)
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies MessageV2.TextPart)
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
          const { msg, part, cwd } = yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
              yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
            const userMsg: MessageV2.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.updateMessage(userMsg)
            const userPart: MessageV2.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: MessageV2.Assistant = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: userMsg.id,
              mode: input.agent,
              agent: input.agent,
              cost: 0,
              path: { cwd: ctx.directory, root: ctx.worktree },
              time: { created: Date.now() },
              role: "assistant",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.modelID,
              providerID: model.providerID,
            }
            yield* sessions.updateMessage(msg)
            const started = Date.now()
            const part: MessageV2.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: ShellID.ToolID,
              callID: ulid(),
              state: {
                status: "running",
                time: { start: started },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Shell.Started, {
                sessionID: input.sessionID,
                timestamp: DateTime.makeUnsafe(started),
                callID: part.callID,
                command: input.command,
              })
            }
            return { msg, part, cwd: ctx.directory }
          }).pipe(Effect.ensuring(markReady))

          const cfg = yield* config.get()
          const sh = Shell.preferred(cfg.shell)
          const args = Shell.args(sh, input.command, cwd)
          let output = ""
          let aborted = false

          const finish = Effect.uninterruptible(
            Effect.gen(function* () {
              if (aborted) {
                output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
              }
              const completed = Date.now()
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Shell.Ended, {
                  sessionID: input.sessionID,
                  timestamp: DateTime.makeUnsafe(completed),
                  callID: part.callID,
                  output,
                })
              }
              if (!msg.time.completed) {
                msg.time.completed = completed
                yield* sessions.updateMessage(msg)
              }
              if (part.state.status === "running") {
                part.state = {
                  status: "completed",
                  time: { ...part.state.time, end: completed },
                  input: part.state.input,
                  title: "",
                  metadata: { output, description: "" },
                  output,
                }
                yield* sessions.updatePart(part)
              }
            }),
          )

          const exit = yield* restore(
            Effect.gen(function* () {
              const shellEnv = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: input.sessionID, callID: part.callID },
                { env: {} },
              )
              const cmd = ChildProcess.make(sh, args, {
                cwd,
                extendEnv: true,
                env: { ...shellEnv.env, TERM: "dumb" },
                stdin: "ignore",
                forceKillAfter: "3 seconds",
              })
              const handle = yield* spawner.spawn(cmd)
              yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                Effect.gen(function* () {
                  output += chunk
                  if (part.state.status === "running") {
                    part.state.metadata = { output, description: "" }
                    yield* sessions.updatePart(part)
                  }
                }),
              )
              yield* handle.exitCode
            }).pipe(Effect.scoped, Effect.orDie),
          ).pipe(Effect.exit)

          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
            aborted = true
          }
          yield* finish

          if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
            return yield* Effect.failCause(exit.cause)
          }

          return { info: msg, parts: [part] }
        }),
      )
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderID,
      modelID: ModelID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
        yield* bus.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.providerID}/${err.modelID}.${hint}`,
          }).toObject(),
        })
      }
      return yield* Effect.die(err)
    })

    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = Database.use((db) =>
        db.select({ model: SessionTable.model }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
      )
      if (current?.model) {
        return {
          providerID: ProviderID.make(current.model.providerID),
          modelID: ModelID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel()
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent
      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!ag) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const current = Database.use((db) =>
        db
          .select({ agent: SessionTable.agent, model: SessionTable.model })
          .from(SessionTable)
          .where(eq(SessionTable.id, input.sessionID))
          .get(),
      )
      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider
              .getModel(model.providerID, model.modelID)
              .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
          : undefined
      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

      const info: MessageV2.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        format: input.format,
        autoMode: input.autoMode,
      }

      if (current?.agent !== info.agent) {
        yield* events.publish(SessionEvent.AgentSwitched, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(info.time.created),
          agent: info.agent,
        })
      }
      if (
        current?.model?.providerID !== info.model.providerID ||
        current.model.id !== info.model.modelID ||
        (current.model.variant === "default" ? undefined : current.model.variant) !== info.model.variant
      ) {
        yield* events.publish(SessionEvent.ModelSwitched, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(info.time.created),
          model: {
            id: ModelV2.ID.make(info.model.modelID),
            providerID: ProviderV2.ID.make(info.model.providerID),
            variant: ModelV2.VariantID.make(info.model.variant ?? "default"),
          },
        })
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<MessageV2.Part>): MessageV2.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const referenceContextFromFilePart = Effect.fnUntraced(function* (
        part: Extract<PromptInput["parts"][number], { type: "file" }>,
        filepath: string,
      ) {
        const name = part.filename?.replace(/#\d+(?:-\d*)?$/, "")
        if (!name) return
        const slash = name.indexOf("/")
        if (slash === -1) return

        const reference = yield* references.get(name.slice(0, slash))
        if (!reference || reference.kind === "invalid") return
        if (!AppFileSystem.contains(reference.path, filepath)) return

        const target = path.relative(reference.path, filepath).split(path.sep).join("/")
        if (!target || target.startsWith("../") || target === "..") return

        return referenceTextPart({
          reference,
          source: part.source?.text ?? { value: `@${name}`, start: 0, end: name.length + 1 },
          target,
          targetPath: filepath,
        })
      })

      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<MessageV2.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<MessageV2.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if ("text" in c && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && c.blob) {
                  const mime = "mimeType" in c ? c.mimeType : part.mime
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mime}]`,
                  })
                }
              }
              pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
            } else {
              const error = Cause.squash(exit.cause)
              log.error("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }
            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              if (isOfficeDocument(part.filename, part.mime)) {
                const document = yield* Effect.promise(() =>
                  extractOfficeDocumentText({
                    filename: part.filename ?? "attachment",
                    mime: part.mime,
                    bytes: decodeDataUrlBytes(part.url),
                  }),
                )
                if (!document) break
                const content = document.text.trim()
                if (content) {
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Extracted Office attachment text from ${part.filename ?? "attachment"} (${document.kind})`,
                    },
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: [
                        `<attachment filename="${part.filename ?? "attachment"}">`,
                        `<type>office:${document.kind}</type>`,
                        "<content>",
                        content,
                        "</content>",
                        "</attachment>",
                      ].join("\n"),
                    },
                  ]
                }
              }
              break
            case "file:": {
              log.info("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              const referenceContext = yield* referenceContextFromFilePart(part, filepath)
              const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

              const { read } = yield* registry.named()
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                const controller = new AbortController()
                return read
                  .execute(args, {
                    sessionID: input.sessionID,
                    abort: controller.signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...extra },
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              if (isOfficeDocument(part.filename, mime)) {
                const bytes = yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))
                const document = yield* Effect.promise(() =>
                  extractOfficeDocumentText({
                    filename: part.filename ?? path.basename(filepath),
                    mime,
                    bytes,
                  }),
                )
                const content = document?.text.trim()
                if (document && content) {
                  return [
                    ...(referenceContext
                      ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                      : []),
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Extracted Office attachment text from ${part.filename ?? path.basename(filepath)} (${document.kind})`,
                    },
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: [
                        `<attachment filename="${part.filename ?? path.basename(filepath)}">`,
                        `<type>office:${document.kind}</type>`,
                        "<content>",
                        content,
                        "</content>",
                        "</attachment>",
                      ].join("\n"),
                    },
                  ]
                }
              }

              if (mime === "text/plain") {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                // Mirrors Claude Code's `already_read_file` attachment: when the
                // same unchanged file is mentioned again, pointing at the
                // earlier read is enough — re-inlining it just burns context.
                const known = yield* Effect.serviceOption(ReadState.Service).pipe(
                  Effect.flatMap((service) =>
                    Option.isNone(service)
                      ? Effect.succeed(undefined)
                      : service.value.get(input.sessionID, filepath),
                  ),
                )
                const current = yield* fsys.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
                const mtime = current?.mtime.pipe(Option.map((date) => date.getTime()), Option.getOrElse(() => 0)) ?? 0
                // `offset` is only set by an actual Read. An entry created by
                // edit/write reflects the post-write mtime while the content in
                // context is the pre-write version, so it must not be deduped.
                if (
                  known?.offset !== undefined &&
                  offset === undefined &&
                  limit === undefined &&
                  !known.partial &&
                  known.mtime === mtime
                ) {
                  return [
                    ...(referenceContext
                      ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                      : []),
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `This file is already in context and has not changed since it was last read (${known.size} bytes, mtime ${new Date(known.mtime).toISOString()}). Its contents are omitted here; refer to the earlier read. Re-read it only if you need to confirm the current contents.`,
                    },
                  ]
                }
                const pieces: Draft<MessageV2.Part>[] = [
                  ...(referenceContext
                    ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                    : []),
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read file", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* bus.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit)
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read directory", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* bus.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  return [
                    ...(referenceContext
                      ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                      : []),
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
                return [
                  ...(referenceContext
                    ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                    : []),
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: exit.value.output,
                  },
                  { ...part, mime, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              return [
                ...(referenceContext ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }] : []),
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url:
                    `data:${mime};base64,` +
                    Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                  mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
            }
          }
        }

        if (part.type === "agent") {
          const perm = Permission.evaluate("task", part.name, ag.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts: resolvedParts },
      )

      const parts = yield* Effect.forEach(resolvedParts, (part) =>
        part.type === "file" && part.mime.startsWith("image/")
          ? image.normalize(part).pipe(
              Effect.catchIf(
                (error) => error instanceof Image.ResizerUnavailableError,
                () => Effect.succeed(part),
              ),
            )
          : Effect.succeed(part),
      )

      const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
      if (Exit.isFailure(parsed)) {
        log.error("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          cause: Cause.pretty(parsed.cause),
        })
      }
      parts.forEach((part, index) => {
        const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
        if (Exit.isSuccess(p)) return
        log.error("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          cause: Cause.pretty(p.cause),
          part,
        })
      })

      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)
      const nextPrompt = parts.reduce(
        (result, part) => {
          if (part.type === "text") {
            if (part.synthetic) result.synthetic.push(part.text)
            else result.text.push(part.text)
            const reference = referencePromptMetadata(part.metadata?.reference)
            if (reference) {
              result.references.push(
                new ReferenceAttachment({
                  name: reference.name,
                  kind: reference.kind,
                  uri: reference.path ? pathToFileURL(reference.path).href : undefined,
                  repository: reference.repository,
                  branch: reference.branch,
                  target: reference.target,
                  targetUri: reference.targetPath ? pathToFileURL(reference.targetPath).href : undefined,
                  problem: reference.problem,
                  source: new Source({
                    start: reference.source.start,
                    end: reference.source.end,
                    text: reference.source.value,
                  }),
                }),
              )
            }
          }
          if (part.type === "file") {
            result.files.push(
              new FileAttachment({
                uri: part.url,
                mime: part.mime,
                name: part.filename,
                source: part.source
                  ? new Source({
                      start: part.source.text.start,
                      end: part.source.text.end,
                      text: part.source.text.value,
                    })
                  : undefined,
              }),
            )
          }
          if (part.type === "agent") {
            result.agents.push(
              new AgentAttachment({
                name: part.name,
                source: part.source
                  ? new Source({
                      start: part.source.start,
                      end: part.source.end,
                      text: part.source.value,
                    })
                  : undefined,
              }),
            )
          }
          return result
        },
        {
          text: [] as string[],
          files: [] as FileAttachment[],
          agents: [] as AgentAttachment[],
          references: [] as ReferenceAttachment[],
          synthetic: [] as string[],
        },
      )
      // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
      if (flags.experimentalEventSystem) {
        yield* events.publish(SessionEvent.Prompted, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(info.time.created),
          prompt: {
            text: nextPrompt.text.join("\n"),
            files: nextPrompt.files,
            agents: nextPrompt.agents,
            references: nextPrompt.references,
          },
        })
      }
      for (const text of nextPrompt.synthetic) {
        // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
        if (flags.experimentalEventSystem) {
          yield* events.publish(SessionEvent.Synthetic, {
            sessionID: input.sessionID,
            timestamp: DateTime.makeUnsafe(info.time.created),
            text,
          })
        }
      }

      return { info, parts }
    }, Effect.scoped)

    const inferMemoryReviewCandidates = Effect.fn("SessionPrompt.inferMemoryReviewCandidates")(function* (input: {
      model: Provider.Model
      userContent: string
      assistantContent: string
    }) {
      const cfg = yield* config.get()
      if (ConfigMemory.resolve(cfg.memory).review_llm !== true) return []
      if (!input.userContent.trim() && !input.assistantContent.trim()) return []

      const language = yield* provider.getLanguage(input.model)
      const system = [
        [
          "你是 NovaWay 的长期记忆审查器。",
          "从本轮对话中提取最多 3 条值得长期保留的通用记忆候选，例如情景、事实、偏好、目标、决策、关系、经验教训或可复用流程。",
          "不要提取临时任务、普通闲聊、一次性命令、工具输出噪音、凭据、密钥或敏感信息。",
          "候选必须是未来对话可能复用的稳定信息，并尽量简洁。",
          "每条候选必须包含 kind(episodic/semantic/preference/goal/decision/relationship/lesson/procedure)、factKey、operation(add/update/archive/confirm)、domain(general/coding/office/personal/research/ops) 和 confidence(0-1)。",
          "如果记忆涉及人物、组织、地点、产品或主题，填写 entities 数组，每项包含 name 和可选 type。",
          "若候选修正已知事实，使用 operation=update 并复用同一个 factKey。",
          "只输出 JSON 对象本身，不要包 markdown 代码块，也不要加任何解释。",
        ].join("\n"),
      ]
      yield* plugin.trigger("experimental.chat.system.transform", { model: input.model }, { system })

      const authInfo = auth ? yield* auth.get(input.model.providerID).pipe(Effect.orDie) : undefined
      const isOpenaiOauth = input.model.providerID === "openai" && authInfo?.type === "oauth"
      const messages = [
        ...(isOpenaiOauth
          ? []
          : system.map(
              (item): ModelMessage => ({
                role: "system",
                content: item,
              }),
            )),
        {
          role: "user",
          content: [
            "请审查以下对话，并返回 JSON 结构中的 candidates。",
            "",
            "<user>",
            input.userContent,
            "</user>",
            "",
            "<assistant>",
            input.assistantContent,
            "</assistant>",
          ].join("\n"),
        } satisfies ModelMessage,
      ]
      const params = {
        model: language,
        temperature: 0.1,
        maxOutputTokens: 800,
        messages,
        schema: Object.assign(
          Schema.toStandardSchemaV1(MemoryReviewResult),
          Schema.toStandardJSONSchemaV1(MemoryReviewResult),
        ),
        experimental_repairText: async ({ text }) => repairMemoryReviewJson(text),
      } satisfies Parameters<typeof generateObject>[0]

      const result = isOpenaiOauth
        ? yield* Effect.promise(async () => {
            try {
              const stream = streamObject({
                ...params,
                providerOptions: ProviderTransform.providerOptions(input.model, {
                  instructions: system.join("\n"),
                  store: false,
                }),
                onError: () => {},
              })
              for await (const part of stream.fullStream) {
                if (part.type === "error") throw part.error
              }
              return stream.object
            } catch {
              // 流式结构化输出不支持 repair；失败时退回可修复的 generateObject。
              return generateObject(params).then((response) => response.object)
            }
          })
        : yield* Effect.tryPromise(() => generateObject(params).then((response) => response.object))

      return result.candidates
        .map(
          (candidate): MemoryReviewCandidateDraft => ({
            ...candidate,
            content: candidate.content.trim(),
            summary: candidate.summary?.trim() || undefined,
            tags: candidate.tags?.map((tag) => tag.trim()).filter(Boolean),
            reason: candidate.reason?.trim() || undefined,
          }),
        )
        .filter((candidate) => candidate.content.length >= 8)
        .slice(0, 3)
    })

    const inferEvolutionReviewCandidates = Effect.fn("SessionPrompt.inferEvolutionReviewCandidates")(function* (input: {
      model: Provider.Model
      userContent: string
      assistantContent: string
    }) {
      const cfg = yield* config.get()
      if (!ConfigEvolution.resolve(cfg.evolution).enabled || !ConfigEvolution.resolve(cfg.evolution).review_llm)
        return []
      if (!input.userContent.trim() && !input.assistantContent.trim()) return []

      const language = yield* provider.getLanguage(input.model)
      const system = [
        [
          "你是 NovaWay 的自我进化审查器。",
          "从本轮对话中提取最多 3 条值得用户确认的自我进化候选。",
          "候选只能是可长期改进系统能力或用户工作方式的建议，例如技能补充、Agent 行为调整、工作流固化、提示词改进、可执行工具、行为策略、个人习惯流程、知识模板或项目规则沉淀。",
          "不要提取临时任务、普通闲聊、一次性命令、工具输出噪音、凭据、密钥或敏感信息。",
          "候选必须具体说明目标、改进内容和原因；当前步骤只生成候选，不会自动改写任何文件。",
          "候选必须提供 expectedOutcomes，即写盘后可通过内容检查验证的预期结果（2-5 条短句，必须出现在最终文件中）。",
          "kind 可以是 skill、agent、workflow、prompt、tool、project、strategy、habit、knowledge；后三类分别用于通用行为策略、个人流程和知识模板。",
          "scope 必须是 global 或 project：global 表示该候选是跨项目通用的能力（如通用技能、可复用工作流、全局提示词/工具），应写入全局配置；project 表示仅与当前项目相关（如项目规则、特定 Agent 行为、项目专属流程）。",
          "当 kind=tool 时，content 优先给出可运行的 TypeScript 工具模块（export default tool({ description, args, execute })，可 import { tool } from @opencode/plugin）；若暂时只能给自然语言，也要写清工具用途、输入输出与执行步骤。",
          "当 kind=workflow 或 prompt 时，content 应是可直接作为命令模板使用的 Markdown 流程/提示词。",
          '当 kind=project 时，content 必须是目标文件的完整新内容或 unified diff，不要写"把 A 改成 B"这类操作说明；target 用相对路径（不含 .novaway 前缀）。',
          "expectedOutcomes 里的每一条都必须逐字出现在 content 中，否则写盘后的回归校验会判定失败并回滚。",
          "只输出 JSON 对象本身，不要包 markdown 代码块，也不要加任何解释。",
        ].join("\n"),
      ]
      yield* plugin.trigger("experimental.chat.system.transform", { model: input.model }, { system })

      const authInfo = auth ? yield* auth.get(input.model.providerID).pipe(Effect.orDie) : undefined
      const isOpenaiOauth = input.model.providerID === "openai" && authInfo?.type === "oauth"
      const messages = [
        ...(isOpenaiOauth
          ? []
          : system.map(
              (item): ModelMessage => ({
                role: "system",
                content: item,
              }),
            )),
        {
          role: "user",
          content: [
            "请审查以下对话，并返回 JSON 结构中的 candidates。",
            "",
            "<user>",
            input.userContent,
            "</user>",
            "",
            "<assistant>",
            input.assistantContent,
            "</assistant>",
          ].join("\n"),
        } satisfies ModelMessage,
      ]
      const params = {
        model: language,
        temperature: 0.1,
        maxOutputTokens: 900,
        messages,
        schema: Object.assign(
          Schema.toStandardSchemaV1(EvolutionReviewResult),
          Schema.toStandardJSONSchemaV1(EvolutionReviewResult),
        ),
        experimental_repairText: async ({ text }) => repairEvolutionReviewJson(text),
      } satisfies Parameters<typeof generateObject>[0]

      const result = isOpenaiOauth
        ? yield* Effect.promise(async () => {
            try {
              const stream = streamObject({
                ...params,
                providerOptions: ProviderTransform.providerOptions(input.model, {
                  instructions: system.join("\n"),
                  store: false,
                }),
                onError: () => {},
              })
              for await (const part of stream.fullStream) {
                if (part.type === "error") throw part.error
              }
              return stream.object
            } catch {
              // 流式结构化输出不支持 repair；失败时退回可修复的 generateObject。
              return generateObject(params).then((response) => response.object)
            }
          })
        : yield* Effect.tryPromise(() => generateObject(params).then((response) => response.object))

      return result.candidates
        .map(
          (candidate): EvolutionReviewCandidateDraft => ({
            ...candidate,
            target: candidate.target.trim(),
            title: candidate.title.trim(),
            content: candidate.content.trim(),
            reason: candidate.reason.trim(),
            tags: candidate.tags?.map((tag) => tag.trim()).filter(Boolean),
          }),
        )
        .filter(
          (candidate) =>
            candidate.target.length >= 2 &&
            candidate.title.length >= 4 &&
            candidate.content.length >= 8 &&
            candidate.reason.length >= 4,
        )
        .slice(0, 3)
    })

    // 目标裁判:输入活动目标(含成功标准)与本轮对话文本,判断目标是否达成。
    const inferGoalJudge = Effect.fn("SessionPrompt.inferGoalJudge")(function* (input: {
      model: Provider.Model
      goalsText: string
      userContent: string
      assistantContent: string
    }) {
      const system = [
        "你是 NovaWay 的目标裁判(judge)。",
        "根据给定的活动目标及其成功标准,结合本轮对话,判断这些目标是否已经全部达成。",
        "goalMet=true 仅当所有活动目标的成功标准都已满足;否则为 false。",
        "当 goalMet=false 时,nextAction 必须给出一句具体、可执行的下一步指令,推动完成目标。",
        "reasoning 用一到两句话说明判断依据。不要编造未发生的进展。",
      ].join("\n")

      const messages = [
        { role: "system", content: system } satisfies ModelMessage,
        {
          role: "user",
          content: [
            "<goals>",
            input.goalsText,
            "</goals>",
            "",
            "<user>",
            input.userContent,
            "</user>",
            "",
            "<assistant>",
            input.assistantContent,
            "</assistant>",
          ].join("\n"),
        } satisfies ModelMessage,
      ]

      const params = {
        model: yield* provider.getLanguage(input.model),
        temperature: 0.1,
        maxOutputTokens: 400,
        messages,
        schema: Object.assign(
          Schema.toStandardSchemaV1(GoalJudgeResult),
          Schema.toStandardJSONSchemaV1(GoalJudgeResult),
        ),
      } satisfies Parameters<typeof generateObject>[0]

      const result = yield* Effect.promise(() => generateObject(params).then((response) => response.object))
      return result as Schema.Schema.Type<typeof GoalJudgeResult>
    })

    const prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts, Image.Error, never> = Effect.fn(
      "SessionPrompt.prompt",
    )(function* (input: PromptInput) {
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* revert.cleanup(session)
      const promptText = input.parts
        .filter(
          (part): part is { type: "text"; text: string } =>
            part.type === "text" && typeof (part as any).text === "string",
        )
        .map((part) => part.text)
        .join(String.fromCharCode(10))
      const submitted = hooks
        ? yield* hooks
            .trigger({
              event: "UserPromptSubmit",
              sessionID: input.sessionID,
              cwd: session.directory,
              prompt: promptText,
            })
            .pipe(Effect.catch(() => Effect.succeed(EMPTY_HOOK)))
        : EMPTY_HOOK
      if (submitted.blocked) {
        return yield* Effect.die(new Error("Prompt blocked by a UserPromptSubmit hook."))
      }
      const message = yield* createUserMessage(input)
      // Hook-provided context (SessionStart at the start of the session,
      // UserPromptSubmit per message) is only useful if the model sees it, so
      // attach it to this user message as a synthetic part.
      const startContext = Session.takeStartContext(input.sessionID)
      for (const text of [startContext, submitted.additionalContext]) {
        if (!text) continue
        const part = yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: message.info.id,
          sessionID: message.info.sessionID,
          type: "text",
          synthetic: true,
          text: `<hook-context>
${text}
</hook-context>`,
        })
        message.parts.push(part)
      }
      yield* sessions.touch(input.sessionID)

      const permissions: Permission.Ruleset = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
      }

      if (input.noReply === true) return message
      return yield* loop({ sessionID: input.sessionID })
    })

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    /**
     * 「继续任务」：把中断的那一轮接着做完。
     *
     * 与用户重新发一条消息的区别：
     *  - 不新增用户消息，对话轮次保持不变（同一条 user 消息下的下一条 assistant 消息）；
     *  - 已有的上下文（计划、待办、已完成步骤、文件改动）原样沿用，模型只需接着做；
     *  - 只有"意外中断"才允许续跑：用户主动停止（MessageAbortedError）或已经正常收尾的轮次
     *    直接返回当前消息，不做任何事。
     */
    const resume = Effect.fn("SessionPrompt.resume")(function* (sessionID: SessionID) {
      const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
      yield* revert.cleanup(session)
      const msgs = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
      const lastUser = msgs.findLast((item) => item.info.role === "user")
      // 还没有任何用户消息：没什么可继续的。
      if (!lastUser) return yield* lastAssistant(sessionID)

      const attempts = msgs.filter(
        (item) => item.info.role === "assistant" && item.info.parentID === lastUser.info.id,
      )
      const last = attempts.at(-1)
      if (!last || last.info.role !== "assistant") return yield* lastAssistant(sessionID)
      // 用户主动停止：这是用户的决定，不自动续跑。
      if (last.info.error?.name === "MessageAbortedError") return yield* lastAssistant(sessionID)
      // 这一轮已经正常收尾：无需继续。
      const interrupted = !!last.info.error || last.info.time.completed === undefined
      if (!interrupted) return yield* lastAssistant(sessionID)

      const data = last.info.error?.data
      const reason =
        typeof data === "object" && data !== null && "message" in data && typeof data.message === "string"
          ? data.message
          : undefined
      yield* sessions.touch(sessionID)
      return yield* loop({ sessionID, resume: true, reason })
    })

    // 在已配置的提供方中挑选一个支持图片输入的模型，优先同提供方，其次 NovaWay，最后任意提供方。
    const findVisionModel = Effect.fn("SessionPrompt.findVisionModel")(function* (preferred: Provider.Model) {
      const providers = yield* provider.list()
      const matches: Array<{ providerID: ProviderID; model: Provider.Model }> = []
      for (const [providerID, info] of Object.entries(providers)) {
        for (const model of Object.values(info.models)) {
          if (!model.capabilities?.input?.image) continue
          matches.push({ providerID: ProviderID.make(providerID), model })
        }
      }
      if (matches.length === 0) return undefined
      const best = (items: Array<{ providerID: ProviderID; model: Provider.Model }>) =>
        items.sort((a, b) => (b.model.limit?.context ?? 0) - (a.model.limit?.context ?? 0))[0]?.model
      return (
        best(matches.filter((item) => item.providerID === preferred.providerID)) ??
        best(matches.filter((item) => item.providerID === ProviderID.make("novaway"))) ??
        best(matches)
      )
    })

    // 使用多模态模型识别图片，返回识别文本；失败由调用方降级处理。
    const describeImages = Effect.fn("SessionPrompt.describeImages")(function* (input: {
      visionModel: Provider.Model
      agent: Agent.Info
      lastUser: MessageV2.User
      parts: MessageV2.Part[]
      sessionID: SessionID
    }) {
      const messages = yield* MessageV2.toModelMessagesEffect(
        [{ info: input.lastUser, parts: input.parts }],
        input.visionModel,
      )
      return yield* llm
        .stream({
          user: input.lastUser,
          agent: input.agent,
          system: [VISION_DESCRIBE_SYSTEM_PROMPT],
          tools: {},
          model: input.visionModel,
          sessionID: input.sessionID,
          retries: 2,
          messages,
        })
        .pipe(
          Stream.filter((e): e is Extract<LLM.Event, { type: "text-delta" }> => e.type === "text-delta"),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
        )
        .pipe(Effect.map((text) => text.trim()))
    })

    /**
     * 一轮对话的收尾副作用：记忆自动抽取/审查、进化审查、自动检查点。
     *
     * 这些逻辑原先挂在 `result === "stop"` 分支里，但 processor 对
     * 「正常说完一句话」返回的是 `"continue"`（只有报错/被拦截才返回 `"stop"`），
     * 所以正常对话永远走不到那里 —— 记忆和进化实际上从未触发过。
     * 现在由「循环即将因最后一条 assistant 已完成而退出」的出口调用，
     * 并按 assistant 消息 id 去重，避免恢复会话时重复执行。
     */
    const finishedTurns = new Set<string>()
    const runTurnLearning = Effect.fn("SessionPrompt.runTurnLearning")(function* (input: {
      session: Session.Info
      lastUser: MessageV2.User
      userParts: MessageV2.Part[]
      assistant: MessageV2.Assistant
      assistantParts: MessageV2.Part[]
      model: Provider.Model
      agentName: string
    }) {
      if (finishedTurns.has(input.assistant.id)) return
      finishedTurns.add(input.assistant.id)
      if (input.assistant.error) return

      const memory = Option.getOrUndefined(yield* Effect.serviceOption(Memory.Service))
      const evolution = Option.getOrUndefined(yield* Effect.serviceOption(Evolution.Service))
      const checkpoint = SessionCheckpoint
        ? Option.getOrUndefined(yield* Effect.serviceOption(SessionCheckpoint.Service))
        : undefined
      const cfg = yield* config.get()
      const memoryCfg = ConfigMemory.resolve(cfg.memory)
      const evolutionCfg = ConfigEvolution.resolve(cfg.evolution)
      const memoryEnabled = memoryCfg.enabled
      const memoryReviewEnabled = memoryEnabled && memoryCfg.review_enabled && memoryCfg.review_interval > 0
      const evolutionReviewEnabled = evolutionCfg.enabled && evolutionCfg.review_llm && evolutionCfg.review_interval > 0
      const userContent = textFromParts(input.userParts)
      const assistantContent = textFromParts(input.assistantParts)
      const session = input.session
      const sessionID = input.assistant.sessionID
      const lastUser = input.lastUser
      const model = input.model
      const agentName = input.agentName

      // 全自动学习：显式抽取先做（纯本地、很快）。
      if (memoryEnabled && memory && memoryCfg.auto_extract) {
        yield* memory
          .syncTurn({
            userContent,
            assistantContent: "",
            projectID: session.projectID,
            sessionID,
            originMessageID: lastUser.id,
            agent: agentName,
          })
          .pipe(Effect.ignore)
      }

      /**
       * 记忆与进化的审查都依赖一次 LLM 调用。两者**并发**执行：
       * 之前是串行，记忆审查的模型请求一旦慢（弱网时可达数十秒），
       * 进化审查就一直排在后面，看起来像"进化从未触发"。
       * `reviewDue` 是纯 DB 操作，先各自判定，再并发跑生成。
       */
      const memoryDue =
        memoryReviewEnabled && memory
          ? yield* memory
              .reviewDue({
                userContent,
                projectID: session.projectID,
                sessionID,
                sourceMessageID: lastUser.id,
                agent: agentName,
                reviewInterval: memoryCfg.review_interval,
              })
              .pipe(Effect.catch(() => Effect.succeed(false)))
          : false
      const evolutionDue =
        evolutionReviewEnabled && evolution
          ? yield* evolution
              .reviewDue({
                projectID: session.projectID,
                sessionID,
                sourceMessageID: lastUser.id,
                reviewInterval: evolutionCfg.review_interval,
              })
              .pipe(Effect.catch(() => Effect.succeed(false)))
          : false

      const memoryJob =
        !memoryDue || !memory
          ? Effect.void
          : Effect.gen(function* () {
              const candidates = yield* inferMemoryReviewCandidates({
                model,
                userContent,
                assistantContent,
              }).pipe(Effect.catch(() => Effect.succeed([])))
              const reviewed = yield* memory!
                .review({
                  userContent,
                  assistantContent,
                  projectID: session.projectID,
                  sessionID,
                  sourceMessageID: lastUser.id,
                  agent: agentName,
                  candidates,
                  skipReviewState: true,
                })
                .pipe(Effect.catch(() => Effect.succeed([] as never[])))
              // 自动写入：候选直接进长期记忆，越用越聪明无需点通过。
              if (memoryCfg.auto_apply && reviewed.length) {
                for (const item of reviewed) {
                  if (item.status !== "pending") continue
                  yield* memory!.applyReviewCandidate(item.id).pipe(Effect.ignore)
                }
              }
            }).pipe(Effect.ignore)

      const evolutionJob =
        !evolutionDue || !evolution
          ? Effect.void
          : Effect.gen(function* () {
              const proposals = yield* inferEvolutionReviewCandidates({
                model,
                userContent,
                assistantContent,
              }).pipe(Effect.catch(() => Effect.succeed([])))
              if (!proposals.length) return
              const instanceCtx = yield* InstanceState.context
              const reviewed = yield* evolution!
                .review({
                  proposals,
                  projectID: session.projectID,
                  sessionID,
                  sourceMessageID: lastUser.id,
                })
                .pipe(Effect.catch(() => Effect.succeed([] as never[])))
              // 自动写入磁盘：开启后进化候选无需人工确认直接落地到 .novaway 文件。
              if (evolutionCfg.auto_apply_file && reviewed.length) {
                for (const item of reviewed) {
                  if (item.status !== "pending") continue
                  yield* evolution!
                    .applyToDisk(item.id, {
                      directory: instanceCtx.directory,
                      worktree: instanceCtx.worktree,
                    })
                    .pipe(
                      Effect.ignoreCause({
                        log: true,
                        message: `evolution auto-apply to disk failed: ${item.id}`,
                      }),
                    )
                }
              }
            }).pipe(Effect.ignore)

      yield* Effect.all([memoryJob, evolutionJob], { concurrency: 2 })
      // 自动检查点：在压缩/剪枝之前按间隔捕获会话消息 + 文件快照，便于回滚。默认关闭。
      if (checkpoint) {
        const checkpointCfg = ConfigCheckpoint.resolve(cfg.checkpoint)
        if (checkpointCfg.auto_enabled && checkpointCfg.auto_interval > 0) {
          const due = yield* checkpoint
            .autoDue({ sessionId: sessionID, interval: checkpointCfg.auto_interval })
            .pipe(Effect.catch(() => Effect.succeed(false)))
          if (due) {
            yield* checkpoint.createAuto({ sessionId: sessionID }).pipe(Effect.ignore)
          }
        }
      }
    })

    const runLoop: (
      sessionID: SessionID,
      resume?: { reason?: string },
    ) => Effect.Effect<MessageV2.WithParts, never, never> = Effect.fn("SessionPrompt.run")(function* (
      sessionID: SessionID,
      resume?: { reason?: string },
    ) {
      const ctx = yield* InstanceState.context
      const slog = elog.with({ sessionID })
      let structured: unknown
      let step = 0
      let autoCompactions = 0
      let lengthContinuations = 0
      let stopHookBlocks = 0
      const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
      let loopModel: Provider.Model | undefined = undefined
      // 「继续任务」：上一轮请求失败/被意外切断后，用户点继续时不能把上一条 assistant
      // 的 finish/error 当成"这一轮已经结束"，必须再发一次请求把剩下的活干完。
      // 只强制一次，之后回到正常的结束判定，避免一直续跑。
      let resumeAttempts = resume ? 1 : 0

      while (true) {
        const resuming = resumeAttempts > 0
        if (resuming) resumeAttempts -= 1
        yield* status.set(sessionID, { type: "busy" })
        yield* slog.info("loop", { step })

        let msgs = yield* MessageV2.filterCompactedEffect(sessionID)

        // Drain messages sent by other agents. They arrive as synthetic user
        // parts so the model sees them without polluting real user input.
        const pending = mailbox ? yield* mailbox.drain(sessionID).pipe(Effect.catch(() => Effect.succeed([]))) : []
        if (pending.length > 0) {
          const owner = msgs.findLast((item) => item.info.role === "user")
          const info: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: owner?.info.role === "user" && owner.info.agent ? owner.info.agent : (session.agent ?? "build"),
            model:
              owner?.info.role === "user" && owner.info.model
                ? {
                    providerID: owner.info.model.providerID,
                    modelID: owner.info.model.modelID,
                    ...(owner.info.model.variant ? { variant: owner.info.model.variant } : {}),
                  }
                : yield* provider.defaultModel(),
          }
          yield* sessions.updateMessage(info)
          for (const message of pending) {
            yield* sessions.updatePart({
              id: PartID.ascending(),
              messageID: info.id,
              sessionID,
              type: "text",
              synthetic: true,
              text: [`<agent-message from="${message.fromSessionID}">`, message.content, "</agent-message>"].join(
                String.fromCharCode(10),
              ),
            } satisfies MessageV2.TextPart)
          }
          msgs = yield* MessageV2.filterCompactedEffect(sessionID)
        }

        const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = MessageV2.latest(msgs)

        if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

        const lastAssistantMsg = msgs.findLast(
          (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
        )
        // Some providers return "stop" even when the assistant message contains tool calls.
        // Keep the loop running so tool results can be sent back to the model.
        // Skip provider-executed tool parts — those were fully handled within the
        // provider's stream (e.g. DWS Agent Platform) and don't need a re-loop.
        const hasToolCalls =
          lastAssistantMsg?.parts.some((part) => part.type === "tool" && !part.metadata?.providerExecuted) ?? false

        // Session notes (CC `SessionMemory`): once a response is on record and
        // the context has grown enough, refresh the 10-section markdown file in
        // the background. It never blocks the loop and failures only log.
        if (
          lastAssistant &&
          lastFinished?.id === lastAssistant.id &&
          lastAssistant.summary !== true &&
          !lastAssistant.error &&
          lastUser.model &&
          lastUser.id < lastAssistant.id
        ) {
          const noteModel = yield* getModel(
            lastUser.model.providerID,
            lastUser.model.modelID,
            sessionID,
          ).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
          if (noteModel) {
            const noteTokens =
              lastFinished.tokens.total ||
              lastFinished.tokens.input +
                lastFinished.tokens.output +
                lastFinished.tokens.reasoning +
                lastFinished.tokens.cache.read +
                lastFinished.tokens.cache.write
            yield* SessionMemoryNotes.maybeUpdate({
              sessionID,
              provider,
              model: noteModel,
              messages: msgs,
              tokens: noteTokens,
              lastTurnHasToolCalls: hasToolCalls,
              lastMessageID: lastAssistant.id,
            }).pipe(Effect.ignore, Effect.forkIn(scope))
          }
        }

        // A response that hit the output token limit is not a finished turn.
        // Claude Code escalates max_tokens and retries; we continue from the
        // cut-off point instead, bounded so a model that keeps rambling cannot
        // loop forever.
        if (
          !resuming &&
          lastAssistant?.finish === "length" &&
          !hasToolCalls &&
          lastUser.id < lastAssistant.id &&
          lengthContinuations < MAX_LENGTH_CONTINUATIONS
        ) {
          lengthContinuations++
          const info: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: lastUser.agent,
            model: lastUser.model,
          }
          yield* sessions.updateMessage(info)
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: info.id,
            sessionID,
            type: "text",
            synthetic: true,
            text: [
              "<system-reminder>",
              "Your previous response was cut off because it reached the output token limit. Continue exactly where it stopped. Do not repeat text you already emitted and do not restart the task.",
              "</system-reminder>",
            ].join(NL),
          } satisfies MessageV2.TextPart)
          step++
          continue
        }

        if (
          !resuming &&
          lastAssistant?.finish &&
          !["tool-calls"].includes(lastAssistant.finish) &&
          !hasToolCalls &&
          lastUser.id < lastAssistant.id
        ) {
          // 正常完成的轮次从这里退出，所以记忆/进化/检查点要在当前出口执行
          // （processor 正常完成返回的是 "continue"，见 runTurnLearning 的说明）。
          // Learning side effects must never break a turn: a missing model or a
          // provider hiccup here only skips memory/evolution review.
          const finishedModel = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID).pipe(
            Effect.catchCause(() => Effect.succeed(undefined)),
          )
          if (finishedModel) {
            yield* runTurnLearning({
              session,
              lastUser,
              userParts: msgs.findLast((m) => m.info.role === "user" && m.info.id === lastUser.id)?.parts ?? [],
              assistant: lastAssistant,
              assistantParts: lastAssistantMsg?.parts ?? [],
              model: finishedModel,
              agentName: lastUser.agent,
            }).pipe(Effect.ignore)
          }
          if (hooks) {
            const stop = yield* hooks
              .trigger({
                event: "Stop",
                sessionID,
                cwd: session.directory,
                metadata: { finish: lastAssistant.finish, agent: lastUser.agent },
              })
              .pipe(
                // A crashing Stop hook is itself an event worth observing
                // (`StopFailure`), but must never abort the loop or leave the
                // session running.
                Effect.catchCause((cause) =>
                  hooks
                    .trigger({
                      event: "StopFailure",
                      sessionID,
                      cwd: session.directory,
                      error: Cause.pretty(cause),
                    })
                    .pipe(Effect.ignore, Effect.as(EMPTY_HOOK)),
                ),
              )
            if (stop.decision === "deny") {
              // Mirror Claude Code: a blocking Stop hook (lint/typecheck/tests)
              // is feedback for the model, not the end of the turn. The reason
              // is injected as a synthetic user message and the loop continues
              // so the model can fix what the hook complained about.
              yield* hooks
                .trigger({
                  event: "StopFailure",
                  sessionID,
                  cwd: session.directory,
                  error: stop.reason ?? "Stop hook denied",
                })
                .pipe(Effect.ignore)
              if (stopHookBlocks < MAX_STOP_HOOK_BLOCKS) {
                stopHookBlocks++
                const feedback: MessageV2.User = {
                  id: MessageID.ascending(),
                  sessionID,
                  role: "user",
                  time: { created: Date.now() },
                  agent: lastUser.agent,
                  model: lastUser.model,
                }
                yield* sessions.updateMessage(feedback)
                yield* sessions.updatePart({
                  id: PartID.ascending(),
                  messageID: feedback.id,
                  sessionID,
                  type: "text",
                  synthetic: true,
                  text: [
                    `Stop hook feedback:\n${stop.reason ?? "The Stop hook blocked the turn."}`,
                    "",
                    "Address the issue the hook reported, then finish the task. Do not simply restate this message.",
                  ].join(NL),
                } satisfies MessageV2.TextPart)
                step++
                continue
              }
              yield* slog.warn("stop hook still blocking after limit", { blocks: stopHookBlocks })
            }
          }
          yield* slog.info("exiting loop")
          break
        }

        step++
        if (step === 1)
          yield* title({
            session,
            modelID: lastUser.model.modelID,
            providerID: lastUser.model.providerID,
            history: msgs,
          }).pipe(Effect.ignore, Effect.forkIn(scope))

        const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
        loopModel = model
        // 媒体模型必须使用持久化的用户输入，而不是为聊天模型追加的提醒或插件注入内容。
        const media = LLM.mediaInput(
          msgs.findLast((message) => message.info.role === "user" && message.info.id === lastUser.id)?.parts ?? [],
        )
        const task = tasks.pop()

        if (task?.type === "subtask") {
          yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
          continue
        }

        if (task?.type === "compaction") {
          if (!task.auto) autoCompactions = 0
          const exit = yield* compaction
            .process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
            })
            .pipe(Effect.exit)
          if (Exit.isFailure(exit)) {
            // Cancellation means the user stopped the turn: never swallow it.
            if (Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.failCause(exit.cause)
            // A manual compaction is one-shot; surface the failure instead of
            // retrying behind the user's back.
            if (!task.auto) return yield* Effect.failCause(exit.cause)
            // Failures count towards the same circuit breaker as "compacted but
            // still over the limit". Without this a provider error would either
            // abort the turn or retry forever, depending on where it surfaced.
            autoCompactions++
            yield* slog.warn("auto-compaction failed", {
              attempts: autoCompactions,
              cause: Cause.pretty(exit.cause),
            })
            if (autoCompactions >= MAX_CONSECUTIVE_AUTO_COMPACTIONS) {
              const error = new NamedError.Unknown({
                message:
                  `Auto-compaction failed ${autoCompactions} times in a row, so the turn was stopped to avoid retrying forever.\n` +
                  `Last error: ${Cause.pretty(exit.cause)}\n` +
                  `Run /compact manually, or start a new session.`,
              })
              yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
              break
            }
            continue
          }
          const result = exit.value
          if (result === "stop") break
          if (task.auto) autoCompactions++
          continue
        }

        if (lastFinished && lastFinished.summary !== true) {
          // usage 只覆盖上一条 assistant 自己的请求；工具在响应结束后执行，
          // 它们的输出要到下一次请求才计入 input。把这段增量一起算进去，
          // 避免大工具输出直到下一次 413 才触发压缩。
          const pending = pendingTokens({ messages: msgs, finishedID: lastFinished.id })
          const base =
            lastFinished.tokens.total ||
            lastFinished.tokens.input +
              lastFinished.tokens.output +
              lastFinished.tokens.reasoning +
              lastFinished.tokens.cache.read +
              lastFinished.tokens.cache.write
          const tokens = pending > 0 ? { ...lastFinished.tokens, total: base + pending } : lastFinished.tokens
          if (yield* compaction.isOverflow({ tokens, model })) {
            // 先判断再创建：避免熔断时留下一条永远待处理的 compaction 标记。
            if (autoCompactions >= MAX_CONSECUTIVE_AUTO_COMPACTIONS) {
              const error = new NamedError.Unknown({
                message:
                  `Auto-compaction stopped after ${MAX_CONSECUTIVE_AUTO_COMPACTIONS} consecutive attempts: the context is still above the model's usable window. ` +
                  `The fixed prompt (system + tool schemas) is too large. Disable unused MCP tools or switch to a model with a larger context window.`,
              })
              yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
              break
            }
            yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
            continue
          }
          // 硬上限：auto-compaction 关闭或反复失败时，继续发请求只会 413。
          // 在发请求前就停下，和 CC 的 MANUAL_COMPACT_BUFFER_TOKENS 一致。
          const budget = contextBudget({
            cfg: yield* config.get(),
            model,
            outputTokenMax: flags.outputTokenMax,
            tokens: tokens.total || base,
          })
          const used = tokens.total || base
          if (budget.blocking > 0 && used >= budget.blocking) {
            const error = new MessageV2.ContextOverflowError({
              message:
                `Context window is nearly full (${budget.percentLeft ?? 0}% until auto-compact, ` +
                `${used} of ${budget.effective} usable tokens). Run /compact to summarize the session and continue.`,
            })
            yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            break
          }
          // 已经回到阈值以下，说明压缩有效；下一次溢出重新计数。
          autoCompactions = 0
        }

        const agent = yield* agents.get(lastUser.agent)
        if (!agent) {
          const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
          const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
          const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
          yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
          throw error
        }
        const maxSteps = agent.steps ?? Infinity
        const isLastStep = step >= maxSteps
        msgs = yield* insertReminders({ messages: msgs, agent, session })

        // 主模型不支持图片输入时，把图片识别交给多模态子代理完成，
        // 识别结果以合成文本写入用户消息，主模型继续用文本处理对话。
        const modelSupportsImages = model.capabilities?.input?.image
        if (!modelSupportsImages) {
          const visionUserMsg = msgs.findLast((m) => m.info.role === "user" && m.info.id === lastUser.id)
          const visionImageParts = visionUserMsg?.parts.filter(
            (p): p is MessageV2.FilePart => p.type === "file" && p.mime.startsWith("image/"),
          )
          const alreadyDescribed = visionUserMsg?.parts.some(
            (p) => p.type === "text" && p.synthetic && p.text.startsWith(VISION_DESCRIPTION_MARKER),
          )
          if (visionUserMsg && visionImageParts?.length && !alreadyDescribed) {
            const visionModel = yield* findVisionModel(model)
            if (visionModel) {
              const description = yield* describeImages({
                visionModel,
                agent,
                lastUser,
                parts: visionUserMsg.parts,
                sessionID,
              }).pipe(
                Effect.catchCause((cause) => {
                  log.error("image recognition failed, falling back to attachment placeholder", {
                    error: Cause.squash(cause),
                  })
                  return Effect.succeed(undefined)
                }),
              )
              if (description) {
                const descriptionPart: MessageV2.TextPart = {
                  id: PartID.ascending(),
                  sessionID,
                  messageID: lastUser.id,
                  type: "text",
                  synthetic: true,
                  text: `${VISION_DESCRIPTION_MARKER}\n${description}`,
                }
                yield* sessions.updatePart(descriptionPart)
                // 同步更新内存中的消息，确保当前步骤主模型也能看到识别结果。
                visionUserMsg.parts.push(descriptionPart)
              }
            }
          }
        }

        const msg: MessageV2.Assistant = {
          id: MessageID.ascending(),
          parentID: lastUser.id,
          role: "assistant",
          mode: agent.name,
          agent: agent.name,
          variant: lastUser.model.variant,
          path: { cwd: ctx.directory, root: ctx.worktree },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
          sessionID,
        }
        yield* sessions.updateMessage(msg)

        const finalizeInterruptedAssistant = Effect.gen(function* () {
          if (msg.time.completed) return
          msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
            providerID: msg.providerID,
            aborted: true,
          })
          msg.time.completed = Date.now()
          yield* sessions.updateMessage(msg)
        })

        const handle = yield* processor
          .create({
            assistantMessage: msg,
            sessionID,
            model,
          })
          .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))

        const outcome: "break" | "continue" = yield* Effect.gen(function* () {
          const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
          const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

          const tools = yield* resolveTools({
            agent,
            session,
            model,
            tools: lastUser.tools,
            processor: handle,
            bypassAgentCheck,
            messages: msgs,
          })

          if (lastUser.format?.type === "json_schema") {
            tools["StructuredOutput"] = createStructuredOutputTool({
              schema: lastUser.format.schema,
              onSuccess(output) {
                structured = output
              },
            })
          }

          if (step === 1)
            yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

          if (step > 1 && lastFinished) {
            for (const m of msgs) {
              if (m.info.role !== "user" || m.info.id <= lastFinished.id) continue
              for (const p of m.parts) {
                if (p.type !== "text" || p.ignored || p.synthetic) continue
                if (!p.text.trim()) continue
                p.text = [
                  "<system-reminder>",
                  "The user sent the following message:",
                  p.text,
                  "",
                  "Please address this message and continue with your tasks.",
                  "</system-reminder>",
                ].join("\n")
              }
            }
          }

          yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

          const gitStatus =
            git._tag === "Some"
              ? yield* git.value.run(["--no-optional-locks", "status", "--short"], { cwd: session.directory }).pipe(
                  Effect.map((result) => {
                    if (result.exitCode !== 0) return ""
                    const text = result.text().trim()
                    if (!text) return ""
                    const truncated =
                      text.length > 2000
                        ? text.slice(0, 2000) + NL + "...(truncated; run git status for the full list)"
                        : text
                    return ["<git-status>", truncated, "</git-status>"].join(NL)
                  }),
                  Effect.catch(() => Effect.succeed("")),
                )
              : ""

          const cfg = yield* config.get()
          // Aggregate tool-result budget: stub the oldest tool outputs once the
          // request exceeds the configured character budget. Storage is
          // untouched, so the UI and later turns still see the full text.
          const budgeted = ToolBudget.apply(msgs, {
            budgetChars: cfg.experimental?.tool_result_budget_chars ?? ToolBudget.DEFAULT_BUDGET_CHARS,
            keepRecentMessages: cfg.experimental?.tool_result_keep_recent_messages ?? 20,
          })
          if (budgeted.replaced > 0) {
            log.info("tool result budget applied", {
              sessionID,
              replaced: budgeted.replaced,
              elided: budgeted.elided,
            })
          }

          const [skills, env, instructionParts, modelMsgs] = yield* Effect.all([
            sys.skills(
              agent,
              (() => {
                const paths = touchedPaths(msgs)
                return paths.length > 0 ? paths : undefined
              })(),
            ),
            sys.environment(model),
            instruction.system({ prompt: textFromParts(lastUserMsg?.parts ?? []) }).pipe(Effect.orDie),
            MessageV2.toModelMessagesEffect(
              budgeted.messages,
              model,
              modelSupportsImages ? undefined : { stripMedia: true },
            ),
          ])
          if (hooks && instructionParts.paths.length + instructionParts.urls.length > 0) {
            const loaded = [...instructionParts.paths, ...instructionParts.urls].sort()
            const signature = loaded.join("\n")
            if (instructionSignatures.get(sessionID) !== signature) {
              instructionSignatures.set(sessionID, signature)
              yield* hooks
                .trigger({
                  event: "InstructionsLoaded",
                  sessionID,
                  cwd: session.directory,
                  metadata: { paths: loaded, count: loaded.length },
                })
                .pipe(Effect.ignore)
            }
          }
          const instanceCtx = yield* InstanceState.context
          const memoryCfg = ConfigMemory.resolve(cfg.memory)
          const evolutionCfg = ConfigEvolution.resolve(cfg.evolution)
          const memoryEnabled = memoryCfg.enabled
          const activeMemory = Option.getOrUndefined(yield* Effect.serviceOption(Memory.Service))
          const memoryContext =
            memoryEnabled && activeMemory
              ? yield* activeMemory
                  .prefetch({
                    query: textFromParts(lastUserMsg?.parts ?? []),
                    projectID: session.projectID,
                    sessionID,
                    limit: memoryCfg.prefetch_limit,
                    maxChars: memoryCfg.prefetch_budget_chars,
                  })
                  .pipe(Effect.catch(() => Effect.succeed("")))
              : ""
          const projectContext = yield* ProjectContext.read({
            directory: ctx.directory,
            worktree: ctx.worktree,
            plan: Session.plan(session, ctx),
          }).pipe(
            Effect.provideService(AppFileSystem.Service, fsys),
            Effect.catch(() => Effect.succeed("")),
          )
          const requestMessages = injectMemoryContext({
            messages: modelMsgs,
            context: [projectContext, memoryContext].filter(Boolean).join("\n\n"),
          })
          // 静态指令/技能放在缓存前缀，环境信息放尾部，避免目录、日期或模型信息变化时整段缓存失效。
          const style = yield* OutputStyle.resolve({
            directory: ctx.directory,
            worktree: ctx.worktree,
            name: agent.outputStyle,
          })
          const styleSystem = style
            ? [
                `<output-style name="${style.name}">`,
                ...(style.description ? [style.description, ""] : []),
                style.body,
                "</output-style>",
              ].join("\n")
            : undefined
          const staticSystem = [
            ...instructionParts.always,
            ...(skills ? [skills] : []),
            ...(styleSystem ? [styleSystem] : []),
          ]
            .filter(Boolean)
            .join("\n\n")
          const dynamicSystem = [...instructionParts.triggered, ...env].filter(Boolean).join("\n\n")
          const system = [staticSystem, dynamicSystem].filter(Boolean)
          const goalContext = yield* buildGoalContext(goalService, sessionID).pipe(
            Effect.catch(() => Effect.succeed("")),
          )
          if (goalContext) system.push(goalContext)
          // 继续任务：把"为什么又发了一次请求"告诉模型，并明确要求接着做而不是重来。
          // 这条只走 system，不新增用户消息 —— 对话轮次与界面都保持同一轮。
          if (resuming) {
            system.push(
              [
                "<resume-context>",
                "This turn was interrupted before it finished.",
                resume?.reason ? `Interruption reason: ${resume.reason}` : "",
                "Continue exactly where you stopped: keep the existing plan and todo list, do not restart the task, do not repeat output that was already produced, and finish the remaining work.",
                "</resume-context>",
              ]
                .filter(Boolean)
                .join(NL),
            )
          }
          const format = lastUser.format ?? { type: "text" as const }
          if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
          const result = yield* handle.process({
            user: lastUser,
            // A style with `keep-coding-instructions: false` replaces the base
            // coding prompt instead of stacking on top of it.
            agent: style && !style.keepCodingInstructions ? { ...agent, prompt: undefined } : agent,
            permission: session.permission,
            sessionID,
            parentSessionID: session.parentID,
            system,
            messages: [...requestMessages, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
            media,
            tools,
            model,
            toolChoice: format.type === "json_schema" ? "required" : undefined,
          })

          if (structured !== undefined) {
            handle.message.structured = structured
            handle.message.finish = handle.message.finish ?? "stop"
            yield* sessions.updateMessage(handle.message)
            return "break" as const
          }

          const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
          if (finished && !handle.message.error) {
            if (format.type === "json_schema") {
              handle.message.error = new MessageV2.StructuredOutputError({
                message: "Model did not produce structured output",
                retries: 0,
              }).toObject()
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }
          }

          if (result === "stop") {
            const assistantMsg = yield* sessions
              .findMessage(sessionID, (message) => message.info.id === handle.message.id)
              .pipe(Effect.orDie)
            yield* runTurnLearning({
              session,
              lastUser,
              userParts: lastUserMsg?.parts ?? [],
              assistant: handle.message,
              assistantParts: Option.isSome(assistantMsg) ? assistantMsg.value.parts : [],
              model,
              agentName: agent.name,
            }).pipe(Effect.ignore)
            return "break" as const
          }
          if (result === "compact") {
            yield* compaction.create({
              sessionID,
              agent: lastUser.agent,
              model: lastUser.model,
              auto: true,
              overflow: !handle.message.finish,
            })
          }
          return "continue" as const
        }).pipe(
          Effect.ensuring(instruction.clear(handle.message.id)),
          Effect.onInterrupt(() => finalizeInterruptedAssistant),
        )
        if (outcome === "break") break
        continue
      }

      yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))

      // Dream/Distill 自我改进集成:默认关闭,开启后按 interval 轮用 LLM 反思会话并蒸馏进长期记忆。
      {
        const dreamCfg = ConfigDream.resolve((yield* config.get()).dream)
        if (dreamCfg.enabled && dreamCfg.interval > 0 && dreamDue(sessionID, dreamCfg.interval)) {
          const capturedModel = loopModel
          if (capturedModel) {
            yield* Effect.gen(function* () {
              const dreamModule = yield* Effect.tryPromise(() => import("./dream"))
              const distillModule = yield* Effect.tryPromise(() => import("./distill"))
              const dream = yield* dreamModule.Service
              const distill = yield* distillModule.Service
              const analysis = yield* dream.analyzeSession(sessionID, capturedModel)
              const distillResult = yield* distill.fromAnalysis(analysis)
              yield* distill.applyMemories(distillResult)
            }).pipe(
              Effect.catch(() => Effect.void),
              Effect.forkIn(scope),
            )
          }
        }
      }

      return yield* lastAssistant(sessionID)
    } as any) as any

    const loop: (input: LoopInput) => Effect.Effect<MessageV2.WithParts, never, never> = Effect.fn(
      "SessionPrompt.loop",
    )(function* (input: LoopInput) {
      // Durable cron jobs are only in memory after a restart once something asks
      // the scheduler to load them; the session loop is the one place every
      // session is guaranteed to pass through, so it doubles as the trigger.
      // `start` is idempotent and only forks on the first call.
      const cron = Option.getOrUndefined(yield* Effect.serviceOption(CronService))
      if (cron) {
        const instance = yield* InstanceState.context
        yield* cron.start({ directory: instance.directory }).pipe(Effect.ignore)
      }

      let result = yield* state.ensureRunning(
        input.sessionID,
        lastAssistant(input.sessionID),
        runLoop(input.sessionID, input.resume ? { reason: input.reason } : undefined) as any,
      )

      // 目标驱动自主循环:每轮结束后用裁判模型判断活动目标是否达成,未达成则
      // 顺序(不 fork)追加一轮,受硬性 max_iterations 上限约束防跑飞。默认关闭。
      const cfg = yield* config.get().pipe(Effect.catch(() => Effect.succeed({} as any)))
      const goalCfg = ConfigGoal.resolve(cfg.goal)

      // 收尾统一出口:目标循环可能追加多轮,最终结果都从这里返回。
      if (!goalCfg.enabled || !goalService || goalCfg.max_iterations <= 0) return result

      let iterations = 0
      while (iterations < goalCfg.max_iterations) {
        const goals = yield* goalService.list(input.sessionID).pipe(Effect.catch(() => Effect.succeed([] as any[])))
        const active = goals.filter((g: any) => g.status === "in_progress" || g.status === "pending")
        if (active.length === 0) break

        const msgs = yield* sessions
          .messages({ sessionID: input.sessionID })
          .pipe(Effect.catch(() => Effect.succeed([])))
        const lastAssistantMsg = [...msgs].reverse().find((m) => m.info.role === "assistant")
        const lastUserMsg = [...msgs].reverse().find((m) => m.info.role === "user")
        if (!lastAssistantMsg || lastAssistantMsg.info.role !== "assistant") break
        if (lastAssistantMsg.info.error) break

        // 裁判模型:优先配置 judge_model("provider/model"),否则复用当轮 assistant 模型。
        const judgeRef = (() => {
          if (goalCfg.judge_model && goalCfg.judge_model.includes("/")) {
            const [providerID, ...rest] = goalCfg.judge_model.split("/")
            return { providerID: ProviderID.make(providerID), modelID: rest.join("/") as ModelID }
          }
          return {
            providerID: lastAssistantMsg.info.providerID as ProviderID,
            modelID: lastAssistantMsg.info.modelID as ModelID,
          }
        })()
        const judgeModel = yield* provider
          .getModel(judgeRef.providerID, judgeRef.modelID)
          .pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!judgeModel) break

        const goalsText = active
          .map((g: any) => {
            const criteria =
              Array.isArray(g.successCriteria) && g.successCriteria.length
                ? `\n  成功标准: ${g.successCriteria.join("; ")}`
                : ""
            return `- ${g.title} [${g.status}]${criteria}`
          })
          .join("\n")
        const userContent = textFromParts(lastUserMsg?.parts ?? [])
        const assistantContent = textFromParts(lastAssistantMsg.parts)

        const verdict = yield* inferGoalJudge({
          model: judgeModel,
          goalsText,
          userContent,
          assistantContent,
        }).pipe(Effect.catch(() => Effect.succeed(null)))
        if (!verdict) break

        if (verdict.goalMet) {
          for (const g of active) {
            yield* goalService.update({ goalId: g.id, status: "completed" }).pipe(Effect.ignore)
          }
          break
        }

        iterations++
        const nextText = verdict.nextAction?.trim() || "继续完成当前目标。"
        result = yield* prompt({
          sessionID: input.sessionID,
          agent: lastUserMsg?.info.role === "user" ? lastUserMsg.info.agent : undefined,
          model:
            lastUserMsg?.info.role === "user" && lastUserMsg.info.model
              ? { providerID: lastUserMsg.info.model.providerID, modelID: lastUserMsg.info.model.modelID }
              : undefined,
          parts: [{ type: "text", text: nextText }],
        }).pipe(Effect.catch(() => Effect.succeed(result)))
      }

      return result
    })

    const shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts, Session.BusyError> = Effect.fn(
      "SessionPrompt.shell",
    )(function* (input: ShellInput) {
      const ready = yield* Latch.make()
      return yield* state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready), ready)
    })

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* elog.info("command", { sessionID: input.sessionID, command: input.command, agent: input.agent })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        const results = yield* Effect.promise(() =>
          Promise.all(
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
          ),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* currentModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!agent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const templateParts = yield* resolvePromptParts(template)
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      const parts = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...templateParts, ...(input.parts ?? [])]

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* currentModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
      })
      yield* bus.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    return Service.of({
      cancel,
      prompt,
      resume,
      loop,
      shell,
      command,
      resolvePromptParts,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        SessionRunState.defaultLayer,
        SessionStatus.defaultLayer,
        SessionCompaction.defaultLayer,
        SessionProcessor.defaultLayer,
        Command.defaultLayer,
        Permission.defaultLayer,
        MCP.defaultLayer,
        LSP.defaultLayer,
        CronDefaultLayer,
      ),
    ),
    Layer.provide(ToolRegistry.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
    Layer.provide(Layer.mergeAll(HookServiceLayer, ToolLockServiceLayer, AgentMailboxLayer)),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(
      Layer.mergeAll(
        EventV2Bridge.defaultLayer,
        Agent.defaultLayer,
        SystemPrompt.defaultLayer,
        LLM.defaultLayer,
        Reference.defaultLayer,
        Bus.layer,
        CrossSpawnSpawner.defaultLayer,
        RuntimeFlags.defaultLayer,
        Todo.defaultLayer,
        ReadState.defaultLayer,
      ),
    ),
  ),
)
const ModelRef = Schema.Struct({
  providerID: ProviderID,
  modelID: ModelID,
})

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  format: Schema.optional(MessageV2.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  autoMode: Schema.optional(Schema.Boolean),
  parts: Schema.Array(
    Schema.Union([
      MessageV2.TextPartInput,
      MessageV2.FilePartInput,
      MessageV2.AgentPartInput,
      MessageV2.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
})
export type PromptInput = Schema.Schema.Type<typeof PromptInput>

export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
  /** 中断后续跑：忽略上一条 assistant 的 finish/error，再发一次请求把这一轮做完。 */
  resume: Schema.optional(Schema.Boolean),
  /** 续跑原因（写进 system 提示，让模型知道为什么会再次请求）。 */
  reason: Schema.optional(Schema.String),
}) {}

export const ShellInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  agent: Schema.String,
  model: Schema.optional(ModelRef),
  command: Schema.String,
})
export type ShellInput = Schema.Schema.Type<typeof ShellInput>

export const CommandInput = Schema.Struct({
  messageID: Schema.optional(MessageID),
  sessionID: SessionID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  // Inlined (no identifier annotation) to keep the original SDK output — the
  // PromptInput call site below references FilePartInput by ref via the
  // Schema export in message-v2.ts.
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(MessageV2.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
})
export type CommandInput = Schema.Schema.Type<typeof CommandInput>

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}
const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export * as SessionPrompt from "./prompt"
