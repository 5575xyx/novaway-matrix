import { NamedError } from "@novaway/core/util/error"
import { Cause, Clock, Duration, Effect, Schedule } from "effect"
import { MessageV2 } from "./message-v2"
import { iife } from "@/util/iife"
import { isRecord } from "@/util/record"
import { describeError } from "@/util/error"

export type Err = ReturnType<NamedError["toObject"]>

export const GO_UPSELL_MESSAGE = "Free usage exceeded, subscribe to Go"
export const GO_UPSELL_URL = "https://opencode.ai/go"
export type RetryReason = "free_tier_limit" | "account_rate_limit" | (string & {})

/**
 * 错误分类，决定「还能重试几次」。
 *
 * - `overload`：供应商过载（529 / `Overloaded` / `resource_exhausted`）。
 *   连续几次过载说明上游确实没容量了，继续等只是让用户盯着转圈。
 * - `transport`：连接中途被掐断（unexpected EOF / socket hang up）。
 * - `rate_limit`：限流，通常带 `retry-after`。
 * - `server`：其余 5xx。
 */
export type RetryKind = "overload" | "transport" | "rate_limit" | "server"

export type Retryable = {
  message: string
  kind: RetryKind
  action?: {
    reason: RetryReason
    provider: string
    title: string
    message: string
    label: string
    link?: string
  }
}

export const RETRY_INITIAL_DELAY = 2000
export const RETRY_BACKOFF_FACTOR = 2
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
export const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout

/**
 * 单次请求最多自动重试几次（对齐 CC 的 `DEFAULT_MAX_RETRIES = 10`）。
 * 以前 5xx 不设上限，供应商长时间不可用时界面会一直转圈，用户不知道
 * 是「还在努力」还是「已经卡死」。
 */
export const MAX_API_ATTEMPTS = 10

/** 连续过载几次就停止自动重试（对齐 CC 的 `MAX_529_RETRIES = 3`）。 */
export const MAX_OVERLOAD_ATTEMPTS = 3

/**
 * 重试过程中的计数。由 `policy()` 写入，调用方在请求失败后读取，
 * 用来把「停了」这件事说清楚（而不是丢一句供应商原文）。
 * 每次新的请求都要 `reset()`。
 */
export type Tracker = {
  attempts: number
  overloads: number
  exhausted?: "attempts" | "overload"
}

export function tracker(): Tracker {
  return { attempts: 0, overloads: 0 }
}

export function reset(value: Tracker) {
  value.attempts = 0
  value.overloads = 0
  value.exhausted = undefined
}

/**
 * 停止自动重试时，把供应商原文换成一句能照做的话。
 *
 * 「重试到一半不试了」是用户最容易被误导的时刻：界面停住但没有解释，
 * 看起来像卡死。这里只替换 message，保留 statusCode / responseHeaders，
 * 其余诊断信息仍然完整。
 */
export function explain<T extends Err>(error: T, value: Tracker): T {
  if (!value.exhausted) return error
  const message =
    value.exhausted === "overload"
      ? `供应商连续 ${value.overloads} 次过载，已停止自动重试。稍后再试，或在模型选择里换一个模型/供应商。`
      : `已自动重试 ${value.attempts} 次仍未成功。稍后再试，或在模型选择里换一个模型/供应商。`
  // 返回的是"同一类错误、换一句人话"，调用方据此把错误挂回消息；
  // 泛型只是让 `assistantMessage.error` 的联合类型不被擦成宽泛的 Err。
  if (MessageV2.APIError.isInstance(error)) {
    return new MessageV2.APIError({ ...error.data, message, isRetryable: false }).toObject() as T
  }
  return new NamedError.Unknown({ message }).toObject() as T
}

function cap(ms: number) {
  return Math.min(ms, RETRY_MAX_DELAY)
}

