import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import * as LSPServer from "@/lsp/server"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Process } from "@/util/process"
import { formatSetupReport, setupFailure, type SetupReport } from "@/setup/report"
import path from "node:path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * 语言工具链（LSP）安装与诊断。
 *
 * 每种语言的服务端获取方式都不一样：Go 用 go install、Ruby 用 gem install、
 * C# 用 dotnet tool、zls 直接下 release、TS/Vue 走 npm……用户很难记住。
 * server.spawn() 里其实已经实现了「缺二进制就自动装」，这个工具把它暴露出来：
 * 先试启动（顺带触发安装），成功就停掉进程只报告结果，失败则给出缺的前置工具。
 */
type LspMetadata = {
  servers: number
  ready: number
  missing: number
}

const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["status", "install"])).annotate({
    description:
      "status (default) lists language servers and which ones are connected; install prepares a server (downloads/installs it when missing) and verifies it can start.",
  }),
  language: Schema.optional(Schema.String).annotate({
    description:
      'Language or file extension to target, e.g. "go", "python", ".rs", "typescript". Omit to target every server.',
  }),
  server: Schema.optional(Schema.String).annotate({
    description: 'Exact server id, e.g. "gopls", "pyright", "rust-analyzer". Takes precedence over language.',
  }),
})

const NL = String.fromCharCode(10)

/** 语言名 / 扩展名 → 候选服务端。 */
export function matchServers(
  input: string | undefined,
  servers: readonly LSPServer.Info[] = Object.values(LSPServer).filter(isServer),
): LSPServer.Info[] {
  if (!input?.trim()) return Array.from(servers)
  const raw = input.trim().toLowerCase()
  const ext = raw.startsWith(".") ? raw : "." + raw
  return servers.filter(
    (server) =>
      server.id.toLowerCase() === raw ||
      server.id.toLowerCase().includes(raw) ||
      server.extensions.some((item) => item.toLowerCase() === ext || item.toLowerCase() === raw),
  )
}

export function isServer(value: unknown): value is LSPServer.Info {
  return typeof value === "object" && value !== null && typeof (value as LSPServer.Info).id === "string"
}

/** 配置里被显式关闭的服务端不需要再尝试。 */
export function isDisabled(config: unknown, id: string) {
  if (config === true) return false
  if (!config || config === false) return true
  const entry = (config as Record<string, { disabled?: boolean }>)[id]
  return entry?.disabled === true
}

/** 用一个假的文件路径触发 root 解析（root 只看目录名）。 */
export function probeFile(directory: string, server: LSPServer.Info) {
  return path.join(directory, "probe" + (server.extensions[0] ?? ""))
}

export const LspSetupTool = Tool.define(
  "lsp_setup",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const flags = yield* RuntimeFlags.Service
    const config = yield* Config.Service

    return {
      description: [
        "Inspect or prepare the language servers behind NovaWay's lsp tool (diagnostics, definitions, references, symbols).",
        "Use action=status to see which servers cover a language and which are currently connected.",
        "Use action=install to prepare a server when lsp fails or the server is missing; it triggers the same built-in installer the agent uses (go install / gem install / dotnet tool / npm / release download) and verifies the process starts.",
        "Only fall back to manual shell commands when this reports a missing prerequisite such as the Go, Ruby, Zig or .NET toolchain.",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<LspMetadata>> =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const directory = ctx.directory ?? instance.directory
          const cfg = yield* config.get()
          const all = matchServers(params.server ?? params.language)

          if (all.length === 0) {
            return {
              title: "No matching language server",
              metadata: { servers: 0, ready: 0, missing: 0 },
              output: formatSetupReport({
                domain: "lsp",
                ready: false,
                phase: "unknown",
                summary: "没有匹配的语言服务端：" + (params.server ?? params.language ?? ""),
                facts: {
                  available: Object.values(LSPServer)
                    .filter(isServer)
                    .map((item) => item.id)
                    .join(", "),
                },
              }),
            }
          }

          const statuses = yield* lsp.status()
          const connected = new Set(statuses.map((item) => item.id))

          if ((params.action ?? "status") === "status") {
            const rows = all.map((server) => {
              const disabled = isDisabled(cfg.lsp, server.id)
              const state = disabled ? "disabled in config" : connected.has(server.id) ? "connected" : "not running"
              return server.id + " [" + server.extensions.join(" ") + "] - " + state
            })
            const missing = all.filter((server) => !connected.has(server.id)).length
            return {
              title: "Language servers",
              metadata: { servers: all.length, ready: all.length - missing, missing },
              output: formatSetupReport({
                domain: "lsp",
                ready: missing === 0,
                phase: missing === 0 ? "ready" : "idle",
                summary: missing === 0 ? "相关语言服务端已连接。" : "有 " + missing + " 个语言服务端尚未启动。",
                facts: { servers: rows.join(NL) },
                next:
                  missing === 0 ? undefined : "对尚未启动的服务端调用 action=install（可指定 language 或 server）。",
              }),
            }
          }

          yield* ctx.ask({
            permission: "lsp_setup",
            patterns: all.map((server) => server.id),
            always: ["*"],
            metadata: { action: "install", servers: all.map((server) => server.id).join(",") },
          })

          if (flags.disableLspDownload) {
            throw new Error(
              setupFailure({
                domain: "lsp",
                ready: false,
                phase: "blocked",
                summary: "当前配置禁用了 LSP 自动下载（disableLspDownload），无法自动安装。",
                next: "让用户手动安装对应语言服务端，或在配置里关闭 disableLspDownload。",
              }),
            )
          }

          const lines: string[] = []
          let ready = 0
          for (const server of all) {
            if (isDisabled(cfg.lsp, server.id)) {
              lines.push("- [skip] " + server.id + ": 配置里已禁用")
              continue
            }
            const root = yield* Effect.promise(() =>
              server.root(probeFile(directory, server), instance).catch(() => undefined),
            )
            if (!root) {
              lines.push("- [skip] " + server.id + ": 当前项目没有匹配的根目录标记")
              continue
            }
            const handle = yield* Effect.promise(() => server.spawn(root, instance, flags).catch(() => undefined))
            if (!handle) {
              lines.push(
                "- [error] " +
                  server.id +
                  ": 启动失败，通常是缺少前置工具链或下载失败（" +
                  server.extensions.join(" ") +
                  "）",
              )
              continue
            }
            // 只是为了验证能否启动/安装成功，验证完立刻停掉，避免常驻进程。
            yield* Effect.promise(() => Process.stop(handle.process).catch(() => undefined))
            lines.push("- [ok] " + server.id + ": 已就绪")
            ready++
          }

          const report: SetupReport = {
            domain: "lsp",
            ready: ready === all.length,
            phase: ready === all.length ? "ready" : "partial",
            summary:
              ready === all.length
                ? "相关语言服务端已就绪。"
                : ready + "/" + all.length + " 个语言服务端就绪，其余需要排查前置工具。",
            facts: { servers: lines.join(NL) },
            next:
              ready === all.length
                ? undefined
                : "按报错确认前置工具（go / ruby+gem / zig / dotnet / node），安装后再次调用 action=install。",
          }

          if (ready === 0) throw new Error(setupFailure(report))

          return {
            title: "Language servers prepared",
            metadata: { servers: all.length, ready, missing: all.length - ready },
            output: formatSetupReport(report),
          }
        }),
    }
  }),
)
