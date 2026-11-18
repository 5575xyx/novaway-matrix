import path from "node:path"
import fs from "node:fs/promises"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Global } from "@novaway/core/global"
import { Identifier } from "@/id/id"
import { InstanceState } from "@/effect/instance-state"
import { PluginHost } from "@/plugin/host"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import { PluginStorage } from "@/plugin/storage"
import { Service as SkillService } from "@/skill"
import * as SkillPython from "@/skill/python-env"
import { InstanceHttpApi } from "../api"
import { Service as ExtensionService } from "@/extension/registry"
import * as Marketplace from "@/extension/marketplace"
import * as Legacy from "@/extension/legacy"
import * as Operations from "@/extension/operations"
import * as Provision from "@/extension/provision"
import * as Catalog from "@/extension/catalog"
import * as Sources from "@/extension/sources"
import { PluginEvent } from "@/plugin/event"
import type { Loaded } from "@/extension/schema"
import type { GitEntry, ZipEntry } from "@/extension/marketplace"

type Change = "added" | "removed" | "upgraded" | "downgraded" | "changed" | "unchanged"
type Generation = { value: number }

const toInfo = (
  item: Loaded,
  issues?: Array<{ severity: "error" | "warning"; code: string; message: string }>,
  status?: Change,
  operationId?: string,
) => ({
  name: item.name,
  version: item.manifest.version,
  description: item.manifest.description,
  root: item.root,
  source: item.source,
  enabled: item.enabled,
  ...(item.error ? { error: item.error } : {}),
  ...(issues && issues.length > 0 ? { issues } : {}),
  ...(status ? { status } : {}),
  ...(operationId ? { operationId } : {}),
})

/** 把下载字节进度映射到操作进度区间；串行写盘，避免并发 read-modify-write 丢更新。 */
function downloadReporter(operationId: string, from: number, to: number, phase?: Operations.OperationPhase) {
  let last = from
  let chain: Promise<unknown> = Promise.resolve()
  const onProgress = (received: number, total: number) => {
    // 镜像/CDN 常以 chunked 下发、不带 content-length（total=0）。此时按已收字节
    // 渐近逼近目标值，保证进度随真实下载推进而非卡在起点；完成时由阶段切换落到真值。
    const percent =
      total > 0
        ? Math.min(to, from + Math.round((received / total) * (to - from)))
        : Math.min(to - 1, from + Math.round((to - from) * (1 - Math.exp(-received / (256 * 1024)))))
    if (percent === last) return
    last = percent
    chain = chain
      .then(() => Operations.update(operationId, phase ? { phase, progress: percent } : { progress: percent }))
      .catch(() => undefined)
  }
  return { onProgress, settle: () => chain }
}

