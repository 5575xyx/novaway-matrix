import type {
  AgentContribution,
  CommandContribution,
  EventSourceContribution,
  Manifest,
  OfficeEngineContribution,
  PreviewContribution,
  PluginScope,
  ProviderAdapter,
  PublishDriverContribution,
  SchedulerContribution,
  SkillContribution,
  SurfaceContribution,
  ToolContribution,
} from "@novaway/plugin-api"
import { pluginError } from "@novaway/plugin-api"
import type { ContributionRegistry } from "../contributions/registry"
import type { Registries } from "./context"
import type { InterceptorRuntime } from "./hooks"
import { createAgentRegistry, createCommandRegistry, createSkillRegistry, createToolRegistry } from "../contributions"
import { createInterceptorRuntime } from "./hooks"
import { createStack } from "./disposable"

export type HostRegistries = Omit<Registries, "tools" | "agents" | "skills" | "commands"> & {
  tools: ContributionRegistry<ToolContribution>
  agents: ContributionRegistry<AgentContribution>
  skills: ContributionRegistry<SkillContribution>
  commands: ContributionRegistry<CommandContribution>
  providers?: Registries["providers"]
  office?: Registries["office"]
  previewers?: ContributionRegistry<PreviewContribution>
  publish?: Registries["publish"]
  surfaces?: Registries["surfaces"]
  schedulers?: Registries["schedulers"]
  eventSources?: Registries["eventSources"]
  interceptors: InterceptorRuntime
}

export type Plugin = {
  id: string
  scope: PluginScope
  manifest: Manifest
  installOrder?: number
  root: string
  activate: (input: {
    registries: HostRegistries
    signal: AbortSignal
    resources: ReturnType<typeof createStack>
  }) => Promise<void>
}

export type State = {
  id: string
  status: "installed" | "activating" | "active" | "failed" | "disabled"
  error?: unknown
}

export type Host = {
  readonly registries: HostRegistries
  readonly states: () => readonly State[]
  state(pluginID: string, scope: PluginScope): State | undefined
  activate(plugin: Plugin): Promise<void>
  load(plugin: Plugin): Promise<void>
  deactivate(pluginID: string, scope?: PluginScope): void
  dispose(): void
}

