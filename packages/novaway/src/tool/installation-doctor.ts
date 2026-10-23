import { Installation, NPM_PACKAGE } from "@/installation"
import { describeLayout, inspectInstall } from "@/installation/diagnose"
import { Process } from "@/util/process"
import { formatSetupReport, setupFailure, type SetupReport } from "@/setup/report"
import { NpmConfig } from "@novaway/core/npm-config"
import { InstallationChannel, InstallationVersion } from "@novaway/core/installation/version"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * 安装 / 升级诊断。
 *
 * README 的排查章节是静态文档：用户得自己判断是哪一种坑。这个工具把那套判断
 * 变成可执行检查——找到包装包、确认二进制不是 postinstall 占位脚本、确认平台包
 * 是否解包、读 registry、尝试拿 latest——再由 AI 决定下一步（走镜像重装、
 * 补跑 postinstall，还是先解决网络）。
 *
 * 升级只在用户明确要求时执行，并且先走权限确认。
 */
type DoctorMetadata = {
  method: string
  version: string
  ready: boolean
}

const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["status", "upgrade"])).annotate({
    description:
      "status (default) inspects the installation; upgrade installs the latest (or the requested) version using the detected package manager.",
  }),
  version: Schema.optional(Schema.String).annotate({
    description: "Target version for action=upgrade. Defaults to the latest published version.",
  }),
  registry: Schema.optional(Schema.String).annotate({
    description:
      "npm-family only: install through this registry (e.g. https://registry.npmmirror.com) when the default one is slow or stale.",
  }),
})

type NpmMethod = "npm" | "yarn" | "pnpm" | "bun"

function packageManagerCommand(name: NpmMethod) {
  if (process.platform === "win32" && name !== "bun") return name + ".cmd"
  return name
}

/** npm 家族各自的全局安装参数，顺序与官方文档一致。 */
export function globalInstallArgs(method: NpmMethod, target: string, registry?: string) {
  const pkg = NPM_PACKAGE + "@" + target
  if (method === "npm") return ["install", "-g", pkg, ...(registry ? ["--registry", registry] : [])]
  if (method === "pnpm") return ["add", "-g", pkg, ...(registry ? ["--registry", registry] : [])]
  if (method === "yarn") return ["global", "add", pkg, ...(registry ? ["--registry", registry] : [])]
  return ["add", "-g", pkg, ...(registry ? ["--registry", registry] : [])]
}

function isNpmFamily(method: string): method is NpmMethod {
  return method === "npm" || method === "pnpm" || method === "yarn" || method === "bun"
}

const NL = String.fromCharCode(10)

async function diagnose(): Promise<SetupReport> {
  const layout = inspectInstall()
  const method = await Installation.method()
  const registry = await Effect.runPromise(NpmConfig.registry(process.cwd())).catch(() => "unknown")

  let latest: string | undefined
  let latestError: string | undefined
  try {
    latest = await Installation.latest(method === "unknown" ? undefined : method)
  } catch (error) {
    latestError = error instanceof Error ? error.message : String(error)
  }

  const uptodate = latest === undefined ? undefined : latest === InstallationVersion
  const problems: string[] = []
  if (method === "unknown") problems.push("无法识别安装方式（可能装在非常规路径或用了不支持的安装器）")
  if (layout.postinstallStub) problems.push("二进制仍是 postinstall 占位脚本，说明安装脚本没有执行")
  if (!layout.development && !layout.binaryPath) problems.push("包装包里找不到可执行二进制")
  if (!layout.development && !layout.platformPackagePresent)
    problems.push("平台包 " + layout.platformPackage + " 未解包（npm 下载超时会被静默跳过）")
  if (latestError) problems.push("拿不到最新版本，可能是 registry / 网络问题")
  if (uptodate === false) problems.push("当前版本落后于最新版本")

  const next = (() => {
    if (layout.postinstallStub && layout.wrapperDir)
      return "在 " + layout.wrapperDir + " 下执行 node postinstall.mjs，或换镜像重装"
    if (method === "unknown")
      return "用 npm 从镜像重装：npm install -g " + NPM_PACKAGE + " --registry=https://registry.npmmirror.com"
    if (!layout.development && !layout.platformPackagePresent)
      return (
        "换镜像重装：npm install -g " +
        NPM_PACKAGE +
        "@" +
        (latest ?? "latest") +
        " --registry=https://registry.npmmirror.com"
      )
    if (latestError) return "检查 registry（当前 " + registry + "）与代理后重试"
    if (uptodate === false) return "调用本工具 action=upgrade 升级到 " + latest
    return undefined
  })()

  return {
    domain: "installation",
    ready: problems.length === 0,
    phase: problems.length === 0 ? "ready" : "attention",
    summary:
      problems.length === 0
        ? "安装状态正常（" + InstallationVersion + "）"
        : "发现 " + problems.length + " 个问题：" + problems.join("；"),
    facts: {
      version: InstallationVersion,
      channel: InstallationChannel,
      method,
      registry,
      latest: latest ?? "unknown",
      "up to date": uptodate === undefined ? "unknown" : uptodate,
      package: NPM_PACKAGE,
      "exec path": layout.execPath,
      "wrapper dir": layout.wrapperDir,
      binary: describeLayout(layout),
      "platform package": layout.platformPackage + (layout.platformPackagePresent ? " (present)" : " (missing)"),
      ...(latestError ? { "latest error": latestError.slice(0, 300) } : {}),
    },
    next,
  }
}