export function delay(attempt: number, error?: MessageV2.APIError) {
  if (error) {
    const headers = error.data.responseHeaders
    if (headers) {
      const retryAfterMs = headers["retry-after-ms"]
      if (retryAfterMs) {
        const parsedMs = Number.parseFloat(retryAfterMs)
        if (!Number.isNaN(parsedMs)) {
          return cap(parsedMs)
        }
      }

      const retryAfter = headers["retry-after"]
      if (retryAfter) {
        const parsedSeconds = Number.parseFloat(retryAfter)
        if (!Number.isNaN(parsedSeconds)) {
          // convert seconds to milliseconds
          return cap(Math.ceil(parsedSeconds * 1000))
        }
        // Try parsing as HTTP date format
        const parsed = Date.parse(retryAfter) - Date.now()
        if (!Number.isNaN(parsed) && parsed > 0) {
          return cap(Math.ceil(parsed))
        }
      }

      return cap(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1))
    }
  }

  return cap(Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS))
}

/**
 * 传输层"连接中途断掉"的错误特征。
 *
 * 这类错误不是模型业务错误：上游把 SSE 流掐断、代理超时、socket 被重置时，
 * 客户端拿到的是 `unexpected EOF` / `socket hang up` / `terminated` 这类文本
 * （Bun 的 fetch 与各 provider SDK 各自措辞不同）。它们以前会被判成 `Unknown`
 * 直接终止整轮，表现就是"任务老是中断、必须点继续"。这里统一按可重试处理：
 * 换个连接重发一次通常就好了，对齐其他 agent 的透明重试行为。
 */
const TRANSIENT_STREAM_ERROR =
  /unexpected eof|socket hang up|econnreset|connection reset|other side closed|premature close|terminated|fetch failed|network error|network_error|stream ended|stream closed|upstream connect error|bad gateway|service unavailable|gateway timeout|temporarily unavailable|timed out|timeout|stream idle|no chunks received|without receiving any events|before producing any content/i

/** 传输层错误最多自动重试这么多次；再多就交给用户决定（继续/换模型）。 */
export const MAX_TRANSIENT_ATTEMPTS = 5

/**
 * 这条错误是不是"连接中途被掐断"。
 *
 * 上游代理/网关经常把流中断包装成 HTTP 400 的 APIError(`custom stream failed
 * 400: {"error":{"message":"upstream_400"}}`、`unexpected EOF`),SDK 因此标记为
 * 不可重试;但它们本质是传输层问题,重连一次通常就好。这里统一识别出来,
 * 让它们和裸的 stream 错误一样走透明重试。
 */
export function isTransientStreamError(error: Err) {
  if (MessageV2.APIError.isInstance(error)) {
    const values = [error.data.message, error.data.responseBody]
    if (values.some((value) => typeof value === "string" && TRANSIENT_STREAM_ERROR.test(value))) return true
    return false
  }
  const raw = isRecord(error.data) && typeof error.data.message === "string" ? error.data.message : undefined
  return typeof raw === "string" && TRANSIENT_STREAM_ERROR.test(raw)
}

/**
 * 供应商过载：529 是 Anthropic 的专用状态码，其余厂商大多把同一件事表达在
 * 正文里（`Overloaded` / `resource_exhausted`）。
 */
export function isOverload(error: Err) {
  if (MessageV2.APIError.isInstance(error)) {
    if (error.data.statusCode === 529) return true
    const text = `${error.data.message ?? ""} ${error.data.responseBody ?? ""}`
    return /overload|resource[_ ]exhausted|capacity/i.test(text)
  }
  const raw = isRecord(error.data) && typeof error.data.message === "string" ? error.data.message : ""
  return /overload|resource[_ ]exhausted|capacity/i.test(raw)
}

