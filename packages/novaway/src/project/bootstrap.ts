import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "@/lsp/lsp"
import { File } from "../file"
import { Snapshot } from "../snapshot"
import * as Project from "./project"
import * as Vcs from "./vcs"
import { Bus } from "../bus"
import { InstanceState } from "@/effect/instance-state"
import { FileWatcher } from "@/file/watcher"
import { ShareNext } from "@/share/share-next"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { Global } from "@novaway/core/global"
import { PluginHost } from "@/plugin/host"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import { PluginStorage } from "@/plugin/storage"
import { Service } from "./bootstrap-service"
import { Reference } from "@/reference/reference"

export { Service } from "./bootstrap-service"
export type { Interface } from "./bootstrap-service"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // Yield each bootstrap dep at layer init so `run` itself has R = never.
    // InstanceStore imports only the lightweight tag from bootstrap-service.ts,
    // so it can depend on bootstrap without importing this implementation graph.
    const config = yield* Config.Service
    const pluginRuntime = yield* PluginRuntimeService.Service
    const file = yield* File.Service
    const fileWatcher = yield* FileWatcher.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const plugin = yield* Plugin.Service
    const project = yield* Project.Service
    const reference = yield* Reference.Service
    const shareNext = yield* ShareNext.Service
    const snapshot = yield* Snapshot.Service
    const vcs = yield* Vcs.Service

    const run = Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      yield* Effect.logInfo("bootstrapping").pipe(Effect.annotateLogs("directory", ctx.directory))
      // everything depends on config so eager load it for nice traces
      yield* config.get()
      if (ctx.scope === "global") return
      // Plugin can mutate config so it has to be initialized before anything else.
      yield* plugin.init()
      const cfg = yield* config.get()
      const persisted = PluginStorage.listForInstance(ctx.directory)
      const enabled = persisted
        .filter((item) => item.enabled === 1)
        .map((item) => `${item.scope}:${item.plugin_id}`)
      const disabled = [
        ...(cfg.plugins?.disabled ?? []),
        ...persisted.filter((item) => item.enabled === 0).map((item) => `${item.scope}:${item.plugin_id}`),
      ]
      const discovered = yield* Effect.promise(() =>
        PluginHost.inspect({
          config: Global.Path.config,
          home: Global.Path.home,
          directory: ctx.directory,
          worktree: ctx.worktree,
          plugins: cfg.plugin_origins,
          disabled,
          enabled,
        }),
      )
      const enabledInstances = discovered.instances.filter(
        (item) =>
          item.adapter === "v2" &&
          item.status === "installed" &&
          (item.scope === "builtin" || enabled.includes(`${item.scope}:${item.id}`)),
      )
      yield* Effect.forEach(
        enabledInstances,
        (item) =>
          (item.scope === "builtin"
            ? pluginRuntime.activateBuiltin(item)
            : pluginRuntime.setEnabled(item, true)
          ).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("persisted plugin activation failed", { pluginID: item.id, scope: item.scope, cause }),
            ),
          ),
        { concurrency: 1, discard: true },
      )
      // Each service self-manages its own slow work via Effect.forkScoped against
      // its per-instance state scope. We just await materialization here.
      yield* Effect.forEach(
        [reference, lsp, shareNext, format, file, fileWatcher, vcs, snapshot, project],
        (s) => s.init().pipe(Effect.catchCause((cause) => Effect.logWarning("init failed", { cause }))),
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.withSpan("InstanceBootstrap.init"))
    }).pipe(Effect.withSpan("InstanceBootstrap"))

    return Service.of({ run })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide([
    Bus.layer,
    Config.defaultLayer,
    File.defaultLayer,
    FileWatcher.defaultLayer,
    Format.defaultLayer,
    LSP.defaultLayer,
    Plugin.defaultLayer,
    PluginRuntimeService.defaultLayer,
    Project.defaultLayer,
    Reference.defaultLayer,
    ShareNext.defaultLayer,
    Snapshot.defaultLayer,
    Vcs.defaultLayer,
  ]),
)

export * as InstanceBootstrap from "./bootstrap"
