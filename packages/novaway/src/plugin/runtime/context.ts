import type {
  AgentContribution,
  CommandContribution,
  ConfigSlice,
  Disposable,
  EventSourceContribution,
  KernelApi,
  KernelApiSuperAgent,
  Logger,
  Manifest,
  OfficeEngineContribution,
  PluginContext,
  PluginScope,
  PluginStorage as StorageDto,
  PreviewContribution,
  ProviderAdapter,
  PublishDriverContribution,
  Registry,
  RestrictedRegistry,
  SchedulerContribution,
  SecretStore,
  SkillContribution,
  SurfaceContribution,
  ToolContribution,
} from "@novaway/plugin-api"
import { pluginError } from "@novaway/plugin-api"
import type { ContributionRegistry, Entry, Source } from "../contributions/registry"
import type { SuperAgentContributionRegistries } from "@/super-agent/plugin-contributions"
import { PluginStorage } from "../storage"
import { checkTool, createFiles, createHttp, createSecrets, type Roots } from "./capabilities"
import type { InterceptorRuntime } from "./hooks"
import type { Stack } from "./disposable"

/**
 * 两层 API 的构造器（§5.1–§5.4、§14.3 第 8 步）。
 *
 * 前半部分（注册表 / storage / secrets / http / log / signal）两层共用同一份实现，第一方只是多出
 * 宿主机能力——这样内置能力迁移时改的是类型标注，不是写法（§5.1）。
 *
 * **M0 不接任何内核调用点**：会话、LLM、后台任务、工具执行全部由宿主注入（`KernelDeps`），
 * 这里不认识 Effect Service，也不 import 内核模块。所以这一步的产物是「能构造出两种 ctx」，
 * 而不是「插件真的能驱动会话」；后者是 M1 接线的事。
 *
 * 两条边界都在这里守住：
 * 1. **scope 决定字段集**：第三方访问第一方字段抛 `capability_denied`，不是拿到 undefined（§5.3）。
 * 2. **manifest 决定能力**：fs / network / secrets / tools 未声明即拒绝，两层一视同仁（§5.4、§11.2 的 L0）。
 */

/** M0 落地的五个注册表：四个贡献点（§14.3 第 5 步）+ 拦截器运行时（第 6 步）。 */
export type SurfaceRegistry = Registry<SurfaceContribution> | ContributionRegistry<SurfaceContribution>

export type Registries = {
  tools: ContributionRegistry<ToolContribution>
  agents: ContributionRegistry<AgentContribution>
  skills: ContributionRegistry<SkillContribution>
  commands: ContributionRegistry<CommandContribution>
  interceptors: InterceptorRuntime
} & {
  providers?: Registry<ProviderAdapter>
  office?: Registry<OfficeEngineContribution>
  previewers?: ContributionRegistry<PreviewContribution>
  publish?: Registry<PublishDriverContribution>
  surfaces?: SurfaceRegistry
  schedulers?: Registry<SchedulerContribution>
  eventSources?: Registry<EventSourceContribution>
}

/**
 * 其余六个贡献点的内核注册表在后续里程碑落地。宿主已经绑好来源的就直接传 `Registry`；
 * 没传就是「这个贡献点现在不能用」，`register` 抛错而不是悄悄收下一条没人读的记录。
 */
export type LaterRegistries = {
  providers?: Registry<ProviderAdapter>
  office?: Registry<OfficeEngineContribution>
  previewers?: ContributionRegistry<PreviewContribution>
  publish?: Registry<PublishDriverContribution>
  surfaces?: SurfaceRegistry
  schedulers?: Registry<SchedulerContribution>
  eventSources?: Registry<EventSourceContribution>
  superAgent?: SuperAgentContributionRegistries
}

/** 第一方专属的宿主能力；第三方 ctx 根本不读它。 */
export type KernelDeps = {
  sessions: KernelApi["sessions"]
  toolRuntime: KernelApi["toolRuntime"]
  llm: KernelApi["llm"]
  background: KernelApi["background"]
  scheduler: KernelApi["scheduler"]
  events: KernelApi["events"]
  permissions: KernelApi["permissions"]
  /** super-agent 运行时（另一份文档，待评审）；没接线时 threads / channels / triggers 访问即抛。 */
  superAgent?: KernelApiSuperAgent
}

