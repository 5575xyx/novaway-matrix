import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type {
  KernelApi,
  Manifest,
  OfficeEngineContribution,
  OfficeEngineDeclaration,
  InterceptorRegistration,
  PreviewContribution,
  PluginActivation,
  PluginContext,
  ProviderAdapter,
  PublishDriverContribution,
  SkillContribution,
  ToolContribution,
  ToolDeclaration,
} from "@novaway/plugin-api"
import { pluginError, toolSafetyDefaults } from "@novaway/plugin-api"
import type { Instance as DiscoveredPlugin } from "../host"
import { createKernelApi, createPluginContext, type Input, type KernelInput } from "./context"
import type { Plugin as RuntimePlugin } from "./host"
import { createStack } from "./disposable"
import type { DeclarativeContributionKey } from "./declarative"

export function createActivation(input: Omit<Input, "signal" | "resources">) {
  return createOwner((signal, resources) => createPluginContext({ ...input, signal, resources }))
}

export function createBuiltinActivation(input: Omit<KernelInput, "signal" | "resources">) {
  return createOwner((signal, resources) => createKernelApi({ ...input, signal, resources }))
}

export function createDiscoveredPlugin(input: {
  instance: DiscoveredPlugin
  runtime: Omit<Input, "pluginID" | "scope" | "manifest" | "installOrder" | "ownerID" | "signal" | "resources">
}): RuntimePlugin {
  const instance = input.instance
  if (instance.status !== "installed" || instance.manifest.kind !== "declarative") {
    throw new Error(`插件 ${instance.id} 未安装或不是可执行插件`)
  }
  if (instance.adapter !== "v2" || instance.location.kind !== "directory") {
    throw new Error(`插件 ${instance.id} 尚无统一 Host 激活适配器`)
  }
  const unsupported = Object.keys(instance.manifest.contributes).filter(
    (key) =>
      ![
        "tools",
        "agents",
        "skills",
        "commands",
        "interceptors",
        "providers",
        "officeEngines",
        "publishDrivers",
        "surfaces",
        "previewers",
        "storage",
        "agentRuntimes",
        "superAgentStrategies",
        "taskKinds",
        "verifiers",
        "repairStrategies",
        "agentTemplates",
        "superAgentPolicies",
        "superAgentSurfaces",
        "mcpServers",
        "outputStyles",
        "lspServers",
        "httpRoutes",
        "triggers",
        "fastPath",
        "routingPolicies",
        "workerTypes",
        "watchdogPolicies",
        "channels",
        "schedulers",
        "eventSources",
        "lifecycleHooks",
      ].includes(key),
  )
  if (unsupported.length > 0) {
    throw new Error(`插件 ${instance.id} 声明了尚未接入统一 Host 的贡献点：${unsupported.join(", ")}`)
  }

  const root = instance.location.root
  const activationInput = {
    ...input.runtime,
    pluginID: instance.id,
    scope: instance.scope,
    manifest: instance.manifest,
    installOrder: instance.installOrder,
    ownerID: `${instance.scope}:${instance.id}`,
  }
  return {
    id: instance.id,
    scope: instance.scope,
    manifest: instance.manifest,
    installOrder: instance.installOrder,
    root,
    async activate({ registries, signal, resources }) {
      // Built-in provider adapters are declarative data plus trusted entry modules.
      // They do not need the broader KernelApi, but they must still be owned by
      // this Host activation so disable releases them with the plugin.
      if (instance.scope === "builtin") {
        const keys = Object.keys(instance.manifest.contributes)
        if (
          keys.some(
            (key) =>
              key !== "providers" &&
              key !== "officeEngines" &&
              key !== "publishDrivers" &&
              key !== "surfaces" &&
              key !== "previewers" &&
              key !== "storage" &&
              key !== "agentRuntimes" &&
              key !== "superAgentStrategies" &&
              key !== "taskKinds" &&
              key !== "verifiers" &&
              key !== "repairStrategies" &&
              key !== "agentTemplates" &&
              key !== "superAgentPolicies" &&
              key !== "superAgentSurfaces",
          )
        ) {
          throw pluginError(
            "capability_denied",
            "内置 Provider/Office/Publish/UI 插件只能声明 providers、officeEngines、publishDrivers、surfaces、previewers 或 storage",
            { pluginID: instance.id },
          )
        }
        if (
          !registries.providers &&
          !registries.office &&
          !registries.publish &&
          !registries.surfaces &&
          !registries.previewers &&
          !registries.superAgent
        ) {
          throw pluginError("capability_denied", "当前 Host 未提供 Provider/Office 注册表", { pluginID: instance.id })
        }
        signal.throwIfAborted()
        for (const provider of await loadProviderEntries({
          root,
          entries: instance.manifest.contributes.providers ?? [],
          pluginID: instance.id,
        })) {
          signal.throwIfAborted()
          if (!registries.providers) {
            throw pluginError("capability_denied", "当前 Host 未提供 Provider 注册表", { pluginID: instance.id })
          }
          resources.push(registries.providers.register(provider))
        }
        for (const office of await loadOfficeEntries({
          root,
          entries: instance.manifest.contributes.officeEngines ?? [],
          pluginID: instance.id,
        })) {
          signal.throwIfAborted()
          if (!registries.office) {
            throw pluginError("capability_denied", "当前 Host 未提供 Office 注册表", { pluginID: instance.id })
          }
          resources.push(registries.office.register(office))
        }
        for (const driver of await loadPublishEntries({
          root,
          entries: instance.manifest.contributes.publishDrivers ?? [],
          pluginID: instance.id,
        })) {
          signal.throwIfAborted()
          if (!registries.publish) {
            throw pluginError("capability_denied", "当前 Host 未提供 Publish 注册表", { pluginID: instance.id })
          }
          resources.push(registries.publish.register(driver))
        }
        for (const surface of instance.manifest.contributes.surfaces ?? []) {
          signal.throwIfAborted()
          if (!registries.surfaces) {
            throw pluginError("capability_denied", "当前 Host 未提供 Surface 注册表", { pluginID: instance.id })
          }
          const source = {
            pluginID: instance.id,
            scope: instance.scope,
            ownerID: `${instance.scope}:${instance.id}`,
            priority: instance.manifest.priority,
            installOrder: instance.installOrder,
            overrides: instance.manifest.overrides,
          }
          const disposable =
            "kind" in registries.surfaces
              ? registries.surfaces.register(source, surface)
              : registries.surfaces.register(surface)
          resources.push(disposable)
        }
        await registerSuperAgentContributions({ instance, registries, resources, signal })
        await registerDeclarativeContributions({ instance, registries, resources, signal })
        registerPreviewers({ instance, registries, resources, signal })
        return
      }
      const context = createPluginContext({ ...activationInput, registries, signal, resources })
      if (typeof instance.manifest.contributes.interceptors === "string") {
        for (const interceptor of await loadInterceptorEntries({
          root,
          declaration: instance.manifest.contributes.interceptors,
          pluginID: instance.id,
          context,
        })) {
          context.interceptors.register(interceptor)
        }
      }
      const marketplaceOffice =
        instance.location.kind === "directory" &&
        instance.location.label === "plugin" &&
        instance.manifest.capabilities?.ui?.includes("office-engine")
      if (
        (instance.manifest.contributes.officeEngines?.length ?? 0) > 0 &&
        !marketplaceOffice
      ) {
        throw pluginError("capability_denied", "Office 引擎必须声明 ui.office-engine 能力；未声明时只允许内置插件", {
          pluginID: instance.id,
        })
      }
      const marketplacePublish =
        instance.location.kind === "directory" &&
        instance.location.label === "plugin" &&
        (instance.manifest.capabilities?.publishDrivers?.length ?? 0) > 0
      if ((instance.manifest.contributes.publishDrivers?.length ?? 0) > 0 && !marketplacePublish) {
        throw pluginError("capability_denied", "Publish driver 必须声明 publishDrivers 能力；未声明时只允许内置插件", {
          pluginID: instance.id,
        })
      }
      const tools = shouldDeferTools(instance.manifest)
        ? createLazyToolEntries({ root, declarations: instance.manifest.contributes.tools ?? [], context })
        : await loadToolEntries({ root, declarations: instance.manifest.contributes.tools ?? [], context })
      for (const tool of tools) context.tools.register(tool)
      for (const declaration of instance.manifest.contributes.agents ?? []) {
        if (typeof declaration === "string") {
          throw pluginError("contribution_invalid", `Agent 贡献必须是对象声明：${declaration}`, {
            pluginID: instance.id,
          })
        }
        const prompt =
          typeof declaration.prompt === "string"
            ? declaration.prompt
            : await readContributionFile(root, declaration.prompt.file, instance.id, declaration.id)
        context.agents.register({ ...declaration, prompt })
      }
      for (const declaration of await loadSkillEntries({
        root,
        declarations: instance.manifest.contributes.skills ?? [],
        pluginID: instance.id,
      })) {
        context.skills.register(declaration)
      }
      for (const declaration of instance.manifest.contributes.commands ?? []) {
        if (typeof declaration === "string") {
          throw pluginError("contribution_invalid", `Command 贡献必须是对象声明：${declaration}`, {
            pluginID: instance.id,
          })
        }
        context.commands.register(declaration)
      }
      const providers = await loadProviderEntries({
        root,
        entries: instance.manifest.contributes.providers ?? [],
        pluginID: instance.id,
      })
      for (const provider of providers) {
        if (!context.providers) {
          throw pluginError("capability_denied", "当前 Host 未提供 Provider 注册表", { pluginID: instance.id })
        }
        context.providers.register(provider)
      }
      const publishDrivers = await loadPublishEntries({
        root,
        entries: instance.manifest.contributes.publishDrivers ?? [],
        pluginID: instance.id,
      })
      for (const driver of publishDrivers) {
        const allowed = new Set(instance.manifest.capabilities?.publishDrivers ?? [])
        if (!allowed.has("*") && !allowed.has(driver.id)) {
          throw pluginError("capability_denied", `publishDrivers：未声明 driver ${driver.id}`, {
            pluginID: instance.id,
            contributionID: driver.id,
          })
        }
        if (!registries.publish) {
          throw pluginError("capability_denied", "当前 Host 未提供 Publish 注册表", { pluginID: instance.id })
        }
        resources.push(registries.publish.register(driver))
      }
      for (const office of await loadOfficeEntries({
        root,
        entries: instance.manifest.contributes.officeEngines ?? [],
        pluginID: instance.id,
      })) {
        if (!registries.office) {
          throw pluginError("capability_denied", "当前 Host 未提供 Office 注册表", { pluginID: instance.id })
        }
        resources.push(registries.office.register(office))
      }
      const surfaces = instance.manifest.contributes.surfaces ?? []
      if (surfaces.length > 0) {
        if (!registries.surfaces) {
          throw pluginError("capability_denied", "当前 Host 未提供 Surface 注册表", { pluginID: instance.id })
        }
        for (const surface of surfaces) {
          signal.throwIfAborted()
          const source = {
            pluginID: instance.id,
            scope: instance.scope,
            ownerID: `${instance.scope}:${instance.id}`,
            priority: instance.manifest.priority,
            installOrder: instance.installOrder,
            overrides: instance.manifest.overrides,
          }
          const disposable =
            "kind" in registries.surfaces
              ? registries.surfaces.register(source, surface)
              : registries.surfaces.register(surface)
          resources.push(disposable)
        }
      }
      await registerSuperAgentContributions({ instance, registries, resources, signal })
      await registerDeclarativeContributions({ instance, registries, resources, signal })
      registerPreviewers({ instance, registries, resources, signal })
    },
  }
}

