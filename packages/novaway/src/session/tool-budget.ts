import type { MessageV2 } from "./message-v2"

/**
 * Aggregate tool-result budget ("microcompact").
 *
 * Pruning (see `compaction.prune`) only clears tool output once the session is
 * being compacted, and compaction replaces the whole history with a summary.
 * Both are heavy: the first throws away detail the model may still need, the
 * second costs a full summarisation round-trip.
 *
 * This module is the middle layer. Before every request we walk the tool
 * results from newest to oldest, keep the newest ones verbatim, and replace the
 * oldest ones with a short stub once the running total exceeds a character
 * budget. Nothing is deleted from storage — only the copy sent to the provider
 * is trimmed, so the UI and later turns still see the full output.
 */

export const DEFAULT_BUDGET_CHARS = 60_000
/** Tool results that must survive trimming. */
export const PROTECTED_TOOLS = new Set(["skill", "question", "plan_exit"])

export const STUB_PREFIX = "[Old tool result content cleared"

export function stub(original: number) {
  return `${STUB_PREFIX}: ${original} chars elided to keep the context window small. Re-run the tool if you need it.]`
}

export type Options = {
  /**
   * Total characters allowed across all tool results in this request.
   * `Infinity` (or a falsy value) disables trimming.
   */
  budgetChars?: number
  /** Never trim results newer than this many messages (counted from the end). */
  keepRecentMessages?: number
}

export type Result = {
  messages: MessageV2.WithParts[]
  /** Characters removed from the request. */
  elided: number
  /** How many tool results were replaced. */
  replaced: number
}

function isElided(part: MessageV2.ToolPart) {
  return part.state.status === "completed" && part.state.output.startsWith(STUB_PREFIX)
}

/**
 * Return a copy of `messages` whose oldest tool results have been replaced by
 * stubs. Input is never mutated: the caller keeps the authoritative transcript.
 */
export function apply(messages: MessageV2.WithParts[], options: Options = {}): Result {
  const budget = options.budgetChars ?? DEFAULT_BUDGET_CHARS
  if (!Number.isFinite(budget) || budget <= 0) return { messages, elided: 0, replaced: 0 }

  const keepRecent = Math.max(0, options.keepRecentMessages ?? 2)
  const floor = messages.length - keepRecent

  // Collect every completed tool result with its position, newest last.
  const entries: Array<{ msg: number; part: number; chars: number; tool: string }> = []
  messages.forEach((message, msgIndex) => {
    message.parts.forEach((part, partIndex) => {
      if (part.type !== "tool") return
      if (part.state.status !== "completed") return
      // Already-stubbed results are minimal; counting them again would make a
      // second pass believe the request is still over budget.
      if (isElided(part)) return
      entries.push({ msg: msgIndex, part: partIndex, chars: part.state.output.length, tool: part.tool })
    })
  })
  if (entries.length === 0) return { messages, elided: 0, replaced: 0 }

  const total = entries.reduce((sum, entry) => sum + entry.chars, 0)
  if (total <= budget) return { messages, elided: 0, replaced: 0 }

  // Newest-first allocation: always keep results inside the recent window,
  // then keep older ones while they still fit. Everything else is stubbed.
  let kept = 0
  const drop = new Set<string>()
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    const protectedTool = PROTECTED_TOOLS.has(entry.tool)
    if (protectedTool || entry.msg >= floor) {
      kept += entry.chars
      continue
    }
    if (kept + entry.chars <= budget) {
      kept += entry.chars
      continue
    }
    drop.add(`${entry.msg}:${entry.part}`)
  }
  if (drop.size === 0) return { messages, elided: 0, replaced: 0 }

  let elided = 0
  let replaced = 0
  const next = messages.map((message, msgIndex) => {
    if (![...drop].some((key) => key.startsWith(`${msgIndex}:`))) return message
    const parts = message.parts.map((part, partIndex) => {
      if (!drop.has(`${msgIndex}:${partIndex}`)) return part
      if (part.type !== "tool" || part.state.status !== "completed") return part
      if (isElided(part)) return part
      replaced += 1
      elided += part.state.output.length
      return {
        ...part,
        state: {
          ...part.state,
          output: stub(part.state.output.length),
        },
      } as MessageV2.ToolPart
    })
    return { ...message, parts }
  })

  return { messages: next, elided, replaced }
}

export * as ToolBudget from "./tool-budget"
