import type { JSONSchema } from "./json"
import type { Disposable } from "./registry"
import type {
  ModelInfo,
  ModelRef,
  OAuthSpec,
  PermissionConfig,
  PluginHttpResponse,
  PluginHttpRequest,
  PublishAutomationSpec,
  SchedulerRun,
  ToolExecutionContext,
  ToolResult,
} from "./dto"

/** 贡献项的作者名（不含命名空间前缀）；最终名按 §4.8 `resolveName()` 计算。 */
export type LocalName = string

/** 内核工具默认值取最保守：缺省即「写操作 + 串行 + 需确认 + 不重试」（§4.2）。 */
export type ToolSafety = {
  readOnly?: boolean
  concurrencySafe?: boolean
  destructive?: boolean
  idempotent?: boolean
  maxResultBytes?: number
  deferLoading?: boolean
  searchHint?: string
  interrupt?: "cancel" | "abort"
}

export const toolSafetyDefaults = {
  readOnly: false,
  concurrencySafe: false,
  destructive: true,
  idempotent: false,
  maxResultBytes: 20_000,
  deferLoading: false,
} as const satisfies Required<Omit<ToolSafety, "searchHint" | "interrupt">>

/**
 * `Args` 只给作者侧标注参数形状用；注册表仍按 `ToolContribution`（= `unknown`）收集。
 * `execute` 是方法语法，参数双变，所以窄化后的贡献项能直接 `register`。
 */
export type ToolContribution<Args = unknown> = {
  id: LocalName
  description: string
  parameters: JSONSchema
  safety?: ToolSafety
  /** 为 `true` 时保留原名（内置插件迁移期用，§4.8、Q2）。 */
  global?: boolean
  execute(args: Args, ctx: ToolExecutionContext): Promise<ToolResult>
}

export type AgentContribution = {
  id: LocalName
  description: string
  mode: "primary" | "subagent"
  prompt: string | { file: string }
  /** 只写最终名；跨插件引用用 `plugin:local`，加载时展开（§4.3）。 */
  tools?: string[]
  disallowedTools?: string[]
  permission?: PermissionConfig
  options?: { displayName?: string; category?: string; modeGroup?: string; scene?: string }
  model?: ModelRef
  global?: boolean
}

/** Skill 是目录索引，不执行代码（§4.12）。 */
export type SkillContribution = {
  id: LocalName
  source: { file: string } | { text: string }
  description: string
  allowedTools?: string[]
  metadata?: Record<string, string>
  global?: boolean
}

export type CommandContribution = {
  id: LocalName
  description: string
  /** 模板正文，支持 `$ARGUMENTS` / `$1..$9`。 */
  template: string
  argumentHint?: string
  model?: string
  agent?: string
  subtask?: boolean
  global?: boolean
}

/** 与生命周期 Hook 严格分开（Q3）；Hook 走 `lifecycle-hooks`，见 manifest 的 `lifecycleHooks`。 */
export type InterceptorHook =
  | "chat.message"
  | "chat.params"
  | "chat.headers"
  | "tool.definition"
  | "tool.execute.before"
  | "tool.execute.after"
  | "permission.ask"
  | "command.execute.before"
  | "shell.env"
  | "event"

export type InterceptorRegistration = {
  id: LocalName
  hook: InterceptorHook
  handler: (input: unknown, output: unknown) => void | Promise<void>
  /** 只对某些工具/Agent 生效，减少无关调用。 */
  filter?: { tool?: string[]; agent?: string[] }
}

/**
 * Provider 适配器（§4.4）。
 *
 * `LanguageModel` 由内核用 AI SDK 的模型类型实例化；plugin-api 不许依赖 SDK，所以在这里保持参数化。
 */
export type ProviderAdapter<LanguageModel = unknown> = {
  id: LocalName
  name: string
  sdk?: string | { package: string; factory: string }
  auth?: {
    type: "api" | "oauth" | "env"
    key?: string[]
    oauth?: OAuthSpec
  }
  models?: Record<string, ModelInfo> | (() => Promise<Record<string, ModelInfo>>)
  discoverModels?: (input: { apiKey: string; baseURL: string }) => Promise<Record<string, ModelInfo>>
  transform?: {
    languageModel?: (model: LanguageModel, options: Record<string, unknown>) => LanguageModel
    headers?: (input: { modelID: string; apiKey: string }) => Record<string, string>
    params?: (input: { modelID: string }) => Record<string, unknown>
  }
  options?: { baseURL?: string; requireZeroPricing?: boolean; freeTier?: boolean }
  quirks?: { toolChoice?: boolean; systemRole?: "system" | "developer"; reasoning?: boolean }
}

export type OfficeFormatKind = "document" | "spreadsheet" | "presentation" | "pdf" | "richtext" | "plaintext"