async function loadSuperAgentContribution(input: {
  root: string
  pluginID: string
  kind: string
  declaration: Record<string, unknown>
}) {
  const entry = input.declaration.entry
  if (typeof entry !== "string" || entry.length === 0) return input.declaration
  const root = await fs.realpath(input.root)
  const requested = path.resolve(root, entry)
  const requestedRelative = path.relative(root, requested)
  if (requestedRelative === ".." || requestedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(requestedRelative)) {
    throw pluginError("capability_denied", `Super-Agent ${input.kind} entry 路径越界：${entry}`, {
      pluginID: input.pluginID,
      contributionID: String(input.declaration.id ?? entry),
    })
  }
  let resolved: string
  try {
    resolved = await fs.realpath(requested)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return input.declaration
    throw error
  }
  const relative = path.relative(root, resolved)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw pluginError("capability_denied", `Super-Agent ${input.kind} entry 路径越界：${entry}`, {
      pluginID: input.pluginID,
      contributionID: String(input.declaration.id ?? entry),
    })
  }
  const module = await import(pathToFileURL(resolved).href)
  const candidate = module.default ?? module.contribution ?? module[input.kind]
  if (candidate !== undefined && (typeof candidate !== "object" || candidate === null)) {
    throw pluginError("contribution_invalid", `Super-Agent ${input.kind} entry 必须导出对象：${entry}`, {
      pluginID: input.pluginID,
      contributionID: String(input.declaration.id ?? entry),
    })
  }
  const merged = { ...input.declaration, ...(candidate as Record<string, unknown> | undefined) }
  if (typeof merged.id !== "string" || merged.id.length === 0 || typeof merged.version !== "string") {
    throw pluginError("contribution_invalid", `Super-Agent ${input.kind} entry 缺少 id/version：${entry}`, {
      pluginID: input.pluginID,
      contributionID: String(input.declaration.id ?? entry),
    })
  }
  if (typeof candidate === "object" && candidate !== null && ("id" in candidate || "version" in candidate)) {
    if (candidate.id !== input.declaration.id || candidate.version !== input.declaration.version) {
      throw pluginError("contribution_invalid", `Super-Agent ${input.kind} entry metadata 与 manifest 不一致：${entry}`, {
        pluginID: input.pluginID,
        contributionID: String(input.declaration.id),
      })
    }
  }
  return merged
}