export function retryable(error: Err, provider: string) {
  // context overflow errors should not be retried
  if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
  if (MessageV2.APIError.isInstance(error)) {
    const status = error.data.statusCode
    // 5xx errors are transient server failures and should always be retried,
    // even when the provider SDK doesn't explicitly mark them as retryable.
    // 传输层中断同理:即便上游把它包装成 4xx,也重连一次再判断。
    if (!error.data.isRetryable && !(status !== undefined && status >= 500) && !isTransientStreamError(error))
      return undefined
    if (isTransientStreamError(error) && !error.data.isRetryable && !(status !== undefined && status >= 500)) {
      return { kind: "transport", message: `连接被中断（${error.data.message ?? "stream error"}），正在自动重试` }
    }
    if (error.data.responseBody?.includes("FreeUsageLimitError")) {
      const retryAfter = num(error.data.responseHeaders?.["retry-after"])
      const resetIn = iife(() => {
        if (retryAfter === undefined) return ""
        const seconds = Math.max(0, Math.ceil(retryAfter))
        const days = Math.floor(seconds / 86_400)
        const hours = Math.floor((seconds % 86_400) / 3_600)
        const minutes = Math.ceil((seconds % 3_600) / 60)

        if (days > 0) return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`
        if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`
        return minutes > 0 ? `${minutes} 分钟` : "不到 1 分钟"
      })

      // 内置免费模型走公共免费通道(opencode Zen 匿名层),限额按出口 IP 每日共享。
      // 只在重试状态条给一句短文案,不弹窗不打断 —— 原因和恢复时间都压缩在这一句里。
      const message = resetIn
        ? `公共免费通道今日额度已用完，${resetIn} 后重置；可先切换其他模型`
        : "公共免费通道今日额度已用完，每天重置；可先切换其他模型"
      return { kind: "rate_limit", message }
    }
    if (error.data.responseBody?.includes("GoUsageLimitError")) {
      const body = parseJSON(error.data.responseBody)
      const workspace = str(body?.metadata?.workspace)
      const limitName = str(body?.metadata?.limitName)
      const retryAfter = num(error.data.responseHeaders?.["retry-after"])
      const resetIn = iife(() => {
        if (retryAfter === undefined) return ""
        const seconds = Math.max(0, Math.ceil(retryAfter))
        const days = Math.floor(seconds / 86_400)
        const hours = Math.floor((seconds % 86_400) / 3_600)
        const minutes = Math.ceil((seconds % 3_600) / 60)
        const unit = (value: number, name: string) => `${value} ${name}${value === 1 ? "" : "s"}`

        if (days > 0) return hours > 0 ? `${unit(days, "day")} ${unit(hours, "hour")}` : unit(days, "day")
        if (hours > 0) return minutes > 0 ? `${unit(hours, "hour")} ${unit(minutes, "minute")}` : unit(hours, "hour")
        return minutes > 0 ? unit(minutes, "minute") : "less than a minute"
      })

      const message = `${limitName ? `${limitName} usage limit` : "Usage limit"} reached. It will reset in ${resetIn}. To continue using this model now, enable usage from your available balance`

      const link = `https://opencode.ai/workspace/${workspace}/go`
      return {
        kind: "rate_limit",
        message: `${message} - ${link}`,
        action: {
          reason: "account_rate_limit",
          provider,
          title: "Go limit reached",
          message,
          label: "open settings",
          link,
        },
      }
    }
    // 过载单独归类：连续几次过载就停止重试，而不是按 5xx 一直等到次数上限。
    // CC 的 `is529Error` 覆盖的正是这条路径（`MAX_529_RETRIES = 3`）。
    if (isOverload(error)) {
      return { kind: "overload", message: "Provider is overloaded" }
    }
    return {
      kind: status === 429 ? "rate_limit" : "server",
      message: describeError({ message: error.data.message, statusCode: error.data.statusCode }),
    }
  }

  // 非 APIError：连接中途断开（unexpected EOF / socket hang up…）按可重试处理。
  // 只认已知的传输层措辞，避免把真正的业务错误无限重试。
  const raw = isRecord(error.data) && typeof error.data.message === "string" ? error.data.message : undefined
  if (typeof raw === "string" && TRANSIENT_STREAM_ERROR.test(raw)) {
    return { kind: "transport", message: `连接中断（${raw}），正在自动重试` }
  }

  // Check for rate limit patterns in plain text error messages
  const msg = isRecord(error.data) ? error.data.message : undefined
  if (typeof msg === "string") {
    const lower = msg.toLowerCase()
    if (
      lower.includes("rate increased too quickly") ||
      lower.includes("rate limit") ||
      lower.includes("too many requests")
    ) {
      return { kind: "rate_limit", message: msg }
    }
  }

  const json = parseJSON(msg)
  if (!json || typeof json !== "object") return undefined
  const code = typeof json.code === "string" ? json.code : ""

  if (json.type === "error" && json.error?.type === "too_many_requests") {
    return { kind: "rate_limit", message: "Too Many Requests" }
  }
  if (code.includes("exhausted") || code.includes("unavailable")) {
    return { kind: "overload", message: "Provider is overloaded" }
  }
  if (json.type === "error" && typeof json.error?.code === "string" && json.error.code.includes("rate_limit")) {
    return { kind: "rate_limit", message: "Rate Limited" }
  }
  return undefined
}

