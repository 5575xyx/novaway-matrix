import type { JSONSchema } from "./json"

/**
 * 宿主与插件之间传递的数据结构（插件文档 §5）。
 *
 * **对齐规则**：带内核对应物的 DTO 逐字段镜像内核的**公开 wire 形状**（HTTP API 返回的就是它），
 * 只把 branded ID 换成 `string`、把 Effect Schema 类推平成结构类型——plugin-api 不许 import 内核
 * （§2.2 规则 1），所以是镜像而不是引用。字段名保持一致，宿主侧适配器因此是直通而不是翻译。
 *
 * 文档与内核都还没有对应物的（`OAuthSpec` / `PublishAutomationSpec` / `PluginHttpRequest` /
 * `PluginHttpResponse` / `SchedulerContext`）保持开放，由真正实现那个贡献点的里程碑定形；
 * 现在编一个形状出来只会让第一批作者照着写，然后被迫改两次。
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

/* 权限：镜像 `config/permission.ts` 的解码后形状与 `permission/index.ts` 的运行时规则集。 */

export type PermissionAction = "ask" | "allow" | "deny"

/** 配置里写 `"allow"` 或 `{ "*.ts": "allow" }`；解码后前者归一成 `{ "*": "allow" }`。 */
export type PermissionRuleConfig = PermissionAction | Record<string, PermissionAction>

/**
 * 不枚举已知权限键（`read` / `edit` / `bash` / `skill` …）：内核加一个键不该要求插件 API 跟着发版，
 * 而插件能写的键本来就由宿主在调用点裁定（§5.4）。
 */
export type PermissionConfig = Record<string, PermissionRuleConfig>

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions" | "unattended"

/** 运行时规则集（`Permission.Ruleset`）：会话上生效的那份，不是用户写的配置。 */
export type PermissionRule = {
  permission: string
  pattern: string
  action: PermissionAction
}

/* 会话：镜像 `session/session.ts` 的 `Session.Info`（HTTP `session.create` / `session.get` 的返回体）。 */

