import type { NamedError } from "@novaway/core/util/error"
import { Cause, Clock, Duration, Effect, Schedule } from "effect"
import { MessageV2 } from "./message-v2"
import { iife } from "@/util/iife"
import { isRecord } from "@/util/record"
import { describeError } from "@/util/error"

export type Err = ReturnType<NamedError["toObject"]>

export const GO_UPSELL_MESSAGE = "Free usage exceeded, subscribe to Go"
export const GO_UPSELL_URL = "https://opencode.ai/go"
export type RetryReason = "free_tier_limit" | "account_rate_limit" | (string & {})

export type Retryable = {
  message: string
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
  /unexpected eof|socket hang up|econnreset|connection reset|other side closed|premature close|terminated|fetch failed|network error|network_error|stream ended|stream closed|upstream connect error|bad gateway|service unavailable|gateway timeout|temporarily unavailable|timed out|timeout/i

/** 传输层错误最多自动重试这么多次；再多就交给用户决定（继续/换模型）。 */
export const MAX_TRANSIENT_ATTEMPTS = 5

export function retryable(error: Err, provider: string) {
  // context overflow errors should not be retried
  if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
  if (MessageV2.APIError.isInstance(error)) {
    const status = error.data.statusCode
    // 5xx errors are transient server failures and should always be retried,
    // even when the provider SDK doesn't explicitly mark them as retryable.
    if (!error.data.isRetryable && !(status !== undefined && status >= 500)) return undefined
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
      return { message }
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
    return {
      message: error.data.message?.includes("Overloaded")
        ? "Provider is overloaded"
        : describeError({ message: error.data.message, statusCode: error.data.statusCode }),
    }
  }

  // 非 APIError：连接中途断开（unexpected EOF / socket hang up…）按可重试处理。
  // 只认已知的传输层措辞，避免把真正的业务错误无限重试。
  const raw = isRecord(error.data) && typeof error.data.message === "string" ? error.data.message : undefined
  if (typeof raw === "string" && TRANSIENT_STREAM_ERROR.test(raw)) {
    return { message: `连接中断（${raw}），正在自动重试` }
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
      return { message: msg }
    }
  }

  const json = parseJSON(msg)
  if (!json || typeof json !== "object") return undefined
  const code = typeof json.code === "string" ? json.code : ""

  if (json.type === "error" && json.error?.type === "too_many_requests") {
    return { message: "Too Many Requests" }
  }
  if (code.includes("exhausted") || code.includes("unavailable")) {
    return { message: "Provider is overloaded" }
  }
  if (json.type === "error" && typeof json.error?.code === "string" && json.error.code.includes("rate_limit")) {
    return { message: "Rate Limited" }
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
}) {
  return Schedule.fromStepWithMetadata(
    Effect.succeed((meta: Schedule.InputMetadata<unknown>) => {
      const error = opts.parse(meta.input)
      const retry = retryable(error, opts.provider)
      if (!retry) return Cause.done(meta.attempt)
      // 传输层错误有次数上限：一直重连不成功说明网络/供应商真的不可用，
      // 把决定权交回用户（界面上的「继续」），而不是无限转圈。
      // 4xx/5xx 这类 HTTP 错误保持原有行为（由供应商的 retry-after 决定节奏）。
      if (!MessageV2.APIError.isInstance(error) && meta.attempt > MAX_TRANSIENT_ATTEMPTS) return Cause.done(meta.attempt)
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