export const InstallationDoctorTool = Tool.define(
  "installation_doctor",
  Effect.gen(function* () {
    return {
      description: [
        "Diagnose NovaWay's own installation and upgrade problems (npm/pnpm/bun/brew installs).",
        "Use action=status when the app fails to start, an upgrade fails, or the user reports a missing binary / stuck install.",
        "It reports the detected install method, wrapper package and binary health (including the postinstall placeholder), platform package presence, npm registry, current vs latest version, and the network error if latest cannot be fetched.",
        "Use action=upgrade only when the user asked to upgrade; it runs the detected package manager, optionally through a mirror registry.",
        "Explain the returned next step in plain language and prefer fixing the registry or re-running postinstall over reinstalling blindly.",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<DoctorMetadata>> =>
        Effect.gen(function* () {
          const report = yield* Effect.promise(() => diagnose())
          const method = String(report.facts?.method ?? "unknown")

          if ((params.action ?? "status") === "status") {
            return {
              title: "Installation status",
              metadata: { method, version: InstallationVersion, ready: report.ready },
              output: formatSetupReport(report),
            }
          }

          if (method === "unknown" && !params.registry) {
            throw new Error(
              setupFailure({
                ...report,
                summary: "无法自动升级：安装方式未知。",
                next:
                  "让用户确认安装来源，或用 npm 重装：npm install -g " +
                  NPM_PACKAGE +
                  " --registry=https://registry.npmmirror.com",
              }),
            )
          }

          yield* ctx.ask({
            permission: "installation_doctor",
            patterns: [params.registry ? "upgrade:registry" : "upgrade"],
            always: ["*"],
            metadata: { action: "upgrade", version: params.version, registry: params.registry },
          })

          const target = params.version || String(report.facts?.latest ?? "") || "latest"

          if (isNpmFamily(method) && params.registry) {
            const cmd = packageManagerCommand(method)
            const args = globalInstallArgs(method, target, params.registry)
            const result = yield* Effect.promise(() =>
              Process.run([cmd, ...args], { timeout: 10 * 60_000, nothrow: true }),
            )
            if (result.code !== 0) {
              throw new Error(
                setupFailure({
                  ...report,
                  summary: "通过镜像升级失败（" + cmd + "）",
                  error:
                    (result.stderr.toString() || result.stdout.toString()).trim().slice(-1500) || "exit " + result.code,
                  next: "检查网络/代理，或改用其他镜像；也可以让用户手动执行这条命令确认输出。",
                }),
              )
            }
            return {
              title: "Upgraded",
              metadata: { method, version: target, ready: true },
              output:
                "已通过 " +
                params.registry +
                " 安装 " +
                NPM_PACKAGE +
                "@" +
                target +
                NL +
                "提示：重启 NovaWay 后新版本才会生效。",
            }
          }

          const upgraded = yield* Effect.tryPromise({
            try: () => Installation.upgrade(method as never, target).then(() => ({ ok: true as const })),
            catch: (error) => error,
          }).pipe(
            Effect.match({
              onSuccess: (value) => value,
              onFailure: (error) => ({ ok: false as const, failure: error as { stderr?: string } }),
            }),
          )

          if (!upgraded.ok) {
            const failure = upgraded.failure?.stderr ?? String(upgraded.failure)
            throw new Error(
              setupFailure({
                ...report,
                summary: "升级失败（" + method + " → " + target + "）",
                error: failure.slice(0, 1500),
                next: "改写 registry 镜像后重试：action=upgrade 带上 registry=https://registry.npmmirror.com",
              }),
            )
          }

          return {
            title: "Upgraded",
            metadata: { method, version: target, ready: true },
            output: "已升级到 " + target + "，重启 NovaWay 后生效。",
          }
        }),
    }
  }),
)
