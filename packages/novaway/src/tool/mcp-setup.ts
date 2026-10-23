import { Config } from "@/config/config"
import type { ConfigMCP } from "@/config/mcp"
import { MCP } from "@/mcp"
import { formatSetupReport, setupFailure, type SetupReport, type SetupStepView } from "@/setup/report"
import { which } from "@/util/which"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * MCP 服务器接入与诊断。
 *
 * MCP 的失败形态很集中：命令不存在（npx/uvx 没装）、环境变量没填、
 * 远端需要 OAuth、远端需要预注册 clientId。这些在状态里只有一句 error，
 * 用户很难自己判断该改哪一处。这个工具把「状态 + 配置 + 本机探测」放在一起，
 * 让 AI 直接说清楚差什么、改哪里，并在需要时重新连接。
 *
 * 注意：环境变量只报告「是否配置」与变量名，不读取、不输出变量值。
 */
type McpMetadata = {
  servers: number
  connected: number
  failed: number
}

const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["status", "connect", "add"])).annotate({
    description:
      "status (default) reports every configured server plus local diagnostics; connect retries an existing server after the config was fixed; add registers a new server and connects it.",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "Server name. Required for connect; for add it is the key written into config.",
  }),
  config: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description:
      'With action=add: the MCP entry, e.g. {"type":"local","command":["npx","-y","@upstash/context7-mcp"]} or {"type":"remote","url":"https://..."}.',
  }),
})

const NL = String.fromCharCode(10)

/** 只报告变量名与是否为空，绝不回传值。 */
export function describeEnv(environment: Record<string, string> | undefined) {
  if (!environment) return undefined
  const entries = Object.entries(environment)
  if (entries.length === 0) return undefined
  return entries.map(([key, value]) => key + (String(value ?? "").trim() ? " (set)" : " (empty)")).join(", ")
}

export function describeEntry(entry: ConfigMCP.Info) {
  if (entry.type === "local") return "local: " + entry.command.join(" ")
  return "remote: " + entry.url
}

/** 本地 server 的命令是否真的能启动（npx/uvx/node 之类的入口）。 */
export function localCommandProblem(entry: ConfigMCP.Info) {
  if (entry.type !== "local") return undefined
  const [cmd, ...rest] = entry.command
  if (!cmd) return "配置里没有 command"
  if (!which(cmd)) return "找不到可执行文件 " + cmd + "（可能没装或不在 PATH）"
  if ((cmd === "npx" || cmd === "bunx") && rest.length === 0) return "npx/bunx 后面缺少包名"
  return undefined
}

export function remoteUrlProblem(entry: ConfigMCP.Info) {
  if (entry.type !== "remote") return undefined
  if (!URL.canParse(entry.url)) return "URL 不合法：" + entry.url
  const url = new URL(entry.url)
  if (url.protocol !== "https:" && url.protocol !== "http:") return "只支持 http/https：" + url.protocol
  return undefined
}

export function isEntry(value: unknown): value is ConfigMCP.Info {
  return typeof value === "object" && value !== null && "type" in value
}

function step(server: string, status: string, detail?: string): SetupStepView {
  return { step: server, status, ...(detail ? { detail } : {}) }
}

