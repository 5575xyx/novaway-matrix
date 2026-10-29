import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { Token } from "@/util/token"
import type { MessageID } from "./schema"
import { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000
/** Extra headroom below the usable window, matching Claude Code's AUTOCOMPACT_BUFFER_TOKENS. */
const AUTOCOMPACT_BUFFER = 13_000
/** Usage this close to the auto threshold shows a low-context warning. */
const WARNING_THRESHOLD_BUFFER = 20_000
/** Error color threshold (Claude Code also uses 20k). */
const ERROR_THRESHOLD_BUFFER = 20_000
/** No request is sent once usage is this close to the effective window; compact manually. */
const MANUAL_COMPACT_BUFFER = 3_000

function limits(input: { cfg: Config.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  const base = input.model.limit.input ?? context
  if (input.cfg.compaction?.reserved !== undefined) {
    return { effective: Math.max(0, base - input.cfg.compaction.reserved), autoBuffer: 0 }
  }
  const summaryReserve = Math.min(
    COMPACTION_BUFFER,
    ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax),
  )
  // 两条路径都必须扣掉预留空间：
  // - limit.input 是厂商显式给出的「输入上限」，扣掉摘要/输出预留才不会顶到硬上限；
  // - 没有 limit.input 时，模型硬上限是 context - 实际 max_tokens。
  //   默认预留 min(20k, maxOutput) + 13k（对齐 CC），128k/32k 模型因此是 95k；
  //   只扣 20k 会算成 108k，输入 + max_tokens 可能超过 128k。
  return { effective: Math.max(0, base - summaryReserve), autoBuffer: AUTOCOMPACT_BUFFER }
}

export function usable(input: { cfg: Config.Info; model: Provider.Model; outputTokenMax?: number }) {
  if (input.model.limit.context === 0) return 0
  return autoThreshold(input)
}

/**
 * Token count at which automatic compaction starts.
 *
 * `compaction.threshold` (absolute) wins over `compaction.threshold_percent`
 * (1-100 of the effective window); both fall back to the Claude Code default
 * of `effective - 13k`. A configured value is clamped to the hard blocking
 * limit (`effective - 3k`): compacting above that line would mean the request
 * is rejected before the threshold is ever reached.
 */
export function autoThreshold(input: { cfg: Config.Info; model: Provider.Model; outputTokenMax?: number }) {
  const value = limits(input)
  const ceiling = Math.max(0, value.effective - MANUAL_COMPACT_BUFFER)
  const absolute = input.cfg.compaction?.threshold
  if (absolute !== undefined) return Math.min(absolute, ceiling)
  const percent = input.cfg.compaction?.threshold_percent
  if (percent !== undefined) return Math.min(Math.floor(value.effective * (percent / 100)), ceiling)
  return Math.max(0, value.effective - value.autoBuffer)
}

export type ContextBudget = {
  /** context/input window minus the summary+output reserve. */
  effective: number
  /**
   * Usage at/above this triggers auto-compaction: `compaction.threshold` or
   * `compaction.threshold_percent` when configured, otherwise
   * `effective - 13k`; the effective window when auto is off.
   */
  threshold: number
  /** Usage at/above this shows the low-context warning. */
  warning: number
  /** Usage at/above this uses the error color. */
  error: number
  /** Requests are blocked at/above this; manual compaction must run first. */
  blocking: number
  /** Percent remaining until `threshold`, clamped to 0..100 (Claude Code's percentLeft). */
  percentLeft: number | null
}

/**
 * Claude Code compatible context thresholds.
 *
 * `threshold` is the auto-compact line: `compaction.threshold` /
 * `compaction.threshold_percent` when the user configured them, otherwise
 * `effective - 13k`. Warning/error are 20k below it, and the hard blocking
 * limit is 3k below the effective window. When `compaction.auto` is disabled
 * the threshold moves up to the effective window so the UI can still warn
 * before the provider rejects a request.
 */
export function contextBudget(input: {
  cfg: Config.Info
  model: Provider.Model
  outputTokenMax?: number
  tokens?: number
}): ContextBudget {
  if (input.model.limit.context === 0) {
    return { effective: 0, threshold: 0, warning: 0, error: 0, blocking: 0, percentLeft: null }
  }
  const value = limits(input)
  const auto = input.cfg.compaction?.auto !== false
  const threshold = auto ? autoThreshold(input) : value.effective
  const count = input.tokens
  return {
    effective: value.effective,
    threshold,
    warning: Math.max(0, threshold - WARNING_THRESHOLD_BUFFER),
    error: Math.max(0, threshold - ERROR_THRESHOLD_BUFFER),
    blocking: Math.max(0, value.effective - MANUAL_COMPACT_BUFFER),
    percentLeft:
      count === undefined || threshold <= 0
        ? null
        : Math.max(0, Math.min(100, Math.round(((threshold - count) / threshold) * 100))),
  }
}

export function isOverflow(input: {
  cfg: Config.Info
  tokens: MessageV2.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
  return count >= usable(input)
}

/**
 * 估算「上一条 assistant 的 usage 之后又新增了多少输入」。
 *
 * assistant 的 usage 只覆盖它自己那次请求；工具在响应结束后执行，
 * 它们的输出要到下一次请求才会变成 input。若只看 usage，大工具输出
 * （读大文件、跑命令、MCP 查询）会直到下一次 413 才被发现。
 *
 * 这里只遍历最近一条 assistant 的工具结果和它之后的新消息，成本与
 * 会话长度无关；结果用于把「实际 usage + 待发送增量」一起和阈值比较。
 */
export function pendingTokens(input: { messages: MessageV2.WithParts[]; finishedID: MessageID }) {
  const index = input.messages.findLastIndex((message) => message.info.id === input.finishedID)
  if (index < 0) return 0

  let total = 0
  const addPart = (part: MessageV2.Part) => {
    if (part.type === "tool") {
      if (part.state.status === "completed") total += Token.estimate(part.state.output)
      return
    }
    if (part.type === "text") {
      if (!part.ignored) total += Token.estimate(part.text)
      return
    }
    if (part.type === "file") {
      total += MessageV2.isMedia(part.mime) ? 1_500 : Token.estimate(part.url)
    }
  }

  // 最近一条 assistant 请求之后执行的工具结果。它自己的文本/推理已经
  // 计入 usage，不能重复计算。
  for (const part of input.messages[index].parts) {
    if (part.type === "tool" && part.state.status === "completed") {
      total += Token.estimate(part.state.output)
    }
  }
  // 它之后新增的消息（邮箱消息、新用户输入等）。
  for (const message of input.messages.slice(index + 1)) {
    for (const part of message.parts) addPart(part)
  }
  return total
}