export type Input = {
  pluginID: string
  scope: PluginScope
  manifest: Manifest
  /** §4.9 排序键第 2 位，Host 从 `plugin_state.install_order` 取。 */
  installOrder?: number
  /** Runtime Host 生命周期释放用的内部实例键，不参与展示、覆盖与排序。 */
  ownerID?: string
  signal: AbortSignal
  resources?: Stack
  log: Logger
  registries: Registries & LaterRegistries
  /** 底层 secret 实现；`capabilities.secrets` 的检查包在它外面。 */
  secrets: SecretStore
  fetch?: typeof fetch
}

export type KernelInput = Input & {
  roots: Roots
  /** `plugins.config.<pluginID>` 的只读切片，Host 从 `ConfigPlugins.options()` 取。 */
  config?: Record<string, unknown>
  kernel: KernelDeps
}

export function createKernelApi(input: KernelInput): KernelApi {
  // 构造点就拒：让「给第三方发了第一方 ctx」这种宿主 bug 炸在接线处，而不是等插件越权成功。
  if (input.scope !== "builtin") {
    throw pluginError(
      "capability_denied",
      `KernelApi 只对 scope=builtin 开放，"${input.pluginID}" 是 ${input.scope}（§5.2）`,
      { pluginID: input.pluginID },
    )
  }
  const kernel = input.kernel
  const capabilities = input.manifest.capabilities
  const later = input.registries
  return {
    ...common(input),
    providers: own(later.providers ?? locked<ProviderAdapter>("providers", input.pluginID, LATER, undefined), input),
    office: own(later.office ?? locked<OfficeEngineContribution>("office", input.pluginID, LATER, undefined), input),
    publish: own(
      later.publish ?? locked<PublishDriverContribution>("publish", input.pluginID, LATER, undefined),
      input,
    ),
    surfaces: own(
      later.surfaces
        ? isContributionRegistry(later.surfaces)
          ? contributionRegistryView(later.surfaces, input)
          : later.surfaces
        : locked<SurfaceContribution>("surfaces", input.pluginID, LATER, undefined),
      input,
    ),
    schedulers: own(
      later.schedulers ?? locked<SchedulerContribution>("schedulers", input.pluginID, LATER, undefined),
      input,
    ),
    eventSources: own(
      later.eventSources ?? locked<EventSourceContribution>("eventSources", input.pluginID, LATER, undefined),
      input,
    ),
    sessions: kernel.sessions,
    toolRuntime: {
      list(query) {
        return kernel.toolRuntime.list(query)
      },
      async execute(call) {
        checkTool({ pluginID: input.pluginID, capabilities, tool: call.tool })
        return kernel.toolRuntime.execute(call)
      },
    },
    llm: kernel.llm,
    background: kernel.background,
    scheduler: {
      every(ms, fn) {
        input.signal.throwIfAborted()
        const disposable = kernel.scheduler.every(ms, fn)
        return input.resources?.push(disposable) ?? disposable
      },
      cron(expr, fn) {
        input.signal.throwIfAborted()
        const disposable = kernel.scheduler.cron(expr, fn)
        return input.resources?.push(disposable) ?? disposable
      },
    },
    events: {
      on(event, handler) {
        input.signal.throwIfAborted()
        const disposable = kernel.events.on(event, handler)
        return input.resources?.push(disposable) ?? disposable
      },
      emit(event, payload) {
        input.signal.throwIfAborted()
        kernel.events.emit(event, payload)
      },
    },
    files: createFiles({ pluginID: input.pluginID, capabilities, roots: input.roots }),
    config: slice(input.config),
    permissions: kernel.permissions,
    get threads() {
      return kernel.superAgent?.threads ?? missing("threads", input.pluginID, SUPER_AGENT)
    },
    get channels() {
      return kernel.superAgent?.channels ?? missing("channels", input.pluginID, SUPER_AGENT)
    },
    get triggers() {
      return kernel.superAgent?.triggers ?? missing("triggers", input.pluginID, SUPER_AGENT)
    },
  }
}

export function createPluginContext(input: Input): PluginContext {
  const scope = input.scope
  if (scope === "builtin") {
    throw pluginError(
      "capability_denied",
      `内置插件要用 createKernelApi，PluginContext 只发给第三方（当前 "${input.pluginID}" 是 builtin）`,
      { pluginID: input.pluginID },
    )
  }
  return hideFields(
    {
      ...common(input),
      scope,
      // §5.3：读取可用（能列出内置提供了哪些 provider），写入抛错。
      providers: providerRegistry(input),
      surfaces: locked(
        "surfaces",
        input.pluginID,
        BUILTIN_ONLY,
        input.registries.surfaces
          ? isContributionRegistry(input.registries.surfaces)
            ? contributionRegistryView(input.registries.surfaces, input)
            : input.registries.surfaces
          : undefined,
      ),
    },
    input.pluginID,
  )
}

