import path from "node:path"
import type { ContributionKind, PluginScope, PluginStatus, ViewRender } from "@novaway/plugin-api"
import { createRegistry, type Source } from "./contributions/registry"
import type { Instance } from "./host"
import { isRecord } from "@/util/record"

type Match = {
  tool?: string
  partType?: string
  extension?: string | string[]
  format?: string | string[]
  mime?: string | string[]
}

export type Entry = {
  pluginID: string
  kind: ContributionKind
  name: string
  localName: string
  scope: PluginScope
  origin: Instance["origin"]
  adapter: Instance["adapter"]
  status: PluginStatus
  path?: string
  slot?: string
  title?: string
  description?: string
  icon?: string
  action?: unknown
  view?: unknown
  render?: ViewRender
  order?: number
  match?: Match
  viewId?: string
  priority?: number
  readOnly?: boolean
}

type Declaration = {
  id: string
  global?: boolean
  path?: string
  slot?: string
  title?: string
  description?: string
  icon?: string
  action?: unknown
  view?: unknown
  render?: ViewRender
  order?: number
  match?: Match
  viewId?: string
  priority?: number
  readOnly?: boolean
}

type Candidate = { source: Source; instance: Instance; kind: ContributionKind; item: Declaration }

const kinds = {
  tools: "tool",
  agents: "agent",
  skills: "skill",
  commands: "command",
  providers: "provider",
  officeEngines: "office-engine",
  previewers: "previewer",
  publishDrivers: "publish-driver",
  surfaces: "surface",
  interceptors: "interceptor",
  mcpServers: "mcp",
  outputStyles: "output-style",
  httpRoutes: "http-route",
  lspServers: "lsp",
  triggers: "trigger",
  fastPath: "fast-path",
  routingPolicies: "routing-policy",
  workerTypes: "worker-type",
  watchdogPolicies: "watchdog-policy",
  channels: "channel",
  agentRuntimes: "agent-runtime",
  superAgentStrategies: "super-agent-strategy",
  taskKinds: "task-kind",
  verifiers: "verifier",
  repairStrategies: "repair-strategy",
  agentTemplates: "agent-template",
  superAgentPolicies: "super-agent-policy",
  superAgentSurfaces: "super-agent-surface",
} as const satisfies Partial<Record<keyof Instance["manifest"]["contributes"], ContributionKind>>

