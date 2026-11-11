/**
 * 错误模型（插件文档 §5.5）。
 *
 * 加码不删码：错误码与 `apiVersion` 一起演进，已发布的码永远保留。
 */
export type PluginErrorCode =
  | "capability_denied"
  | "api_version"
  | "activation_failed"
  | "cleanup_failed"
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
  "cleanup_failed",
  "contribution_invalid",
  "tool_unavailable",
  "timeout",
  "circuit_open",
  "storage_conflict",
  "transport",
] as const satisfies readonly PluginErrorCode[]

/**
 * 宿主与插件共用同一个构造入口：错误分类靠 `code`，不靠解析 message。
 *
 * 用 `Error`  subclass 而不是普通对象，`catch` 到的东西才能既保留堆栈又被宿主策略化。
 */
export class PluginErrorImpl extends Error implements PluginError {
  constructor(
    public readonly code: PluginErrorCode,
    message: string,
    public readonly pluginID?: string,
    public readonly contributionID?: string,
    public readonly retryable?: boolean,
  ) {
    super(message)
    this.name = "PluginError"
  }
}

export function pluginError(
  code: PluginErrorCode,
  message: string,
  input?: { pluginID?: string; contributionID?: string; retryable?: boolean },
): PluginError {
  return new PluginErrorImpl(code, message, input?.pluginID, input?.contributionID, input?.retryable)
}

/**
 * `tool_unavailable` 是正常路径（插件文档 §4.9）：调用方必须处理，它不算插件故障，也不触发熔断。
 */
export function isPluginError(error: unknown): error is PluginError {
  if (typeof error !== "object" || error === null) return false
  const code = (error as { code?: unknown }).code
  return typeof code === "string" && (pluginErrorCodes as readonly string[]).includes(code)
}
