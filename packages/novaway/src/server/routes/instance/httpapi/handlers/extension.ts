import path from "node:path"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { BackgroundJob } from "@/background/job"
import { Identifier } from "@/id/id"
import { Service as SkillService } from "@/skill"
import * as SkillPython from "@/skill/python-env"
import { InstanceHttpApi } from "../api"
import { ExtensionInfo } from "../groups/extension"
import { Service as ExtensionService } from "@/extension/registry"
import * as Marketplace from "@/extension/marketplace"
import * as Provision from "@/extension/provision"
import * as Catalog from "@/extension/catalog"
import type { Loaded } from "@/extension/schema"

type Change = "added" | "removed" | "upgraded" | "downgraded" | "changed" | "unchanged"

const toInfo = (
  item: Loaded,
  issues?: Array<{ severity: "error" | "warning"; code: string; message: string }>,
  status?: Change,
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
})

export const extensionHandlers = HttpApiBuilder.group(InstanceHttpApi, "extension", (handlers) =>
  Effect.gen(function* () {
    const extensions = yield* ExtensionService
    const jobs = yield* BackgroundJob.Service
    const skills = yield* SkillService

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

    return handlers
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
          const errors: string[] = []
          const load = (urls: readonly string[]) =>
            Effect.promise(() => Marketplace.manifest(urls)).pipe(
              Effect.catchCause((cause) => {
                errors.push(String(cause).slice(0, 300))
                return Effect.succeed(undefined as unknown)
              }),
            )
          const zcode = yield* load(Catalog.ZCODE_MARKETPLACE_URLS)
          const claude = yield* load(Catalog.CLAUDE_MARKETPLACE_URLS)
          return {
            installed,
            zcode: Catalog.parseZcode(zcode),
            claude: Catalog.parseClaude(claude),
            updates,
            errors,
          }
        }),
      )
      .handle("install", (ctx) =>
        Effect.gen(function* () {
          const input = ctx.payload
          const installed =
            input.kind === "zip"
              ? yield* Effect.promise(() =>
                  Marketplace.installZip({
                    name: input.name,
                    url: input.url,
                    version: input.version,
                    sha256: input.sha256,
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
                  }),
                )
          yield* refresh()
          // 手动装回来：清掉「用户卸载过」的标记，后台自动准备照常生效。
          yield* Effect.promise(() => Provision.undismiss(input.name))
          // 后台准备 Python 依赖（`jobs.start` 自己会 fork，不会卡住安装请求）；
          // 失败不影响「已安装」这个事实，模型运行时会看到原因。
          yield* preparePython(installed.root)
          return installed
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.fail(
              new HttpApiError.BadRequest({
                message: String(cause).slice(0, 400),
              } as never),
            ),
          ),
        ),
      )
      .handle("uninstall", (ctx) =>
        Effect.gen(function* () {
          // 先记下目录：卸载完就查不到它给哪个技能准备过 Python 环境了。
          const installed = yield* Effect.promise(() => Marketplace.list()).pipe(
            Effect.catchCause(() => Effect.succeed([] as Marketplace.Installed[])),
          )
          const target = installed.find(
            (item) => item.name === ctx.params.name || path.basename(item.root) === ctx.params.name,
          )
          const removed = yield* Effect.promise(() => Marketplace.remove(ctx.params.name))
          if (!removed) return yield* Effect.fail(new HttpApiError.NotFound({}))
          // 内置条目被手动卸载：记下来，别在下次启动时自动装回来。
          yield* Effect.promise(() => Provision.dismiss(target?.name ?? ctx.params.name))
          // 扩展没了，它专属的 venv 也一起删，别留几百 MB 的孤儿目录。
          if (target) yield* Effect.promise(() => SkillPython.forgetUnder(target.root))
          yield* refresh()
          return true
        }).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.BadRequest({})))),
      )
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
      .handle("toggle", (ctx) =>
        Effect.gen(function* () {
          yield* extensions.setEnabled(ctx.params.name, ctx.payload.enabled)
          // 关掉一个扩展，它贡献的技能也要立刻从技能列表里消失。
          yield* skills.reload().pipe(Effect.catchCause(() => Effect.succeed([] as never[])))
          const list = yield* extensions.list()
          const match = list.find((item) => item.name === ctx.params.name)
          if (!match) return yield* Effect.fail(new HttpApiError.NotFound({}))
          const issues = yield* extensions.issues()
          const changes = yield* extensions.changes()
          return toInfo(match, issues[match.name], changes[match.name])
        }),
      )
  }),
)
