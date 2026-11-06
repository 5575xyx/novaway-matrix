/**
 * 错误模型（插件文档 §5.5）。
 *
 * 加码不删码：错误码与 `apiVersion` 一起演进，已发布的码永远保留。
 */
export type PluginErrorCode =
  | "capability_denied"
  | "api_version"
  | "activation_failed"
  | "contribution_invalid"
  | "tool_unavailable"
  | "timeout"
  | "circuit_open"
  | "storage_conflict"
  | "transport"

export interface PluginError extends Error {
  code: PluginErrorCode
  pluginID?: string
  contributionID?: string
  retryable?: boolean
}

export const pluginErrorCodes = [
  "capability_denied",
  "api_version",
  "activation_failed",
  "contribution_invalid",
  "tool_unavailable",
  "timeout",
  "circuit_open",
  "storage_conflict",
  "transport",
] as const satisfies readonly PluginErrorCode[]

/**
 * `tool_unavailable` 是正常路径（插件文档 §4.9）：调用方必须处理，它不算插件故障，也不触发熔断。
 */
export function isPluginError(error: unknown): error is PluginError {
  if (typeof error !== "object" || error === null) return false
  const code = (error as { code?: unknown }).code
  return typeof code === "string" && (pluginErrorCodes as readonly string[]).includes(code)
}
