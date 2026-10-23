import type { OfficeConnectorConfig, OfficePlatformStatus } from "@/office/platform"
import { OfficePlatform } from "@/office/platform"
import { formatSetupReport, setupFailure, type SetupReport, type SetupStepView } from "@/setup/report"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * 办公平台接入诊断（飞书 / 腾讯文档）。
 *
 * 这类问题几乎都是「配置对了但顺序错了」或「凭据错了但界面只显示未配置」。
 * 这个工具只做诊断与验证：读已保存的配置 + 环境变量，必要时调用飞书开放平台
 * 校验 appId/appSecret 是否有效，然后给出可执行结论。
 *
 * 安全边界：工具**永不写入、永不返回密钥内容**，只报告「是否已配置」与校验结果。
 * 需要填写 App Secret 时，指引用户到「设置 → 办公平台」里操作。
 */
type OfficeMetadata = {
  feishu: "ok" | "partial" | "missing"
  tencentDocs: "ok" | "missing"
}

const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["status", "verify", "guide"])).annotate({
    description:
      "status (default) reports what is configured and what is missing; verify checks the Feishu app credentials against the open platform; guide returns the setup checklist for the chosen platform.",
  }),
  platform: Schema.optional(Schema.Literals(["feishu", "tencent-docs"])).annotate({
    description: "Which connector to focus on. Defaults to feishu.",
  }),
})

const NL = String.fromCharCode(10)
const FEISHU_TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"

export type FeishuConfigView = {
  hasWebhook: boolean
  hasAppId: boolean
  hasAppSecret: boolean
  hasUserId: boolean
  keyword?: string
}

/** 从已保存配置与环境变量合并出「到底配了什么」，不含任何密钥内容。 */
export function feishuView(
  config: OfficeConnectorConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): FeishuConfigView {
  const webhook = config?.feishuWebhookUrl?.trim() || env.FEISHU_WEBHOOK_URL?.trim()
  const appId = config?.feishuAppId?.trim() || env.FEISHU_APP_ID?.trim()
  const appSecret = config?.feishuAppSecret?.trim() || env.FEISHU_APP_SECRET?.trim()
  const userId = config?.feishuUserId?.trim() || env.FEISHU_USER_ID?.trim()
  return {
    hasWebhook: Boolean(webhook),
    hasAppId: Boolean(appId),
    hasAppSecret: Boolean(appSecret),
    hasUserId: Boolean(userId),
    keyword: config?.feishuKeyword?.trim() || env.FEISHU_KEYWORD?.trim() || undefined,
  }
}

export function tencentDocsConfigured(config: OfficeConnectorConfig | undefined, env: NodeJS.ProcessEnv = process.env) {
  return Boolean(config?.tencentDocsToken?.trim() || env.TENCENT_DOCS_TOKEN?.trim())
}

/**
 * 判断飞书配置应该走哪条路：
 * - app：长连接机器人（能收消息、能回问题），需要 appId + appSecret；
 * - webhook：自定义机器人（只能单向推送），需要 webhookUrl；
 * - incomplete：填了一半，最常见的就是「只填了 App ID，忘了 App Secret」。
 */
export function feishuMode(view: FeishuConfigView) {
  if (view.hasAppId && view.hasAppSecret) return "app" as const
  if (view.hasWebhook) return "webhook" as const
  if (view.hasAppId || view.hasAppSecret) return "incomplete" as const
  return "missing" as const
}

/** 用 tenant_access_token 校验 appId/appSecret；不发送任何消息。 */
export async function verifyFeishuApp(appId: string, appSecret: string) {
  try {
    const response = await fetch(FEISHU_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await response.json().catch(() => ({}))) as { code?: number; msg?: string }
    const code = typeof body.code === "number" ? body.code : response.ok ? 0 : response.status
    return {
      ok: response.ok && code === 0,
      code,
      message: body.msg?.trim() || (response.ok ? "ok" : "HTTP " + response.status),
    }
  } catch (error) {
    return {
      ok: false,
      code: -1,
      message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    }
  }
}

/** 飞书错误码 → 人话。只列最常见的几个，其余原样返回。 */
export function explainFeishuCode(code: number) {
  if (code === 0) return undefined
  if (code === 10003 || code === 10001) return "App ID 或 App Secret 不正确"
  if (code === 10014) return "App Secret 不正确"
  if (code === 99991663 || code === 99991661) return "应用未开通机器人能力"
  if (code === -1) return "网络不可达（检查代理或防火墙）"
  return undefined
}

function step(name: string, status: string, detail?: string): SetupStepView {
  return { step: name, status, ...(detail ? { detail } : {}) }
}

