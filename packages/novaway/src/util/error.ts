import { isRecord } from "./record"

export function errorFormat(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`
  }

  if (typeof error === "object" && error !== null) {
    try {
      const json = JSON.stringify(error, null, 2)
      // Plain objects whose own properties are all non-enumerable (or empty)
      // serialize to "{}", which prints as a useless bare `{}` on stderr.
      // Fall back to a custom toString first, then to ctor name + own prop names.
      if (json === "{}") {
        const str = String(error)
        if (str && str !== "[object Object]") return str
        const ctor = error.constructor?.name
        const prefix = ctor && ctor !== "Object" ? ctor : "Error"
        const names = Object.getOwnPropertyNames(error)
        return names.length === 0 ? `${prefix} (no message)` : `${prefix} { ${names.join(", ")} }`
      }
      return json
    } catch {
      return "Unexpected error (unserializable)"
    }
  }

  return String(error)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message) return error.message
    if (error.name) return error.name
  }

  if (isRecord(error) && typeof error.message === "string" && error.message) {
    return error.message
  }

  if (isRecord(error) && isRecord(error.data) && typeof error.data.message === "string" && error.data.message) {
    return error.data.message
  }

  const text = String(error)
  if (text && text !== "[object Object]") return text

  const formatted = errorFormat(error)
  if (formatted) return formatted
  return "unknown error"
}

export function errorData(error: unknown) {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: errorMessage(error),
      stack: error.stack,
      cause: error.cause === undefined ? undefined : errorFormat(error.cause),
      formatted: errorFormat(error),
    }
  }

  if (!isRecord(error)) {
    return {
      type: typeof error,
      message: errorMessage(error),
      formatted: errorFormat(error),
    }
  }

  const data = Object.getOwnPropertyNames(error).reduce<Record<string, unknown>>((acc, key) => {
    const value = error[key]
    if (value === undefined) return acc
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      acc[key] = value
      return acc
    }
    // oxlint-disable-next-line no-base-to-string -- intentional coercion of arbitrary error properties
    acc[key] = value instanceof Error ? value.message : String(value)
    return acc
  }, {})

  if (typeof data.message !== "string") data.message = errorMessage(error)
  if (typeof data.type !== "string") data.type = error.constructor?.name
  data.formatted = errorFormat(error)
  return data
}

/**
 * 把"没有原因"的错误文案换成一句能读的话。
 *
 * 不少供应商在流式中断/网关错误时返回空的 message，或者干脆返回字符串
 * `<none>` / `null` —— 直接展示给用户就变成界面上一个 `<none>`。
 * 这里按 HTTP 状态给一句人话，状态也没有时给一句通用说明。
 */
export function describeError(input: { message?: unknown; statusCode?: unknown }) {
  const raw = typeof input.message === "string" ? input.message.trim() : ""
  const meaningless =
    !raw || /^<?none>?$/i.test(raw) || raw === "undefined" || raw === "null" || raw === "[object Object]"
  if (!meaningless) return raw
  const status = typeof input.statusCode === "number" ? input.statusCode : undefined
  if (status === 401 || status === 403) return `模型服务拒绝了这次请求（HTTP ${status}），请检查供应商的 API Key`
  if (status === 404) return `模型不存在或已下线（HTTP ${status}），换一个模型试试`
  if (status === 429) return `模型服务限流了（HTTP ${status}），稍后会自动重试`
  if (status !== undefined && status >= 500) return `模型服务暂时不可用（HTTP ${status}），稍后会自动重试`
  if (status !== undefined) return `模型服务返回了错误（HTTP ${status}），且没有给出原因`
  return "模型服务没有返回失败原因，可能是连接被中断"
}