async function registerSuperAgentContributions(input: {
  instance: DiscoveredPlugin
  registries: Parameters<RuntimePlugin["activate"]>[0]["registries"]
  resources: ReturnType<typeof createStack>
  signal: AbortSignal
}) {
  const contributions = input.instance.manifest.contributes
  const registry = input.registries.superAgent
  const declarations = [
    ...(contributions.agentRuntimes ?? []).map((item) => ["agentRuntimes", item] as const),
    ...(contributions.superAgentStrategies ?? []).map((item) => ["strategies", item] as const),
    ...(contributions.taskKinds ?? []).map((item) => ["taskKinds", item] as const),
    ...(contributions.verifiers ?? []).map((item) => ["verifiers", item] as const),
    ...(contributions.repairStrategies ?? []).map((item) => ["repairStrategies", item] as const),
    ...(contributions.agentTemplates ?? []).map((item) => ["agentTemplates", item] as const),
    ...(contributions.superAgentPolicies ?? []).map((item) => ["policies", item] as const),
    ...(contributions.superAgentSurfaces ?? []).map((item) => ["surfaces", item] as const),
  ]
  if (declarations.length === 0) return
  if (!registry) {
    throw pluginError("capability_denied", "当前 Host 未提供 Super-Agent 注册表", { pluginID: input.instance.id })
  }
  for (const [kind, declaration] of declarations) {
    input.signal.throwIfAborted()
    const target = registry[kind as keyof typeof registry] as { register(item: never): { dispose(): void } }
    const loaded = await loadSuperAgentContribution({
      root: input.instance.location.kind === "directory" ? input.instance.location.root : "",
      pluginID: input.instance.id,
      kind,
      declaration: declaration as Record<string, unknown>,
    })
    input.signal.throwIfAborted()
    input.resources.push(target.register(loaded as never))
  }
}