export const extensionHandlers = HttpApiBuilder.group(InstanceHttpApi, "extension", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const runtime = yield* PluginRuntimeService.Service
    const extensions = yield* ExtensionService
    const jobs = yield* BackgroundJob.Service
    const skills = yield* SkillService
    const generation = yield* InstanceState.make<Generation>(() => Effect.sync(() => ({ value: 0 })))

    const publishChanged = Effect.fn("ExtensionHttpApi.publishChanged")(function* (
      pluginID?: string,
      enabled?: boolean,
    ) {
      const state = yield* InstanceState.get(generation)
      state.value += 1
      yield* bus.publish(PluginEvent.Changed, {
        ...(pluginID === undefined ? {} : { pluginID }),
        ...(enabled === undefined ? {} : { enabled }),
        generation: state.value,
      })
    })

    /**
     * 扩展变了，技能列表也得跟着变。
     *
     * 技能发现走的是自己的实例缓存：装完 ppt-master 只重载扩展，`skill` 工具依然
     * 找不到它（要等重启）。这里显式刷新一次，装完就能立刻加载、路由也能立刻切过去。
     */
    const refresh = () =>
      Effect.gen(function* () {
        const list = yield* extensions.reload()
        yield* skills.reload().pipe(Effect.catchCause(() => Effect.succeed([] as never[])))
        return list
      })

    /**
     * 装完扩展后顺手准备 Python 环境。
     *
     * 市场上有些技能自带 `requirements.txt`（ppt-master 的 SVG → PPTX 脚本就是），
     * 它们的自述写的是「pip install -r requirements.txt」—— 照做会污染系统 Python，
     * 模型还常常用错解释器。这里改成装进独立 venv，并放到后台跑：pip 动辄几分钟，
     * 不能把安装请求一直挂着。
     */
    const activateInstalledPlugin = (pluginID: string, installedRoot?: string, enabled = true) =>
      Effect.gen(function* () {
        const context = yield* InstanceState.context
        const info = yield* config.get()
        const persisted = PluginStorage.listForInstance(context.directory)
        const disabled = [
          ...(info.plugins?.disabled ?? []),
          ...persisted.filter((item) => item.enabled === 0).map((item) => `${item.scope}:${item.plugin_id}`),
        ].filter((item) => !enabled || (item !== pluginID && item !== `global:${pluginID}`))
        const discovered = yield* Effect.promise(() =>
          PluginHost.inspect({
            config: Global.Path.config,
            home: Global.Path.home,
            directory: context.directory,
            worktree: context.worktree,
            plugins: info.plugin_origins,
            disabled,
            enabled: enabled
              ? [
                  pluginID,
                  `global:${pluginID}`,
                  ...persisted.flatMap((item) => [item.plugin_id, `${item.scope}:${item.plugin_id}`]),
                ]
              : [],
          }),
        )
        const instance = discovered.instances.find(
          (item) =>
            (item.id === pluginID ||
              (installedRoot &&
                item.location.kind === "directory" &&
                path.resolve(item.location.root) === path.resolve(installedRoot))) &&
            item.adapter === "v2" &&
            item.scope !== "builtin" &&
            item.status !== "blocked",
        )
        if (!instance) return false
        yield* runtime.setEnabled(instance, enabled)
        return true
      })

    /**
     * Stop the v2 instance before replacing its directory.  PluginHost keeps the
     * activation resources (and the AbortSignal used by tools/skills) in memory;
     * merely rescanning the extension directory would leave those resources
     * pointing at the retired version.  The old persisted state is deliberately
     * marked disabled for the short replacement window and is restored by the
     * activation step after the new tree is visible.
     */
    const deactivateInstalledPlugin = (pluginID: string, installedRoot: string) =>
      Effect.gen(function* () {
        const context = yield* InstanceState.context
        const info = yield* config.get()
        const persisted = PluginStorage.listForInstance(context.directory)
        const disabled = [
          ...(info.plugins?.disabled ?? []),
          ...persisted.filter((item) => item.enabled === 0).map((item) => `${item.scope}:${item.plugin_id}`),
        ]
        const enabled = persisted
          .filter((item) => item.enabled === 1)
          .flatMap((item) => [item.plugin_id, `${item.scope}:${item.plugin_id}`])
        const discovered = yield* Effect.promise(() =>
          PluginHost.inspect({
            config: Global.Path.config,
            home: Global.Path.home,
            directory: context.directory,
            worktree: context.worktree,
            plugins: info.plugin_origins,
            disabled,
            enabled,
          }),
        )
        const instance = discovered.instances.find(
          (item) =>
            item.adapter === "v2" &&
            item.scope !== "builtin" &&
            item.location.kind === "directory" &&
            path.resolve(item.location.root) === path.resolve(installedRoot) &&
            (item.id === pluginID || item.status === "installed" || item.status === "active"),
        )
        if (!instance) return false
        yield* runtime.setEnabled(instance, false)
        return true
      })

    const preparePython = (root: string) =>
      Effect.gen(function* () {
        const found = yield* Effect.promise(() => SkillPython.findRequirements(root))
        if (!found) return
        const running = (yield* jobs.list()).find(
          (job) => job.type === "extension.python.install" && job.status === "running",
        )
        if (running) return
        const jobID = Identifier.ascending("job")
        const controller = new AbortController()
        yield* jobs.start({
          id: jobID,
          type: "extension.python.install",
          title: "准备 " + found.name + " 的 Python 环境",
          metadata: { target: found.name, phase: "detect", message: "正在准备 Python 环境" },
          cancel: Effect.sync(() => controller.abort()),
          run: Effect.gen(function* () {
            const report = (phase: string, message: string, log?: string) => {
              void Effect.runPromise(
                jobs.update(jobID, {
                  metadata: { target: found.name, phase, message, ...(log ? { log } : {}) },
                }),
              ).catch(() => undefined)
            }
            const result = yield* Effect.promise(() =>
              SkillPython.prepare({
                name: found.name,
                requirements: found.file,
                signal: controller.signal,
                onProgress: (event) => report(event.phase, event.message, event.log),
              }),
            )
            if (result.state !== "ready") {
              yield* jobs
                .update(jobID, {
                  metadata: {
                    target: found.name,
                    phase: "error",
                    message: result.error ?? "安装失败",
                    ...(result.hint ? { hint: result.hint } : {}),
                  },
                })
                .pipe(Effect.ignore)
              return yield* Effect.fail(new Error(result.error ?? "安装失败"))
            }
            yield* jobs
              .update(jobID, { metadata: { target: found.name, phase: "done", message: "Python 环境已就绪" } })
              .pipe(Effect.ignore)
            return "installed " + (result.python ?? "")
          }),
        })
      }).pipe(Effect.catchCause(() => Effect.void))

    const refreshSource = (sourceID: string) =>
      Effect.gen(function* () {
        const source = yield* Effect.promise(() => Sources.get(sourceID))
        if (!source) return yield* Effect.fail(new HttpApiError.NotFound({}))
        yield* Effect.promise(() => Marketplace.manifest(Sources.urlsFor(source))).pipe(
          Effect.tap(() => Effect.promise(() => Sources.recordRefresh(source.id, {}))),
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* Effect.promise(() => Sources.recordRefresh(source.id, { error: String(cause).slice(0, 500) }))
              return yield* Effect.fail(new HttpApiError.BadRequest({ message: String(cause).slice(0, 400) } as never))
            }),
          ),
        )
        return (yield* Effect.promise(() => Sources.get(source.id))) ?? source
      })

    const loadCatalogEntries = () =>
      Effect.gen(function* () {
        const sources = yield* Effect.promise(() => Sources.list())
        const novaway: Array<Catalog.NovaWayEntry & { sourceId?: string }> = []
        const zcode: Array<ZipEntry & { sourceId?: string }> = []
        const claude: Array<GitEntry & { sourceId?: string }> = []
        for (const source of sources.filter((item) => item.enabled)) {
          const raw = yield* Effect.promise(() => Marketplace.manifest(Sources.urlsFor(source))).pipe(
            Effect.catchCause(() => Effect.succeed(undefined as unknown)),
          )
          if (raw === undefined) continue
          if (source.type === "novaway") {
            novaway.push(...Catalog.parseNovaWay(raw).map((entry) => ({ ...entry, sourceId: source.id })))
          } else if (source.type === "zcode") {
            zcode.push(...Catalog.parseZcode(raw).map((entry) => ({ ...entry, sourceId: source.id })))
          } else if (source.type === "claude") {
            claude.push(...Catalog.parseClaude(raw).map((entry) => ({ ...entry, sourceId: source.id })))
          } else {
            const native = Catalog.parseNovaWay(raw)
            if (native.length > 0) novaway.push(...native.map((entry) => ({ ...entry, sourceId: source.id })))
            else {
              const zcodeEntries = Catalog.parseZcode(raw)
              if (zcodeEntries.length > 0)
                zcode.push(...zcodeEntries.map((entry) => ({ ...entry, sourceId: source.id })))
              else claude.push(...Catalog.parseClaude(raw).map((entry) => ({ ...entry, sourceId: source.id })))
            }
          }
        }
        return { novaway, zcode, claude }
      })

    const findCatalogTarget = (name: string) =>
      loadCatalogEntries().pipe(
        Effect.map(({ novaway, zcode, claude }) =>
          [...novaway, ...zcode, ...claude].find((entry) =>
            "packageId" in entry ? entry.packageId === name : entry.name === name,
          ),
        ),
      )

    return handlers
      .handle("marketplaceSources", () => Effect.promise(() => Sources.list()))
      .handle("marketplaceLegacyMigrations", () => Effect.promise(() => Legacy.migrations()))
      .handle("marketplaceLegacyMigrate", (ctx) => {
        let operationId: string | undefined
        return Effect.gen(function* () {
          const operation = yield* Effect.promise(() =>
            Operations.start({ operationType: "migrate", packageId: `legacy:${ctx.params.name}` }),
          )
          operationId = operation.operationId
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "staging", progress: 25 }))
          const migration = yield* Effect.promise(() => Legacy.migrate(ctx.params.name))
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "replacing", progress: 70 }))
          yield* refresh()
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "completed", progress: 100 }))
          return { ...migration, operationId }
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              if (operationId)
                yield* Effect.promise(() =>
                  Operations.update(operationId!, {
                    phase: "failed",
                    progress: 100,
                    errorCode: "LEGACY_MIGRATION_FAILED",
                    recoveryHint: "legacy 原目录和已存在的备份不会自动删除；检查冲突后重试或执行 rollback。",
                  }),
                )
              const message = String(cause).slice(0, 400)
              return yield* Effect.fail(
                /找不到|不存在|not found/i.test(message)
                  ? new HttpApiError.NotFound({})
                  : new HttpApiError.BadRequest({ message } as never),
              )
            }),
          ),
        )
      })
      .handle("marketplaceLegacyRollback", (ctx) => {
        let operationId: string | undefined
        return Effect.gen(function* () {
          const operation = yield* Effect.promise(() =>
            Operations.start({ operationType: "rollback", packageId: `legacy:${ctx.params.migrationId}` }),
          )
          operationId = operation.operationId
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "replacing", progress: 35 }))
          const migration = yield* Effect.promise(() => Legacy.rollbackMigration(ctx.params.migrationId))
          yield* refresh()
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "completed", progress: 100 }))
          return { ...migration, operationId }
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              if (operationId)
                yield* Effect.promise(() =>
                  Operations.update(operationId!, {
                    phase: "failed",
                    progress: 100,
                    errorCode: "LEGACY_ROLLBACK_FAILED",
                    recoveryHint: "managed copy和legacy备份仍保留；检查文件占用后重试。",
                  }),
                )
              const message = String(cause).slice(0, 400)
              return yield* Effect.fail(
                /找不到|不存在|not found/i.test(message)
                  ? new HttpApiError.NotFound({})
                  : new HttpApiError.BadRequest({ message } as never),
              )
            }),
          ),
        )
      })
      .handle("marketplaceSourceAdd", (ctx) =>
        Effect.promise(() => Sources.add(ctx.payload)).pipe(
          Effect.catchCause((cause) => Effect.fail(new HttpApiError.BadRequest({ message: String(cause) } as never))),
        ),
      )
      .handle("marketplaceSourceUpdate", (ctx) => {
        const payload: Sources.UpdateInput = {
          ...(typeof ctx.payload.name === "string" ? { name: ctx.payload.name } : {}),
          ...(ctx.payload.type === undefined ? {} : { type: ctx.payload.type }),
          ...(typeof ctx.payload.url === "string" ? { url: ctx.payload.url } : {}),
          ...(typeof ctx.payload.enabled === "boolean" ? { enabled: ctx.payload.enabled } : {}),
        }
        return Effect.promise(() => Sources.update(ctx.params.sourceId, payload)).pipe(
          Effect.catchCause((cause) => {
            const message = String(cause)
            return Effect.fail(
              message.includes("not found")
                ? new HttpApiError.NotFound({})
                : new HttpApiError.BadRequest({ message } as never),
            )
          }),
        )
      })
      .handle("marketplaceSourceRemove", (ctx) =>
        Effect.promise(() => Sources.remove(ctx.params.sourceId)).pipe(
          Effect.catchCause((cause) => Effect.fail(new HttpApiError.BadRequest({ message: String(cause) } as never))),
          Effect.flatMap((removed) => (removed ? Effect.succeed(true) : Effect.fail(new HttpApiError.NotFound({})))),
        ),
      )
      .handle("marketplaceSourceRefresh", (ctx) => refreshSource(ctx.params.sourceId))
      .handle("list", () =>
        Effect.gen(function* () {
          const list = yield* extensions.list()
          const issues = yield* extensions.issues()
          const changes = yield* extensions.changes()
          return list.map((item) => toInfo(item, issues[item.name], changes[item.name]))
        }),
      )
      .handle("contributions", () =>
        Effect.gen(function* () {
          const list = yield* extensions.contributions()
          return list.map((item) => ({
            extension: item.extension,
            root: item.root,
            kind: item.kind,
            ...(item.kind === "mcp" ? { name: item.name } : {}),
            ...("path" in item ? { path: item.path } : {}),
          }))
        }),
      )
      .handle("reload", () =>
        Effect.gen(function* () {
          const list = yield* refresh()
          const issues = yield* extensions.issues()
          const changes = yield* extensions.changes()
          return list.map((item) => toInfo(item, issues[item.name], changes[item.name]))
        }),
      )
      .handle("marketplace", () =>
        Effect.gen(function* () {
          // 先拿已安装列表（要遍历文件统计体积，一次就够），再基于它做远端探测。
          const installed = yield* Effect.promise(() => Marketplace.list()).pipe(
            Effect.catchCause(() => Effect.succeed([] as Marketplace.Installed[])),
          )
          // 更新检查是纯探测：失败（离线、镜像不响应）只让 state=unknown，不影响目录本身。
          const updates = yield* Effect.promise(() =>
            Marketplace.updates(undefined, { timeoutMs: 6_000, installed }),
          ).pipe(Effect.catchCause(() => Effect.succeed([] as Marketplace.UpdateStatus[])))
          const legacy = yield* Effect.promise(async () =>
            Legacy.migrationPlan(await Legacy.list(), new Set(installed.map((item) => item.name))),
          )
          const errors: string[] = []
          const sources = yield* Effect.promise(() => Sources.list())
          const novaway: ReturnType<typeof Catalog.parseNovaWay> = []
          const zcode: ReturnType<typeof Catalog.parseZcode> = []
          const claude: ReturnType<typeof Catalog.parseClaude> = []
          const load = (source: Sources.Source) =>
            Effect.promise(() => Marketplace.manifest(Sources.urlsFor(source))).pipe(
              Effect.tap(() => Effect.promise(() => Sources.recordRefresh(source.id, {}))),
              Effect.catchCause((cause) => {
                const message = String(cause).slice(0, 300)
                errors.push(`${source.name}: ${message}`)
                return Effect.promise(() => Sources.recordRefresh(source.id, { error: message })).pipe(
                  Effect.andThen(Effect.succeed(undefined as unknown)),
                )
              }),
            )
          for (const source of sources.filter((item) => item.enabled)) {
            const raw = yield* load(source)
            if (raw === undefined) continue
            if (source.type === "novaway")
              novaway.push(...Catalog.parseNovaWay(raw).map((entry) => ({ ...entry, sourceId: source.id })))
            else if (source.type === "zcode")
              zcode.push(...Catalog.parseZcode(raw).map((entry) => ({ ...entry, sourceId: source.id })))
            else if (source.type === "claude")
              claude.push(...Catalog.parseClaude(raw).map((entry) => ({ ...entry, sourceId: source.id })))
            else {
              const native = Catalog.parseNovaWay(raw)
              if (native.length > 0) novaway.push(...native.map((entry) => ({ ...entry, sourceId: source.id })))
              else {
                const zcodeEntries = Catalog.parseZcode(raw)
                if (zcodeEntries.length > 0)
                  zcode.push(...zcodeEntries.map((entry) => ({ ...entry, sourceId: source.id })))
                else claude.push(...Catalog.parseClaude(raw).map((entry) => ({ ...entry, sourceId: source.id })))
              }
            }
          }
          return {
            installed,
            legacy,
            sources,
            novaway,
            zcode,
            claude,
            updates,
            errors,
          }
        }),
      )
      .handle("marketplaceOperations", () => Effect.promise(() => Operations.list()))
      .handle("marketplaceOperation", (ctx) =>
        Effect.promise(() => Operations.get(ctx.params.operationId)).pipe(
          Effect.flatMap((operation) =>
            operation ? Effect.succeed(operation) : Effect.fail(new HttpApiError.NotFound({})),
          ),
        ),
      )
      .handle("install", (ctx) => {
        let operationId: string | undefined
        let activationFailure: string | undefined
        return Effect.gen(function* () {
          const input = ctx.payload
          const operation = yield* Effect.promise(() =>
            Operations.start({
              operationType: "install",
              packageId: input.name,
              ...(input.version ? { version: input.version } : {}),
            }),
          )
          operationId = operation.operationId
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "downloading", progress: 10 }))
          const reporter = downloadReporter(operation.operationId, 10, 60, "downloading")
          const installed =
            input.kind === "zip"
              ? yield* Effect.promise(() =>
                  Marketplace.installZip({
                    name: input.name,
                    url: input.url,
                    version: input.version,
                    sha256: input.sha256,
                    sourceId: input.sourceId,
                    permissions: input.permissions ? [...input.permissions] : undefined,
                    dependencies: input.dependencies ? { ...input.dependencies } : undefined,
                    conflicts: input.conflicts ? [...input.conflicts] : undefined,
                    onProgress: reporter.onProgress,
                  }),
                )
              : yield* Effect.promise(() =>
                  Marketplace.installGit({
                    name: input.name,
                    url: input.url,
                    ref: input.ref,
                    subdir: input.subdir,
                    version: input.version,
                    sha256: input.sha256,
                    sourceId: input.sourceId,
                    permissions: input.permissions ? [...input.permissions] : undefined,
                    dependencies: input.dependencies ? { ...input.dependencies } : undefined,
                    conflicts: input.conflicts ? [...input.conflicts] : undefined,
                  }),
                )
          yield* Effect.promise(() => reporter.settle())
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "replacing", progress: 65 }))
          yield* refresh()
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "activating", progress: 80 }))
          // v2 目录型插件由 Plugin Host 重新发现并默认启用；旧 Extension 仍由兼容 loader 管理。
          // v2 包激活失败必须让安装操作失败，不能把「装上了但用不了」报成完成。
          const isV2 = yield* Effect.promise(() =>
            fs
              .readFile(path.join(installed.root, "plugin.json"), "utf8")
              .then((text) => (JSON.parse(text) as { apiVersion?: number }).apiVersion === 2)
              .catch(() => false),
          )
          const activated = yield* activateInstalledPlugin(input.name, installed.root).pipe(
            Effect.matchCause({
              onFailure: (cause) => {
                activationFailure = String(cause).slice(0, 300)
                return false
              },
              onSuccess: (ok) => ok,
            }),
          )
          if (isV2 && !activated) {
            activationFailure ??= "插件已安装但未被 Plugin Host 发现或启用"
            return yield* Effect.fail(new Error("plugin activation failed: " + activationFailure))
          }
          // 手动装回来：清掉「用户卸载过」的标记，后台自动准备照常生效。
          yield* Effect.promise(() => Provision.undismiss(input.name))
          // 后台准备 Python 依赖（`jobs.start` 自己会 fork，不会卡住安装请求）；
          // 失败不影响「已安装」这个事实，模型运行时会看到原因。
          yield* preparePython(installed.root)
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "completed", progress: 100 }))
          yield* publishChanged(input.name, true)
          return { ...installed, operationId }
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              if (operationId) {
                yield* Effect.promise(() =>
                  Operations.update(operationId!, {
                    phase: "failed",
                    progress: 100,
                    errorCode: activationFailure ? "PLUGIN_ACTIVATION_FAILED" : "MARKETPLACE_OPERATION_FAILED",
                    recoveryHint: activationFailure
                      ? "文件已安装但激活失败：在已安装列表查看错误后重试启用，或卸载后重装。"
                      : "检查网络、摘要和安装日志后重试；当前版本未被 staging 失败破坏。",
                  }),
                )
              }
              return yield* Effect.fail(
                new HttpApiError.BadRequest({
                  message: String(cause).slice(0, 400),
                } as never),
              )
            }),
          ),
        )
      })
      .handle("rollback", (ctx) => {
        let operationId: string | undefined
        return Effect.gen(function* () {
          const operation = yield* Effect.promise(() =>
            Operations.start({ operationType: "rollback", packageId: ctx.params.name }),
          )
          operationId = operation.operationId
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "replacing", progress: 20 }))
          const rolledBack = yield* Effect.promise(() => Marketplace.rollback(ctx.params.name))
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "activating", progress: 65 }))
          yield* refresh()
          yield* activateInstalledPlugin(ctx.params.name, rolledBack.root).pipe(
            Effect.catchCause((cause) => Effect.logWarning("marketplace plugin reactivation failed", { cause })),
          )
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "completed", progress: 100 }))
          yield* publishChanged(ctx.params.name, true)
          return { ...rolledBack, operationId }
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              if (operationId) {
                yield* Effect.promise(() =>
                  Operations.update(operationId!, {
                    phase: "failed",
                    progress: 100,
                    errorCode: "MARKETPLACE_ROLLBACK_FAILED",
                    recoveryHint: "当前版本仍保留；检查历史备份后重试。",
                  }),
                )
              }
              const message = String(cause).slice(0, 400)
              return yield* Effect.fail(
                /找不到|不存在|没有可回滚|not found/i.test(message)
                  ? new HttpApiError.NotFound({})
                  : new HttpApiError.BadRequest({ message } as never),
              )
            }),
          ),
        )
      })
      .handle("updatePreview", (ctx) =>
        Effect.gen(function* () {
          const installedList = yield* Effect.promise(() => Marketplace.list())
          const installed = installedList.find(
            (item) => item.name === ctx.params.name || path.basename(item.root) === ctx.params.name,
          )
          if (!installed) return yield* Effect.fail(new HttpApiError.NotFound({}))
          const target = yield* findCatalogTarget(installed.name)
          if (!target) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return Marketplace.previewUpdate(installed, {
            ...(target.version ? { version: target.version } : {}),
            source: target.url,
            ...(target.sourceId ? { sourceId: target.sourceId } : {}),
            ...(target.sha256 ? { sha256: target.sha256 } : {}),
            ...(target.permissions ? { permissions: target.permissions } : {}),
            ...(target.dependencies ? { dependencies: target.dependencies } : {}),
            ...(target.conflicts ? { conflicts: target.conflicts } : {}),
          })
        }).pipe(
          Effect.catchCause((cause) => {
            const message = String(cause).slice(0, 400)
            return Effect.fail(
              /找不到|不存在|没有安装|not found/i.test(message)
                ? new HttpApiError.NotFound({})
                : new HttpApiError.BadRequest({ message } as never),
            )
          }),
        ),
      )
      .handle("update", (ctx) => {
        let operationId: string | undefined
        let previous: Marketplace.Installed | undefined
        let replacement: Marketplace.Installed | undefined
        let deactivated = false
        return Effect.gen(function* () {
          const operation = yield* Effect.promise(() =>
            Operations.start({ operationType: "update", packageId: ctx.params.name }),
          )
          operationId = operation.operationId

          const installedList = yield* Effect.promise(() => Marketplace.list())
          previous = installedList.find(
            (item) => item.name === ctx.params.name || path.basename(item.root) === ctx.params.name,
          )
          if (!previous) return yield* Effect.fail(new HttpApiError.NotFound({}))

          // The generic endpoint is also the canonical non-UI client path. It
          // must use the current catalog target rather than replaying a stale
          // URL/version from .novaway-install.json.
          const target = yield* findCatalogTarget(previous.name)
          if (!target) return yield* Effect.fail(new HttpApiError.NotFound({}))
          const kind = ("kind" in target && target.kind ? target.kind : "zip") as "zip" | "git"
          const targetName = previous.name

          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "downloading", progress: 10 }))
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "staging", progress: 25 }))
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "draining", progress: 30 }))
          deactivated = yield* deactivateInstalledPlugin(targetName, previous.root).pipe(
            Effect.mapError(
              (error) => new HttpApiError.BadRequest({ message: `无法停用旧插件运行时：${String(error).slice(0, 300)}` } as never),
            ),
          )
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "validating", progress: 40 }))

          const reporter = downloadReporter(operation.operationId, 40, 59)
          const input = {
            name: targetName,
            url: target.url,
            kind,
            ...(target.version ? { version: target.version } : {}),
            ...(target.sha256 ? { sha256: target.sha256 } : {}),
            ...(target.sourceId ? { sourceId: target.sourceId } : {}),
            ...(target.permissions ? { permissions: target.permissions } : {}),
            ...(target.dependencies ? { dependencies: target.dependencies } : {}),
            ...(target.conflicts ? { conflicts: target.conflicts } : {}),
            ...(("ref" in target && target.ref) ? { ref: target.ref } : {}),
            ...(("subdir" in target && target.subdir) ? { subdir: target.subdir } : {}),
            onProgress: reporter.onProgress,
          }
          replacement =
            kind === "zip"
              ? yield* Effect.promise(() => Marketplace.installZip(input))
              : yield* Effect.promise(() => Marketplace.installGit(input))
          yield* Effect.promise(() => reporter.settle())
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "cleanup-pending", progress: 60 }))
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "replacing", progress: 65 }))
          yield* refresh()
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "activating", progress: 80 }))

          // Activation is part of the transaction. A package is not reported
          // updated when discovery succeeded but its real Skill/Tool host did
          // not accept the new root.
          const activated = yield* activateInstalledPlugin(targetName, replacement.root).pipe(
            Effect.mapError(
              (error) => new HttpApiError.BadRequest({ message: `新版本激活失败：${String(error).slice(0, 300)}` } as never),
            ),
          )
          if (!activated)
            return yield* Effect.fail(
              new HttpApiError.BadRequest({ message: `插件 ${targetName} 未能在新目录中完成 v2 activation` } as never),
            )
          yield* preparePython(replacement.root)
          yield* Effect.promise(() => Provision.undismiss(targetName))
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "completed", progress: 100 }))
          yield* publishChanged(targetName, true)
          return { ...replacement, operationId }
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              let recoveryError: unknown
              // installZip/installGit retain the old tree as a physical backup.
              // Restore it when activation or consumer rebuild fails, then put
              // the old runtime back in the host before exposing the failure.
              if (replacement) {
                try {
                  const restored = yield* Effect.promise(() => Marketplace.rollback(previous?.name ?? ctx.params.name))
                  yield* refresh()
                  if (deactivated) {
                    const restoredActive = yield* activateInstalledPlugin(ctx.params.name, restored.root).pipe(
                      Effect.mapError(
                        (error) => new HttpApiError.BadRequest({ message: `旧版本恢复激活失败：${String(error).slice(0, 300)}` } as never),
                      ),
                    )
                    if (!restoredActive) throw new HttpApiError.BadRequest({ message: "旧版本恢复后无法重新激活" } as never)
                  }
                } catch (error) {
                  recoveryError = error
                }
              } else if (deactivated && previous) {
                try {
                  const restoredActive = yield* activateInstalledPlugin(ctx.params.name, previous.root).pipe(
                    Effect.mapError(
                      (error) => new HttpApiError.BadRequest({ message: `旧版本重新激活失败：${String(error).slice(0, 300)}` } as never),
                    ),
                  )
                  if (!restoredActive) throw new HttpApiError.BadRequest({ message: "旧版本重新激活失败" } as never)
                } catch (error) {
                  recoveryError = error
                }
              }
              if (operationId) {
                yield* Effect.promise(() =>
                  Operations.update(operationId!, {
                    phase: "failed",
                    progress: 100,
                    errorCode: recoveryError ? "MARKETPLACE_UPDATE_RECOVERY_FAILED" : "MARKETPLACE_UPDATE_FAILED",
                    recoveryHint: recoveryError
                      ? "更新失败且自动恢复未完成；请立即检查插件状态和历史备份。"
                      : "旧版本目录和运行时已恢复；检查来源后重试或执行 rollback。",
                  }),
                )
              }
              const message = `${String(cause).slice(0, 360)}${recoveryError ? `; recovery: ${String(recoveryError).slice(0, 240)}` : ""}`
              return yield* Effect.fail(
                /找不到|不存在|没有安装|not found/i.test(message)
                  ? new HttpApiError.NotFound({})
                  : new HttpApiError.BadRequest({ message } as never),
              )
            }),
          ),
        )
      })
      .handle("uninstall", (ctx) => {
        let operationId: string | undefined
        return Effect.gen(function* () {
          const operation = yield* Effect.promise(() =>
            Operations.start({ operationType: "uninstall", packageId: ctx.params.name }),
          )
          operationId = operation.operationId
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "replacing", progress: 20 }))
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "draining", progress: 15 }))
          // 先记下目录：卸载完就查不到它给哪个技能准备过 Python 环境了。
          const installed = yield* Effect.promise(() => Marketplace.list()).pipe(
            Effect.catchCause(() => Effect.succeed([] as Marketplace.Installed[])),
          )
          const target = installed.find(
            (item) => item.name === ctx.params.name || path.basename(item.root) === ctx.params.name,
          )
          const removed = yield* Effect.promise(() => Marketplace.remove(ctx.params.name))
          if (!removed) return yield* Effect.fail(new HttpApiError.NotFound({}))
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "cleanup-pending", progress: 55 }))
          // 内置条目被手动卸载：记下来，别在下次启动时自动装回来。
          yield* Effect.promise(() => Provision.dismiss(target?.name ?? ctx.params.name))
          // 扩展没了，它专属的 venv 也一起删，别留几百 MB 的孤儿目录。
          if (target) yield* Effect.promise(() => SkillPython.forgetUnder(target.root))
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "activating", progress: 80 }))
          yield* refresh()
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "completed", progress: 100 }))
          yield* publishChanged(ctx.params.name, false)
          return true
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              if (operationId) {
                yield* Effect.promise(() =>
                  Operations.update(operationId!, {
                    phase: "failed",
                    progress: 100,
                    errorCode: "MARKETPLACE_UNINSTALL_FAILED",
                    recoveryHint: "当前文件可能仍保留；检查扩展目录后重试。",
                  }),
                )
              }
              const message = String(cause).slice(0, 400)
              return yield* Effect.fail(
                /找不到|不存在|not found/i.test(message)
                  ? new HttpApiError.NotFound({})
                  : new HttpApiError.BadRequest({ message } as never),
              )
            }),
          ),
        )
      })
      .handle("integrity", (ctx) =>
        Effect.gen(function* () {
          const list = yield* extensions.list()
          const match = list.find((item) => item.name === ctx.params.name)
          if (!match) return null
          const print = yield* extensions.integrity(ctx.params.name)
          if (!print) return null
          return { name: match.name, root: match.root, ...print }
        }),
      )
      .handle("toggle", (ctx) => {
        let operationId: string | undefined
        return Effect.gen(function* () {
          const operation = yield* Effect.promise(() =>
            Operations.start({ operationType: ctx.payload.enabled ? "enable" : "disable", packageId: ctx.params.name }),
          )
          operationId = operation.operationId
          yield* Effect.promise(() =>
            Operations.update(operation.operationId, {
              phase: ctx.payload.enabled ? "activating" : "draining",
              progress: 30,
            }),
          )
          yield* extensions.setEnabled(ctx.params.name, ctx.payload.enabled)
          yield* Effect.promise(() =>
            Operations.update(operation.operationId, { phase: "cleanup-pending", progress: 65 }),
          )
          // 关掉一个扩展，它贡献的技能也要立刻从技能列表里消失。
          yield* skills.reload().pipe(Effect.catchCause(() => Effect.succeed([] as never[])))
          const list = yield* extensions.list()
          const match = list.find((item) => item.name === ctx.params.name)
          if (!match) {
            const handled = yield* activateInstalledPlugin(ctx.params.name, undefined, ctx.payload.enabled).pipe(
              Effect.catchCause(() => Effect.succeed(false)),
            )
            if (!handled) return yield* Effect.fail(new HttpApiError.NotFound({}))
            yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "completed", progress: 100 }))
            yield* publishChanged(ctx.params.name, ctx.payload.enabled)
            return {
              name: ctx.params.name,
              root: "",
              source: "plugin" as const,
              enabled: ctx.payload.enabled,
              operationId,
            }
          }
          const issues = yield* extensions.issues()
          const changes = yield* extensions.changes()
          yield* Effect.promise(() => Operations.update(operation.operationId, { phase: "completed", progress: 100 }))
          yield* publishChanged(ctx.params.name, ctx.payload.enabled)
          return toInfo(match, issues[match.name], changes[match.name], operationId)
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              if (operationId) {
                yield* Effect.promise(() =>
                  Operations.update(operationId!, {
                    phase: "failed",
                    progress: 100,
                    errorCode: "MARKETPLACE_TOGGLE_FAILED",
                    recoveryHint: "当前启用状态可能未改变；重新加载扩展后重试。",
                  }),
                )
              }
              const message = String(cause).slice(0, 400)
              return yield* Effect.fail(
                /找不到|不存在|not found/i.test(message)
                  ? new HttpApiError.NotFound({})
                  : new HttpApiError.BadRequest({ message } as never),
              )
            }),
          ),
        )
      })
  }),
)
