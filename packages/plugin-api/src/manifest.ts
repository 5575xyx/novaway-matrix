import type {
  AgentContribution,
  CommandContribution,
  HttpRouteContribution,
  McpServerContribution,
  OfficeEngineContribution,
  PreviewContribution,
  SkillContribution,
  SurfaceContribution,
  ToolContribution,
  SchedulerContribution,
  EventSourceContribution,
} from "./contributions"
import type {
  ChannelContribution,
  FastPathRule,
  AgentRuntimeContribution,
  SuperAgentStrategyContribution,
  TaskKindContribution,
  VerifierContribution,
  RepairStrategyContribution,
  AgentTemplateContribution,
  SuperAgentPolicyContribution,
  SuperAgentSurfaceContribution,
  RoutingPolicyContribution,
  ThreadTriggerBinding,
  TriggerContribution,
  WatchdogPolicyContribution,
  WorkerTypeContribution,
} from "./superagent"

/** 惰性激活事件（§6.2；`onTrigger:` 来自 super-agent §3.6）。缺省按 `onStartup`（Q9）。 */
export type ActivationEvent =
  | "onStartup"
  | "onSessionStart"
  | `onTool:${string}`
  | `onCommand:${string}`
  | `onProvider:${string}`
  | `onView:${string}`
  | `onPreview:${string}`
  | `onEvent:${string}`
  | `onTrigger:${string}`

export type PluginKind = "declarative" | "code" | "mixed"

/** 权限声明（§11.1）。未声明即拒绝，检查发生在调用点（§5.4）。 */
export type PluginCapabilities = {
  fs?: Array<"plugin-data" | "workspace-read" | "workspace-write">
  network?: string[]
  shell?: boolean
  process?: Array<"spawn">
  secrets?: string[]
  tools?: string[]
  providers?: string[]
  publishDrivers?: string[]
  ui?: string[]
}

/** 声明式贡献：manifest 里能看到的部分（没有函数，宿主不 import 代码就能建索引，§6.5）。 */
export type ToolDeclaration = Omit<ToolContribution, "execute"> & { entry?: string }
export type OfficeEngineDeclaration = Omit<OfficeEngineContribution, "engine"> & { entry: string }
export type HttpRouteDeclaration = Omit<HttpRouteContribution, "handler"> & { entry: string }
export type TriggerDeclaration = Omit<TriggerContribution, "match" | "normalize"> & {
  entry: string
  thread?: ThreadTriggerBinding
}
export type FastPathDeclaration = Pick<FastPathRule, "id"> & { entry: string }
export type RoutingPolicyDeclaration = Pick<RoutingPolicyContribution, "id"> & { entry: string }
export type WorkerTypeDeclaration = Pick<WorkerTypeContribution, "id"> & { entry: string }
export type WatchdogPolicyDeclaration = Pick<WatchdogPolicyContribution, "id"> & { entry: string }
export type SchedulerDeclaration = Omit<SchedulerContribution, "run"> & { entry: string }
export type EventSourceDeclaration = Omit<EventSourceContribution, "start"> & { entry: string }
export type ChannelDeclaration = Pick<ChannelContribution, "id" | "kind"> & { entry: string }
export type AgentRuntimeDeclaration = Omit<AgentRuntimeContribution, "entry"> & { entry: string }
export type SuperAgentStrategyDeclaration = Omit<SuperAgentStrategyContribution, "entry"> & { entry: string }
export type TaskKindDeclaration = Omit<TaskKindContribution, "entry"> & { entry: string }
export type VerifierDeclaration = Omit<VerifierContribution, "entry"> & { entry: string }
export type RepairStrategyDeclaration = Omit<RepairStrategyContribution, "entry"> & { entry: string }
export type AgentTemplateDeclaration = AgentTemplateContribution
export type SuperAgentPolicyDeclaration = Omit<SuperAgentPolicyContribution, "entry"> & { entry: string }
export type SuperAgentSurfaceDeclaration = SuperAgentSurfaceContribution

