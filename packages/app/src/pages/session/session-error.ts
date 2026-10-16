/**
 * 会话错误的归类与"人话化"。
 *
 * 单独成一个模块（不 import 任何 UI/Kobalte）：这是纯字符串逻辑，
 * 需要能被单测直接覆盖。上游报错的形态太杂，分类规则必须能被回归测试锁住。
 */

/** 会话错误的归类，文案层按它取用户可读的说明。 */
export type ErrorKind =
  | "aborted"
  | "rateLimit"
  | "auth"
  | "upstream"
  | "model"
  | "network"
  | "context"
  | "unknown"

/**
 * 把一次会话错误归到有限的几类，让文案层能说人话。
 *
 * 上游报错的形态很杂：这次是 `custom stream failed 400: {"error":{"message":"upstream_400",…}}`，
 * 上次是 `custom stream failed 502: {…"auth.unavailable: no auth available"…}`，
 * 中间还可能是限流（`all eligible accounts are cooling down`）。
 * 与其在聊天区铺一整段 JSON，不如分类之后给一句"发生了什么 + 能做什么"，
 * 原始内容收进可展开的详情里。
 */
export function classifyError(message: string, name?: string): ErrorKind {
  const haystack = `${name ?? ""} ${readableErrorText(message)}`.toLowerCase()
  if (/abort/.test(haystack)) return "aborted"
  if (/rate.?limit|429|cooling down|cooldown|too many requests|quota/.test(haystack)) return "rateLimit"
  if (/no auth|unauthenticated|unauthorized|401|403|api.?key|auth\.unavailable|invalid.*credential/.test(haystack)) {
    return "auth"
  }
  if (/overload|503|502|500|upstream|service unavailable|server_error/.test(haystack)) return "upstream"
  if (/model.*not found|no such model|unknown model/.test(haystack)) return "model"
  if (/fetch failed|econnrefused|econnreset|etimedout|network|socket hang up|dns/.test(haystack)) return "network"
  if (/context.*(length|window)|too long|token.*limit/.test(haystack)) return "context"
  return "unknown"
}

/**
 * 从各类包装里抽出"人能读的那句话"。
 *
 * 输入可能是：纯文本、`Error: xxx`、一段 JSON、被 JSON 再包一层的字符串、
 * 或者前面带前缀的 JSON（`custom stream failed 400: {…}`）。逐层剥。
 */
export function readableErrorText(message: string): string {
  const text = message.replace(/^Error:\s*/, "").trim()

  const parse = (value: string) => {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return undefined
    }
  }

  const read = (value: string) => {
    const first = parse(value)
    if (typeof first !== "string") return first
    return parse(first.trim())
  }

  const slice = (value: string) => {
    const start = value.indexOf("{")
    const end = value.lastIndexOf("}")
    if (start === -1 || end <= start) return undefined
    return value.slice(start, end + 1)
  }

  let json = read(text)

  if (json === undefined) {
    const inner = slice(text)
    if (inner) json = read(inner)
  }

  if (json === undefined && text.includes('\\"')) {
    // 双重转义：整段 payload 被当成 JSON 字符串又转义了一层。
    const unescaped = text.replace(/\\"/g, '"').replace(/\\/g, "\\")
    const inner = slice(unescaped)
    if (inner) json = read(inner)
  }

  if (!record(json)) return text

  const err = record(json.error) ? json.error : undefined
  if (err) {
    const msg = typeof err.message === "string" ? err.message : undefined
    const type = typeof err.type === "string" ? err.type : undefined
    const code = err.code === undefined || err.code === null ? undefined : String(err.code)
    if (msg) return type && type !== msg ? `${msg} (${type})` : msg
    if (type) return type
    if (code) return code
  }

  const msg = typeof json.message === "string" ? json.message : undefined
  if (msg) return msg

  const reason = typeof json.error === "string" ? json.error : undefined
  if (reason) return reason

  return text
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
