import { Effect, Stream, Queue, Option } from "effect"
import * as Sse from "effect/unstable/encoding/Sse"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Global } from "@novaway/core/global"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import * as ConfigParse from "@/config/parse"
import * as ConfigPaths from "@/config/paths"
import * as ConfigPlugin from "@/config/plugin"
import { Service as ExtensionService } from "@/extension/registry"
import { InstanceState } from "@/effect/instance-state"
import { isRecord } from "@/util/record"
import { Filesystem } from "@/util/filesystem"
import { isPluginError } from "@novaway/plugin-api"
import { PluginHost } from "@/plugin/host"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import { Provider } from "@/provider/provider"
import { PluginStorage } from "@/plugin/storage"
import * as PluginCatalog from "@/plugin/catalog"
import * as PluginShared from "@/plugin/shared"
import * as PluginDiagnostics from "@/plugin/diagnostics"
import { PluginEvent } from "@/plugin/event"
import {
  listPublishAccounts,
  findPublishAccount,
  savePublishAccount,
  removePublishAccount,
} from "@/plugin/publish-accounts"
import { InstanceHttpApi } from "../api"
import { PluginTransitionError } from "../groups/plugin"

type Generation = { value: number }

function eventData(data: unknown): Sse.Event {
  return { _tag: "Event", event: "message", id: undefined, data: JSON.stringify(data) }
}

