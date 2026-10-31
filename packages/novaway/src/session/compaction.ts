import fs from "node:fs/promises"
import path from "node:path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import * as Session from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "./message-v2"
import { Token } from "@/util/token"
import * as Log from "@novaway/core/util/log"
import { SessionProcessor } from "./processor"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { ConfigMemory } from "@/config/memory"
import { NotFoundError } from "@/storage/storage"
import { ModelID, ProviderID } from "@/provider/schema"
import { Effect, Layer, Context, Schema, Option } from "effect"
import * as DateTime from "effect/DateTime"
import { InstanceState } from "@/effect/instance-state"
import { isOverflow as overflow, usable } from "./overflow"
import { serviceUse } from "@/effect/service-use"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionEvent } from "@novaway/core/session-event"
import { Memory } from "@/memory/service"
import { Service as HookService, defaultLayer as HookLayer } from "@/hook/service"
import { ReadState } from "@/tool/read-state"
import { SessionMemoryNotes } from "./memory-notes"

const log = Log.create({ service: "session.compaction" })

export const Event = {
  Compacted: BusEvent.define(
    "session.compacted",
    Schema.Struct({
      sessionID: SessionID,
    }),
  ),
}

export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const PRUNE_PROTECTED_TOOLS = ["skill"]
const DEFAULT_TAIL_TURNS = 2
const MIN_PRESERVE_RECENT_TOKENS = 2_000
const MAX_PRESERVE_RECENT_TOKENS = 8_000
/** 压缩请求自身也可能 prompt-too-long；按最旧的一半反复裁剪后重试。 */
const MAX_COMPACTION_RETRIES = 3
/** 压缩后重新附上最近读写的文件（对齐 Claude Code 的 post-compact file attachments）。 */
const POST_COMPACT_MAX_FILES = 5
const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000
const POST_COMPACT_TOTAL_TOKENS = 50_000
const POST_COMPACT_MAX_FILE_BYTES = 2_000_000
const POST_COMPACT_TOOLS = new Set(["read", "write", "edit", "apply_patch"])
const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## User Messages
- [short verbatim quotes of the user's requests and corrections, newest last, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Pending Tasks
- [tasks explicitly requested but not finished, or "(none)"]

## Current Work
- [what was being worked on immediately before this summary, with file names and exact state, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Optional Next Step
- [the single next action, with a verbatim quote from the most recent user request; omit if the task is complete]

## Critical Context
- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- In "User Messages" prefer exact quotes over paraphrases; keep each quote short.
- Do not mention the summary process or that context was compacted.`
type Turn = {
  start: number
  end: number
  id: MessageID
}

type Tail = {
  start: number
  id: MessageID
}

type CompletedCompaction = {
  userIndex: number
  assistantIndex: number
  summary: string | undefined
}

function summaryText(message: MessageV2.WithParts) {
  const text = message.parts
    // Post-compact file attachments live on the summary message as synthetic
    // text; keep them out of the anchored summary so they are not re-summarized.
    .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  return text || undefined
}

function reviewText(messages: MessageV2.WithParts[]) {
  return messages
    .map((message) => {
      const text = summaryText(message)
      if (!text) return
      return [`<${message.info.role}>`, text, `</${message.info.role}>`].join("\n")
    })
    .filter((item) => item !== undefined)
    .join("\n\n")
    .trim()
}

function completedCompactions(messages: MessageV2.WithParts[]) {
  const users = new Map<MessageID, number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (!msg.parts.some((part) => part.type === "compaction")) continue
    users.set(msg.info.id, i)
  }

  return messages.flatMap((msg, assistantIndex): CompletedCompaction[] => {
    if (msg.info.role !== "assistant") return []
    if (!msg.info.summary || !msg.info.finish || msg.info.error) return []
    const userIndex = users.get(msg.info.parentID)
    if (userIndex === undefined) return []
    return [{ userIndex, assistantIndex, summary: summaryText(msg) }]
  })
}

function buildPrompt(input: { previousSummary?: string; context: string[]; instructions?: string }) {
  const anchor = input.previousSummary
    ? [
        "Update the anchored summary below using the conversation history above.",
        "Preserve still-true details, remove stale details, and merge in the new facts.",
        "<previous-summary>",
        input.previousSummary,
        "</previous-summary>",
      ].join("\n")
    : "Create a new anchored summary from the conversation history above."
  // `/compact <instructions>`：用户当次的要求优先于模板里"保留什么"的默认判断。
  const instructions = input.instructions?.trim()
    ? [
        "Additional instructions from the user for this compaction (follow them, they override the defaults below when they conflict):",
        input.instructions.trim(),
      ].join("\n")
    : undefined
  return [anchor, ...(instructions ? [instructions] : []), SUMMARY_TEMPLATE, ...input.context].join("\n\n")
}

function preserveRecentBudget(input: { cfg: Config.Info; model: Provider.Model }) {
  return (
    input.cfg.compaction?.preserve_recent_tokens ??
    Math.min(MAX_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable(input) * 0.25)))
  )
}

function turns(messages: MessageV2.WithParts[]) {
  const result: Turn[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (msg.parts.some((part) => part.type === "compaction")) continue
    result.push({
      start: i,
      end: messages.length,
      id: msg.info.id,
    })
  }
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start
  }
  return result
}

function splitTurn(input: {
  messages: MessageV2.WithParts[]
  turn: Turn
  model: Provider.Model
  budget: number
  estimate: (input: { messages: MessageV2.WithParts[]; model: Provider.Model }) => Effect.Effect<number>
}) {
  return Effect.gen(function* () {
    if (input.budget <= 0) return undefined
    if (input.turn.end - input.turn.start <= 1) return undefined
    for (let start = input.turn.start + 1; start < input.turn.end; start++) {
      const size = yield* input.estimate({
        messages: input.messages.slice(start, input.turn.end),
        model: input.model,
      })
      if (size > input.budget) continue
      return {
        start,
        id: input.messages[start]!.info.id,
      } satisfies Tail
    }
    return undefined
  })
}

/**
 * 会话笔记压缩（对齐 CC `trySessionMemoryCompaction`）的保留预算。
 * 笔记已经覆盖了较早的对话，压缩时只需要保留最近一段原始消息。
 */
export const SM_COMPACT = {
  minTokens: 10_000,
  minTextBlockMessages: 5,
  maxTokens: 40_000,
}

function hasTextBlocks(message: MessageV2.WithParts) {
  return message.parts.some(
    (part) => part.type === "text" && !part.ignored && !part.synthetic && part.text.trim().length > 0,
  )
}

/**
 * 单条消息的粗略 token 数。只用来决定"保留到哪"，和为压缩请求本身
 * 计量（会走 toModelMessages）不同，这里宁可快而稳定。
 */
function messageTokens(message: MessageV2.WithParts) {
  let total = 0
  for (const part of message.parts) {
    if (part.type === "text") {
      if (!part.ignored) total += Token.estimate(part.text)
    } else if (part.type === "reasoning") {
      total += Token.estimate(part.text)
    } else if (part.type === "tool") {
      if (part.state.status === "completed") {
        total += Token.estimate(JSON.stringify(part.state.input ?? {}))
        total += Token.estimate(part.state.output)
      } else if (part.state.status === "error") {
        total += Token.estimate(part.state.error)
      }
    }
  }
  return total
}

/**
 * 压缩后保留消息的起始下标：从"已摘要到的最后一条消息"之后开始，若不足
 * minTokens 或 minTextBlockMessages 就向前扩，碰到 maxTokens 立刻停。
 */
export function messagesToKeepIndex(messages: MessageV2.WithParts[], lastSummarizedIndex: number) {
  let start = lastSummarizedIndex >= 0 ? lastSummarizedIndex + 1 : messages.length
  let tokens = 0
  let textMessages = 0
  for (let i = start; i < messages.length; i++) {
    tokens += messageTokens(messages[i]!)
    if (hasTextBlocks(messages[i]!)) textMessages++
  }
  const enough = () => tokens >= SM_COMPACT.minTokens && textMessages >= SM_COMPACT.minTextBlockMessages
  if (tokens < SM_COMPACT.maxTokens && !enough()) {
    for (let i = start - 1; i >= 0; i--) {
      tokens += messageTokens(messages[i]!)
      if (hasTextBlocks(messages[i]!)) textMessages++
      start = i
      if (tokens >= SM_COMPACT.maxTokens || enough()) break
    }
  }
  return adjustToUserStart(messages, start)
}

/**
 * 压缩后的对话必须从用户消息开始（很多 provider 不接受 assistant 开头），
 * 也不能从一条旧的压缩标记开始 —— 那会再次触发剪枝。
 */
function adjustToUserStart(messages: MessageV2.WithParts[], start: number) {
  if (start <= 0) return 0
  for (let i = start; i >= 0; i--) {
    const message = messages[i]!
    if (message.info.role !== "user") continue
    if (message.parts.some((part) => part.type === "compaction")) continue
    return i
  }
  return 0
}

/**
 * 压缩请求本身超限时，丢掉最旧的一半内容再试。
 *
 * 优先按用户轮次切（保证新的 head 从 user 开始）；只有一个轮次时保留
 * 这条 user 消息本身（任务意图不能丢），只裁掉它后面的旧 assistant/tool 消息。
 */
function truncateForRetry(messages: MessageV2.WithParts[]) {
  const all = turns(messages)
  if (all.length >= 2) {
    const drop = Math.max(1, Math.ceil(all.length / 2))
    const next = all[drop]
    return next ? messages.slice(next.start) : messages.slice(all[all.length - 1]!.start)
  }
  if (messages.length <= 2) return undefined
  const first = messages.find((message) => message.info.role === "user")
  const sliced = messages.slice(Math.max(1, Math.floor(messages.length / 2)))
  if (first && sliced[0]?.info.role !== "user") return [first, ...sliced]
  return sliced
}

/**
 * Absolute paths a tool part touched. `read`/`write`/`edit` carry a single
 * `filePath`; `apply_patch` hides them inside the patch envelope, so the
 * `*** Update/Add/Delete File:` and `*** Move to:` headers are scanned.
 * Paths are resolved against the session directory, matching how the tools
 * themselves resolve relative hunk paths.
 */
function partPaths(part: MessageV2.ToolPart, base: string) {
  const input = part.state.input
  if (part.tool === "apply_patch") {
    const patch = typeof input.patchText === "string" ? input.patchText : ""
    if (!patch) return []
    const files: string[] = []
    for (const match of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      const file = match[1]!.trim()
      if (file) files.push(path.resolve(base, file))
    }
    for (const match of patch.matchAll(/^\*\*\* Move to: (.+)$/gm)) {
      const file = match[1]!.trim()
      if (file) files.push(path.resolve(base, file))
    }
    return files
  }
  const filePath = input.filePath
  if (typeof filePath !== "string" || !filePath) return []
  return [path.resolve(base, filePath)]
}

/**
 * Files recently read/written/edited in the compacted portion, newest first.
 * The retained tail is excluded because it stays in context anyway.
 */
function recentFiles(messages: MessageV2.WithParts[], limit: number, base: string) {
  const seen = new Set<string>()
  const files: string[] = []
  for (let i = messages.length - 1; i >= 0 && files.length < limit; i--) {
    const message = messages[i]!
    for (let j = message.parts.length - 1; j >= 0 && files.length < limit; j--) {
      const part = message.parts[j]!
      if (part.type !== "tool" || !POST_COMPACT_TOOLS.has(part.tool)) continue
      for (const normalized of partPaths(part, base)) {
        if (seen.has(normalized)) continue
        seen.add(normalized)
        files.push(normalized)
        if (files.length >= limit) break
      }
    }
  }
  return files
}

/**
 * Every file path handed to a read/write/edit/apply_patch tool in these
 * messages. Used to drop stale `ReadState` entries once their content leaves
 * context.
 */
function touchedPaths(messages: MessageV2.WithParts[], base: string) {
  const paths = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool" || !POST_COMPACT_TOOLS.has(part.tool)) continue
      for (const file of partPaths(part, base)) paths.add(file)
    }
  }
  return [...paths]
}

/**
 * Re-attach recently touched files after compaction, mirroring Claude Code's
 * post-compact file restoration (max 5 files, 5k tokens each, 50k total).
 * Returns the text to persist on the summary message plus its token estimate.
 */
const buildAttachments = Effect.fn("SessionCompaction.attachments")(function* (input: {
  messages: MessageV2.WithParts[]
}) {
  const instance = yield* InstanceState.context
  const files = recentFiles(input.messages, POST_COMPACT_MAX_FILES, instance.directory)
  if (!files.length) return { text: undefined as string | undefined, tokens: 0, files: [] as string[] }

  const chunks: string[] = []
  const attached: string[] = []
  let tokens = 0
  for (const file of files) {
    if (tokens >= POST_COMPACT_TOTAL_TOKENS) break
    const stat = yield* Effect.tryPromise(() => fs.stat(file)).pipe(Effect.option)
    if (Option.isNone(stat) || !stat.value.isFile()) continue
    if (stat.value.size > POST_COMPACT_MAX_FILE_BYTES) continue
    const content = yield* Effect.tryPromise(() => fs.readFile(file, "utf8")).pipe(Effect.option)
    if (Option.isNone(content)) continue
    if (content.value.includes("\u0000")) continue

    const remaining = (POST_COMPACT_TOTAL_TOKENS - tokens) * 4
    const cap = Math.min(POST_COMPACT_MAX_TOKENS_PER_FILE * 4, remaining)
    let text = content.value
    if (text.length > cap) text = `${text.slice(0, cap)}\n[Truncated: ${text.length - cap} chars omitted]`
    const size = Token.estimate(text)
    if (tokens + size > POST_COMPACT_TOTAL_TOKENS) continue
    tokens += size
    attached.push(file)
    chunks.push(`<file path="${file}">\n${text}\n</file>`)
  }

  if (!chunks.length) return { text: undefined as string | undefined, tokens: 0, files: [] as string[] }
  return {
    text: [
      "Files most recently read or modified before compaction. Re-read them if you need the full contents.",
      ...chunks,
    ].join("\n\n"),
    tokens,
    files: attached,
  }
})

export interface Interface {
  readonly isOverflow: (input: {
    tokens: MessageV2.Assistant["tokens"]
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
  readonly process: (input: {
    parentID: MessageID
    messages: MessageV2.WithParts[]
    sessionID: SessionID
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<"continue" | "stop">
  readonly create: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderID; modelID: ModelID }
    auto: boolean
    overflow?: boolean
    instructions?: string
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/SessionCompaction") {}

export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const plugin = yield* Plugin.Service
    const processors = yield* SessionProcessor.Service
    const provider = yield* Provider.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const memory = yield* Memory.Service
    const hooks = Option.getOrUndefined(yield* Effect.serviceOption(HookService))
    const readState = Option.getOrUndefined(yield* Effect.serviceOption(ReadState.Service))

    const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
      tokens: MessageV2.Assistant["tokens"]
      model: Provider.Model
    }) {
      return overflow({
        cfg: yield* config.get(),
        tokens: input.tokens,
        model: input.model,
        outputTokenMax: flags.outputTokenMax,
      })
    })

    const estimate = Effect.fn("SessionCompaction.estimate")(function* (input: {
      messages: MessageV2.WithParts[]
      model: Provider.Model
    }) {
      const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, input.model)
      return Token.estimate(JSON.stringify(msgs))
    })

    const select = Effect.fn("SessionCompaction.select")(function* (input: {
      messages: MessageV2.WithParts[]
      cfg: Config.Info
      model: Provider.Model
    }) {
      const limit = input.cfg.compaction?.tail_turns ?? DEFAULT_TAIL_TURNS
      if (limit <= 0) return { head: input.messages, tail_start_id: undefined }
      const budget = preserveRecentBudget({ cfg: input.cfg, model: input.model })
      const all = turns(input.messages)
      if (!all.length) return { head: input.messages, tail_start_id: undefined }
      const recent = all.slice(-limit)
      const sizes = yield* Effect.forEach(
        recent,
        (turn) =>
          estimate({
            messages: input.messages.slice(turn.start, turn.end),
            model: input.model,
          }),
        { concurrency: 1 },
      )

      let total = 0
      let keep: Tail | undefined
      for (let i = recent.length - 1; i >= 0; i--) {
        const turn = recent[i]!
        const size = sizes[i]
        if (total + size <= budget) {
          total += size
          keep = { start: turn.start, id: turn.id }
          continue
        }
        const remaining = budget - total
        const split = yield* splitTurn({
          messages: input.messages,
          turn,
          model: input.model,
          budget: remaining,
          estimate,
        })
        if (split) keep = split
        else if (!keep) log.info("tail fallback", { budget, size, total })
        break
      }

      if (!keep || keep.start === 0) return { head: input.messages, tail_start_id: undefined }
      return {
        head: input.messages.slice(0, keep.start),
        tail_start_id: keep.id,
      }
    })

    // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
    // calls, then erases output of older tool calls to free context space
    const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
      const cfg = yield* config.get()
      if (!cfg.compaction?.prune) return
      log.info("pruning")

      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs) return

      let total = 0
      let pruned = 0
      const toPrune: MessageV2.ToolPart[] = []
      let turns = 0

      loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (msg.info.role === "user") turns++
        if (turns < 2) continue
        if (msg.info.role === "assistant" && msg.info.summary) break loop
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex]
          if (part.type !== "tool") continue
          if (part.state.status !== "completed") continue
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
          if (part.state.time.compacted) break loop
          const estimate = Token.estimate(part.state.output)
          total += estimate
          if (total <= PRUNE_PROTECT) continue
          pruned += estimate
          toPrune.push(part)
        }
      }

      log.info("found", { pruned, total })
      if (pruned > PRUNE_MINIMUM) {
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            part.state.time.compacted = Date.now()
            yield* session.updatePart(part)
          }
        }
        log.info("pruned", { count: toPrune.length })
      }
    })

    const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
      parentID: MessageID
      messages: MessageV2.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
    }) {
      const parent = input.messages.findLast((m) => m.info.id === input.parentID)
      if (!parent || parent.info.role !== "user") {
        throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
      }
      const instance = yield* InstanceState.context

      const userMessage = parent.info
      const compactionPart = parent.parts.find((part): part is MessageV2.CompactionPart => part.type === "compaction")

      let messages = input.messages
      let replay:
        | {
            info: MessageV2.User
            parts: MessageV2.Part[]
          }
        | undefined
      if (input.overflow) {
        const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
        for (let i = idx - 1; i >= 0; i--) {
          const msg = input.messages[i]
          if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
            replay = { info: msg.info, parts: msg.parts }
            messages = input.messages.slice(0, i)
            break
          }
        }
        const hasContent =
          replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
        if (!hasContent) {
          replay = undefined
          messages = input.messages
        }
      }

      const agent = yield* agents.get("compaction")
      const model = agent.model
        ? yield* provider.getModel(agent.model.providerID, agent.model.modelID).pipe(Effect.orDie)
        : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID).pipe(Effect.orDie)
      const cfg = yield* config.get()
      const history = compactionPart && messages.at(-1)?.info.id === input.parentID ? messages.slice(0, -1) : messages
      const prior = completedCompactions(history)
      const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
      const previousSummary = prior.at(-1)?.summary
      const visible = history.filter((_, index) => !hidden.has(index))
      const selected = yield* select({ messages: visible, cfg, model })
      // 会话笔记可用时优先用"笔记当摘要"：省掉一次完整的压缩请求，只保留最近
      // 一段原始消息（对齐 CC 的 session memory compaction）。锚点未知或
      // 压缩后仍然超限时回退到常规摘要。
      const smPlan = yield* Effect.gen(function* () {
        const notes = yield* Effect.promise(() => SessionMemoryNotes.read(input.sessionID))
        if (!notes) return undefined
        const anchor = SessionMemoryNotes.state(input.sessionID)?.lastMessageID
        const anchorIndex = anchor ? visible.findIndex((message) => message.info.id === anchor) : -1
        // 锚点不在历史里（撤回/重写等）就无法划边界，交给常规摘要。
        if (anchor && anchorIndex === -1) return undefined
        // 恢复的会话没有锚点：当作"整段都已摘要"，再从尾部向前补足最小保留量。
        const start = messagesToKeepIndex(visible, anchorIndex === -1 ? visible.length - 1 : anchorIndex)
        if (start <= 0 || start >= visible.length) return undefined
        const head = visible.slice(0, start)
        const truncated = SessionMemoryNotes.truncate(notes)
        if (input.auto) {
          const lastAssistant = [...history]
            .reverse()
            .find(
              (item) =>
                item.info.role === "assistant" && item.info.summary !== true && (item.info.tokens?.total ?? 0) > 0,
            )
          if (lastAssistant && lastAssistant.info.role === "assistant") {
            const mainModel = yield* provider
              .getModel(userMessage.model.providerID, userMessage.model.modelID)
              .pipe(Effect.orDie)
            const budget = usable({ cfg, model: mainModel, outputTokenMax: flags.outputTokenMax })
            const removed = yield* estimate({ messages: head, model: mainModel })
            const projected =
              Math.max(0, lastAssistant.info.tokens.total ?? 0) + Token.estimate(truncated.text) - removed
            if (budget > 0 && projected >= budget) {
              log.info("session memory compaction cannot make progress; falling back", { projected, budget })
              return undefined
            }
          }
        }
        return { head, tail: visible[start]!.info.id, summary: truncated.text, truncated: truncated.truncated }
      })
      if (ConfigMemory.resolve(cfg.memory).enabled && ConfigMemory.resolve(cfg.memory).review_enabled) {
        const text = reviewText(smPlan ? smPlan.head : selected.head)
        if (text) {
          const info = yield* session.get(input.sessionID).pipe(Effect.option)
          yield* memory
            .reviewCompaction({
              messagesText: text,
              projectID: Option.getOrUndefined(info)?.projectID,
              sessionID: input.sessionID,
              sourceMessageID: selected.head.at(-1)?.info.id,
            })
            .pipe(Effect.ignore)
        }
      }
      // Allow plugins to inject context or replace compaction prompt.
      const compacting = yield* plugin.trigger(
        "experimental.session.compacting",
        { sessionID: input.sessionID },
        { context: [], prompt: undefined },
      )
      const context = compacting.context
      const nextPrompt =
        compacting.prompt ?? buildPrompt({ previousSummary, context, instructions: compactionPart?.instructions })
      let head = smPlan ? smPlan.head : selected.head
      let tailStartID = smPlan?.tail ?? selected.tail_start_id
      let result: "continue" | "stop" | "compact" = smPlan ? "continue" : "compact"
      let summaryMessage: MessageV2.Assistant | undefined
      let failedMessage: MessageV2.Assistant | undefined

      if (smPlan) {
        const ctx = yield* InstanceState.context
        const notesPath = SessionMemoryNotes.file(input.sessionID)
        const summary = [
          "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.",
          "",
          smPlan.summary,
          ...(smPlan.truncated
            ? [
                "",
                `Some session memory sections were truncated for length. The full session memory can be viewed at: ${notesPath}`,
              ]
            : []),
          "",
          "Recent messages are preserved verbatim.",
        ].join("\n")
        const tokens = Token.estimate(summary)
        const msg: MessageV2.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          parentID: input.parentID,
          sessionID: input.sessionID,
          mode: "compaction",
          agent: "compaction",
          variant: userMessage.model.variant,
          summary: true,
          finish: "stop",
          path: {
            cwd: ctx.directory,
            root: ctx.worktree,
          },
          cost: 0,
          tokens: {
            total: tokens,
            output: tokens,
            input: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: {
            created: Date.now(),
            completed: Date.now(),
          },
        }
        yield* session.updateMessage(msg)
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: input.sessionID,
          type: "text",
          text: summary,
          time: { start: Date.now(), end: Date.now() },
        })
        summaryMessage = msg
        log.info("compacted with session memory", {
          kept: visible.length - smPlan.head.length,
          truncated: smPlan.truncated,
        })
      }

      // 压缩请求自己也可能是 prompt-too-long（会话太大 / 工具输出太多）。
      // 这时不能直接放弃：按最旧的一半裁剪 head，最多重试 3 次。
      for (let attempt = 1; !smPlan && attempt <= MAX_COMPACTION_RETRIES; attempt++) {
        const msgs = structuredClone(head)
        yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
        const modelMessages = yield* MessageV2.toModelMessagesEffect(msgs, model, {
          stripMedia: true,
          toolOutputMaxChars: TOOL_OUTPUT_MAX_CHARS,
        })
        const ctx = yield* InstanceState.context
        const msg: MessageV2.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          parentID: input.parentID,
          sessionID: input.sessionID,
          mode: "compaction",
          agent: "compaction",
          variant: userMessage.model.variant,
          summary: true,
          path: {
            cwd: ctx.directory,
            root: ctx.worktree,
          },
          cost: 0,
          tokens: {
            output: 0,
            input: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: {
            created: Date.now(),
          },
        }
        yield* session.updateMessage(msg)
        const processor = yield* processors.create({
          assistantMessage: msg,
          sessionID: input.sessionID,
          model,
        })
        result = yield* processor.process({
          user: userMessage,
          agent,
          sessionID: input.sessionID,
          tools: {},
          system: [],
          messages: [
            ...modelMessages,
            {
              role: "user",
              content: [{ type: "text", text: nextPrompt }],
            },
          ],
          model,
        })

        if (result !== "compact") {
          summaryMessage = msg
          break
        }

        // 这一次压缩请求自己超限：标记为失败的 summary（filterCompacted 会忽略），
        // 裁掉最旧的一半后重试。
        processor.message.error = new MessageV2.ContextOverflowError({
          message: replay
            ? "Conversation history too large to compact - exceeds model context limit"
            : "Session too large to compact - context exceeds model limit even after stripping media",
        }).toObject()
        processor.message.finish = "error"
        failedMessage = processor.message
        yield* session.updateMessage(processor.message)
        const next = truncateForRetry(head)
        if (!next) break
        log.info("compaction request overflowed; retrying with truncated history", {
          attempt,
          before: head.length,
          after: next.length,
        })
        head = next
      }

      if (!summaryMessage || result === "compact") {
        if (failedMessage?.error) {
          yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: failedMessage.error })
        }
        return "stop"
      }

      // Re-attach files that were touched before compaction. They are stored on
      // the summary message as synthetic text so `summaryText` (and therefore
      // the anchored summary) ignores them, while model conversion still sees
      // them on every subsequent request.
      const attachments = yield* buildAttachments({ messages: head })
      if (attachments.text) {
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: summaryMessage.id,
          sessionID: input.sessionID,
          type: "text",
          text: attachments.text,
          synthetic: true,
          time: {
            start: Date.now(),
            end: Date.now(),
          },
        })
        log.info("attached recent files after compaction", {
          files: attachments.files,
          tokens: attachments.tokens,
        })
      }

      // The compacted head is gone, so a later read of one of those files must
      // not be answered with the "unchanged since last read" stub — the read it
      // points at is no longer in context (and the re-attached copy above may be
      // truncated). Forgetting the entries makes the next read return the file.
      if (readState) {
        const tailIndex = tailStartID ? messages.findIndex((message) => message.info.id === tailStartID) : -1
        const kept = new Set(tailIndex === -1 ? [] : touchedPaths(messages.slice(tailIndex), instance.directory))
        const paths = touchedPaths(head, instance.directory).filter((file) => !kept.has(file))
        yield* Effect.forEach(paths, (file) => readState.forget(input.sessionID, file), { discard: true }).pipe(
          Effect.ignore,
        )
      }

      if (compactionPart && tailStartID && compactionPart.tail_start_id !== tailStartID) {
        yield* session.updatePart({
          ...compactionPart,
          tail_start_id: tailStartID,
        })
      }

      // 压缩只能删历史，删不掉 system + 工具 schema。若压缩后的理论下限
      // 仍高于模型可用窗口，自动继续只会再次溢出 → 再次压缩，形成死循环。
      // 这里用触发压缩的那条 assistant 的真实 usage 做估算：
      //   压缩后 ≈ 压缩前 - 被摘要掉的历史 + 摘要本身
      // 仍然超限就停止自动继续，并把原因报给用户；runLoop 里还有连续次数熔断兜底。
      let canAutoContinue = true
      if (result === "continue" && input.auto) {
        const lastAssistant = [...history]
          .reverse()
          .find(
            (item) =>
              item.info.role === "assistant" && item.info.summary !== true && (item.info.tokens?.total ?? 0) > 0,
          )
        if (lastAssistant && lastAssistant.info.role === "assistant") {
          const mainModel = yield* provider
            .getModel(userMessage.model.providerID, userMessage.model.modelID)
            .pipe(Effect.orDie)
          const budget = usable({ cfg, model: mainModel, outputTokenMax: flags.outputTokenMax })
          const removed = yield* estimate({ messages: head, model: mainModel })
          const added = (summaryMessage.tokens.total ?? 0) + attachments.tokens
          const projected = Math.max(0, lastAssistant.info.tokens.total ?? 0) + added - removed
          if (budget > 0 && projected >= budget) {
            canAutoContinue = false
            log.info("compaction cannot make progress", {
              before: lastAssistant.info.tokens.total,
              removed,
              added,
              projected,
              budget,
            })
            yield* bus.publish(Session.Event.Error, {
              sessionID: input.sessionID,
              error: new MessageV2.ContextOverflowError({
                message:
                  `Auto-compaction cannot make progress: projected ${projected} tokens still exceed the usable window (${budget}). ` +
                  `The fixed prompt (system + tool schemas) is too large. Disable unused MCP tools or switch to a model with a larger context window.`,
              }).toObject(),
            })
          }
        }
      }

      if (canAutoContinue && result === "continue" && input.auto) {
        if (replay) {
          const original = replay.info
          const replayMsg = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: input.sessionID,
            time: { created: Date.now() },
            agent: original.agent,
            model: original.model,
            format: original.format,
            tools: original.tools,
            system: original.system,
          })
          for (const part of replay.parts) {
            if (part.type === "compaction") continue
            const replayPart =
              part.type === "file" && MessageV2.isMedia(part.mime)
                ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
                : part
            yield* session.updatePart({
              ...replayPart,
              id: PartID.ascending(),
              messageID: replayMsg.id,
              sessionID: input.sessionID,
            })
          }
        }

        if (!replay) {
          const info = yield* provider.getProvider(userMessage.model.providerID)
          if (
            (yield* plugin.trigger(
              "experimental.compaction.autocontinue",
              {
                sessionID: input.sessionID,
                agent: userMessage.agent,
                model: yield* provider
                  .getModel(userMessage.model.providerID, userMessage.model.modelID)
                  .pipe(Effect.orDie),
                provider: {
                  source: info.source,
                  info,
                  options: info.options,
                },
                message: userMessage,
                overflow: input.overflow === true,
              },
              { enabled: true },
            )).enabled
          ) {
            const continueMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: userMessage.agent,
              model: userMessage.model,
            })
            const text =
              (input.overflow
                ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
                : "") +
              "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: continueMsg.id,
              sessionID: input.sessionID,
              type: "text",
              // Internal marker for auto-compaction followups so provider plugins
              // can distinguish them from manual post-compaction user prompts.
              // This is not a stable plugin contract and may change or disappear.
              metadata: { compaction_continue: true },
              synthetic: true,
              text,
              time: {
                start: Date.now(),
                end: Date.now(),
              },
            })
          }
        }
      }

      if (summaryMessage.error) return "stop"
      if (result === "continue") {
        const summary = summaryText(
          (yield* session.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)).find(
            (item) => item.info.id === summaryMessage.id,
          ) ?? {
            info: summaryMessage,
            parts: [],
          },
        )
        if (flags.experimentalEventSystem) {
          yield* events.publish(SessionEvent.Compaction.Ended, {
            sessionID: input.sessionID,
            timestamp: DateTime.makeUnsafe(Date.now()),
            text: summary ?? "",
            include: tailStartID,
          })
        }
        yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
        if (hooks) {
          yield* hooks.trigger({ event: "PostCompact", sessionID: input.sessionID }).pipe(Effect.ignore)
        }
      }
      return canAutoContinue ? result : "stop"
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderID; modelID: ModelID }
      auto: boolean
      overflow?: boolean
      /** `/compact <instructions>`: extra guidance for what to keep. */
      instructions?: string
    }) {
      if (hooks) {
        const pre = yield* hooks
          .trigger({ event: "PreCompact", sessionID: input.sessionID })
          .pipe(Effect.catch(() => Effect.succeed({ blocked: false, ran: false })))
        if (pre.blocked) return
      }

      const msg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
        ...(input.instructions?.trim() ? { instructions: input.instructions.trim() } : {}),
      })
      if (flags.experimentalEventSystem) {
        yield* events.publish(SessionEvent.Compaction.Started, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(Date.now()),
          reason: input.auto ? "auto" : "manual",
        })
      }
    })

    return Service.of({
      isOverflow,
      prune,
      process: processCompaction,
      create,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Memory.layer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(HookLayer),
    Layer.provide(RuntimeFlags.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(ReadState.defaultLayer),
  ),
)

export * as SessionCompaction from "./compaction"