export function createHost(hostRegistries: HostRegistries): Host {
  const active = new Map<
    string,
    { controller: AbortController; resources: ReturnType<typeof createStack>; pending: Promise<void> }
  >()
  const states = new Map<string, State>()
  const cleanupFailures = new Map<string, ReturnType<typeof pluginError>>()
  let disposed = false

  function cleanupFailure(id: string, errors: readonly unknown[]) {
    const error = pluginError(
      "cleanup_failed",
      errors.map((error) => (error instanceof Error ? error.message : String(error))).join("; "),
      {
        pluginID: id.slice(id.indexOf(":") + 1),
        retryable: false,
      },
    )
    cleanupFailures.set(id, error)
    return error
  }

  function instanceID(plugin: Pick<Plugin, "id" | "scope">) {
    return `${plugin.scope}:${plugin.id}`
  }

  function state(id: string, status: State["status"], error?: unknown) {
    const next: State = { id, status, ...(error === undefined ? {} : { error }) }
    states.set(id, next)
    return next
  }

  function scopedRegistries(
    plugin: Plugin,
    ownerID: string,
    signal: AbortSignal,
    resources: ReturnType<typeof createStack>,
  ): HostRegistries {
    const bind = <T extends { id: string; global?: boolean }>(registry: ContributionRegistry<T>) => ({
      ...registry,
      register(source: Parameters<ContributionRegistry<T>["register"]>[0], item: T) {
        signal.throwIfAborted()
        return registry.register(
          { ...source, pluginID: plugin.id, scope: plugin.scope, ownerID, root: plugin.root },
          item,
        )
      },
      release() {
        signal.throwIfAborted()
        registry.release(ownerID)
      },
    })
    const interceptors = {
      ...hostRegistries.interceptors,
      register(
        source: Parameters<InterceptorRuntime["register"]>[0],
        item: Parameters<InterceptorRuntime["register"]>[1],
      ) {
        signal.throwIfAborted()
        return hostRegistries.interceptors.register(
          { ...source, pluginID: plugin.id, scope: plugin.scope, ownerID },
          item,
        )
      },
      release() {
        signal.throwIfAborted()
        hostRegistries.interceptors.release(plugin.id, ownerID)
      },
    }
    const tools = bind(hostRegistries.tools)
    const previewers = hostRegistries.previewers === undefined ? undefined : bind(hostRegistries.previewers)
    const providers =
      hostRegistries.providers === undefined
        ? undefined
        : {
            ...hostRegistries.providers,
            register(item: ProviderAdapter) {
              signal.throwIfAborted()
              const disposable = hostRegistries.providers!.register(item)
              return resources.push(disposable)
            },
          }
    const office =
      hostRegistries.office === undefined
        ? undefined
        : {
            ...hostRegistries.office,
            register(item: OfficeEngineContribution) {
              signal.throwIfAborted()
              const disposable = hostRegistries.office!.register(item)
              return resources.push(disposable)
            },
          }
    const publish =
      hostRegistries.publish === undefined
        ? undefined
        : {
            ...hostRegistries.publish,
            register(item: PublishDriverContribution) {
              signal.throwIfAborted()
              const disposable = hostRegistries.publish!.register(item)
              return resources.push(disposable)
            },
          }
    const surfaces =
      hostRegistries.surfaces === undefined
        ? undefined
        : {
            ...hostRegistries.surfaces,
            register(item: SurfaceContribution) {
              signal.throwIfAborted()
              const disposable = hostRegistries.surfaces!.register(item)
              return resources.push(disposable)
            },
          }
    return {
      ...hostRegistries,
      tools: {
        ...tools,
        register(source, item) {
          return tools.register(source, {
            ...item,
            async execute(args, context) {
              // A cached turn/tool snapshot never revives after a later enable.
              if (signal.aborted) {
                throw pluginError("tool_unavailable", `插件 ${plugin.id} 已停用`, {
                  pluginID: plugin.id,
                  contributionID: item.id,
                })
              }
              return item.execute(args, { ...context, abort: AbortSignal.any([signal, context.abort]) })
            },
          })
        },
      },
      agents: bind(hostRegistries.agents),
      skills: bind(hostRegistries.skills),
      commands: bind(hostRegistries.commands),
      ...(providers === undefined ? {} : { providers }),
      ...(office === undefined ? {} : { office }),
      ...(previewers === undefined ? {} : { previewers }),
      ...(publish === undefined ? {} : { publish }),
      ...(surfaces === undefined ? {} : { surfaces }),
      interceptors,
    }
  }

  function release(ownerID: string) {
    hostRegistries.tools.release(ownerID)
    hostRegistries.agents.release(ownerID)
    hostRegistries.skills.release(ownerID)
    hostRegistries.commands.release(ownerID)
    hostRegistries.previewers?.release(ownerID)
    hostRegistries.interceptors.release(ownerID, ownerID)
  }

  function deactivate(pluginID: string, scope?: PluginScope) {
    const ids =
      scope === undefined ? [...states.keys()].filter((id) => id.endsWith(`:${pluginID}`)) : [`${scope}:${pluginID}`]
    const failures: unknown[] = []
    for (const id of ids.length === 0 && scope === undefined ? [pluginID] : ids) {
      const current = active.get(id)
      if (!current) {
        release(id)
        const error = cleanupFailures.get(id)
        if (error) failures.push(error)
        else if (scope !== undefined || states.has(id)) state(id, "disabled")
        continue
      }
      active.delete(id)
      current.controller.abort()
      current.resources.dispose()
      release(id)
      const error = current.resources.errors.length > 0 ? cleanupFailure(id, current.resources.errors) : undefined
      state(id, error ? "failed" : "disabled", error)
      if (error) failures.push(error)
      void current.pending.catch(() => undefined)
    }
    if (scope === undefined) release(pluginID)
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1)
      throw pluginError("cleanup_failed", failures.map(String).join("; "), { pluginID, retryable: false })
  }

  function load(plugin: Plugin): Promise<void> {
    const id = instanceID(plugin)
    if (!states.has(id)) state(id, "installed")
    return activate(plugin)
  }

  function activate(plugin: Plugin): Promise<void> {
    if (disposed) return Promise.reject(new Error("Plugin host is disposed"))
    const id = instanceID(plugin)
    const unresolved = cleanupFailures.get(id)
    if (unresolved) return Promise.reject(unresolved)
    const ownerID = id
    const current = active.get(id)
    if (current) return current.pending
    const controller = new AbortController()
    const resources = createStack()
    state(id, "activating")
    const run = {
      controller,
      resources,
      pending: Promise.resolve(),
    }
    active.set(id, run)
    run.pending = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted()
        return plugin.activate({
          registries: scopedRegistries(plugin, ownerID, controller.signal, resources),
          signal: controller.signal,
          resources,
        })
      })
      .then(() => {
        controller.signal.throwIfAborted()
        if (active.get(id) === run) state(id, "active")
      })
      .catch((error: unknown) => {
        const wasCancelled = controller.signal.aborted
        controller.abort()
        resources.dispose()
        const cleanup = resources.errors.length > 0 ? cleanupFailure(id, [error, ...resources.errors]) : undefined
        if (active.get(id) === run) {
          active.delete(id)
          release(ownerID)
          state(id, cleanup || !wasCancelled ? "failed" : "disabled", cleanup ?? (wasCancelled ? undefined : error))
        }
        throw cleanup ?? error
      })
    return run.pending
  }

  return {
    registries: hostRegistries,
    states: () => [...states.values()],
    state(pluginID, scope) {
      return states.get(`${scope}:${pluginID}`)
    },
    activate,
    load,
    deactivate,
    dispose() {
      if (disposed) return
      disposed = true
      const failures: unknown[] = []
      for (const id of [...active.keys()].reverse()) {
        const separator = id.indexOf(":")
        try {
          deactivate(id.slice(separator + 1), id.slice(0, separator) as PluginScope)
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1)
        throw pluginError("cleanup_failed", failures.map(String).join("; "), { retryable: false })
    },
  }
}

export * as PluginRuntimeHost from "./host"