const LATER = "该贡献点的内核注册表在 M0 之后落地，现在还没有消费者"
const BUILTIN_ONLY = "该贡献点当前只对内置插件开放（§5.3）"
const SUPER_AGENT = "super-agent 运行时还没接线（docs/super-agent-plugin-design.md 待评审）"
const THIRD_PARTY = "该 API 只对内置插件（scope=builtin）开放（§5.3）"

/** 第三方拿不到的字段：访问即抛。不可枚举，`{...ctx}` 与 JSON.stringify 不该被一个「你没有的字段」炸掉。 */
const HIDDEN = [
  "sessions",
  "toolRuntime",
  "llm",
  "background",
  "scheduler",
  "events",
  "files",
  "config",
  "permissions",
  "office",
  "publish",
  "schedulers",
  "eventSources",
  "threads",
  "channels",
  "triggers",
] as const

function own<T>(registry: Registry<T>, input: Input): Registry<T> {
  const track = (create: () => Disposable) => {
    input.signal.throwIfAborted()
    const disposable = create()
    return input.resources?.push(disposable) ?? disposable
  }
  return {
    register: (item) => track(() => registry.register(item)),
    resolve: (id) => registry.resolve(id),
    list: () => registry.list(),
    onDidChange: (fn) => track(() => registry.onDidChange(fn)),
  }
}

function isContributionRegistry(registry: SurfaceRegistry): registry is ContributionRegistry<SurfaceContribution> {
  return "kind" in registry
}

function contributionRegistryView<T extends { id: string }>(
  registry: ContributionRegistry<T>,
  input: Input,
): Registry<T> {
  const source: Source = {
    pluginID: input.pluginID,
    scope: input.scope,
    ownerID: input.ownerID,
    priority: input.manifest.priority,
    installOrder: input.installOrder,
    overrides: input.manifest.overrides,
  }
  return {
    register(item) {
      input.signal.throwIfAborted()
      const disposable = registry.register(source, item)
      return input.resources?.push(disposable) ?? disposable
    },
    resolve(id) {
      return registry.resolve(id)?.item
    },
    list() {
      return registry.list().map((entry) => entry.item)
    },
    onDidChange(fn) {
      input.signal.throwIfAborted()
      const disposable = registry.onDidChange(fn)
      return input.resources?.push(disposable) ?? disposable
    },
  }
}

function common(input: Input) {
  // 来源由宿主绑定，插件作者填不了：否则第三方可以自称 builtin 拿到原名与最高 rank（§4.8、§4.9）。
  const source: Source = {
    pluginID: input.pluginID,
    scope: input.scope,
    ownerID: input.ownerID,
    priority: input.manifest.priority,
    installOrder: input.installOrder,
    overrides: input.manifest.overrides,
  }
  const capabilities = input.manifest.capabilities
  return {
    id: input.pluginID,
    scope: input.scope,
    tools: bind(input.registries.tools, source, input),
    agents: bind(input.registries.agents, source, input),
    skills: bind(input.registries.skills, source, input),
    commands: bind(input.registries.commands, source, input),
    interceptors: bind(input.registries.interceptors, source, input),
    storage: storage(input),
    secrets: createSecrets({ pluginID: input.pluginID, capabilities, store: input.secrets }),
    http: createHttp({ pluginID: input.pluginID, capabilities, fetch: input.fetch }),
    log: tagged(input),
    signal: input.signal,
  }
}

type Bindable<T extends { id: string }> = Pick<ContributionRegistry<T>, "register" | "resolve" | "list" | "onDidChange">

/** `register(source, item)` → `register(item)`：宿主侧注册表要来源，作者侧 API 不该有这个方法参数。 */
function bind<T extends { id: string }>(registry: Bindable<T>, source: Source, input: Input): Registry<T> {
  return {
    register(item) {
      input.signal.throwIfAborted()
      const disposable = registry.register(source, item)
      return input.resources?.push(disposable) ?? disposable
    },
    resolve(id) {
      const hit = registry.resolve(id)
      return hit === undefined ? undefined : named(hit)
    },
    list() {
      return registry.list().map(named)
    },
    onDidChange(fn) {
      input.signal.throwIfAborted()
      const disposable = registry.onDidChange(fn)
      return input.resources?.push(disposable) ?? disposable
    },
  }
}

