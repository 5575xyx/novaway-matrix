import type { AssistantMessage } from "@novaway/sdk-v2-latest/v2"
import type { useSync } from "../context/sync"
import { Locale } from "./locale"

// 与输入卡状态行同一份格式化器:同一个数字在两处显示成两种货币写法比显示成一种更糟。
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export type SessionUsage = {
  /** 最后一条有输出的助手消息这一轮的 token 合计(含缓存读写)。 */
  tokens: number
  /**
   * 输入卡状态行的写法:`8.2K`,模型有 context 上限时是 `8.2K (12%)`。
   * 带上百分比是因为那一行的读者是要判断「还能不能继续聊」的人。
   */
  context: string
  cost?: string
}

/**
 * 会话当前的上下文占用。取「最后一条**有输出**的助手消息」而不是最后一条助手消息:
 * 正在跑的那一轮 output 还是 0,拿它算会得到一个越算越小的数字,每来一条消息就掉一次。
 *
 * token 合计 = input + output + reasoning + cache.read + cache.write —— 缓存读写也是真占
 * context,漏掉它们会让「上下文快满了」的判断偏乐观。
 *
 * 为什么是这个独立文件而不是两处各算一遍:输入卡的状态行(prompt/index.tsx)与标签行的
 * `8.2K ctx` 胶囊(routes/session)问的是同一个数,口径一旦分叉就会出现「状态行写着 8.2K (12%)、
 * 胶囊写着 8.2K」这种对不上的屏幕。原始 token 数一并返回,胶囊要的是不带百分比的那个。
 */
export function sessionUsage(sync: ReturnType<typeof useSync>, sessionID: string): SessionUsage | undefined {
  const session = sync.session.get(sessionID)
  const messages = sync.data.message[sessionID] ?? []
  const last = messages.findLast(
    (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
  )
  if (!last) return

  const tokens =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  if (tokens <= 0) return

  const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
  const pct = model?.limit.context ? `${Math.round((tokens / model.limit.context) * 100)}%` : undefined
  const cost = session?.cost ?? 0
  return {
    tokens,
    context: pct ? `${Locale.number(tokens)} (${pct})` : Locale.number(tokens),
    cost: cost > 0 ? money.format(cost) : undefined,
  }
}