async function registerDeclarativeContributions(input: {
  instance: DiscoveredPlugin
  registries: Parameters<RuntimePlugin["activate"]>[0]["registries"]
  resources: ReturnType<typeof createStack>
  signal: AbortSignal
}) {
  const declarations = input.instance.manifest.contributes
  const registries = input.registries.declarative
  const root = input.instance.location.kind === "directory" ? input.instance.location.root : ""
  const source = {
    pluginID: input.instance.id,
    scope: input.instance.scope,
    ownerID: `${input.instance.scope}:${input.instance.id}`,
    priority: input.instance.manifest.priority,
    installOrder: input.instance.installOrder,
    overrides: input.instance.manifest.overrides,
  }
  const register = (kind: DeclarativeContributionKey, item: Record<string, unknown>) => {
    const registry = registries?.[kind]
    if (!registry) {
      throw pluginError("capability_denied", `当前 Host 未提供 ${kind} 注册表`, {
        pluginID: input.instance.id,
        contributionID: String(item.id),
      })
    }
    input.signal.throwIfAborted()
    input.resources.push(registry.register(source, item as never))
  }
  const arrays: Array<[DeclarativeContributionKey, unknown[] | undefined]> = [
    ["httpRoutes", declarations.httpRoutes],
    ["triggers", declarations.triggers],
    ["fastPath", declarations.fastPath],
    ["routingPolicies", declarations.routingPolicies],
    ["workerTypes", declarations.workerTypes],
    ["watchdogPolicies", declarations.watchdogPolicies],
    ["channels", declarations.channels],
    ["schedulers", declarations.schedulers],
    ["eventSources", declarations.eventSources],
  ]
  for (const [kind, values] of arrays) {
    for (const value of values ?? []) {
      const item = await loadDeclarativeEntry({ root, value, kind, pluginID: input.instance.id })
      register(kind, item)
    }
  }
  for (const [id, value] of Object.entries(declarations.mcpServers ?? {})) {
    register("mcpServers", { id, ...value })
  }
  for (const [kind, declaration] of [
    ["outputStyles", declarations.outputStyles],
    ["lspServers", declarations.lspServers],
    ["lifecycleHooks", declarations.lifecycleHooks],
  ] as const) {
    if (typeof declaration !== "string") continue
    for (const value of await loadDeclarativeModule({ root, declaration, kind, pluginID: input.instance.id })) {
      register(kind, value)
    }
  }
}