export function tuiContribution(instance: Instance, json: Record<string, unknown>, root: string) {
  if (instance.location.kind !== "spec" || !instance.location.tui) return []
  const exports = json.exports
  if (!isRecord(exports)) return []
  const target = exports["./tui"]
  const entry =
    typeof target === "string"
      ? target
      : isRecord(target)
        ? (string(target.import) ?? string(target.default))
        : undefined
  if (entry === undefined) return []
  const resolved = path.resolve(root, entry)
  const relative = path.relative(root, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return []
  return [{ extension: instance.id, root, kind: "surface", name: "tui", path: relative.split(path.sep).join("/") }]
}

export function list(
  instances: readonly Instance[],
  query?: { kind?: ContributionKind; slot?: string },
  legacy: readonly { extension: string; root: string; kind: string; name?: string; path?: string }[] = [],
): Entry[] {
  const candidates: Candidate[] = []
  for (const instance of instances) {
    if (instance.status !== "installed" && instance.status !== "active") continue
    const source: Source = {
      pluginID: instance.id,
      scope: instance.scope,
      priority: instance.manifest.priority,
      installOrder: instance.installOrder,
      overrides: instance.manifest.overrides,
    }
    for (const [key, kind] of Object.entries(kinds) as [keyof typeof kinds, ContributionKind][]) {
      for (const item of declarations(key, instance.manifest.contributes[key])) {
        if (query?.kind !== undefined && query.kind !== kind) continue
        if (query?.slot !== undefined && item.slot !== query.slot) continue
        candidates.push({ source, instance, kind, item })
      }
    }
  }

  const byID = new Map(instances.map((instance) => [instance.id, instance]))
  for (const item of legacy) {
    const instance = byID.get(item.extension)
    const kind = item.kind === "hook" ? "interceptor" : item.kind
    if (instance === undefined || (instance.status !== "installed" && instance.status !== "active")) continue
    if (!isContributionKind(kind)) continue
    if (query?.kind !== undefined && query.kind !== kind) continue
    const declaration: Declaration = {
      id: item.name ?? (item.path === undefined ? item.extension : fileID(item.path)),
      ...(item.path === undefined ? {} : { path: item.path }),
    }
    if (query?.slot !== undefined) continue
    candidates.push({
      source: {
        pluginID: instance.id,
        scope: instance.scope,
        priority: instance.manifest.priority,
        installOrder: instance.installOrder,
        overrides: instance.manifest.overrides,
      },
      instance,
      kind,
      item: declaration,
    })
  }

  const registries = new Map<ContributionKind, ReturnType<typeof createRegistry<Declaration>>>()
  const metadata = new Map<string, Candidate>()
  for (const candidate of candidates) {
    let registry = registries.get(candidate.kind)
    if (registry === undefined) {
      registry = createRegistry({
        kind: candidate.kind,
        policy: candidate.kind === "agent" || candidate.kind === "command" ? "override" : "accumulate",
      })
      registries.set(candidate.kind, registry)
    }
    registry.register(candidate.source, candidate.item)
    metadata.set(`${candidate.kind}\u0000${candidate.instance.id}\u0000${candidate.item.id}`, candidate)
  }

  return [...registries].flatMap(([kind, registry]) =>
    registry.list().flatMap((registered) => {
      const candidate = metadata.get(`${kind}\u0000${registered.pluginID}\u0000${registered.localName}`)
      if (candidate === undefined) return []
      return [
        {
          pluginID: registered.pluginID,
          kind,
          name: registered.name,
          localName: registered.localName,
          scope: registered.scope,
          origin: candidate.instance.origin,
          adapter: candidate.instance.adapter,
          status: candidate.instance.status,
          ...(registered.item.path === undefined ? {} : { path: registered.item.path }),
          ...(registered.item.slot === undefined ? {} : { slot: registered.item.slot }),
          ...(registered.item.order === undefined ? {} : { order: registered.item.order }),
          ...(registered.item.title === undefined ? {} : { title: registered.item.title }),
          ...(registered.item.description === undefined ? {} : { description: registered.item.description }),
          ...(registered.item.icon === undefined ? {} : { icon: registered.item.icon }),
          ...(registered.item.action === undefined ? {} : { action: registered.item.action }),
          ...(registered.item.view === undefined ? {} : { view: registered.item.view }),
          ...(registered.item.render === undefined ? {} : { render: registered.item.render }),
          ...(registered.item.match === undefined ? {} : { match: registered.item.match }),
          ...(registered.item.viewId === undefined ? {} : { viewId: registered.item.viewId }),
          ...(registered.item.priority === undefined ? {} : { priority: registered.item.priority }),
          ...(registered.item.readOnly === undefined ? {} : { readOnly: registered.item.readOnly }),
        },
      ]
    }),
  )
}

const legacyKinds = new Set<ContributionKind>([...Object.values(kinds), "output-style"])

function isContributionKind(value: string): value is ContributionKind {
  return legacyKinds.has(value as ContributionKind)
}

function match(value: unknown): Match | undefined {
  if (!isRecord(value)) return undefined
  const strings = (field: unknown): string | string[] | undefined => {
    if (typeof field === "string") return field
    if (Array.isArray(field) && field.every((item) => typeof item === "string")) return field
    return undefined
  }
  return {
    ...(typeof value.tool === "string" ? { tool: value.tool } : {}),
    ...(typeof value.partType === "string" ? { partType: value.partType } : {}),
    ...(strings(value.extension) === undefined ? {} : { extension: strings(value.extension) }),
    ...(strings(value.format) === undefined ? {} : { format: strings(value.format) }),
    ...(strings(value.mime) === undefined ? {} : { mime: strings(value.mime) }),
  }
}

function declarations(key: string, value: unknown): Declaration[] {
  if (value === undefined) return []
  if (key === "mcpServers" && isRecord(value)) return Object.keys(value).map((id) => ({ id }))
  if (typeof value === "string") return [{ id: fileID(value), path: value }]
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === "string") return [{ id: fileID(item), path: item }]
    if (!isRecord(item)) return []
    const id = string(item.id) ?? string(item.format) ?? string(item.name) ?? string(item.title)
    if (id === undefined) return []
    return [
      {
        id,
        ...(item.global === true ? { global: true } : {}),
        ...(string(item.entry) === undefined ? {} : { path: string(item.entry) }),
        ...(string(item.path) === undefined ? {} : { path: string(item.path) }),
        ...(string(item.slot) === undefined ? {} : { slot: string(item.slot) }),
        ...(string(item.title) === undefined ? {} : { title: string(item.title) }),
        ...(string(item.description) === undefined ? {} : { description: string(item.description) }),
        ...(string(item.icon) === undefined ? {} : { icon: string(item.icon) }),
        ...(item.action === undefined ? {} : { action: item.action }),
        ...(item.view === undefined ? {} : { view: item.view }),
        ...(viewRender(item.render) === undefined ? {} : { render: viewRender(item.render) }),
        ...(typeof item.order === "number" && Number.isFinite(item.order) ? { order: item.order } : {}),
        ...(match(item.match) === undefined ? {} : { match: match(item.match) }),
        ...(string(item.viewId) === undefined ? {} : { viewId: string(item.viewId) }),
        ...(typeof item.priority === "number" && Number.isFinite(item.priority) ? { priority: item.priority } : {}),
        ...(typeof item.readOnly === "boolean" ? { readOnly: item.readOnly } : {}),
      },
    ]
  })
}

function fileID(value: string) {
  return path.basename(value, path.extname(value)) || value
}

function viewRender(value: unknown): ViewRender | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined
  if (value.type === "builtin" && typeof value.component === "string") {
    return { type: "builtin", component: value.component }
  }
  if (value.type === "iframe" && typeof value.url === "string") {
    return { type: "iframe", url: value.url }
  }
  return undefined
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export * as PluginCatalog from "./catalog"
