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
import { Effect, Layer, Option } from "effect"
import { Config } from "@/config/config"
import { Global } from "@novaway/core/global"
import { PluginHost } from "@/plugin/host"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import { PluginStorage } from "@/plugin/storage"
import { Service } from "./bootstrap-service"
import { Reference } from "@/reference/reference"
import * as Marketplace from "@/extension/marketplace"
import * as MarketplaceOperations from "@/extension/operations"
import { Service as CronService } from "@/cron/service"
import { SuperAgentStore } from "@/super-agent"
import { ensureSuperAgentHost } from "@/super-agent/host-service"
import { bindExecutableSuperAgentContributions } from "@/super-agent/plugin-contributions"
import { Permission } from "@/permission"
import { MCP } from "@/mcp"
import { Provider } from "@/provider/provider"
import { ProviderID } from "@/provider/schema"
import { startSuperAgentRun } from "@/super-agent/launcher"
import { createModelVerifier } from "@/super-agent/model-verifier"
import { planGoalWithModel, materializeGoalPlan } from "@/super-agent/planner"
import { SessionID } from "@/session/schema"
import * as Session from "../session/session"
import { Service as ToolRegistryService } from "@/tool/registry"

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
    const cron = Option.getOrUndefined(yield* Effect.serviceOption(CronService))
    const superAgentStore = Option.getOrUndefined(yield* Effect.serviceOption(SuperAgentStore))
    const toolRegistry = Option.getOrUndefined(yield* Effect.serviceOption(ToolRegistryService))
    const permission = Option.getOrUndefined(yield* Effect.serviceOption(Permission.Service))
    const mcp = Option.getOrUndefined(yield* Effect.serviceOption(MCP.Service))
    const provider = Option.getOrUndefined(yield* Effect.serviceOption(Provider.Service))
    const sessions = Option.getOrUndefined(yield* Effect.serviceOption(Session.Service))

    const run = Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      yield* Effect.logInfo("bootstrapping").pipe(Effect.annotateLogs("directory", ctx.directory))
      // everything depends on config so eager load it for nice traces
      yield* config.get()
      // A process may leave staging directories or durable operations mid-flight.
      // Recover them before PluginHost discovery so consumers never index partial trees.
      yield* Effect.promise(() => Marketplace.recover()).pipe(
        Effect.catchCause((cause) => Effect.logWarning("marketplace recovery failed", { cause })),
      )
      yield* Effect.promise(() => MarketplaceOperations.recover()).pipe(
        Effect.catchCause((cause) => Effect.logWarning("marketplace operation recovery failed", { cause })),
      )
      if (ctx.scope === "global") return
      // Start the durable scheduler as part of instance bootstrap, not on the
      // first user prompt. A restarted instance can therefore resume goals even
      // while the UI is idle.
      if (cron) yield* cron.start({ directory: ctx.directory }).pipe(Effect.ignore)
      // Plugin can mutate config so it has to be initialized before anything else.
      yield* plugin.init()
      const cfg = yield* config.get()
      const persisted = PluginStorage.listForInstance(ctx.directory)
      const enabled = persisted.filter((item) => item.enabled === 1).map((item) => `${item.scope}:${item.plugin_id}`)
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
          (item.scope === "builtin" ? pluginRuntime.activateBuiltin(item) : pluginRuntime.setEnabled(item, true)).pipe(
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
      if (superAgentStore && toolRegistry && permission) {
        const pluginHost = yield* pluginRuntime.get
        const bindings = bindExecutableSuperAgentContributions(pluginHost.registries.superAgent)
        ensureSuperAgentHost(ctx, superAgentStore, {
          execution: {
            registry: toolRegistry,
            permission,
            ...(mcp ? { mcp } : {}),
            delegation: bindings.runtimes,
            cleanup: bindings.dispose,
            ...(provider && sessions
              ? {
                  recover: (runID: string) =>
                    Effect.runPromise(startSuperAgentRun({ store: superAgentStore, sessions, provider, toolRegistry }, runID)),
                  judge: async ({ run, criterion, evidence }) => {
                    try {
                      const session = await Effect.runPromise(sessions.get(run.goal.sessionId as SessionID).pipe(Effect.orDie))
                      const configured = run.goal.executionConfig?.judgeModel?.trim()
                      const selected = configured?.includes("/")
                        ? Provider.parseModel(configured)
                        : session.model
                          ? { providerID: session.model.providerID, modelID: session.model.id }
                          : await Effect.runPromise(provider.defaultModel())
                      const model = await Effect.runPromise(provider.getModel(ProviderID.make(selected.providerID), selected.modelID))
                      const language = await Effect.runPromise(provider.getLanguage(model))
                      return await createModelVerifier({
                        model: language,
                        maxOutputTokens: run.goal.executionConfig?.maxTokens,
                        minReasonBytes: run.goal.executionConfig?.evidenceMinBytes,
                      }).verify({ runID: run.id, criterion, evidence })
                    } catch (error) {
                      return {
                        outcome: "unverified" as const,
                        evidenceIDs: [],
                        reason: `durable judge unavailable: ${String(error)}`,
                      }
                    }
                  },
                  replan: async ({ run, reason }) => {
                    const session = await Effect.runPromise(sessions.get(run.goal.sessionId as SessionID).pipe(Effect.orDie))
                    const configured = run.goal.executionConfig?.judgeModel?.trim()
                    const selected = configured?.includes("/")
                      ? Provider.parseModel(configured)
                      : session.model
                        ? { providerID: session.model.providerID, modelID: session.model.id }
                        : await Effect.runPromise(provider.defaultModel())
                    const model = await Effect.runPromise(provider.getModel(ProviderID.make(selected.providerID), selected.modelID))
                    const language = await Effect.runPromise(provider.getLanguage(model))
                    const definitions = await Effect.runPromise(toolRegistry.all())
                    const plan = await planGoalWithModel({
                      model: language,
                      run,
                      availableTools: definitions.map((definition) => definition.id),
                      reason,
                    })
                    return materializeGoalPlan(run, plan)
                  },
                }
              : {}),
          },
        })
      }
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
