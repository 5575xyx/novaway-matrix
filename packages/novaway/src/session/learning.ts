import { createHash } from "node:crypto"
import { Cause, Effect, Semaphore } from "effect"
import * as Log from "@novaway/core/util/log"
import { BackgroundJob } from "@/background/job"
import { BackgroundJobTable } from "@/background/job.sql"
import { InstanceState } from "@/effect/instance-state"
import { Database, eq } from "@/storage/db"
import type { MessageV2 } from "./message-v2"

const log = Log.create({ service: "session.learning" })

// Reject the whole value rather than persisting a partially redacted credential.
// Personal preferences, names and relationships are intentionally not prohibited.
export function sensitive(value: unknown): boolean {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "")
  return /-----BEGIN (?:[A-Z ]*PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----|\b(?:sk-(?:proj-)?[\w-]{12,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|AKIA[A-Z0-9]{16}|eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+)\b|\b(?:Bearer|Basic)\s+[\w+/=.-]{8,}|(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|passwd|密码|密钥|口令|凭据)["'\s]*(?:[:=：]|是|为)["'\s]*[^\s,;，；"'}]{3,}|[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@/i.test(
    text,
  )
}

function optedOutText(text: string) {
  return /(?:不要|别|不许|禁止|无需|不需要|不允许|勿).{0,18}(?:记住|记忆|学习|记录|保存|存储|沉淀)|(?:本轮|这轮|此次|这次|本次).{0,12}(?:不记|不学|不存)|(?:do not|don't|don’t|never)\s+(?:\w+\s+){0,3}(?:remember|memorize|learn|save|store|retain)|(?:no|disable)\s+(?:memory|learning)\b/i.test(
    text,
  )
}

export const optedOut = optedOutText

export function userText(parts: readonly MessageV2.Part[]) {
  return parts
    .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic && !part.ignored)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
}

export type Evidence = {
  turnID: string
  messageID: string
  role: "user" | "assistant" | "tool"
  text: string
  tool?: string
  status?: string
  exitCode?: number
}
export type Window = {
  entries: Evidence[]
  transcript: string
  sourceMessageIDs: string[]
  sourceMessageID?: string
  turnCount: number
  optedOut: boolean
  sensitive: boolean
  signal?: "correction" | "decision" | "tool-recovery"
  repeated: boolean
  /** Tool invocations in the current turn; drives tool-activity skill extraction. */
  toolCallCount: number
}