/**
 * 交回去的贡献项把 `id` 换成**最终名**：作者写的是本地名，而模型、提示词、Agent 的 `tools`
 * 白名单只认 `plugin_local` / `_2` 后缀那个名字（§4.2.1、§4.8）。不换的话作者拿不到能引用的名字。
 * 浅拷贝而不是改原对象——作者手里可能还握着它。
 */
function named<T extends { id: string }>(entry: Entry<T>): T {
  return { ...entry.item, id: entry.name }
}

function providerRegistry(input: Input): Registry<ProviderAdapter> | RestrictedRegistry<ProviderAdapter> {
  const registry = input.registries.providers
  const allowed = new Set(input.manifest.capabilities?.providers ?? [])
  if (!registry || allowed.size === 0) return locked("providers", input.pluginID, BUILTIN_ONLY, registry)
  const track = (create: () => Disposable) => {
    input.signal.throwIfAborted()
    const disposable = create()
    return input.resources?.push(disposable) ?? disposable
  }
  return {
    register(item) {
      if (!allowed.has("*") && !allowed.has(item.id)) {
        throw pluginError("capability_denied", `providers：未声明 provider ${item.id}`, {
          pluginID: input.pluginID,
          contributionID: item.id,
        })
      }
      return track(() => registry.register(item))
    },
    resolve: (id) => registry.resolve(id),
    list: () => registry.list(),
    onDidChange: (fn) => track(() => registry.onDidChange(fn)),
  }
}

/** 只读注册表：`register` 抛 `capability_denied`，读取转发给底层（没有底层就是空集）。 */
function locked<T>(
  kind: string,
  pluginID: string,
  reason: string,
  underlying: Registry<T> | undefined,
): RestrictedRegistry<T> {
  return {
    register() {
      throw pluginError("capability_denied", `${kind}：${reason}`, { pluginID, contributionID: kind })
    },
    resolve(id) {
      return underlying?.resolve(id)
    },
    list() {
      return underlying?.list() ?? []
    },
    onDidChange(fn) {
      return underlying?.onDidChange(fn) ?? { dispose() {} }
    },
  }
}

function missing(name: string, pluginID: string, reason: string): never {
  throw pluginError("capability_denied", `${name}：${reason}`, { pluginID, contributionID: name })
}

function hideFields<T extends object>(target: T, pluginID: string): T {
  for (const name of HIDDEN) {
    Object.defineProperty(target, name, {
      configurable: true,
      enumerable: false,
      get: () => missing(name, pluginID, THIRD_PARTY),
    })
  }
  return target
}

/** KV 句柄不接受 pluginID 参数，namespace 只认 manifest 声明的那一个（§5.4、§12.1）。 */
function storage(input: Input): StorageDto {
  const kv = PluginStorage.openKv({
    pluginID: input.pluginID,
    declared: input.manifest.contributes.storage?.namespace,
  })
  return {
    async get<T = unknown>(key: string) {
      return kv.get(key) as T | undefined
    },
    async set<T = unknown>(key: string, value: T) {
      kv.set(key, value)
    },
    async remove(key) {
      kv.remove(key)
    },
    async keys(prefix) {
      return kv
        .entries()
        .filter((entry) => prefix === undefined || entry.key.startsWith(prefix))
        .map((entry) => entry.key)
    },
  }
}

function slice(values: Record<string, unknown> | undefined): ConfigSlice {
  return {
    get<T = unknown>(key: string) {
      return values?.[key] as T | undefined
    },
  }
}

/** 每条日志都归到插件名下；pluginID 放在最后，作者传同名键也覆盖不掉。 */
function tagged(input: Input): Logger {
  const fields = (extra?: Record<string, unknown>) => ({ ...extra, pluginID: input.pluginID })
  return {
    debug(message, extra) {
      input.log.debug(message, fields(extra))
    },
    info(message, extra) {
      input.log.info(message, fields(extra))
    },
    warn(message, extra) {
      input.log.warn(message, fields(extra))
    },
    error(message, extra) {
      input.log.error(message, fields(extra))
    },
  }
}
