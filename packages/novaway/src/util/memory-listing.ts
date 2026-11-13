/**
 * 记忆条目在提示里的呈现辅助。内核（session/prompt.ts）与记忆能力（memory/prefetch.ts）
 * 都要用，因此放在 shared 层，避免内核反向依赖 capability（插件文档 §2.3 规则 1）。
 */

export function summarizeMemory(item: { summary?: string | null; content: string }, maxLen = 80) {
  const raw = (item.summary || item.content).replace(/\s+/g, " ").trim()
  if (raw.length <= maxLen) return raw
  return `${raw.slice(0, maxLen - 1)}…`
}

/** 把 LLM 判定保留的下标映射回条目，越界/重复下标直接忽略。 */
export function applyRelevanceKeep<T>(items: readonly T[], keep: readonly number[]) {
  const indexes = new Set(keep.filter((index) => Number.isInteger(index) && index >= 0 && index < items.length))
  return items.filter((_, index) => indexes.has(index))
}