const FEISHU_GUIDE = [
  "1. 打开 https://open.feishu.cn/app ，用电脑端登录，创建或选择一个自建应用。",
  "2. 「凭证与基础信息」里复制 App ID 与 App Secret。",
  "3. 「添加应用能力」里开启「机器人」。",
  "4. 「事件与回调」选择长连接方式，订阅 im.message.receive_v1；长连接模式不需要回调地址。",
  "5. 「权限管理」开通 im:message、im:message:send_as_bot（如需读群消息再加 im:chat:readonly）。",
  "6. 在 NovaWay 的「设置 → 办公平台 → 飞书」填入 App ID / App Secret / 接收人 open_id，先点保存，再发消息测试。",
  "7. 发布应用版本并通过审核（企业自建应用通常需要管理员同意）。",
].join(NL)

const TENCENT_GUIDE = [
  "1. 打开腾讯文档开放平台，创建应用并获取访问令牌。",
  "2. 在 NovaWay 的「设置 → 办公平台 → 腾讯文档」粘贴令牌（带不带 Bearer 前缀都可以）。",
  "3. 保存后点击「检查连接」，确认状态变为已配置。",
].join(NL)

function report(status: OfficePlatformStatus | undefined, config: OfficeConnectorConfig | undefined): SetupReport {
  const view = feishuView(config)
  const mode = feishuMode(view)
  const tencent = tencentDocsConfigured(config)
  const problems: string[] = []

  if (mode === "missing") problems.push("飞书：未配置任何凭据（既没有 App ID/Secret，也没有 Webhook）")
  if (mode === "incomplete")
    problems.push("飞书：凭据不完整（App ID 与 App Secret 必须同时填写），这会导致长连接启动失败")
  if (mode === "webhook" && !view.keyword) problems.push("飞书：自定义机器人通常需要关键词，当前未设置")
  if (!tencent) problems.push("腾讯文档：未配置访问令牌")

  const steps: SetupStepView[] = [
    step(
      "feishu",
      mode,
      [
        "appId=" + (view.hasAppId ? "set" : "missing"),
        "appSecret=" + (view.hasAppSecret ? "set" : "missing"),
        "webhook=" + (view.hasWebhook ? "set" : "missing"),
        "receiver=" + (view.hasUserId ? "set" : "missing"),
        view.keyword ? "keyword=" + view.keyword : "",
      ]
        .filter(Boolean)
        .join(", "),
    ),
    step("tencent-docs", tencent ? "configured" : "missing"),
    ...(status
      ? [step("browser", status.diagnostics.browser), step("schedules", "active=" + status.activeScheduleCount)]
      : []),
  ]

  return {
    domain: "office",
    ready: problems.length === 0,
    phase: problems.length === 0 ? "ready" : "attention",
    summary:
      problems.length === 0 ? "办公平台配置完整。" : "发现 " + problems.length + " 个问题：" + problems.join("；"),
    steps,
    facts: {
      "feishu mode": mode,
      "tencent docs": tencent ? "configured" : "missing",
    },
    next:
      problems.length === 0
        ? undefined
        : mode === "incomplete"
          ? "让用户在「设置 → 办公平台 → 飞书」补齐 App Secret 后保存，再执行 action=verify。"
          : "参照 action=guide 的步骤让用户补齐配置；凭据必须由用户在界面填写，不要索取。",
  }
}