async function loadDeclarativeModule(input: {
  root: string
  declaration: string
  kind: DeclarativeContributionKey
  pluginID: string
}): Promise<Record<string, unknown>[]> {
  const realRoot = await fs.realpath(input.root)
  const requested = path.resolve(realRoot, input.declaration)
  const resolved = await fs.realpath(requested)
  const relative = path.relative(realRoot, resolved)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw pluginError("capability_denied", `${input.kind} entry 路径越界：${input.declaration}`, {
      pluginID: input.pluginID,
      contributionID: input.declaration,
    })
  }
  const module = await import(pathToFileURL(resolved).href)
  const exported = module.default ?? module.contributions ?? module[input.kind]
  const values = Array.isArray(exported) ? exported : exported === undefined ? [] : [exported]
  return values.map((value) => {
    if (value === null || typeof value !== "object" || typeof value.id !== "string") {
      throw pluginError("contribution_invalid", `${input.kind} entry 必须导出带 id 的对象：${input.declaration}`, {
        pluginID: input.pluginID,
        contributionID: input.declaration,
      })
    }
    return value as Record<string, unknown>
  })
}

async function loadDeclarativeEntry(input: {
  root: string
  value: unknown
  kind: DeclarativeContributionKey
  pluginID: string
}): Promise<Record<string, unknown>> {
  if (input.value === null || typeof input.value !== "object") {
    throw pluginError("contribution_invalid", `${input.kind} 必须是对象声明`, {
      pluginID: input.pluginID,
      contributionID: String(input.value),
    })
  }
  const declaration = input.value as Record<string, unknown>
  const entry = declaration.entry
  if (typeof entry !== "string") return declaration
  const values = await loadDeclarativeModule({ root: input.root, declaration: entry, kind: input.kind, pluginID: input.pluginID })
  const candidate = values[0]
  if (candidate === undefined) return declaration
  return { ...declaration, ...candidate }
}


function registerPreviewers(input: {
  instance: DiscoveredPlugin
  registries: Parameters<RuntimePlugin["activate"]>[0]["registries"]
  resources: ReturnType<typeof createStack>
  signal: AbortSignal
}) {
  const declarations = input.instance.manifest.contributes.previewers ?? []
  if (declarations.length === 0) return
  if (!input.registries.previewers) {
    throw pluginError("capability_denied", "当前 Host 未提供 Previewer 注册表", { pluginID: input.instance.id })
  }
  for (const declaration of declarations) {
    input.signal.throwIfAborted()
    const match = declaration.match as unknown
    const isStringOrStrings = (value: unknown) =>
      typeof value === "string" ||
      (Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === "string"))
    const validMatch =
      typeof match === "object" &&
      match !== null &&
      ["extension", "format", "mime"].some(
        (key) => key in match && isStringOrStrings((match as Record<string, unknown>)[key]),
      )
    const render = declaration.render as { type?: unknown; url?: unknown; component?: unknown } | undefined
    const validRender =
      render === undefined ||
      (render.type === "iframe" && typeof render.url === "string" && render.url.length > 0) ||
      (render.type === "builtin" && typeof render.component === "string" && render.component.length > 0)
    if (
      typeof declaration.id !== "string" ||
      declaration.id.length === 0 ||
      (typeof declaration.viewId !== "string" && declaration.render === undefined) ||
      (typeof declaration.viewId === "string" && declaration.viewId.length === 0) ||
      !validMatch ||
      !validRender ||
      (declaration.priority !== undefined && !Number.isFinite(declaration.priority)) ||
      (declaration.readOnly !== undefined && typeof declaration.readOnly !== "boolean")
    ) {
      throw pluginError("contribution_invalid", "Previewer 必须声明 id、match，以及 viewId 或合法 render", {
        pluginID: input.instance.id,
        contributionID: declaration.id,
      })
    }
    const disposable = input.registries.previewers.register(
      {
        pluginID: input.instance.id,
        scope: input.instance.scope,
        ownerID: `${input.instance.scope}:${input.instance.id}`,
        root: input.instance.location.kind === "directory" ? input.instance.location.root : undefined,
        priority: input.instance.manifest.priority,
        installOrder: input.instance.installOrder,
        overrides: input.instance.manifest.overrides,
      },
      declaration as PreviewContribution,
    )
    input.resources.push(disposable)
  }
}