export const pluginHandlers = HttpApiBuilder.group(InstanceHttpApi, "plugin", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const extensions = yield* ExtensionService
    const bus = yield* Bus.Service
    const files = yield* AppFileSystem.Service
    const runtime = yield* PluginRuntimeService.Service
    const provider = yield* Effect.serviceOption(Provider.Service)
    const generation = yield* InstanceState.make<Generation>(() => Effect.sync(() => ({ value: 0 })))

    const tuiPlugins = Effect.fn("PluginHttpApi.tuiPlugins")(function* (ctx: { directory: string; worktree: string }) {
      const projectFiles = yield* ConfigPaths.files("tui", ctx.directory)
      const directories = yield* ConfigPaths.directories(ctx.directory)
      const candidates = [
        ...ConfigPaths.fileInDirectory(Global.Path.config, "tui"),
        ...projectFiles,
        ...directories.flatMap((dir) => (dir.endsWith(".novaway") ? ConfigPaths.fileInDirectory(dir, "tui") : [])),
      ]
      const origins: ConfigPlugin.Origin[] = []
      for (const file of candidates) {
        const text = yield* files.readFileStringSafe(file)
        if (!text) continue
        const raw = yield* Effect.sync(() => {
          try {
            return ConfigParse.jsonc(text, file)
          } catch {
            return undefined
          }
        })
        if (!isRecord(raw) || !Array.isArray(raw.plugin)) continue
        const scope = Filesystem.contains(ctx.directory, file) ? "local" : "global"
        for (const spec of raw.plugin) {
          if (typeof spec !== "string" && !Array.isArray(spec)) continue
          const resolved = yield* Effect.promise(() =>
            ConfigPlugin.resolvePluginSpec(spec as ConfigPlugin.Spec, file),
          ).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
          if (resolved !== undefined) origins.push({ spec: resolved, source: file, scope })
        }
      }
      return ConfigPlugin.deduplicatePluginOrigins(origins)
    })

    const tuiContributionPaths = Effect.fn("PluginHttpApi.tuiContributionPaths")(function* (
      instances: readonly PluginHost.Instance[],
    ) {
      const entries: Array<{ extension: string; root: string; kind: string; name?: string; path?: string }> = []
      for (const instance of instances) {
        if (instance.location.kind !== "spec" || !instance.location.tui) continue
        const target = instance.location.target
        if (target === undefined) continue
        const pkg = yield* Effect.promise(() => PluginShared.readPluginPackage(target)).pipe(
          Effect.catchCause(() => Effect.succeed(undefined)),
        )
        if (!pkg) continue
        entries.push(...PluginCatalog.tuiContribution(instance, pkg.json, pkg.dir))
      }
      return entries
    })

    const inspect = Effect.fn("PluginHttpApi.inspect")(function* (enable?: Pick<PluginHost.Instance, "id" | "scope">) {
      const ctx = yield* InstanceState.context
      const info = yield* config.get()
      const legacy = yield* extensions.list().pipe(Effect.catchCause(() => Effect.succeed([])))
      const persisted = PluginStorage.listForInstance(ctx.directory)
      const disabled = new Set([
        ...(info.plugins?.disabled ?? []),
        ...legacy.filter((item) => !item.enabled).map((item) => item.name),
        ...persisted.filter((item) => item.enabled === 0).map((item) => `${item.scope}:${item.plugin_id}`),
      ])
      const tui = yield* tuiPlugins({ directory: ctx.directory, worktree: ctx.worktree }).pipe(
        Effect.catchCause(() => Effect.succeed([] as ConfigPlugin.Origin[])),
      )
      return yield* Effect.promise(() =>
        PluginHost.inspect({
          config: Global.Path.config,
          home: Global.Path.home,
          directory: ctx.directory,
          worktree: ctx.worktree,
          plugins: info.plugin_origins,
          tuiPlugins: tui,
          disabled: [...disabled],
          enabled: [
            ...persisted.filter((item) => item.enabled === 1).map((item) => `${item.scope}:${item.plugin_id}`),
            ...(enable ? [`${enable.scope}:${enable.id}`] : []),
          ],
        }),
      )
    })

    const nextGeneration = Effect.fn("PluginHttpApi.nextGeneration")(function* () {
      const state = yield* InstanceState.get(generation)
      state.value += 1
      return state.value
    })

    const publishChanged = Effect.fn("PluginHttpApi.publishChanged")(function* (pluginID?: string) {
      const value = yield* nextGeneration()
      yield* bus.publish(PluginEvent.Changed, { ...(pluginID === undefined ? {} : { pluginID }), generation: value })
      return value
    })

    const publicPublishAccount = (account: Awaited<ReturnType<typeof listPublishAccounts>>[number]) => ({
      id: account.id,
      driverID: account.driverID,
      label: account.label,
      profile: account.profile,
      createdAt: account.createdAt,
    })

    const publishDriver = Effect.fn("PluginHttpApi.publishDriver")(function* (driverID: string) {
      const host = yield* runtime.get
      const driver = host.registries.publish?.resolve(driverID)
      if (!driver) return yield* new HttpApiError.NotFound({})
      return driver
    })

    const publishDirectory = Effect.fn("PluginHttpApi.publishDirectory")(function* () {
      const context = yield* InstanceState.context
      return context.directory
    })

    const publishAccounts = Effect.fn("PluginHttpApi.publishAccounts")(function* () {
      const directory = yield* publishDirectory()
      const host = yield* runtime.get
      const drivers = host.registries.publish?.list() ?? []
      const accounts = yield* Effect.promise(async () => {
        const result = []
        for (const driver of drivers) {
          result.push(...(await listPublishAccounts(directory, driver.id)))
        }
        return result.map(publicPublishAccount)
      })
      return accounts
    })

    return handlers
      .handle("list", () =>
        Effect.gen(function* () {
          const result = yield* inspect()
          const state = yield* InstanceState.get(generation)
          const host = yield* runtime.get
          return {
            generation: state.value,
            instances: result.instances.map((item) => ({
              ...(host.state(item.id, item.scope) === undefined
                ? {}
                : { runtimeStatus: host.state(item.id, item.scope)?.status }),
              id: item.id,
              status: item.status,
              scope: item.scope,
              origin: item.origin,
              adapter: item.adapter,
              ...(item.manifest.version === undefined ? {} : { version: item.manifest.version }),
              source: item.location.kind === "directory" ? item.location.root : item.location.spec,
              ...(item.location.kind === "directory" ? { root: item.location.root } : {}),
              ...(item.installOrder === undefined ? {} : { installOrder: item.installOrder }),
              ...(item.overriddenBy === undefined ? {} : { overriddenBy: item.overriddenBy }),
              contributions: item.contributions,
              issues: [...item.issues, ...item.diagnostics].map((issue) => ({
                level: issue.level,
                code: issue.code,
                message: issue.message,
                ...(issue.field === undefined ? {} : { field: issue.field }),
              })),
            })),
            cycles: result.cycles,
            ...(result.skipped === undefined ? {} : { skipped: result.skipped }),
          }
        }),
      )
      .handle("contributions", (ctx) =>
        Effect.gen(function* () {
          const result = yield* inspect()
          const legacy = yield* extensions.contributions().pipe(Effect.catchCause(() => Effect.succeed([])))
          const tui = yield* tuiContributionPaths(result.instances).pipe(Effect.catchCause(() => Effect.succeed([])))
          const host = yield* runtime.get
          const ownerFor = (kind: "office" | "publish" | "surface", id: string) =>
            result.instances.find((instance) => {
              if (instance.status !== "installed" && instance.status !== "active") return false
              const declarations =
                kind === "office"
                  ? instance.manifest.contributes.officeEngines
                  : kind === "publish"
                    ? instance.manifest.contributes.publishDrivers
                    : instance.manifest.contributes.surfaces
              return (
                Array.isArray(declarations) &&
                declarations.some((declaration) => {
                  if (typeof declaration !== "object" || declaration === null) return false
                  if (kind === "office") return "format" in declaration && declaration.format === id
                  return "id" in declaration && declaration.id === id
                })
              )
            })
          const runtimeMeta = (owner: PluginHost.Instance | undefined) => ({
            pluginID: owner?.id ?? "runtime",
            scope: owner?.scope ?? ("builtin" as const),
            origin: owner?.origin ?? ("extension" as const),
            adapter: owner?.adapter ?? ("v2" as const),
            status: "active" as const,
          })
          const runtimeContributions = [
            ...(host.registries.office?.list() ?? []).map((entry) => {
              const owner = ownerFor("office", entry.format)
              return {
                ...runtimeMeta(owner),
                kind: "office-engine" as const,
                name: entry.format,
                localName: entry.format,
                extensions: entry.extensions,
              }
            }),
            ...(host.registries.publish?.list() ?? []).map((entry) => {
              const owner = ownerFor("publish", entry.id)
              return {
                ...runtimeMeta(owner),
                kind: "publish-driver" as const,
                name: entry.name,
                localName: entry.id,
                ...(entry.icon === undefined ? {} : { icon: entry.icon }),
                ...(entry.hosts === undefined ? {} : { hosts: entry.hosts }),
                supports: entry.supports,
                urls: entry.urls,
                account: entry.account,
                ...(entry.ui === undefined ? {} : { ui: entry.ui }),
              }
            }),
            ...(host.registries.surfaces?.list() ?? []).map((item) => {
              const owner = ownerFor("surface", item.id)
              return {
                ...runtimeMeta(owner),
                kind: "surface" as const,
                name: item.id,
                localName: item.id,
                slot: item.slot,
                ...("title" in item && item.title !== undefined ? { title: item.title } : {}),
                ...( "description" in item && item.description !== undefined ? { description: item.description } : {}),
                ...( "icon" in item && item.icon !== undefined ? { icon: item.icon } : {}),
                ...( "action" in item && item.action !== undefined ? { action: item.action } : {}),
                ...( "view" in item && item.view !== undefined ? { view: item.view } : {}),
                ...( "match" in item && item.match !== undefined ? { match: item.match } : {}),
                ...( "renderer" in item && item.renderer !== undefined ? { renderer: item.renderer } : {}),
              }
            }),
            ...(host.registries.previewers?.list() ?? []).map((entry) => ({
              pluginID: entry.pluginID,
              scope: entry.scope,
              origin: "extension" as const,
              adapter: "v2" as const,
              status: "active" as const,
              kind: "previewer" as const,
              name: entry.name,
              localName: entry.localName,
              match: entry.item.match,
              viewId: entry.item.viewId,
              ...(entry.item.priority === undefined ? {} : { priority: entry.item.priority }),
              ...(entry.item.readOnly === undefined ? {} : { readOnly: entry.item.readOnly }),
            })),
          ]
            .filter((item) => ctx.query.kind === undefined || item.kind === ctx.query.kind)
            .filter((item) => ctx.query.slot === undefined || ("slot" in item && item.slot === ctx.query.slot))
          return [
            ...PluginCatalog.list(result.instances, { kind: ctx.query.kind, slot: ctx.query.slot }, [
              ...legacy,
              ...tui,
            ]).filter(
              (item) =>
                !(item.kind === "previewer" || (item.scope === "builtin" && ["surface", "office-engine", "publish-driver"].includes(item.kind))),
            ),
            ...runtimeContributions,
          ]
        }),
      )
      .handle("publishAccounts", () => publishAccounts())
      .handle("publishAccount", (ctx) =>
        Effect.gen(function* () {
          const driver = yield* publishDriver(ctx.payload.driverID)
          if (!driver.runtime?.login) {
            return yield* new HttpApiError.BadRequest({})
          }
          const directory = yield* publishDirectory()
          const account = yield* Effect.tryPromise({
            try: () => driver.runtime!.login!({ profile: ctx.payload.profile }),
            catch: () => new HttpApiError.BadRequest({}),
          })
          const stored = yield* Effect.tryPromise({
            try: () => savePublishAccount(directory, driver.id, account),
            catch: () => new HttpApiError.BadRequest({}),
          })
          return publicPublishAccount(stored)
        }),
      )
      .handle("deletePublishAccount", (ctx) =>
        Effect.gen(function* () {
          const directory = yield* publishDirectory()
          const removed = yield* Effect.promise(() =>
            removePublishAccount(directory, ctx.params.driverID, ctx.params.accountID),
          )
          if (!removed) return yield* new HttpApiError.NotFound({})
          return true
        }),
      )
      .handle("publishExecute", (ctx) =>
        Effect.gen(function* () {
          const driver = yield* publishDriver(ctx.payload.driverID)
          if (!driver.runtime?.publish || !driver.supports.includes(ctx.payload.kind)) {
            return yield* new HttpApiError.BadRequest({})
          }
          const directory = yield* publishDirectory()
          const account = yield* Effect.promise(() => findPublishAccount(directory, driver.id, ctx.payload.accountID))
          if (!account) return yield* new HttpApiError.NotFound({})
          return yield* Effect.tryPromise({
            try: () =>
              driver.runtime!.publish!({
                account,
                kind: ctx.payload.kind,
                payload: ctx.payload.payload,
              }),
            catch: () => new HttpApiError.BadRequest({}),
          })
        }),
      )
      .handle("diagnostics", () =>
        Effect.gen(function* () {
          const result = yield* inspect()
          const instance = yield* InstanceState.context
          const persistedStates = PluginStorage.listForInstance(instance.directory)
          const errors = persistedStates.flatMap((state) =>
            state.last_error === null
              ? []
              : [{ pluginID: state.plugin_id, scope: state.scope, error: state.last_error }],
          )
          const host = yield* runtime.get
          const runtimeErrors = host.states().flatMap((state) => {
            if (
              state.status !== "failed" ||
              persistedStates.some((row) => `${row.scope}:${row.plugin_id}` === state.id)
            )
              return []
            const [scope, ...parts] = state.id.split(":")
            const cause = state.error
            const message = cause instanceof Error ? cause.message : String(cause ?? "插件运行失败")
            const code = isPluginError(cause) ? cause.code : "activation_failed"
            return [
              { pluginID: parts.join(":"), scope: scope as PluginHost.Scope, error: { code, message, at: Date.now() } },
            ]
          })
          const legacy = yield* extensions.contributions().pipe(Effect.catchCause(() => Effect.succeed([])))
          const tui = yield* tuiContributionPaths(result.instances).pipe(Effect.catchCause(() => Effect.succeed([])))
          const contributions = PluginCatalog.list(result.instances, undefined, [...legacy, ...tui])
          const unassigned = PluginStorage.list().filter(
            (state) =>
              state.scope === "project" &&
              state.instance_key === "" &&
              result.instances.some(
                (item) =>
                  item.id === state.plugin_id &&
                  item.scope === "project" &&
                  (item.location.kind === "directory" ? item.location.root : item.location.spec) === state.source,
              ),
          )
          return [
            ...PluginDiagnostics.collect(result.instances, [...errors, ...runtimeErrors], contributions),
            ...unassigned.map((state) => ({
              pluginID: state.plugin_id,
              scope: state.scope,
              severity: "warning" as const,
              code: "state_instance_unassigned",
              message: "旧版项目插件状态缺少目录归属，已保留但不跨项目套用；请在本项目重新确认启用或停用。",
            })),
          ]
        }),
      )
      .handle("toggle", (ctx) =>
        Effect.gen(function* () {
          const result = yield* inspect()
          const matches = result.instances.filter(
            (entry) =>
              entry.id === ctx.params.id && (ctx.payload.scope === undefined || entry.scope === ctx.payload.scope),
          )
          if (matches.length === 0) return yield* new HttpApiError.NotFound({})
          if (matches.length > 1) {
            return yield* new PluginTransitionError({
              pluginID: ctx.params.id,
              code: "contribution_invalid",
              message: "多个 scope 声明了同名插件，请在 toggle 请求中指定 scope。",
            })
          }
          const item = matches[0]!
          if (item.adapter === "v2") {
            const target = ctx.payload.enabled
              ? (yield* inspect(item)).instances.find((entry) => entry.id === item.id && entry.scope === item.scope)
              : item
            if (!target || (ctx.payload.enabled && target.status !== "installed")) {
              return yield* new PluginTransitionError({
                pluginID: item.id,
                code: "activation_failed",
                message: target?.diagnostics.map((issue) => issue.message).join("; ") || "插件未通过激活校验。",
              })
            }
            yield* runtime
              .setEnabled(target, ctx.payload.enabled)
              .pipe(
                Effect.catch((error) =>
                  publishChanged(item.id).pipe(
                    Effect.andThen(
                      Effect.fail(
                        new PluginTransitionError({ pluginID: item.id, code: error.code, message: error.message }),
                      ),
                    ),
                  ),
                ),
              )
          } else {
            const source = item.location.kind === "directory" ? item.location.root : item.location.spec
            const instance = yield* InstanceState.context
            yield* Effect.sync(() =>
              PluginStorage.save({
                pluginID: item.id,
                scope: item.scope,
                instanceKey: item.scope === "project" ? instance.directory : "",
                source,
                enabled: ctx.payload.enabled,
                installOrder: item.installOrder,
              }),
            )
            if (item.adapter === "legacy-extension") yield* extensions.setEnabled(item.id, ctx.payload.enabled)
          }
          if (Option.isSome(provider)) yield* provider.value.reload()
          const value = yield* publishChanged(item.id)
          return { pluginID: item.id, enabled: ctx.payload.enabled, generation: value }
        }),
      )
      .handleRaw(
        "events",
        Effect.fn("PluginHttpApi.events")(function* () {
          const context = yield* Effect.context()
          return HttpServerResponse.stream(
            bus
              .subscribe(PluginEvent.Changed)
              .pipe(
                Stream.provideContext(context),
                Stream.map(eventData),
                Stream.pipeThroughChannel(Sse.encode()),
                Stream.encodeText,
              ),
            {
              contentType: "text/event-stream",
              headers: {
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
                "X-Content-Type-Options": "nosniff",
              },
            },
          )
        }),
      )
  }),
)