/** `engine` 的契约沿用 `packages/core/src/office/engine/contract.ts`（§4.5）。 */
export type OfficeEngineContribution<Engine = unknown> = {
  format: string
  kind: OfficeFormatKind
  extensions: string[]
  aliases?: Record<string, string>
  readOnly?: boolean
  engine: Engine
}

export type PublishKind = "video" | "image_text" | "article"

export type PublishAccount = {
  id: string
  label: string
  profile: Record<string, unknown>
  token: string
}

/** Runtime methods are only consumed by the trusted builtin host bridge. */
export type PublishRuntime = {
  login?: (input: { profile?: Record<string, unknown> }) => Promise<PublishAccount>
  publish?: (input: {
    account: PublishAccount
    kind: PublishKind
    payload: Record<string, unknown>
  }) => Promise<Record<string, unknown>>
}

export type PublishDriverContribution = {
  id: LocalName
  name: string
  icon?: string
  hosts?: string[]
  supports: PublishKind[]
  urls: Partial<Record<PublishKind, string>>
  editorUrl?: (token: string) => string
  automation: PublishAutomationSpec
  account: { login: "oauth" | "qrcode" | "cookie"; profileFields: string[] }
  ui?: { accent?: string; docs?: string }
  runtime?: PublishRuntime
}

/** 声明式设置分组的最小字段集（§4.7）。 */
export type SettingsField =
  | { key: string; type: "text" | "secret" | "number"; label: string; placeholder?: string }
  | { key: string; type: "boolean"; label: string; default?: boolean }
  | { key: string; type: "select"; label: string; options: string[]; default?: string }
  | { key: string; type: "list"; label: string; item: "text" | "secret" }

/** Slot 目录（§9.2）。`file.previewer` 不在这里，它由 PreviewRegistry 单独匹配。 */
export type SurfaceSlot =
  | "sidebar.item"
  | "sidebar.footer"
  | "settings.section"
  | "session.panel"
  | "message.part.renderer"
  | "composer.action"
  | "statusbar.item"
  | "home.card"
  | "notification.item"

export type SurfaceAction =
  | { type: "view"; viewId: string }
  | { type: "command"; command: string }
  | { type: "url"; url: string }

export type SurfaceContribution =
  | {
      slot: "sidebar.item"
      id: LocalName
      title: string
      icon: string
      accent?: string
      order?: number
      action: SurfaceAction
    }
  | {
      slot: "settings.section"
      id: LocalName
      title: string
      description?: string
      order?: number
      view: { type: "declarative"; fields: SettingsField[] } | { type: "view"; viewId: string }
    }
  | {
      slot: "message.part.renderer"
      id: LocalName
      match: { tool?: string; partType?: string }
      renderer: { type: "builtin"; id: string } | { type: "iframe"; url: string }
    }
  | {
      slot:
        | "sidebar.footer"
        | "session.panel"
        | "statusbar.item"
        | "home.card"
        | "notification.item"
        | "composer.action"
      id: LocalName
      title: string
      order?: number
      action: SurfaceAction
    }

/** 第一方：App 里已有的组件 id；第三方：iframe 地址（§9.8）。 */
export type ViewContribution = {
  viewId: string
  title: string
  render: { type: "builtin"; component: string } | { type: "iframe"; url: string }
}

export type PreviewContribution = {
  id: LocalName
  match: { extension?: string | string[]; format?: string | string[]; mime?: string | string[] }
  viewId: string
  priority?: number
  readOnly?: boolean
}

export type McpServerContribution = {
  id: LocalName
  type: "local" | "remote"
  command?: string[]
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  /** 该 MCP 的工具是否默认进初始工具块。 */
  eager?: boolean
}

export type OutputStyleContribution = {
  id: LocalName
  name: string
  source: { file: string } | { text: string }
}

export type LspServerContribution = {
  id: LocalName
  languages: string[]
  command: string[]
  rootPatterns?: string[]
  initializationOptions?: unknown
  diagnostics?: "off" | "on-save" | "always"
}

export type SchedulerContribution = {
  id: LocalName
  schedule: { cron: string } | { everyMs: number }
  timezone?: string
  run: SchedulerRun
  catchUp?: boolean
}

export type EventSourceContribution = {
  id: LocalName
  kind: "fs" | "webhook" | "poll" | "custom"
  config?: JSONSchema
  start(emit: (event: { type: string; properties: unknown }) => void): Promise<Disposable>
}

/** 宿主自动加 `/plugin/<pluginID>` 前缀（Q18）。 */
export type HttpRouteContribution = {
  id: LocalName
  method: "GET" | "POST" | "PUT" | "DELETE"
  path: string
  handler: (req: PluginHttpRequest) => Promise<PluginHttpResponse>
  auth?: "none" | "session"
}
