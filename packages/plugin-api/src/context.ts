import type {
  AgentContribution,
  CommandContribution,
  EventSourceContribution,
  InterceptorRegistration,
  OfficeEngineContribution,
  ProviderAdapter,
  PublishDriverContribution,
  SchedulerContribution,
  SkillContribution,
  SurfaceContribution,
  ToolContribution,
} from "./contributions"
import type {
  Chunk,
  ConfigSlice,
  HttpClient,
  JobHandle,
  JobInfo,
  Logger,
  MessageDto,
  ModelRef,
  PermissionAskInput,
  PluginStorage,
  PromptResult,
  SecretStore,
  SessionHandle,
  ToolInfo,
  ToolResult,
} from "./dto"
import type { Disposable, PluginScope, Registry, RestrictedRegistry } from "./registry"
import type { KernelApiSuperAgent } from "./superagent"

/**
 * 第一方插件（`scope: "builtin"`）拿到的特权 API（§5.2）。
 *
 * §3 的 #15–18（`mcp` / `output-style` / `lsp` / `http-route`）有内核侧注册表，但 §5.2 不把它们暴露成
 * 插件可写的字段：唯一消费者是宿主自己，插件走 manifest 声明（§7.4）即可。需要代码注册时再加字段。
 * 另外 API 用短名 `office` / `publish`，manifest 用长名 `officeEngines` / `publishDrivers`，映射只在 host 一处。
 */
export interface KernelApi extends KernelApiSuperAgent {
  readonly id: string
  readonly scope: PluginScope

  readonly tools: Registry<ToolContribution>
  readonly agents: Registry<AgentContribution>
  readonly skills: Registry<SkillContribution>
  readonly commands: Registry<CommandContribution>
  readonly providers: Registry<ProviderAdapter>
  readonly office: Registry<OfficeEngineContribution>
  readonly publish: Registry<PublishDriverContribution>
  readonly surfaces: Registry<SurfaceContribution>
  readonly interceptors: Registry<InterceptorRegistration>
  readonly schedulers: Registry<SchedulerContribution>
  readonly eventSources: Registry<EventSourceContribution>

  readonly sessions: {
    create(input: { title?: string; parentID?: string; agent?: string }): Promise<SessionHandle>
    prompt(input: { sessionID: string; text: string; agent?: string; model?: ModelRef }): Promise<PromptResult>
    messages(sessionID: string): Promise<MessageDto[]>
    abort(sessionID: string): Promise<void>
  }

  readonly toolRuntime: {
    execute(input: { tool: string; args: unknown; sessionID: string; agent: string }): Promise<ToolResult>
    list(input?: { sessionID?: string }): Promise<ToolInfo[]>
  }

  readonly llm: {
    stream(input: { model: ModelRef; messages: MessageDto[]; system?: string[] }): AsyncIterable<Chunk>
    complete(input: { model: ModelRef; messages: MessageDto[]; system?: string[] }): Promise<string>
  }

  readonly background: {
    start(input: { type: string; title?: string; run: (signal: AbortSignal) => Promise<string> }): Promise<JobHandle>
    cancel(jobID: string): Promise<void>
    list(): Promise<JobInfo[]>
  }
  readonly scheduler: {
    every(ms: number, fn: () => Promise<void>): Disposable
    cron(expr: string, fn: () => Promise<void>): Disposable
  }

  readonly events: {
    on(event: string, handler: (payload: unknown) => void): Disposable
    emit(event: string, payload: unknown): void
  }

  readonly storage: PluginStorage
  readonly files: { read(path: string): Promise<string>; write(path: string, data: string): Promise<void> }
  readonly http: HttpClient
  readonly secrets: SecretStore
  readonly config: ConfigSlice
  readonly permissions: { ask(input: PermissionAskInput): Promise<void> }
  readonly log: Logger
  readonly signal: AbortSignal
}

/**
 * 第三方插件拿到的受限 API（§5.3）。
 *
 * 相比 KernelApi 去掉了 sessions / llm / toolRuntime / background.run / events.emit / config.write / 任意路径写；
 * `providers` 与 `surfaces` 只对内置开放，调用 `register` 抛 `capability_denied` 而不是返回 undefined。
 */
export interface PluginContext {
  readonly id: string
  readonly scope: Exclude<PluginScope, "builtin">

  readonly tools: Registry<ToolContribution>
  readonly agents: Registry<AgentContribution>
  readonly commands: Registry<CommandContribution>
  readonly skills: Registry<SkillContribution>
  readonly interceptors: Registry<InterceptorRegistration>

  readonly storage: PluginStorage
  readonly secrets: SecretStore
  readonly http: HttpClient
  readonly log: Logger
  readonly signal: AbortSignal

  readonly providers: RestrictedRegistry<ProviderAdapter>
  readonly surfaces: RestrictedRegistry<SurfaceContribution>
}

/** `main` 默认导出的激活函数；声明是 eager 的，代码是 lazy 的（§6.1）。 */
export type PluginActivation<Ctx> = (ctx: Ctx) => void | Promise<void>
