/**
 * 会话空态的时段问候语。
 *
 * 对齐 ZCode `v4/ConversationDraftEmptyState.tsx` 的 `getChatEmptyGreetingMessageId`：
 * 按「小时」分 6 档，边界时刻自动换档（ZCode 另有一套按边界时刻重排定时器的逻辑，
 * 这里简化为渲染时取一次 —— 空态通常只停留几秒，不值得为此挂定时器）。
 */
export type GreetingKey =
  | "chat.empty.greeting.morningEarly"
  | "chat.empty.greeting.morning"
  | "chat.empty.greeting.noon"
  | "chat.empty.greeting.afternoon"
  | "chat.empty.greeting.evening"
  | "chat.empty.greeting.lateNight"

export function greetingKeyAt(hour: number): GreetingKey {
  if (hour >= 5 && hour < 9) return "chat.empty.greeting.morningEarly"
  if (hour >= 9 && hour < 12) return "chat.empty.greeting.morning"
  if (hour >= 12 && hour < 14) return "chat.empty.greeting.noon"
  if (hour >= 14 && hour < 18) return "chat.empty.greeting.afternoon"
  if (hour >= 18 && hour < 23) return "chat.empty.greeting.evening"
  return "chat.empty.greeting.lateNight"
}

export function greetingMessageId(date: Date = new Date()): GreetingKey {
  return greetingKeyAt(date.getHours())
}
