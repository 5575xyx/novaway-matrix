import type { ContributesKey } from "./manifest"
import { contributesKeys } from "./manifest"

/** Contribution entries have a stable per-item identity; manifest settings do not. */
export const contributionKinds = [
  "tool",
  "agent",
  "skill",
  "command",
  "provider",
  "office-engine",
  "previewer",
  "publish-driver",
  "surface",
  "interceptor",
  "mcp",
  "output-style",
  "scheduler",
  "event-source",
  "http-route",
  "lsp",
  "trigger",
  "fast-path",
  "routing-policy",
  "worker-type",
  "watchdog-policy",
  "channel",
  "agent-runtime",
  "super-agent-strategy",
  "task-kind",
  "verifier",
  "repair-strategy",
  "agent-template",
  "super-agent-policy",
  "super-agent-surface",
] as const

export type ContributionKind = (typeof contributionKinds)[number]

export const contributionDeclarationKinds = [
  "tool",
  "agent",
  "skill",
  "command",
  "provider",
  "office-engine",
  "previewer",
  "publish-driver",
  "surface",
  "interceptor",
  "mcp",
  "output-style",
  "http-route",
  "lsp",
  "trigger",
  "fast-path",
  "routing-policy",
  "worker-type",
  "watchdog-policy",
  "channel",
  "scheduler",
  "event-source",
  "agent-runtime",
  "super-agent-strategy",
  "task-kind",
  "verifier",
  "repair-strategy",
  "agent-template",
  "super-agent-policy",
  "super-agent-surface",
] as const satisfies readonly ContributionKind[]

export const contributionDeclarationKeys = [
  "tools",
  "agents",
  "skills",
  "commands",
  "providers",
  "officeEngines",
  "previewers",
  "publishDrivers",
  "surfaces",
  "interceptors",
  "mcpServers",
  "outputStyles",
  "httpRoutes",
  "lspServers",
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
] as const satisfies readonly ContributesKey[]

export const contributionSettingKeys = ["lifecycleHooks", "storage"] as const satisfies readonly ContributesKey[]

export const runtimeOnlyContributionKinds = [] as const satisfies readonly ContributionKind[]

if (
  contributesKeys.length !== contributionDeclarationKeys.length + contributionSettingKeys.length ||
  contributionKinds.length !== contributionDeclarationKinds.length + runtimeOnlyContributionKinds.length
) {
  throw new Error("Plugin contribution keys and kinds must be classified")
}

/** 贡献来源作用域；覆盖优先级 session > project > global > builtin（§4.9、§10.5）。 */
export type PluginScope = "builtin" | "global" | "project" | "session"

export interface Disposable {
  dispose(): void
}

/** 所有注册表共享的语义：命名、冲突、覆盖、释放、变更通知（§4.1）。 */
export interface Registry<T> {
  register(item: T): Disposable
  resolve(id: string): T | undefined
  list(): ReadonlyArray<T>
  onDidChange(fn: () => void): Disposable
}

/** 未对第三方开放的注册表：读取可用，`register` 抛 `capability_denied`（§5.3）。 */
export interface RestrictedRegistry<T> extends Omit<Registry<T>, "register"> {
  register(item: T): never
}
