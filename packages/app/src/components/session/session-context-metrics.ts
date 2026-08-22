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
  }
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
}

type Metrics = {
  totalCost: number
  context: Context | undefined
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