export function createToolEntryActivation(input: Omit<Input, "signal" | "resources"> & { root: string }) {
  const { root, ...contextInput } = input
  const owner = createActivation(contextInput)
  return {
    get active() {
      return owner.active
    },
    activate() {
      return owner.activate(async (ctx) => {
        const tools = await loadToolEntries({
          root,
          declarations: input.manifest.contributes.tools ?? [],
          context: ctx,
        })
        for (const tool of tools) ctx.tools.register(tool)
      })
    },
    dispose: owner.dispose,
  }
}

export async function loadPublishEntries(input: {
  root: string
  entries: readonly string[]
  pluginID: string
}): Promise<Array<PublishDriverContribution & { pluginID: string }>> {
  const drivers: Array<PublishDriverContribution & { pluginID: string }> = []
  const root = await fs.realpath(input.root)
  for (const entry of input.entries) {
    const resolved = await fs.realpath(path.resolve(root, entry))
    const relative = path.relative(root, resolved)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw pluginError("capability_denied", `Publish driver entry 路径越界：${entry}`, { pluginID: input.pluginID })
    }
    const module = await import(pathToFileURL(resolved).href)
    const candidate = module.default ?? module.driver
    if (
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.id !== "string" ||
      typeof candidate.name !== "string"
    ) {
      throw pluginError("contribution_invalid", `Publish driver entry 必须导出带 id/name 的驱动：${entry}`, {
        pluginID: input.pluginID,
        contributionID: entry,
      })
    }
    drivers.push({ ...(candidate as PublishDriverContribution), pluginID: input.pluginID })
  }
  return drivers
}

export async function loadOfficeEntries(input: {
  root: string
  entries: readonly OfficeEngineDeclaration[]
  pluginID: string
}): Promise<OfficeEngineContribution[]> {
  const engines: OfficeEngineContribution[] = []
  const root = await fs.realpath(input.root)
  for (const declaration of input.entries) {
    const resolved = await fs.realpath(path.resolve(root, declaration.entry))
    const relative = path.relative(root, resolved)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw pluginError("capability_denied", `Office engine entry 路径越界：${declaration.entry}`, {
        pluginID: input.pluginID,
        contributionID: declaration.format,
      })
    }
    const module = await import(pathToFileURL(resolved).href)
    const engine = module.default ?? module.engine
    if (!engine || typeof engine !== "object") {
      throw pluginError("contribution_invalid", `Office engine entry 必须导出引擎对象：${declaration.entry}`, {
        pluginID: input.pluginID,
        contributionID: declaration.format,
      })
    }
    const { entry: _entry, ...metadata } = declaration
    engines.push({ ...metadata, engine } as OfficeEngineContribution)
  }
  return engines
}

export async function loadProviderEntries(input: {
  root: string
  entries: readonly string[]
  pluginID: string
}): Promise<ProviderAdapter[]> {
  const providers: ProviderAdapter[] = []
  const root = await fs.realpath(input.root)
  for (const entry of input.entries) {
    const resolved = await fs.realpath(path.resolve(root, entry))
    const relative = path.relative(root, resolved)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw pluginError("capability_denied", `Provider entry 路径越界：${entry}`, { pluginID: input.pluginID })
    }
    const module = await import(pathToFileURL(resolved).href)
    const candidate = module.default ?? module.provider
    if (
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.id !== "string" ||
      typeof candidate.name !== "string"
    ) {
      throw pluginError("contribution_invalid", `Provider entry 必须导出带 id/name 的适配器：${entry}`, {
        pluginID: input.pluginID,
        contributionID: entry,
      })
    }
    providers.push(candidate as ProviderAdapter)
  }
  return providers
}

async function loadInterceptorEntries(input: {
  root: string
  declaration: string
  pluginID: string
  context: PluginContext
}): Promise<InterceptorRegistration[]> {
  const realRoot = await fs.realpath(input.root)
  const requested = path.resolve(realRoot, input.declaration)
  const resolved = await fs.realpath(requested)
  const relative = path.relative(realRoot, resolved)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw pluginError("capability_denied", `Interceptor entry 路径越界：${input.declaration}`, {
      pluginID: input.pluginID,
      contributionID: input.declaration,
    })
  }
  const module = await import(pathToFileURL(resolved).href)
  const exported = module.default ?? module.interceptors
  const value =
    typeof exported === "function"
      ? await exported(input.context)
      : exported
  if (value === undefined) return []
  const entries = Array.isArray(value) ? value : [value]
  return entries.map((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.id !== "string" ||
      entry.id.length === 0 ||
      typeof entry.hook !== "string" ||
      typeof entry.handler !== "function"
    ) {
      throw pluginError("contribution_invalid", `Interceptor entry 必须导出 id、hook 和 handler：${input.declaration}`, {
        pluginID: input.pluginID,
        contributionID: input.declaration,
      })
    }
    return entry as InterceptorRegistration
  })
}

