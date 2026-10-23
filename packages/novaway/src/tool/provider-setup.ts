import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { formatSetupReport, setupFailure, type SetupReport, type SetupStepView } from "@/setup/report"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * 供应商 / 模型接入诊断。
 *
 * 用户最常见的三个坑：Key 没填、baseURL 写错（少了 /v1、多写 /chat/completions）、
 * 模型列表拉不到。这些在界面上只有一句红字，用户不知道该改哪一段。
 *
 * 这个工具只做「读 + 探测 + 写一个 baseURL」：
 * - 永远不会输出 API Key（只报告类型：api / oauth / env / 未配置）；
 * - probe 会对同一地址尝试几种常见变体，报告每个变体的 HTTP 状态；
 * - configure 写配置前会请求权限确认。
 */
type ProviderMetadata = {
  provider: string
  connected: boolean
  models: number
}

const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["status", "probe", "configure"])).annotate({
    description:
      "status (default) reports connected providers and their model capabilities; probe tests candidate base URLs; configure writes the working base URL into config.",
  }),
  provider: Schema.optional(Schema.String).annotate({
    description: "Provider id, e.g. deepseek, qwen, glm, openai. Required for probe/configure.",
  }),
  baseURL: Schema.optional(Schema.String).annotate({
    description: "Base URL to test or write. For probe, several common variants are derived from it.",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "With action=status, only show availability for this model id.",
  }),
})

const NL = String.fromCharCode(10)

/** 只声明用得到的字段，避免和 Provider.Info 的深层 schema 类型纠缠。 */
type ModelView = {
  id?: string
  capabilities?: { input?: { image?: boolean }; toolcall?: boolean }
}

type ProviderView = {
  id?: string
  source?: string
  key?: string
  options?: Record<string, unknown>
  models?: Record<string, ModelView>
}

function lookup(record: unknown, id: string): ProviderView | undefined {
  const value = (record as Record<string, ProviderView | undefined> | undefined)?.[id]
  return value ?? undefined
}

function authKind(info: { type?: string } | undefined) {
  if (!info) return "none"
  return info.type ?? "unknown"
}

function stringOption(options: Record<string, unknown> | undefined, key: string) {
  const value = options?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/** 同一地址的常见变体：原样、去掉 /chat/completions、补 /v1、去掉 /v1。 */
export function baseURLVariants(input: string) {
  const raw = input.trim().replace(/\/+$/, "")
  if (!raw) return []
  const out: string[] = []
  const push = (value: string) => {
    const clean = value.replace(/\/+$/, "")
    if (clean && !out.includes(clean)) out.push(clean)
  }
  push(raw)
  push(raw.replace(/\/chat\/completions$/, ""))
  if (!/\/v\d+$/.test(raw)) push(raw + "/v1")
  if (/\/v1$/.test(raw)) push(raw.slice(0, -3))
  return out
}

/** 探测一个地址能否列出模型；只回状态码与错误文本，不回 Key。 */
export async function probeURL(url: string, key: string | undefined) {
  const modelsURL = url.replace(/\/+$/, "") + "/models"
  const headers: Record<string, string> = { Accept: "application/json" }
  if (key) headers.Authorization = "Bearer " + key
  try {
    const response = await fetch(modelsURL, { headers, signal: AbortSignal.timeout(15_000) })
    const body = await response.text()
    let models: string[] = []
    try {
      const payload = JSON.parse(body) as { data?: Array<{ id?: unknown }> }
      if (Array.isArray(payload.data)) {
        models = payload.data
          .map((item) => String(item?.id ?? ""))
          .filter(Boolean)
          .slice(0, 5)
      }
    } catch {
      // 非 JSON 响应：保留状态码即可。
    }
    return {
      url,
      ok: response.ok,
      status: response.status,
      models,
      error: response.ok ? undefined : body.replace(/\s+/g, " ").trim().slice(0, 300),
    }
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      models: [] as string[],
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    }
  }
}