/** Original roles and tool states are evidence; assistant success claims are not. */
export function window(messages: readonly MessageV2.WithParts[], sourceMessageID: string, maxChars = 18_000): Window {
  const end = messages.findIndex((message) => message.info.id === sourceMessageID)
  const next = messages.findIndex(
    (message, index) => index > end && message.info.role === "user" && !!userText(message.parts),
  )
  const history = end < 0 ? [] : messages.slice(0, next < 0 ? undefined : next)
  const hasOptedOut = history.some((message) => message.info.role === "user" && optedOutText(userText(message.parts)))
  const turns: Array<{ id: string; text: string; messages: MessageV2.WithParts[] }> = []
  for (const message of history) {
    const text = message.info.role === "user" ? userText(message.parts) : ""
    if (text) turns.push({ id: message.info.id, text, messages: [] })
    // Synthetic continuation prompts do not create learnable user evidence.
    if (message.info.role === "assistant") turns.at(-1)?.messages.push(message)
  }
  const current = turns.at(-1)
  const selected = turns.slice(-6).filter((turn) => !optedOutText(turn.text))
  const toolCallCount = history.reduce(
    (count, message) => count + message.parts.filter((part) => part.type === "tool").length,
    0,
  )
  const entries: Evidence[] = selected.flatMap((turn) => {
    const user: Evidence = {
      turnID: turn.id,
      messageID: turn.id,
      role: "user",
      text: sensitive(turn.text) ? "" : turn.text.slice(0, 3000),
    }
    const rest: Evidence[] = turn.messages.slice(-24).flatMap((message) =>
      message.parts.slice(-40).flatMap((part): Evidence[] => {
        const base = { turnID: turn.id, messageID: message.info.id }
        if (part.type === "text" && !part.synthetic && !part.ignored && !sensitive(part.text))
          return [{ ...base, role: "assistant", text: part.text.slice(0, 1600) }]
        if (part.type !== "tool") return []
        const state = part.state
        const metadata = state.status === "completed" ? state.metadata : undefined
        const exitCode =
          typeof metadata?.exit === "number"
            ? metadata.exit
            : typeof metadata?.exitCode === "number"
              ? metadata.exitCode
              : undefined
        const text = state.status === "error" ? state.error : state.status === "completed" ? state.output : ""
        return [
          {
            ...base,
            role: "tool",
            tool: part.tool,
            status: state.status,
            exitCode,
            text: sensitive(text) ? "" : text.slice(0, 1600),
          },
        ]
      }),
    )
    return [user, ...rest.slice(-24)]
  })
  const latestText = current && !optedOut(current.text) && !sensitive(current.text) ? current.text : ""
  const correction =
    /(?:不对|纠正|更正|不是.{0,30}而是|说错|搞错|应该改|actually|correction|instead of|that's wrong)/i.test(latestText)
  const decision =
    /(?:决定|以后|今后|统一使用|始终|请记住|记住|从现在起|we decided|from now on|always use|remember that)/i.test(
      latestText,
    )
  const recovery = entries.some(
    (entry, index) =>
      entry.turnID === current?.id &&
      entry.role === "tool" &&
      entry.status === "completed" &&
      (entry.exitCode === undefined || entry.exitCode === 0) &&
      entries
        .slice(0, index)
        .some(
          (previous) =>
            previous.role === "tool" &&
            previous.tool === entry.tool &&
            (previous.status === "error" || (previous.exitCode !== undefined && previous.exitCode !== 0)),
        ),
  )
  const userTurns = selected.map((turn) => normalized(turn.text)).filter(Boolean)
  const repeated = userTurns.some((text, index) => userTurns.indexOf(text) !== index)
  // Drop older non-user records first; keep source IDs and roles even when text is truncated.
  while (JSON.stringify(entries).length > Math.max(2, maxChars) && entries.length) {
    const nonUser = entries.findIndex((entry) => entry.role !== "user")
    if (nonUser >= 0 && entries.length > selected.length + 6) {
      entries.splice(nonUser, 1)
      continue
    }
    const longest = entries.reduce((a, b) => (a.text.length > b.text.length ? a : b))
    if (longest.text.length > 32) {
      longest.text = longest.text.slice(0, Math.floor(longest.text.length / 2))
      continue
    }
    entries.shift()
  }
  return {
    entries,
    transcript: JSON.stringify(entries),
    sourceMessageIDs: selected.map((turn) => turn.id),
    sourceMessageID: current?.id,
    turnCount: turns.length,
    optedOut: hasOptedOut,
    sensitive: !!current && sensitive(current.text),
    signal: correction ? "correction" : decision ? "decision" : recovery ? "tool-recovery" : undefined,
    repeated,
    toolCallCount,
  }
}

export function trigger(input: {
  enabled: boolean
  review: boolean
  interval: number
  window: Window
  dreamInterval?: number
  /** When set, a turn with at least this many tool calls triggers skill extraction. */
  toolThreshold?: number
}) {
  if (input.window.optedOut) return { due: false, reason: "opt-out" }
  if (input.window.sensitive) return { due: false, reason: "sensitive" }
  if (!input.enabled) return { due: false, reason: "disabled" }
  if (!input.review) return { due: false, reason: "review-disabled" }
  if (input.interval <= 0) {
    // Tool-activity skill extraction is independent of the periodic review interval.
    if (input.toolThreshold && input.toolThreshold > 0 && input.window.toolCallCount >= input.toolThreshold)
      return { due: true, reason: "tool-activity" }
    return { due: false, reason: "interval-zero" }
  }
  if (input.window.signal) return { due: true, reason: input.window.signal }
  if (input.window.repeated) return { due: true, reason: "repeated-pattern" }
  if (input.toolThreshold && input.toolThreshold > 0 && input.window.toolCallCount >= input.toolThreshold)
    return { due: true, reason: "tool-activity" }
  if (input.dreamInterval && input.dreamInterval > 0 && input.window.turnCount % input.dreamInterval === 0)
    return { due: true, reason: "dream" }
  // Positive intervals are capped at two user turns; signals can accelerate, never override off.
  return input.window.turnCount > 0 && input.window.turnCount % Math.min(2, input.interval) === 0
    ? { due: true, reason: "interval" }
    : { due: false, reason: "interval-not-due" }
}

export type Citation = { messageID: string; quote: string }
export type Grounding = {
  basis?: "explicit" | "inferred" | "tool"
  evidence?: readonly Citation[]
  confidence?: number
}
export type MemoryDraft = Grounding & {
  content: string
  factKey?: string
  operation?: "add" | "update" | "archive" | "confirm"
  reason?: string
}
export type ExistingMemory = { id: string; factKey?: string; content: string }
const normalized = (text: string) => text.trim().toLocaleLowerCase().replace(/\s+/g, " ")

export function cited(draft: Grounding, context: Window) {
  return (draft.evidence ?? []).flatMap((citation) =>
    context.entries.filter(
      (entry) =>
        entry.messageID === citation.messageID &&
        citation.quote.trim().length >= 4 &&
        entry.text.includes(citation.quote.trim()),
    ),
  )
}

/** A mistaken add to an existing fact becomes a pending update, never a blind overwrite. */
export function reconcile<T extends MemoryDraft>(draft: T, existing: readonly ExistingMemory[]): T | undefined {
  if (sensitive(draft)) return undefined
  const same = existing.find((item) => normalized(item.content) === normalized(draft.content))
  const byKey = draft.factKey ? existing.find((item) => item.factKey === draft.factKey) : undefined
  const target = byKey ?? same
  if (
    (draft.operation === "update" || draft.operation === "archive" || draft.operation === "confirm") &&
    !target?.factKey
  )
    return
  if (!target) return { ...draft, operation: draft.operation ?? "add" }
  return {
    ...draft,
    factKey: target.factKey,
    operation:
      draft.operation === "archive"
        ? "archive"
        : normalized(target.content) === normalized(draft.content)
          ? "confirm"
          : "update",
  }
}

export function autoApply(draft: MemoryDraft, context: Window, existing: readonly ExistingMemory[]) {
  if (context.optedOut || sensitive(draft) || (draft.confidence ?? 0) < 0.9 || draft.basis !== "explicit") return false
  if (!cited(draft, context).some((entry) => entry.role === "user")) return false
  if (draft.operation === "confirm")
    return existing.some(
      (item) =>
        !!draft.factKey && item.factKey === draft.factKey && normalized(item.content) === normalized(draft.content),
    )
  return (
    draft.operation === "add" &&
    !!draft.factKey &&
    !existing.some((item) => item.factKey === draft.factKey || normalized(item.content) === normalized(draft.content))
  )
}

export function evolutionEvidence(
  draft: Grounding & { content: string; expectedOutcomes?: readonly string[] },
  context: Window,
) {
  if (
    context.optedOut ||
    sensitive(draft) ||
    !draft.expectedOutcomes?.length ||
    draft.expectedOutcomes.some((item) => item.trim().length < 8)
  )
    return false
  const evidence = cited(draft, context).filter((entry) => entry.role === "user" || entry.role === "tool")
  const explicit = evidence.some(
    (entry) =>
      entry.role === "user" &&
      /(?:纠正|更正|以后|今后|始终|每次|流程|习惯|不对|应该|always|from now on|correction|instead|workflow)/i.test(
        entry.text,
      ),
  )
  return explicit || new Set(evidence.map((entry) => entry.turnID)).size >= 2
}

/** Bounded, relevant records, not an unbounded second conversation transcript. */
export function related<T extends { content: string }>(items: readonly T[], context: Window, maxChars = 6000): T[] {
  const query = context.entries
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.text)
    .join(" ")
    .toLocaleLowerCase()
  const tokens = Array.from(new Set(query.match(/[a-z0-9_-]{3,}|[\p{Script=Han}]{2}/gu) ?? []))
  const sorted = items
    .filter((item) => !sensitive(item))
    .map((item, index) => ({
      item,
      index,
      score: tokens.filter((token) => item.content.toLocaleLowerCase().includes(token)).length,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const result: T[] = []
  for (const entry of sorted) {
    if (result.length >= 20) break
    if (JSON.stringify([...result, entry.item]).length <= maxChars) result.push(entry.item)
  }
  return result
}

export type Output = {
  outcome: "skipped" | "empty" | "candidates" | "applied"
  reason: string
  candidateCount: number
  appliedCount: number
}
export const output = (outcome: Output["outcome"], reason: string, candidateCount = 0, appliedCount = 0): Output => ({
  outcome,
  reason,
  candidateCount,
  appliedCount,
})
export type JobInput = {
  type: "learning.memory" | "learning.evolution"
  projectID: string
  sessionID: string
  sourceMessageID: string
  trigger: string
  run: Effect.Effect<Output, unknown>
}

class LearningFailure extends Error {
  constructor(readonly stage: string) {
    super(`Learning failed at ${stage}`)
  }
}

/** Do not let SDK/HTTP errors (which can embed requests/credentials) reach job persistence. */
export function stage<A, E>(name: string, effect: Effect.Effect<A, E>): Effect.Effect<A, LearningFailure> {
  return Effect.mapError(effect, () => new LearningFailure(name))
}

export function jobID(input: Pick<JobInput, "type" | "projectID" | "sessionID" | "sourceMessageID">) {
  return `job_learning_${createHash("sha256")
    .update(JSON.stringify([input.type, input.projectID, input.sessionID, input.sourceMessageID]))
    .digest("hex")}`
}

export const makeScheduler = Effect.gen(function* () {
  const state = yield* InstanceState.make((_context) =>
    Effect.sync(() => ({ lock: Semaphore.makeUnsafe(1), latest: new Map<string, string>() })),
  )
  return Effect.fn("SessionLearning.schedule")(function* (
    background: BackgroundJob.Interface | undefined,
    input: JobInput,
  ) {
    const id = jobID(input)
    if (!background) {
      log.error("learning unavailable", { id, type: input.type, reason: "background-service-unavailable" })
      return yield* Effect.fail(new LearningFailure("background-service-unavailable"))
    }
    const current = yield* InstanceState.get(state)
    return yield* current.lock.withPermits(1)(
      Effect.gen(function* () {
        if (yield* background.get(id)) return id
        // BackgroundJob.get's persisted fallback only covers the newest 50 records.
        // Exact lookup keeps source-level idempotency across restarts and large histories.
        const persisted = yield* stage(
          "deduplication",
          Effect.sync(() =>
            Database.use((db) =>
              db
                .select({ id: BackgroundJobTable.id })
                .from(BackgroundJobTable)
                .where(eq(BackgroundJobTable.id, id))
                .get(),
            ),
          ),
        )
        if (persisted) return id
        const key = JSON.stringify([input.type, input.projectID, input.sessionID])
        const previous = current.latest.get(key)
        const metadata = {
          projectID: input.projectID,
          sessionID: input.sessionID,
          sourceMessageID: input.sourceMessageID,
          trigger: input.trigger,
        }
        yield* background.start({
          id,
          type: input.type,
          title: input.type === "learning.memory" ? "Memory review" : "Evolution review",
          metadata,
          run: Effect.gen(function* () {
            if (previous) yield* background.wait({ id: previous })
            const result = yield* input.run
            yield* background.update(id, {
              output: JSON.stringify(result),
              metadata: {
                ...metadata,
                outcome: result.outcome,
                reason: result.reason,
                candidateCount: result.candidateCount,
                appliedCount: result.appliedCount,
              },
            })
            return JSON.stringify(result)
          }).pipe(
            Effect.catchCause((cause) => {
              if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
              const error = Cause.squash(cause)
              const stage = error instanceof LearningFailure ? error.stage : "job"
              log.error("learning job failed", { id, type: input.type, stage })
              return Effect.gen(function* () {
                yield* background.update(id, { metadata: { ...metadata, stage } }).pipe(Effect.ignore)
                return yield* Effect.fail(new LearningFailure(stage))
              })
            }),
          ),
        })
        current.latest.set(key, id)
        return id
      }),
    )
  })
})

export * as Learning from "./learning"