export const McpSetupTool = Tool.define(
  "mcp_setup",
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const config = yield* Config.Service

    return {
      description: [
        "Diagnose and repair Model Context Protocol (MCP) servers configured for this project or globally.",
        "Use action=status when an MCP tool is missing or the settings page shows failed / needs_auth / needs_client_registration.",
        "It reports each server status, its config shape, whether the local command exists on PATH, whether the URL is valid, and which environment variables are set or empty (names only, never values).",
        "Use action=connect after the config was fixed to retry without restarting; use action=add to register a new server and connect it right away.",
        "Never invent credentials: if a server needs a token or client id, tell the user which variable to set instead of guessing.",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<McpMetadata>> =>
        Effect.gen(function* () {
          const cfg = yield* config.get()
          const entries = (cfg.mcp ?? {}) as Record<string, unknown>

          if ((params.action ?? "status") === "status") {
            const statuses = yield* mcp.status()
            const lines: SetupStepView[] = []
            const diagnostics: string[] = []
            let connected = 0
            let failed = 0

            for (const [name, raw] of Object.entries(entries)) {
              const status = statuses[name]
              const kind = status?.status ?? "unconfigured"
              if (kind === "connected") connected++
              if (kind === "failed" || kind === "needs_auth" || kind === "needs_client_registration") failed++
              const entry = isEntry(raw) ? raw : undefined
              lines.push(
                step(
                  name,
                  kind,
                  [
                    entry ? describeEntry(entry) : "配置结构不合法（缺少 type）",
                    status && "error" in status ? status.error : undefined,
                  ]
                    .filter(Boolean)
                    .join(" | "),
                ),
              )

              if (!entry) {
                diagnostics.push("- " + name + ": 配置结构不合法（缺少 type）")
                continue
              }
              const problems = [localCommandProblem(entry), remoteUrlProblem(entry)].filter(Boolean)
              if (problems.length > 0) diagnostics.push("- " + name + ": " + problems.join("；"))
              const env = describeEnv(entry.type === "local" ? entry.environment : undefined)
              if (env) diagnostics.push("- " + name + " env: " + env)
              if (kind === "needs_auth") diagnostics.push("- " + name + ": 需要 OAuth 授权（在设置 → MCP 里点击授权）")
              if (kind === "needs_client_registration")
                diagnostics.push("- " + name + ": 服务端不支持动态注册，需要在配置里补 oauth.clientId")
            }

            const total = Object.keys(entries).length
            const report: SetupReport = {
              domain: "mcp",
              ready: total > 0 && failed === 0,
              phase: failed > 0 ? "attention" : total === 0 ? "empty" : "ready",
              summary:
                total === 0
                  ? "没有配置任何 MCP 服务器。"
                  : connected +
                    "/" +
                    total +
                    " 个 MCP 服务器已连接" +
                    (failed > 0 ? "，" + failed + " 个需要处理" : ""),
              steps: lines,
              facts: diagnostics.length > 0 ? { diagnostics: diagnostics.join(NL) } : undefined,
              next:
                failed > 0
                  ? "按 diagnostics 修正配置后调用 action=connect 重试；需要账号授权时先完成授权。"
                  : total === 0
                    ? "可以调用 action=add 添加服务器（例如 context7、sequential-thinking）。"
                    : undefined,
            }
            return {
              title: "MCP status",
              metadata: { servers: total, connected, failed },
              output: formatSetupReport(report),
            }
          }

          if (params.action === "connect") {
            const name = params.name?.trim()
            if (!name) throw new Error("action=connect 需要 name")
            const entry = isEntry(entries[name]) ? (entries[name] as ConfigMCP.Info) : undefined
            if (!entry) throw new Error("没有名为 " + name + " 的有效 MCP 配置")

            const problem = [localCommandProblem(entry), remoteUrlProblem(entry)].filter(Boolean).join("；")
            if (problem) {
              throw new Error(
                setupFailure({
                  domain: "mcp",
                  ready: false,
                  phase: "invalid-config",
                  summary: name + " 的配置仍有问题，先修好再连接。",
                  error: problem,
                  next: "修正 config 里的命令或 URL，然后再次调用 action=connect。",
                }),
              )
            }

            yield* ctx.ask({
              permission: "mcp_setup",
              patterns: [name],
              always: ["*"],
              metadata: { action: "connect", name },
            })

            // connect 内部失败不会抛错，只写状态；这里统一从状态判断结果。
            yield* mcp.connect(name).pipe(Effect.catch(() => Effect.void))
            const status = (yield* mcp.status())[name]
            if (!status || status.status !== "connected") {
              throw new Error(
                setupFailure({
                  domain: "mcp",
                  ready: false,
                  phase: "connect-failed",
                  summary: name + " 连接失败。",
                  error: status && "error" in status ? status.error : (status?.status ?? "unknown"),
                  next: "按错误信息排查：命令是否可执行、网络是否可达、是否需要先完成授权。",
                }),
              )
            }
            return {
              title: "MCP connected",
              metadata: { servers: 1, connected: 1, failed: 0 },
              output: name + " 已连接。",
            }
          }

          const name = params.name?.trim()
          if (!name) throw new Error("action=add 需要 name")
          if (!params.config) throw new Error("action=add 需要 config")
          if (entries[name]) throw new Error("已存在同名 MCP 配置：" + name)

          yield* ctx.ask({
            permission: "mcp_setup",
            patterns: [name],
            always: ["*"],
            metadata: { action: "add", name },
          })

          // 先连接确认可用，再落盘，避免把坏配置写进用户文件。
          const added = yield* mcp.add(name, params.config as unknown as ConfigMCP.Info)
          const statuses = yield* mcp.status()
          const status = statuses[name]
          if (status && status.status === "failed") {
            throw new Error(
              setupFailure({
                domain: "mcp",
                ready: false,
                phase: "add-failed",
                summary: name + " 连接失败，未写入配置文件。",
                error: status.error,
                next: "检查 command / url 是否正确，或改用 remote + headers。",
              }),
            )
          }

          yield* config.updateGlobal({ mcp: { [name]: params.config } } as never)
          return {
            title: "MCP added",
            metadata: { servers: 1, connected: status?.status === "connected" ? 1 : 0, failed: 0 },
            output: [
              name + " 已添加。",
              "配置已写入用户级配置文件。",
              "如果状态不是 connected，请按提示完成授权。",
            ].join(NL),
          }
        }),
    }
  }),
)
