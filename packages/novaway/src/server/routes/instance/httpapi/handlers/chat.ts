import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { ChatPayload, ChatResponse } from "../groups/chat"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Auth } from "@/auth"
import { InstallationVersion } from "@novaway/core/installation/version"
import { generateText, wrapLanguageModel, type LanguageModelMiddleware } from "ai"
import * as Log from "@novaway/core/util/log"

const log = Log.create({ service: "chat-httpapi" })

function errorMessage(cause: unknown) {
  if (cause instanceof Error && cause.message) return cause.message
  if (typeof cause === "string" && cause) return cause
  if (cause && typeof cause === "object") {
    const obj = cause as {
      message?: unknown
      data?: { message?: unknown }
      error?: { message?: unknown }
      cause?: unknown
    }
    if (typeof obj.message === "string" && obj.message) return obj.message
    if (typeof obj.data?.message === "string" && obj.data.message) return obj.data.message
    if (typeof obj.error?.message === "string" && obj.error.message) return obj.error.message
    if (obj.cause) return errorMessage(obj.cause)
  }
  return "Chat request failed"
}

export const chatHandlers = HttpApiBuilder.group(InstanceHttpApi, "chat", (handlers) =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const config = yield* Config.Service
    const auth = yield* Auth.Service

    const send = Effect.fn("ChatHttpApi.send")(function* (ctx: { payload: typeof ChatPayload.Type }) {
      const ctxState = yield* InstanceState.context
      const providerID = ctx.payload.model.providerID
      const modelID = ctx.payload.model.modelID

      const model = yield* provider.getModel(providerID, modelID).pipe(
        Effect.mapError((err) => {
          log.error("chat model not found", { providerID, modelID, err })
          return new HttpApiError.BadRequest({})
        }),
      )

      const item = yield* provider.getProvider(providerID)
      if (!item) {
        log.error("chat provider missing", { providerID })
        return yield* new HttpApiError.BadRequest({})
      }

      const language = yield* provider.getLanguage(model).pipe(
        Effect.mapError((err) => {
          log.error("chat language model failed", { providerID, modelID, err })
          return new HttpApiError.InternalServerError({})
        }),
      )

      // 与会话路径对齐：读取凭证；失败仅记录，避免 orDie 直接 500
      yield* auth.get(providerID).pipe(Effect.catch(() => Effect.succeed(undefined)))

      const cfg = yield* config.get()
      const baseOptions = ProviderTransform.options({
        model,
        providerOptions: item.options,
        sessionID: "chat-optimize",
      })

      const params = {
        temperature: ctx.payload.temperature ?? ProviderTransform.temperature(model),
        maxOutputTokens: ctx.payload.maxOutputTokens ?? ProviderTransform.maxOutputTokens(model),
        topP: ctx.payload.topP ?? ProviderTransform.topP(model),
      }

      const NovaWayProjectID = providerID.startsWith("novaway") ? ctxState.project.id : undefined
      const middleware: LanguageModelMiddleware[] = []

      // 使用 generateText（非流式）更适合提示词优化这种一次性请求
      const result = yield* Effect.tryPromise({
        try: () =>
          generateText({
            system: ctx.payload.system,
            messages: [{ role: "user" as const, content: ctx.payload.message }],
            model: wrapLanguageModel({
              model: language,
              middleware,
            }),
            temperature: params.temperature,
            topP: params.topP,
            maxOutputTokens: params.maxOutputTokens,
            providerOptions: ProviderTransform.providerOptions(model, baseOptions),
            headers: {
              ...(providerID.startsWith("novaway")
                ? {
                    "x-NovaWay-project": NovaWayProjectID,
                    "x-NovaWay-request": "chat",
                    "User-Agent": `NovaWay/${InstallationVersion}`,
                  }
                : {
                    "User-Agent": `NovaWay/${InstallationVersion}`,
                  }),
              ...model.headers,
            },
            maxRetries: 2,
          }),
        catch: (cause) => cause,
      }).pipe(
        Effect.mapError((cause) => {
          const message = errorMessage(cause)
          log.error("chat send failed", { providerID, modelID, message, cause })
          const lower = message.toLowerCase()
          if (
            lower.includes("api key") ||
            lower.includes("unauthorized") ||
            lower.includes("invalid") ||
            lower.includes("not found") ||
            lower.includes("quota") ||
            lower.includes("rate limit") ||
            lower.includes("model") ||
            lower.includes("credit") ||
            lower.includes("permission")
          ) {
            return new HttpApiError.BadRequest({})
          }
          return new HttpApiError.InternalServerError({})
        }),
      )

      const text = (result.text ?? "").trim()
      if (!text) {
        log.error("chat empty response", { providerID, modelID })
        return yield* new HttpApiError.InternalServerError({})
      }

      return ChatResponse.make({ text })
    })

    return handlers.handle("send", send)
  }),
)