export const ProviderSetupTool = Tool.define(
  "provider_setup",
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const auth = yield* Auth.Service
    const config = yield* Config.Service

    return {
      description: [
        "Diagnose AI provider and model configuration (API key, base URL, model list, model capabilities).",
        "Use action=status when a provider fails, a model is missing, or you need to know which models support images or tool calls.",
        "Use action=probe to test candidate base URLs for a provider; it tries common variants such as adding or removing /v1 and reports the HTTP status for each.",
        "Use action=configure to write the working base URL into provider.<id>.options.baseURL after probing.",
        "API keys are never returned by this tool: it only reports whether a key exists and of which kind. Never ask the user to paste a key into the chat; point them to Settings instead.",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<ProviderMetadata>> =>
        Effect.gen(function* () {
          const cfg = yield* config.get()
          const resolved: unknown = yield* provider.list()

          if ((params.action ?? "status") === "status") {
            const wanted = params.provider?.trim()
            const ids = wanted ? [wanted] : Object.keys(resolved as Record<string, ProviderView>)
            const steps: SetupStepView[] = []
            const problems: string[] = []
            let connectedCount = 0

            for (const id of ids) {
              const info = lookup(resolved, id)
              const authInfo = yield* auth.get(id).pipe(Effect.catch(() => Effect.succeed(undefined)))
              const configuredBase = stringOption(cfg.provider?.[id]?.options as Record<string, unknown>, "baseURL")
              const models = info ? Object.values(info.models ?? {}) : []
              const imageModels = models.filter((model) => model.capabilities?.input?.image)
              const toolModels = models.filter((model) => model.capabilities?.toolcall)
              const source = info?.source ?? (cfg.provider?.[id] ? "config" : "unknown")
              const kind = authKind(authInfo as { type?: string } | undefined)

              if (info) connectedCount++
              if (!info) problems.push(id + ": no usable config (not connected, not in the built-in catalog)")
              if (info && kind === "none" && !info.key)
                problems.push(id + ": no API key (connect the provider in Settings)")
              if (info && models.length === 0) problems.push(id + ": empty model list - check baseURL or network")
              if (configuredBase && !URL.canParse(configuredBase)) problems.push(id + ": invalid baseURL")

              steps.push({
                step: id,
                status: info ? "connected" : "missing",
                detail: [
                  "source=" + source,
                  "auth=" + kind,
                  "baseURL=" + (configuredBase ?? stringOption(info?.options, "baseURL") ?? "default"),
                  "models=" + models.length,
                  "vision=" + imageModels.length,
                  "tools=" + toolModels.length,
                  params.model
                    ? params.model + "=" + (models.some((item) => item.id === params.model) ? "present" : "missing")
                    : "",
                ]
                  .filter(Boolean)
                  .join(", "),
              })
            }

            const report: SetupReport = {
              domain: "provider",
              ready: problems.length === 0 && connectedCount > 0,
              phase: problems.length > 0 ? "attention" : connectedCount > 0 ? "ready" : "empty",
              summary:
                connectedCount === 0
                  ? "No usable provider yet."
                  : connectedCount +
                    " provider(s) usable" +
                    (problems.length > 0 ? ", " + problems.length + " problem(s) found" : ""),
              steps,
              facts: problems.length > 0 ? { problems: problems.join(NL) } : undefined,
              next:
                problems.length > 0
                  ? "Fix the key or baseURL first; when the baseURL is uncertain, use action=probe to test candidates."
                  : undefined,
            }
            return {
              title: "Provider status",
              metadata: {
                provider: wanted ?? "",
                connected: connectedCount > 0,
                models: Object.keys(lookup(resolved, wanted ?? "")?.models ?? {}).length,
              },
              output: formatSetupReport(report),
            }
          }

          const id = params.provider?.trim()
          if (!id) throw new Error("action=" + params.action + " requires provider")
          const info = lookup(resolved, id)
          const configuredBase = stringOption(cfg.provider?.[id]?.options as Record<string, unknown>, "baseURL")
          const startURL = params.baseURL?.trim() || configuredBase || stringOption(info?.options, "baseURL")

          if ((params.action ?? "status") === "probe") {
            if (!startURL) {
              throw new Error(
                setupFailure({
                  domain: "provider",
                  ready: false,
                  phase: "no-url",
                  summary: id + " has no baseURL to test.",
                  next: "Ask the user for the provider's OpenAI-compatible endpoint, then call action=probe with baseURL.",
                }),
              )
            }

            const authInfo = yield* auth.get(id).pipe(Effect.catch(() => Effect.succeed(undefined)))
            const key =
              authInfo && "key" in authInfo && typeof authInfo.key === "string"
                ? authInfo.key
                : typeof info?.key === "string"
                  ? info.key
                  : undefined
            if (!key) {
              throw new Error(
                setupFailure({
                  domain: "provider",
                  ready: false,
                  phase: "no-key",
                  summary: id + " has no API key, so the model list cannot be verified.",
                  next: "Ask the user to fill the key in Settings; never ask them to paste it into the chat.",
                }),
              )
            }

            const results = yield* Effect.promise(() =>
              Promise.all(baseURLVariants(startURL).map((url) => probeURL(url, key))),
            )
            const working = results.find((item) => item.ok)
            const report: SetupReport = {
              domain: "provider",
              ready: Boolean(working),
              phase: working ? "ready" : "failed",
              summary: working
                ? "Working URL: " + working.url + " (" + working.models.length + " model samples)"
                : "None of the candidate URLs could list models.",
              steps: results.map((item) => ({
                step: item.url,
                status: item.ok ? "ok" : "error",
                detail: item.ok
                  ? "models: " + (item.models.join(", ") || "empty")
                  : "HTTP " + item.status + " " + (item.error ?? ""),
              })),
              next: working
                ? "To persist it, call action=configure with baseURL=" + working.url
                : "Check that the key is valid and the network is reachable; some providers require enabling model listing.",
            }
            return {
              title: "Provider probe",
              metadata: { provider: id, connected: Boolean(working), models: working?.models.length ?? 0 },
              output: formatSetupReport(report),
            }
          }

          if (!params.baseURL?.trim()) throw new Error("action=configure requires baseURL")
          const target = params.baseURL.trim().replace(/\/+$/, "")
          if (!URL.canParse(target)) throw new Error("Invalid baseURL: " + target)

          yield* ctx.ask({
            permission: "provider_setup",
            patterns: [id],
            always: ["*"],
            metadata: { action: "configure", provider: id, baseURL: target },
          })

          yield* config.updateGlobal({ provider: { [id]: { options: { baseURL: target } } } } as never)
          // 只刷新 provider 缓存：否则旧状态会继续用旧端点，直到重启实例。
          yield* provider.reload().pipe(Effect.catch(() => Effect.void))
          return {
            title: "Provider configured",
            metadata: {
              provider: id,
              connected: Boolean(lookup(resolved, id)),
              models: Object.keys(lookup(resolved, id)?.models ?? {}).length,
            },
            output: [
              id + " baseURL written to the user config: " + target,
              "Note: reopen the session or refresh the provider list for it to take effect.",
            ].join(NL),
          }
        }),
    }
  }),
)