export type Contributes = {
  tools?: ToolDeclaration[]
  agents?: string[] | AgentContribution[]
  skills?: string[] | SkillContribution[]
  commands?: string[] | CommandContribution[]
  interceptors?: string
  lifecycleHooks?: string
  mcpServers?: Record<string, Omit<McpServerContribution, "id">>
  outputStyles?: string
  lspServers?: string
  httpRoutes?: HttpRouteDeclaration[]
  providers?: string[]
  officeEngines?: OfficeEngineDeclaration[]
  publishDrivers?: string[]
  previewers?: PreviewContribution[]
  surfaces?: SurfaceContribution[]
  storage?: { namespace: string; migrations: string }
  triggers?: TriggerDeclaration[]
  fastPath?: FastPathDeclaration[]
  routingPolicies?: RoutingPolicyDeclaration[]
  workerTypes?: WorkerTypeDeclaration[]
  watchdogPolicies?: WatchdogPolicyDeclaration[]
  channels?: ChannelDeclaration[]
  schedulers?: SchedulerDeclaration[]
  eventSources?: EventSourceDeclaration[]
  agentRuntimes?: AgentRuntimeDeclaration[]
  superAgentStrategies?: SuperAgentStrategyDeclaration[]
  taskKinds?: TaskKindDeclaration[]
  verifiers?: VerifierDeclaration[]
  repairStrategies?: RepairStrategyDeclaration[]
  agentTemplates?: AgentTemplateDeclaration[]
  superAgentPolicies?: SuperAgentPolicyDeclaration[]
  superAgentSurfaces?: SuperAgentSurfaceDeclaration[]
}

/**
 * `contributes` 键全集（§3 的 22 个扩展点）。宿主拿它判别未知贡献点，
 * 不再自己抄一份清单——抄一份就会漂移。
 */
export const contributesKeys = [
  "tools",
  "agents",
  "skills",
  "commands",
  "interceptors",
  "lifecycleHooks",
  "mcpServers",
  "outputStyles",
  "lspServers",
  "httpRoutes",
  "providers",
  "officeEngines",
  "publishDrivers",
  "previewers",
  "surfaces",
  "storage",
  "triggers",
  "fastPath",
  "routingPolicies",
  "workerTypes",
  "watchdogPolicies",
  "channels",
  "schedulers",
  "eventSources",
  "agentRuntimes",
  "superAgentStrategies",
  "taskKinds",
  "verifiers",
  "repairStrategies",
  "agentTemplates",
  "superAgentPolicies",
  "superAgentSurfaces",
] as const satisfies readonly (keyof Contributes)[]

export type ContributesKey = (typeof contributesKeys)[number]

/** Manifest v2（§7）。文件名顺序：`.claude-plugin/plugin.json` → `plugin.json` → `extension.json` → `manifest.json`。 */
export type Manifest = {
  /** 插件 id：小写字母/数字/`-`/`_`。 */
  name: string
  version?: string
  /** 宿主 API 版本；旧插件由加载器补 `1`（§13.1）。 */
  apiVersion: number
  engines?: { novaway?: string }
  kind?: PluginKind
  /** 代码型必填，默认导出 `activate`。 */
  main?: string
  activationEvents?: ActivationEvent[]
  /** 插件 id → 版本范围；硬依赖，拓扑激活，有环则环上全部 `blocked`（§4.9）。 */
  dependencies?: Record<string, string>
  /** Plugin ids that cannot be active together with this plugin. */
  conflicts?: string[]
  capabilities?: PluginCapabilities
  contributes: Contributes
  /** 覆盖优先级，默认 0（§4.9）。 */
  priority?: number
  /** `builtin.knowledge` 覆盖全部；`builtin.knowledge:knowledge_search` 只覆盖单项（§4.9）。 */
  overrides?: string[]
  categories?: string[]
  license?: string
  /** 由加载器写入，作者不写。 */
  legacy?: Record<string, unknown>
  [key: string]: unknown
}

/** 生命周期状态机（§10.1）。 */
export type PluginStatus =
  | "discovered"
  | "invalid"
  | "blocked"
  | "installed"
  | "activating"
  | "active"
  | "failed"
  | "degraded"
  | "disabled"
  | "uninstalled"
  | "overridden"

/** PluginHost 始终是唯一发现与执行模型；不提供平行 legacy/shadow 模式。 */
export type PluginsMode = "unified"

/** 信任级别（§11.2）：本期只实现 L0。 */
export type TrustLevel = "L0" | "L1" | "L2"
