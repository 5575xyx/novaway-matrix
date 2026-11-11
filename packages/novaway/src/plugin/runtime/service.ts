import { Context, Effect, Layer, Semaphore } from "effect"
import { createHash } from "node:crypto"
import path from "node:path"
import { Global } from "@novaway/core/global"
import * as Log from "@novaway/core/util/log"
import { isPluginError, pluginError, type PluginError, type PluginStatus } from "@novaway/plugin-api"
import { InstanceState } from "@/effect/instance-state"
import type { Instance as DiscoveredPlugin } from "../host"
import { PluginStorage } from "../storage"
import { createAgentRegistry, createCommandRegistry, createOfficeRegistry, createProviderRegistry, createPublishRegistry, createPreviewerRegistry, createSkillRegistry, createSurfaceRegistry, createToolRegistry } from "../contributions"
import { createDiscoveredPlugin } from "./activation"
import { createInterceptorRuntime } from "./hooks"
import { createHost, type Host, type Plugin as RuntimePlugin } from "./host"
import { createSecretStore } from "./secrets"
import * as EffectLogger from "@novaway/core/effect/logger"

const log = Log.create({ service: "plugin-runtime" })

export interface Interface {
  readonly get: Effect.Effect<Host>
  readonly invalidate: Effect.Effect<void>
  readonly setEnabled: (instance: DiscoveredPlugin, enabled: boolean) => Effect.Effect<void, PluginError>
  /** Activate a shipped builtin default without creating user-state on disk. */
  readonly activateBuiltin: (instance: DiscoveredPlugin) => Effect.Effect<void, PluginError>
}

export class Service extends Context.Service<Service, Interface>()("@novaway/PluginRuntimeHost") {}

export const layer: Layer.Layer<Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make((context) =>
      Effect.gen(function* () {
        const host = createHost({
          tools: createToolRegistry(),
          agents: createAgentRegistry(),
          skills: createSkillRegistry(),
          commands: createCommandRegistry(),
          providers: createProviderRegistry(),
          office: createOfficeRegistry(),
          publish: createPublishRegistry(),
          surfaces: createSurfaceRegistry(),
          previewers: createPreviewerRegistry(),
          interceptors: createInterceptorRuntime(),
        })
        const lock = Semaphore.makeUnsafe(1)
        const loaded = new Map<string, RuntimePlugin>()
        const persist = (instance: DiscoveredPlugin, enabled: boolean, status: PluginStatus, error?: PluginError) =>
          instance.scope === "session"
            ? Effect.void
            : Effect.try({
            try: () =>
              PluginStorage.save({
                pluginID: instance.id,
                scope: instance.scope,
                instanceKey: instance.scope === "project" ? context.directory : "",
                source: instance.location.kind === "directory" ? instance.location.root : instance.location.spec,
                root: instance.location.kind === "directory" ? instance.location.root : undefined,
                version: instance.manifest.version,
                enabled,
                status,
                installOrder: instance.installOrder,
                lastError: error ? { code: error.code, message: error.message, at: Date.now() } : null,
                activatedAt: status === "active" ? Date.now() : undefined,
              }),
            catch: (error) => pluginError("storage_conflict", String(error), { pluginID: instance.id }),
          }).pipe(Effect.asVoid)
        const persistIf = (
          shouldPersist: boolean,
          instance: DiscoveredPlugin,
          enabled: boolean,
          status: PluginStatus,
          error?: PluginError,
        ) => (shouldPersist ? persist(instance, enabled, status, error) : Effect.void)
        const transition = Effect.fn("PluginRuntimeHost.setEnabled")(function* (
          instance: DiscoveredPlugin,
          enabled: boolean,
          shouldPersist = true,
        ) {
          const id = `${instance.scope}:${instance.id}`
          const previous = loaded.get(id)
          if (!enabled) {
            yield* Effect.try({
              try: () => host.deactivate(instance.id, instance.scope),
              catch: (error) => failure(error, instance.id),
            }).pipe(
              Effect.catch((error) => persistIf(shouldPersist, instance, false, "failed", error).pipe(Effect.andThen(Effect.fail(error)))),
            )
            yield* persistIf(shouldPersist, instance, false, "disabled").pipe(
              Effect.catch((error) =>
                (previous
                  ? Effect.tryPromise({ try: () => host.activate(previous), catch: (cause) => failure(cause, instance.id) })
                  : Effect.void
                ).pipe(Effect.andThen(Effect.fail(error))),
              ),
            )
            loaded.delete(id)
            return
          }
          if (host.state(instance.id, instance.scope)?.status === "active" && previous) return
          const plugin = yield* Effect.try({
            try: () => {
              const identity = createHash("sha256")
                .update(`${instance.scope === "project" ? context.directory : ""}\0${id}`)
                .digest("hex")
              return createDiscoveredPlugin({
                instance,
                runtime: {
                  registries: host.registries,
                  log,
                  secrets: createSecretStore(path.join(Global.Path.data, "plugin-secrets", identity)),
                },
              })
            },
            catch: (error) => failure(error, instance.id),
          }).pipe(
            Effect.tap((plugin) =>
              Effect.tryPromise({ try: () => host.load(plugin), catch: (error) => failure(error, instance.id) }),
            ),
            Effect.catch((error) => persistIf(shouldPersist, instance, false, "failed", error).pipe(Effect.andThen(Effect.fail(error)))),
          )
          yield* persistIf(shouldPersist, instance, true, "active").pipe(
            Effect.catch((error) =>
              Effect.sync(() => host.deactivate(instance.id, instance.scope)).pipe(Effect.andThen(Effect.fail(error))),
            ),
          )
          loaded.set(id, plugin)
        })
        yield* Effect.addFinalizer(() => Effect.sync(() => host.dispose()).pipe(Effect.provide(EffectLogger.layer)))
        return {
          host,
          setEnabled: (instance: DiscoveredPlugin, enabled: boolean) => lock.withPermits(1)(transition(instance, enabled)),
          activateBuiltin: (instance: DiscoveredPlugin) => lock.withPermits(1)(transition(instance, true, false)),
        }
      }),
    )
    return Service.of({
      get: InstanceState.use(state, (current) => current.host),
      invalidate: Effect.asVoid(InstanceState.invalidate(state)),
      setEnabled: (instance, enabled) => InstanceState.useEffect(state, (current) => current.setEnabled(instance, enabled)),
      activateBuiltin: (instance) => InstanceState.useEffect(state, (current) => current.activateBuiltin(instance)),
    })
  }),
)

function failure(error: unknown, pluginID: string): PluginError {
  return isPluginError(error) ? error : pluginError("activation_failed", error instanceof Error ? error.message : String(error), { pluginID })
}

export const defaultLayer: Layer.Layer<Service> = layer

export * as PluginRuntimeService from "./service"
