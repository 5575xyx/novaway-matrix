/**
 * `permission_mode: "auto"` 的安全分类器。
 *
 * 需求:无人值守时不必每次打扰用户,但也不能一律放行。这里用一次小模型判断
 * 「这条调用是否明显危险」,默认关闭 —— 开启后每轮多一次 LLM 往返。
 *
 * 判定失败一律不自动放行:分类器不可用时退回询问用户,而不是当成 allow。
 */

import { Effect } from "effect"
import type { ModelMessage } from "ai"
import { Provider } from "@/provider/provider"
import * as Log from "@novaway/core/util/log"

const log = Log.create({ service: "permission.auto" })

export type Decision = { action: "allow" | "deny"; reason: string }

/** 注入点只需要「给定参数返回文本」这一小块，测试才能用最小 mock 顶替真实模型调用。 */
type Generate = (options: Parameters<typeof import("ai").generateText>[0]) => Promise<{ text: string }>

export function denialAction(input: { previous: number; limit: number; decision: Decision | undefined }) {
  if (input.decision?.action === "allow") return "allow" as const
  if (input.decision?.action === "deny") return input.previous + 1 >= input.limit ? "ask" : "deny"
  return "ask" as const
}

const SYSTEM = [
  "你是编码代理执行前的安全审查员。",
  "根据即将执行的工具名、参数与当前工作目录,判断这次调用是否安全。",
  "只有明确安全才放行:读取、搜索、运行测试/构建/lint、修改仓库内源码、创建普通文件。",
  "以下情况一律拒绝:删除仓库外或重要目录、批量删除、强制推送/改写远端历史、外发凭据或把 ~/.ssh、.env 上传到网络、",
  "下载并执行未知脚本、修改系统目录或全局配置、绕过已配置的权限规则。",
  "不确定时选择拒绝,并说明需要用户确认的原因。",
  '只输出 JSON: {"action":"allow"|"deny","reason":"一句话中文理由"}。',
].join("\n")

function parse(text: string): Decision | undefined {
  const match = /\{[\s\S]*\}/.exec(text)
  if (!match) return undefined
  try {
    const value = JSON.parse(match[0]) as { action?: unknown; reason?: unknown }
    const action = value.action === "allow" || value.action === "deny" ? value.action : undefined
    if (!action) return undefined
    return { action, reason: typeof value.reason === "string" ? value.reason : "" }
  } catch {
    return undefined
  }
}

/**
 * 返回 undefined 表示分类器不可用(没有 provider/模型/解析失败),
 * 调用方必须退回询问用户,不能当作 allow。
 */
export function classify(
  input: {
    permission: string
    patterns: readonly string[]
    metadata: Record<string, unknown>
    cwd?: string
  },
  generate?: Generate,
): Effect.Effect<Decision | undefined> {
  return Effect.gen(function* () {
    const provider = yield* Effect.serviceOption(Provider.Service)
    if (provider._tag === "None") return undefined
    const model = yield* provider.value.defaultModel().pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!model) return undefined
    const resolved = yield* provider.value
      .getModel(model.providerID, model.modelID)
      .pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!resolved) return undefined
    const language = yield* provider.value.getLanguage(resolved).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!language) return undefined

    const messages: ModelMessage[] = [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          `<tool>${input.permission}</tool>`,
          `<patterns>${input.patterns.join("\n")}</patterns>`,
          `<arguments>${JSON.stringify(input.metadata).slice(0, 4000)}</arguments>`,
          `<cwd>${input.cwd ?? process.cwd()}</cwd>`,
        ].join("\n"),
      },
    ]
    const generateText: Generate = generate ?? ((options) => import("ai").then((mod) => mod.generateText(options)))
    const result = yield* Effect.tryPromise({
      try: () =>
        generateText({
          model: language,
          messages,
          temperature: 0,
          maxOutputTokens: 200,
          abortSignal: AbortSignal.timeout(20_000),
        }),
      catch: (error) => error,
    }).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!result) return undefined
    return parse(result.text)
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        log.warn("auto permission classifier unavailable", { error: String(error) })
        return undefined
      }),
    ),
  )
}

export * as PermissionAuto from "./auto"