async function loadSkillEntries(input: {
  root: string
  declarations: readonly (string | SkillContribution)[]
  pluginID: string
}): Promise<SkillContribution[]> {
  const result: SkillContribution[] = []
  const realRoot = await fs.realpath(input.root)
  const assertInside = async (entry: string) => {
    const resolved = await fs.realpath(path.resolve(realRoot, entry))
    const relative = path.relative(realRoot, resolved)
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw pluginError("capability_denied", `Skill entry 路径越界：${entry}`, {
        pluginID: input.pluginID,
        contributionID: entry,
      })
    }
    return resolved
  }
  const readSkillFile = async (file: string, fallbackID: string): Promise<SkillContribution> => {
    const text = await fs.readFile(file, "utf8")
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? ""
    const field = (name: string) => {
      const value = frontmatter.match(new RegExp(`^${name}\\s*:\\s*(.+)$`, "m"))?.[1]?.trim()
      return value?.replace(/^(["'])(.*)\\1$/, "$2")
    }
    const id = field("name") || fallbackID
    if (!id) {
      throw pluginError("contribution_invalid", `Skill 缺少 name：${file}`, {
        pluginID: input.pluginID,
        contributionID: file,
      })
    }
    return {
      id,
      description: field("description") || `Skill ${id}`,
      source: { file: path.relative(realRoot, file).split(path.sep).join("/"), text },
    }
  }
  const walk = async (directory: string): Promise<string[]> => {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      const child = path.join(directory, entry.name)
      if (entry.isDirectory()) files.push(...(await walk(child)))
      else if (entry.isFile() && entry.name.toLowerCase() === "skill.md") files.push(child)
    }
    return files
  }
  for (const declaration of input.declarations) {
    if (typeof declaration !== "string") {
      const source =
        "text" in declaration.source
          ? declaration.source
          : {
              ...declaration.source,
              text: await readContributionFile(realRoot, declaration.source.file, input.pluginID, declaration.id),
            }
      result.push({ ...declaration, source })
      continue
    }
    const resolved = await assertInside(declaration)
    const stat = await fs.stat(resolved)
    const files = stat.isDirectory() ? await walk(resolved) : [resolved]
    if (files.length === 0) {
      throw pluginError("contribution_invalid", `Skill 目录没有 SKILL.md：${declaration}`, {
        pluginID: input.pluginID,
        contributionID: declaration,
      })
    }
    for (const file of files) {
      result.push(await readSkillFile(file, path.basename(path.dirname(file))))
    }
  }
  return result
}
async function readContributionFile(root: string, file: string, pluginID: string, contributionID: string) {
  const realRoot = await fs.realpath(root)
  const absolute = await fs.realpath(path.resolve(realRoot, file))
  const relative = path.relative(realRoot, absolute)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw pluginError("capability_denied", `贡献文件越出插件目录：${contributionID}`, {
      pluginID,
      contributionID,
    })
  }
  const stat = await fs.stat(absolute)
  if (!stat.isFile()) {
    throw pluginError("contribution_invalid", `贡献文件不是普通文件：${contributionID}`, { pluginID, contributionID })
  }
  return fs.readFile(absolute, "utf8")
}

export async function loadToolEntries(input: {
  root: string
  declarations: readonly ToolDeclaration[]
  context: PluginContext
}): Promise<ToolContribution[]> {
  const tools: ToolContribution[] = []
  for (const declaration of input.declarations) {
    tools.push(await loadToolEntry({ root: input.root, declaration, context: input.context }))
  }
  return tools
}

/**
 * 延迟激活的工具贡献（§6.3、§6.4「首次 onTool 触发的激活 + 首次调用」）。
 *
 * 声明里已经有静态 schema，模型在索引期就能看到名称/描述/参数；entry 模块要等第一次调用才导入，
 * 且只导入一次。这样启动期不会为从未被调用的工具付模块加载成本。
 */
