/**
 * 宿主与插件之间传递的数据结构。
 *
 * 带字段的类型来自现有内核（迁移时保持同名，见插件文档 §4.2 对 `tool/registry.ts` 的约束）；
 * 标了 `TODO(§14.3-8)` 的是文档尚未定形的 DTO，必须在 `plugin/runtime/context.ts` 落地前与内核 schema 对齐。
 */

export type ModelRef = {
  providerID: string
  modelID: string
}

export type ToolAttachment = {
  type: "file"
  mime: string
  url: string
  filename?: string
}

export type ToolResult =
  | string
  | {
      title?: string
      output: string
      metadata?: Record<string, unknown>
      attachments?: ToolAttachment[]
    }

export type PermissionAskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata?: Record<string, unknown>
}

export type ToolExecutionContext = {
  sessionID: string
  messageID: string
  agent: string
  /** 当前会话的项目目录；解析相对路径时优先用它，而不是 `process.cwd()`。 */
  directory: string
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): void
  ask(input: PermissionAskInput): Promise<void>
}

/** 插件自己的 KV 小状态；namespace 归属当前插件，越权写抛 `storage_conflict`（§5.4、§12.1）。 */
export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  set<T = unknown>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
}

/** 只能读写 `capabilities.secrets` 列出的 key（§5.4）。 */
export interface SecretStore {
  read(key: string): Promise<string | undefined>
  write(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

/** 请求前按 `capabilities.network` 主机白名单校验（§5.4）。 */
export interface HttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response>
}

/** `plugins.config.<pluginID>` 的只读切片。 */
export interface ConfigSlice {
  get<T = unknown>(key: string): T | undefined
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
}

/** TODO(§14.3-8) */
export type SessionHandle = Record<string, unknown>
/** TODO(§14.3-8) */
export type MessageDto = Record<string, unknown>
/** TODO(§14.3-8) */
export type PromptResult = Record<string, unknown>
/** TODO(§14.3-8) */
export type ToolInfo = Record<string, unknown>
/** TODO(§14.3-8) */
export type Chunk = Record<string, unknown>
/** TODO(§14.3-8) */
export type JobHandle = Record<string, unknown>
/** TODO(§14.3-8) */
export type JobInfo = Record<string, unknown>
/** TODO(§14.3-8) */
export type ModelInfo = Record<string, unknown>
/** TODO(§14.3-8) */
export type PermissionConfig = Record<string, unknown>
/** TODO(§14.3-8) */
export type OAuthSpec = Record<string, unknown>
/** TODO(§14.3-8) */
export type PublishAutomationSpec = Record<string, unknown>
/** TODO(§14.3-8) */
export type PluginHttpRequest = Record<string, unknown>
/** TODO(§14.3-8) */
export type PluginHttpResponse = Record<string, unknown>
/** TODO(§14.3-8) */
export type SchedulerContext = Record<string, unknown>
/** TODO(§14.3-8) */
export type SchedulerRun = (ctx: SchedulerContext) => Promise<void>