export type FileDiff = {
  file?: string
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export type SessionTokens = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export type SessionHandle = {
  id: string
  slug: string
  projectID: string
  workspaceID?: string
  directory: string
  path?: string
  parentID?: string
  summary?: { additions: number; deletions: number; files: number; diffs?: FileDiff[] }
  cost?: number
  tokens?: SessionTokens
  share?: { url: string }
  title: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  version: string
  /** 时间戳都在 `time` 下，不是 `time_created` 那种平铺列名。 */
  time: { created: number; updated: number; compacting?: number; archived?: number }
  permission?: PermissionRule[]
  permissionMode?: PermissionMode
  teamMode?: "off" | "auto" | "selected"
  teamIDs?: string[]
  employeeID?: string
  runID?: string
  revert?: { messageID: string; partID?: string; snapshot?: string; diff?: string; files?: FileDiff[] }
}

/* 消息：镜像 `session/message-v2.ts` 的 `WithParts`（HTTP `session.messages` / `session.prompt` 的返回体）。 */

/** `NamedError` 的 wire 形状是 `{ name, data }`；具体错误种别由内核演进，插件按 `name` 判别。 */
export type MessageError = {
  name: string
  data: Record<string, unknown>
}

export type OutputFormat =
  | { type: "text" }
  | { type: "json_schema"; schema: Record<string, unknown>; retryCount: number }

export type MessagePartBase = {
  id: string
  sessionID: string
  messageID: string
}

export type TextPart = MessagePartBase & {
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: { start: number; end?: number }
  metadata?: Record<string, unknown>
}

export type ReasoningPart = MessagePartBase & {
  type: "reasoning"
  text: string
  metadata?: Record<string, unknown>
  time: { start: number; end?: number }
}

export type LspPosition = { line: number; character: number }

export type FilePartSource = {
  text: { value: string; start: number; end: number }
} & (
  | { type: "file"; path: string }
  | { type: "symbol"; path: string; range: { start: LspPosition; end: LspPosition }; name: string; kind: number }
  | { type: "resource"; clientName: string; uri: string }
)

export type FilePart = MessagePartBase & {
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: FilePartSource
}

export type ToolState =
  | { status: "pending"; input: Record<string, unknown>; raw: string }
  | {
      status: "running"
      input: Record<string, unknown>
      title?: string
      metadata?: Record<string, unknown>
      time: { start: number }
    }
  | {
      status: "completed"
      input: Record<string, unknown>
      output: string
      title: string
      metadata: Record<string, unknown>
      time: { start: number; end: number; compacted?: number }
      attachments?: FilePart[]
    }
  | {
      status: "error"
      input: Record<string, unknown>
      error: string
      metadata?: Record<string, unknown>
      time: { start: number; end?: number }
    }

export type ToolPart = MessagePartBase & {
  type: "tool"
  callID: string
  tool: string
  state: ToolState
  metadata?: Record<string, unknown>
}

export type SubtaskPart = MessagePartBase & {
  type: "subtask"
  prompt: string
  description: string
  agent: string
  model?: ModelRef
  command?: string
}

export type AgentPart = MessagePartBase & {
  type: "agent"
  name: string
  source?: { value: string; start: number; end: number }
}

export type SnapshotPart = MessagePartBase & { type: "snapshot"; snapshot: string }

export type PatchPart = MessagePartBase & { type: "patch"; hash: string; files: string[] }

export type StepStartPart = MessagePartBase & { type: "step-start"; snapshot?: string }

export type StepFinishPart = MessagePartBase & {
  type: "step-finish"
  reason: string
  snapshot?: string
  cost: number
  tokens: { total?: number } & SessionTokens
}

export type RetryPart = MessagePartBase & {
  type: "retry"
  attempt: number
  error: MessageError
  time: { created: number }
}

export type CompactionPart = MessagePartBase & {
  type: "compaction"
  auto: boolean
  overflow?: boolean
  tail_start_id?: string
  instructions?: string
}

export type MessagePart =
  | TextPart
  | SubtaskPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart

export type UserMessageInfo = {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
  format?: OutputFormat
  summary?: { title?: string; body?: string; diffs: FileDiff[] }
  agent: string
  model: { providerID: string; modelID: string; variant?: string }
  system?: string
  tools?: Record<string, boolean>
  autoMode?: boolean
}

export type AssistantMessageInfo = {
  id: string
  sessionID: string
  role: "assistant"
  time: { created: number; completed?: number }
  error?: MessageError
  parentID: string
  modelID: string
  providerID: string
  /** @deprecated 内核保留字段，插件不要读。 */
  mode: string
  agent: string
  path: { cwd: string; root: string }
  summary?: boolean
  cost: number
  tokens: { total?: number } & SessionTokens
  structured?: unknown
  variant?: string
  finish?: string
}

export type MessageInfo = UserMessageInfo | AssistantMessageInfo

export type MessageDto = {
  info: MessageInfo
  parts: MessagePart[]
}

/** `session.prompt` 返回的就是落库后的那条 assistant 消息，内核没有第二种结果类型。 */
export type PromptResult = MessageDto

/* 工具：镜像 HTTP `ToolListItem`（`httpapi/groups/experimental.ts`），不是带 `execute` 的 `Tool.Def`。 */

export type ToolInfo = {
  id: string
  description: string
  parameters: JSONSchema
}

/* LLM 流：镜像 `packages/llm` 的 `LLMEvent`（JSON 安全的那一份），不引用 AI SDK 推导出来的类型。 */

export type FinishReason = "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"

/** 按 provider 名分组的原始载荷：`{ openai: {...} }`。 */
export type ProviderMetadata = Record<string, Record<string, unknown>>

/**  inclusive 总量 + 不重叠细分，语义见 `packages/llm/src/schema/events.ts` 的 `Usage`。 */
export type Usage = {
  inputTokens?: number
  outputTokens?: number
  nonCachedInputTokens?: number
  cacheReadInputTokens?: number
  cacheWriteInputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  providerMetadata?: ProviderMetadata
}

export type ToolResultValue = { type: "json" | "text" | "error"; value: unknown }

export type Chunk =
  | { type: "step-start"; index: number }
  | { type: "text-start"; id: string; providerMetadata?: ProviderMetadata }
  | { type: "text-delta"; id: string; text: string }
  | { type: "text-end"; id: string; providerMetadata?: ProviderMetadata }
  | { type: "reasoning-start"; id: string; providerMetadata?: ProviderMetadata }
  | { type: "reasoning-delta"; id: string; text: string }
  | { type: "reasoning-end"; id: string; providerMetadata?: ProviderMetadata }
  | { type: "tool-input-start"; id: string; name: string; providerMetadata?: ProviderMetadata }
  | { type: "tool-input-delta"; id: string; name: string; text: string }
  | { type: "tool-input-end"; id: string; name: string; providerMetadata?: ProviderMetadata }
  | {
      type: "tool-call"
      id: string
      name: string
      input: unknown
      providerExecuted?: boolean
      providerMetadata?: ProviderMetadata
    }
  | {
      type: "tool-result"
      id: string
      name: string
      result: ToolResultValue
      providerExecuted?: boolean
      providerMetadata?: ProviderMetadata
    }
  | {
      type: "tool-error"
      id: string
      name: string
      message: string
      error?: unknown
      providerMetadata?: ProviderMetadata
    }
  | { type: "step-finish"; index: number; reason: FinishReason; usage?: Usage; providerMetadata?: ProviderMetadata }
  | { type: "finish"; reason: FinishReason; usage?: Usage; providerMetadata?: ProviderMetadata }
  | { type: "provider-error"; message: string; retryable?: boolean; providerMetadata?: ProviderMetadata }

/* 后台任务：镜像 `background/job.ts` 的 `Info`（Bus 事件与 HTTP 共用同一份 schema）。 */

export type JobInfo = {
  id: string
  type: string
  title?: string
  status: "running" | "completed" | "error" | "cancelled"
  started_at: number
  completed_at?: number
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

/** 内核 `BackgroundJob.start` 返回的就是 `Info`，没有独立句柄类型；取消用 `info.id`。 */
export type JobHandle = JobInfo

/* 模型：镜像 `config/provider.ts` 的 `Model`——作者声明适配器时写的那份，全字段可选。 */

export type ModelModality = "text" | "audio" | "image" | "video" | "pdf"

export type ModelCost = {
  input: number
  output: number
  cache_read?: number
  cache_write?: number
  context_over_200k?: { input: number; output: number; cache_read?: number; cache_write?: number }
}

export type ModelInfo = {
  id?: string
  name?: string
  family?: string
  release_date?: string
  attachment?: boolean
  reasoning?: boolean
  temperature?: boolean
  tool_call?: boolean
  interleaved?: true | { field: "reasoning_content" | "reasoning_details" }
  cost?: ModelCost
  limit?: { context: number; input?: number; output: number }
  modalities?: { input?: ModelModality[]; output?: ModelModality[] }
  experimental?: boolean
  status?: "alpha" | "beta" | "deprecated" | "active"
  provider?: { npm?: string; api?: string }
  options?: Record<string, unknown>
  headers?: Record<string, string>
  variants?: Record<string, { disabled?: boolean } & Record<string, unknown>>
}

/* 以下五项文档与内核都还没有对应物，见文件头。 */

/** 内核的 OAuth 是回调式 `AuthHook`（`packages/plugin`），没有声明式 spec；由 provider 里程碑定形。 */
export type OAuthSpec = Record<string, unknown>
/** 发布自动化目前只活在技能脚本里，内核没有 typed spec；由 publish-driver 里程碑定形。 */
export type PublishAutomationSpec = Record<string, unknown>
/** 内核走 Effect HttpApi，没有可序列化的请求 DTO；由 http-route 里程碑定形。 */
export type PluginHttpRequest = Record<string, unknown>
export type PluginHttpResponse = Record<string, unknown>
/** 内核只有会话级 cron（`cron/service.ts`），没有插件调度上下文；由 `builtin.schedule`（M3）定形。 */
export type SchedulerContext = Record<string, unknown>
export type SchedulerRun = (ctx: SchedulerContext) => Promise<void>