function str(value: unknown) {
  if (value === undefined || value === null) return ""
  return String(value)
}

function num(value: unknown) {
  const parsed = Number.parseFloat(str(value))
  if (Number.isNaN(parsed)) return undefined
  return parsed
}

function parseJSON(value: unknown) {
  return iife(() => {
    try {
      if (typeof value !== "string") return undefined
      return JSON.parse(value)
    } catch {
      return undefined
    }
  })
}

export function policy(opts: {
  provider: string
  parse: (error: unknown) => Err
  set: (input: { attempt: number; message: string; action?: Retryable["action"]; next: number }) => Effect.Effect<void>
  /** 记录重试过程；最终失败时调用方用它说明「为什么停了」。 */
  tracker?: Tracker
}) {
  return Schedule.fromStepWithMetadata(
    Effect.succeed((meta: Schedule.InputMetadata<unknown>) => {
      const error = opts.parse(meta.input)
      const retry = retryable(error, opts.provider)
      const state = opts.tracker
      if (state) {
        state.attempts = meta.attempt
        state.overloads = retry?.kind === "overload" ? state.overloads + 1 : 0
      }
      if (!retry) return Cause.done(meta.attempt)
      // 连续过载说明上游真的没容量：再等下去只是让界面一直转圈。
      // 对齐 CC 的 `MAX_529_RETRIES = 3`。
      if (retry.kind === "overload" && state && state.overloads >= MAX_OVERLOAD_ATTEMPTS) {
        state.exhausted = "overload"
        return Cause.done(meta.attempt)
      }
      // 传输层错误更早放弃：一直重连不成功说明网络/供应商真的不可用，
      // 把决定权交回用户（界面上的「继续」）。
      // 5xx 这类 HTTP 错误也必须有上限（对齐 CC 的 `DEFAULT_MAX_RETRIES = 10`）。
      const limit = retry.kind === "transport" ? MAX_TRANSIENT_ATTEMPTS : MAX_API_ATTEMPTS
      if (meta.attempt > limit) {
        // `meta.attempt` 是「第几次失败」，真正做过的重试次数是 limit 次。
        if (state) {
          state.attempts = limit
          state.exhausted = "attempts"
        }
        return Cause.done(meta.attempt)
      }
      return Effect.gen(function* () {
        const wait = delay(meta.attempt, MessageV2.APIError.isInstance(error) ? error : undefined)
        const now = yield* Clock.currentTimeMillis
        yield* opts.set({
          attempt: meta.attempt,
          message: retry.message,
          action: retry.action,
          next: now + wait,
        })
        return [meta.attempt, Duration.millis(wait)] as [number, Duration.Duration]
      })
    }),
  )
}

export * as SessionRetry from "./retry"