export const OfficeSetupTool = Tool.define(
  "office_setup",
  Effect.gen(function* () {
    /**
     * OfficePlatform 不能在 layer 构建期取：`registry ← session/prompt ←
     * office/platform` 是模块环，静态导入会在求值期 TDZ。工具执行时所在的
     * 实例上下文里一定提供了该服务，所以这里按需从上下文取。
     */
    const platform = (): Effect.Effect<any> =>
      Effect.gen(function* () {
        const mod = yield* Effect.promise(() => import("@/office/platform"))
        const option = yield* Effect.serviceOption(mod.OfficePlatform.Service)
        if (option._tag === "None") throw new Error("当前上下文没有办公平台服务（OfficePlatform）")
        return option.value
      }) as unknown as Effect.Effect<any>

    return {
      description: [
        "Diagnose office connector setup (Feishu / Tencent Docs) used by automation and office skills.",
        "Use action=status when messages do not arrive, the settings page shows missing, or the automation cannot publish.",
        "It reports, without ever showing secrets: whether App ID / App Secret / webhook / receiver are filled, which Feishu mode is in use, and whether Tencent Docs has a token.",
        "Use action=verify to validate the Feishu app credentials against the open platform (no message is sent).",
        "Use action=guide to get the ordered setup checklist for a platform, then explain the specific step the user is missing.",
        "Never ask the user to paste an App Secret or token into the chat; point them to Settings -> Office platform instead.",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<OfficeMetadata>> =>
        Effect.gen(function* () {
          const service = yield* platform()
          const config = yield* service.getConnectorConfig()
          const status = yield* service.status().pipe(Effect.catch(() => Effect.succeed(undefined)))
          const target = params.platform ?? "feishu"

          if ((params.action ?? "status") === "status") {
            const base = report(status, config)
            const view = feishuView(config)
            return {
              title: "Office platform status",
              metadata: {
                feishu:
                  feishuMode(view) === "app" || feishuMode(view) === "webhook"
                    ? "ok"
                    : feishuMode(view) === "missing"
                      ? "missing"
                      : "partial",
                tencentDocs: tencentDocsConfigured(config) ? "ok" : "missing",
              },
              output: formatSetupReport(base),
            }
          }

          if (params.action === "guide") {
            const text = target === "feishu" ? FEISHU_GUIDE : TENCENT_GUIDE
            return {
              title: "Office setup guide",
              metadata: {
                feishu: tencentDocsConfigured(config) ? "ok" : "missing",
                tencentDocs: tencentDocsConfigured(config) ? "ok" : "missing",
              },
              output: [
                target === "feishu" ? "飞书接入步骤：" : "腾讯文档接入步骤：",
                text,
                "说明：凭据由用户在设置页填写，Agent 只负责诊断与解释。",
              ].join(NL),
            }
          }

          // verify：只校验飞书应用凭据，不发消息。
          const view = feishuView(config)
          if (target !== "feishu") {
            const ok = tencentDocsConfigured(config)
            if (!ok) {
              throw new Error(
                setupFailure({
                  domain: "office",
                  ready: false,
                  phase: "missing",
                  summary: "腾讯文档未配置访问令牌。",
                  next: "让用户在设置 → 办公平台 → 腾讯文档粘贴令牌后保存。",
                }),
              )
            }
            return {
              title: "Tencent Docs configured",
              metadata: { feishu: "partial", tencentDocs: "ok" },
              output: "腾讯文档令牌已配置（不校验有效性，实际发布时才会暴露权限问题）。",
            }
          }

          if (!view.hasAppId || !view.hasAppSecret) {
            throw new Error(
              setupFailure({
                ...report(status, config),
                phase: "incomplete",
                summary: "飞书应用凭据不完整，无法校验。",
                next: "让用户在设置 → 办公平台 → 飞书同时填写 App ID 与 App Secret；不要把凭据贴到对话里。",
              }),
            )
          }

          yield* ctx.ask({
            permission: "office_setup",
            patterns: ["verify:feishu"],
            always: ["*"],
            metadata: { action: "verify", platform: "feishu" },
          })

          const appId = config.feishuAppId?.trim() || process.env.FEISHU_APP_ID?.trim() || ""
          const appSecret = config.feishuAppSecret?.trim() || process.env.FEISHU_APP_SECRET?.trim() || ""
          const result = yield* Effect.promise(() => verifyFeishuApp(appId, appSecret))
          const explanation = explainFeishuCode(result.code)

          if (!result.ok) {
            throw new Error(
              setupFailure({
                ...report(status, config),
                phase: "verify-failed",
                summary: "飞书凭据校验失败。",
                error: "code=" + result.code + " " + result.message + (explanation ? "（" + explanation + "）" : ""),
                next:
                  explanation === "应用未开通机器人能力"
                    ? "让用户在飞书开放平台「添加应用能力」里开启机器人，然后重新发布版本。"
                    : "让用户核对 App ID / App Secret（注意别把另一个应用的 Secret 填进来），保存后再验证。",
              }),
            )
          }

          return {
            title: "Feishu credentials valid",
            metadata: { feishu: "ok", tencentDocs: tencentDocsConfigured(config) ? "ok" : "missing" },
            output: [
              "飞书应用凭据有效（已获取 tenant_access_token）。",
              "注意：这只证明凭据正确，事件订阅与权限仍需在开放平台确认：",
              "1. 「事件与回调」是否选择了长连接并订阅 im.message.receive_v1；",
              "2. 「权限管理」是否开通 im:message / im:message:send_as_bot；",
              "3. 应用版本是否已发布并通过审核。",
            ].join(NL),
          }
        }) as Effect.Effect<Tool.ExecuteResult<OfficeMetadata>>,
    }
  }),
)