export function createLazyToolEntries(input: {
  root: string
  declarations: readonly ToolDeclaration[]
  context: PluginContext
}): ToolContribution[] {
  const pending = new Map<string, Promise<ToolContribution["execute"]>>()
  return input.declarations.map((declaration) => {
    if (!declaration.entry) {
      throw pluginError("contribution_invalid", `工具缺少可执行 entry：${declaration.id}`, {
        pluginID: input.context.id,
        contributionID: declaration.id,
      })
    }
    return {
      id: declaration.id,
      description: declaration.description,
      parameters: declaration.parameters,
      ...(declaration.global === undefined ? {} : { global: declaration.global }),
      safety: { ...toolSafetyDefaults, ...declaration.safety },
      async execute(args, context) {
        if (input.context.signal.aborted) {
          throw pluginError("tool_unavailable", `插件 ${input.context.id} 已停用`, {
            pluginID: input.context.id,
            contributionID: declaration.id,
          })
        }
        let execute = pending.get(declaration.id)
        if (!execute) {
          // 失败不缓存：模块/工厂的问题修好后，下一次调用仍有机会成功。
          execute = loadToolEntry({ root: input.root, declaration, context: input.context })
            .then((tool) => tool.execute)
            .catch((error: unknown) => {
              pending.delete(declaration.id)
              throw error
            })
          pending.set(declaration.id, execute)
        }
        return (await execute)(args, context)
      },
    }
  })
}

/** 静态 schema 齐全、且 activationEvents 没要求启动即活的插件，工具 entry 才能延迟导入。 */
export function shouldDeferTools(manifest: Manifest): boolean {
  const events = manifest.activationEvents
  if (events === undefined || events.length === 0) return false
  if (events.includes("onStartup") || events.includes("onSessionStart")) return false
  return (manifest.contributes.tools ?? []).every(
    (declaration) => typeof declaration.entry === "string" && declaration.entry !== "",
  )
}

async function loadToolEntry(input: {
  root: string
  declaration: ToolDeclaration
  context: PluginContext
}): Promise<ToolContribution> {
  const declaration = input.declaration
  if (!declaration.entry) {
    throw pluginError("contribution_invalid", `工具缺少可执行 entry：${declaration.id}`, {
      pluginID: input.context.id,
      contributionID: declaration.id,
    })
  }
  const root = await fs.realpath(input.root)
  const entry = path.resolve(root, declaration.entry)
  const resolved = await fs.realpath(entry)
  const relative = path.relative(root, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`工具 entry 路径越界：${declaration.id}`)
  }
  const module = await import(pathToFileURL(resolved).href)
  const factory: unknown = module.default
  if (typeof factory !== "function") {
    throw new Error(`工具 entry 必须默认导出工厂：${declaration.id}`)
  }
  const implementation: unknown = await factory(input.context)
  if (
    implementation === null ||
    typeof implementation !== "object" ||
    !("execute" in implementation) ||
    typeof implementation.execute !== "function"
  ) {
    throw new Error(`工具 entry 工厂必须返回 execute：${declaration.id}`)
  }
  const execute = implementation.execute as ToolContribution["execute"]
  return {
    id: declaration.id,
    description: declaration.description,
    parameters: declaration.parameters,
    ...(declaration.global === undefined ? {} : { global: declaration.global }),
    safety: { ...toolSafetyDefaults, ...declaration.safety },
    execute,
  }
}

function createOwner<Ctx extends PluginContext | KernelApi>(
  context: (signal: AbortSignal, resources: ReturnType<typeof createStack>) => Ctx,
) {
  let current:
    | {
        controller: AbortController
        resources: ReturnType<typeof createStack>
        pending: Promise<void>
        active: boolean
      }
    | undefined

  return {
    get active() {
      return current?.active === true && !current.controller.signal.aborted
    },
    activate(activate: PluginActivation<Ctx>): Promise<void> {
      if (current) return current.pending
      const controller = new AbortController()
      const resources = createStack()
      const api = context(controller.signal, resources)
      const run = { controller, resources, pending: Promise.resolve(), active: false }
      current = run
      run.pending = Promise.resolve()
        .then(() => {
          controller.signal.throwIfAborted()
          return activate(api)
        })
        .then(() => {
          controller.signal.throwIfAborted()
          run.active = true
        })
        .catch((error: unknown) => {
          controller.abort()
          resources.dispose()
          if (current === run) current = undefined
          throw error
        })
      return run.pending
    },
    dispose() {
      const run = current
      if (!run) return
      current = undefined
      run.controller.abort()
      run.resources.dispose()
    },
  }
}
