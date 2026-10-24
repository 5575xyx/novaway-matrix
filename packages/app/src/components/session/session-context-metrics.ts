import type { AssistantMessage, Message } from "@novaway/sdk/v2/client"

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: {
    context: number
    input?: number
    output?: number
  }
}

export type ContextStatus = "normal" | "warning" | "error" | "blocking"

type Budget = {
  effective: number
  autoCompact: number
  warning: number
  error: number
  blocking: number
  percentLeft: number | null
  status: ContextStatus
}

type Context = {
  message: AssistantMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
  usage: number | null
  budget: Budget | undefined
}

type Metrics = {
  totalCost: number
  context: Context | undefined
}

// 与内核 `session/overflow.ts` 的 contextBudget 保持一致。
const SUMMARY_RESERVE = 20_000
const AUTOCOMPACT_BUFFER = 13_000
const WARNING_THRESHOLD_BUFFER = 20_000
const ERROR_THRESHOLD_BUFFER = 20_000
const MANUAL_COMPACT_BUFFER = 3_000

function contextBudget(limit: Model["limit"] | undefined, total: number): Budget | undefined {
  if (!limit?.context) return undefined
  const base = limit.input ?? limit.context
  const effective = Math.max(0, base - Math.min(SUMMARY_RESERVE, limit.output ?? 0))
  const autoCompact = Math.max(0, effective - AUTOCOMPACT_BUFFER)
  // Auto compaction is enabled by default; the UI mirrors those thresholds.
  const warning = Math.max(0, autoCompact - WARNING_THRESHOLD_BUFFER)
  const error = Math.max(0, autoCompact - ERROR_THRESHOLD_BUFFER)
  const blocking = Math.max(0, effective - MANUAL_COMPACT_BUFFER)
  return {
    effective,
    autoCompact,
    warning,
    error,
    blocking,
    percentLeft: autoCompact > 0 ? Math.max(0, Math.min(100, Math.round(((autoCompact - total) / autoCompact) * 100))) : null,
    status: total >= blocking ? "blocking" : total >= autoCompact ? "error" : total >= warning ? "warning" : "normal",
  }
}

export type SessionCacheMetrics = {
  input: number
  cacheRead: number
  cacheWrite: number
  totalInput: number
  hitRate: number | null
  calls: number
}

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const lastAssistantWithTokens = (messages: Message[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (tokenTotal(msg) <= 0) continue
    return msg
  }
}

const build = (messages: Message[] = [], providers: Provider[] = []): Metrics => {
  const totalCost = messages.reduce((sum, msg) => sum + (msg.role === "assistant" ? msg.cost : 0), 0)
  const message = lastAssistantWithTokens(messages)
  if (!message) return { totalCost, context: undefined }

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
    totalCost,
    context: {
      message,
      provider,
      model,
      providerLabel: provider?.name ?? message.providerID,
      modelLabel: model?.name ?? message.modelID,
      limit,
      input: message.tokens.input,
      output: message.tokens.output,
      reasoning: message.tokens.reasoning,
      cacheRead: message.tokens.cache.read,
      cacheWrite: message.tokens.cache.write,
      total,
      usage: limit ? Math.round((total / limit) * 100) : null,
      budget: contextBudget(model?.limit, total),
    },
  }
}

export function getSessionContextMetrics(messages: Message[] = [], providers: Provider[] = []) {
  return build(messages, providers)
}

export function getSessionCacheMetrics(messages: Message[] = []): SessionCacheMetrics {
  let input = 0
  let cacheRead = 0
  let cacheWrite = 0
  let calls = 0

  for (const message of messages) {
    if (message.role !== "assistant") continue
    const tokens = message.tokens
    if (!tokens) continue
    if (tokens.input + tokens.cache.read + tokens.cache.write <= 0) continue
    input += tokens.input
    cacheRead += tokens.cache.read
    cacheWrite += tokens.cache.write
    calls += 1
  }

  const totalInput = input + cacheRead + cacheWrite
  return {
    input,
    cacheRead,
    cacheWrite,
    totalInput,
    hitRate: totalInput > 0 ? cacheRead / totalInput : null,
    calls,
  }
}
