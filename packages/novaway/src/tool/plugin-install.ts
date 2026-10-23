import { Config } from "@/config/config"
import type { ConfigPlugin } from "@/config/plugin"
import { Plugin } from "@/plugin"
import { formatSetupReport, setupFailure, type SetupReport, type SetupStepView } from "@/setup/report"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * 插件安装 / 移除。
 *
 * 插件是 npm 包（或本地文件 / git），配置里只存 spec。安装 = 把 spec 追加到
 * `plugin` 数组 + 让插件服务重新读配置并加载：
 * - 设置页「插件」直接读 config，写完后立刻能看到；
 * - `Plugin.reload()` 只失效插件自己的缓存，不动整个实例，所以当前会话不用重启。
 *
 * 不做市场搜索：市场条目由桌面端主进程负责下载，与这里解耦。
 */
type PluginMetadata = {
  spec: string
  installed: boolean
  hooks: number
}

const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["status", "install", "remove"])).annotate({
    description:
      "status (default) lists configured plugin specs and how many hooks are loaded; install adds a spec and reloads; remove drops it and reloads.",
  }),
  spec: Schema.optional(Schema.String).annotate({
    description:
      'Plugin specifier: npm name with optional version ("my-plugin", "@scope/plugin@1.2.3"), a file path, or a git URL. Required for install/remove.',
  }),
  options: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Optional inline plugin options; stored as [spec, options] in config.",
  }),
})

/** 配置项统一取 specifier；支持 [spec, options] 二元组。 */
export function specifierOf(value: ConfigPlugin.Spec) {
  return Array.isArray(value) ? String(value[0]) : String(value)
}

/**
 * 判断是否同一个插件：忽略版本号。
 * 允许用户先装 foo@1.0.0，之后改成 foo@2.0.0。
 */
export function samePackage(a: ConfigPlugin.Spec, b: ConfigPlugin.Spec) {
  const base = (value: string) => {
    const spec = value.trim()
    if (spec.startsWith("@")) {
      const at = spec.indexOf("@", 1)
      return at === -1 ? spec : spec.slice(0, at)
    }
    const at = spec.indexOf("@")
    return at === -1 ? spec : spec.slice(0, at)
  }
  return base(specifierOf(a)) === base(specifierOf(b))
}

/** npm 包名 / 文件路径 / git 地址的基本形态校验。 */
export function validSpec(value: string) {
  const spec = value.trim()
  if (!spec) return "spec 不能为空"
  if (/\s/.test(spec)) return "spec 里不能有空格"
  if (spec.startsWith(".") || spec.startsWith("/") || /^[A-Za-z]:[\\/]/.test(spec)) return undefined
  if (/^(https?|git|file):\/\//.test(spec) || spec.startsWith("git@")) return undefined
  if (/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(@[^\s]+)?$/i.test(spec)) return undefined
  return "看起来不是合法的 npm 包名、文件路径或 git 地址：" + spec
}

function step(value: ConfigPlugin.Spec, status: string, detail?: string): SetupStepView {
  return { step: specifierOf(value), status, ...(detail ? { detail } : {}) }
}

export const PluginInstallTool = Tool.define(
  "plugin_install",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service

    return {
      description: [
        "Install, remove, or inspect NovaWay plugins (npm packages, local files, or git URLs declared in config.plugin).",
        "Use action=status to list configured plugin specs and how many hooks are currently loaded.",
        "Use action=install with a spec such as '@scope/plugin' or 'my-plugin@1.2.3'; it appends the spec to the user config, reloads plugins, and reports whether hooks loaded.",
        "Use action=remove to drop a spec (matching ignores the version) and reload.",
        "Only install plugins the user explicitly named. Never invent package names, and tell the user that a plugin runs code inside NovaWay before installing anything unfamiliar.",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<PluginMetadata>> =>
        Effect.gen(function* () {
          const cfg = yield* config.getGlobal()
          const current = (cfg.plugin ?? []) as ConfigPlugin.Spec[]
          const hooks = yield* plugin.list().pipe(Effect.catch(() => Effect.succeed([] as unknown[])))

          if ((params.action ?? "status") === "status") {
            const report: SetupReport = {
              domain: "plugin",
              ready: true,
              phase: current.length > 0 ? "ready" : "empty",
              summary:
                current.length === 0
                  ? "没有配置任何插件。"
                  : current.length + " 个插件已配置，" + hooks.length + " 个 hook 已加载",
              steps: current.map((item) => step(item, "configured")),
              facts: { hooks: String(hooks.length) },
              next: current.length === 0 ? "需要时用 action=install 指定插件 spec。" : undefined,
            }
            return {
              title: "Plugins",
              metadata: { spec: "", installed: true, hooks: hooks.length },
              output: formatSetupReport(report),
            }
          }

          const raw = params.spec?.trim()
          if (!raw) throw new Error("action=" + params.action + " 需要 spec")
          const problem = validSpec(raw)
          if (problem) throw new Error(problem)

          const spec: ConfigPlugin.Spec = params.options ? ([raw, params.options] as ConfigPlugin.Spec) : raw

          if (params.action === "install" && current.some((item) => samePackage(item, spec))) {
            const existing = current.find((item) => samePackage(item, spec))!
            throw new Error(
              setupFailure({
                domain: "plugin",
                ready: false,
                phase: "exists",
                summary: "该插件已经配置：" + specifierOf(existing),
                next: "如需换版本，先用 action=remove 移除旧 spec，再 action=install 新版本。",
              }),
            )
          }

          if (params.action === "remove" && !current.some((item) => samePackage(item, spec))) {
            throw new Error("配置里没有这个插件：" + raw)
          }

          yield* ctx.ask({
            permission: "plugin_install",
            patterns: [raw],
            always: ["*"],
            metadata: {
              action: params.action,
              spec: raw,
            },
          })

          const next =
            params.action === "remove" ? current.filter((item) => !samePackage(item, spec)) : [...current, spec]

          yield* config.updateGlobal({ plugin: next } as never)
          // 只刷新插件服务，避免整实例销毁把当前会话打断。
          yield* plugin.reload().pipe(Effect.catch(() => Effect.void))
          const loaded = yield* plugin.list().pipe(Effect.catch(() => Effect.succeed([] as unknown[])))

          if (params.action === "remove") {
            return {
              title: "Plugin removed",
              metadata: { spec: raw, installed: false, hooks: loaded.length },
              output: formatSetupReport({
                domain: "plugin",
                ready: true,
                phase: "removed",
                summary: "已从配置移除 " + raw,
                facts: { "plugins left": String(next.length), hooks: String(loaded.length) },
              }),
            }
          }

          const report: SetupReport = {
            domain: "plugin",
            ready: true,
            phase: "installed",
            summary: "已添加插件 " + raw + "，" + loaded.length + " 个 hook 已加载",
            facts: {
              plugins: String(next.length),
              hooks: String(loaded.length),
            },
            steps: next.map((item) => step(item, samePackage(item, spec) ? "just-added" : "configured")),
            next:
              loaded.length === 0
                ? "插件已写入配置但没有 hook：它可能只提供命令 / 技能，也可能安装失败（查看日志里的 failed to install plugin）。"
                : "可以直接让用户试用了；如果行为不符合预期，用 action=remove 回滚并附上原因。",
          }
          return {
            title: "Plugin installed",
            metadata: { spec: raw, installed: true, hooks: loaded.length },
            output: formatSetupReport(report),
          }
        }),
    }
  }),
)
