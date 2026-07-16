import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { ChatPayload, ChatResponse } from "../groups/chat"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Auth } from "@/auth"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { streamText, wrapLanguageModel, type LanguageModelMiddleware } from "ai"

export const chatHandlers = HttpApiBuilder.group(InstanceHttpApi, "chat", (handlers) =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const config = yield* Config.Service
    const auth = yield* Auth.Service

    const send = Effect.fn("ChatHttpApi.send")(function* (ctx: { payload: typeof ChatPayload.Type }) {
      const ctxState = yield* InstanceState.context

      const model = yield* provider
        .getModel(ctx.payload.model.providerID, ctx.payload.model.modelID)
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      const language = yield* provider
        .getLanguage(model)
        .pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))

      yield* auth.get(model.providerID).pipe(Effect.orDie)

      const cfg = yield* config.get()

      const messages: Array<{ role: "user" | "system"; content: string }> = [
        ...(ctx.payload.system ? [{ role: "system" as const, content: ctx.payload.system }] : []),
        { role: "user" as const, content: ctx.payload.message },
      ]

      const baseOptions = ProviderTransform.options({
        model,
        providerOptions: (yield* provider.getProvider(model.providerID)).options,
        sessionID: "",
      })

      const params = {
        temperature: ctx.payload.temperature ?? ProviderTransform.temperature(model),
        maxOutputTokens: ctx.payload.maxOutputTokens ?? ProviderTransform.maxOutputTokens(model),
        topP: ctx.payload.topP ?? ProviderTransform.topP(model),
      }

      const opencodeProjectID = model.providerID.startsWith("opencode") ? ctxState.project.id : undefined

      const middleware: LanguageModelMiddleware[] = []

      const stream = streamText({
        messages,
        model: wrapLanguageModel({
          model: language,
          middleware,
        }),
        temperature: params.temperature,
        topP: params.topP,
        maxOutputTokens: params.maxOutputTokens,
        providerOptions: ProviderTransform.providerOptions(model, baseOptions),
        headers: {
          ...(model.providerID.startsWith("opencode")
            ? {
                "x-opencode-project": opencodeProjectID,
                "x-opencode-request": "chat",
                "User-Agent": `opencode/${InstallationVersion}`,
              }
            : {
                "User-Agent": `opencode/${InstallationVersion}`,
              }),
        },
        maxRetries: 2,
        abortSignal: undefined,
        tools: {},
        activeTools: [],
        experimental_telemetry: {
          isEnabled: cfg.experimental?.openTelemetry,
          functionId: "chat",
          metadata: {
            modelID: model.id,
            providerID: model.providerID,
          },
        },
        onError(err) {
          console.error("chat stream error", err)
        },
      })

      const text = yield* Effect.tryPromise(() => stream.text).pipe(
        Effect.mapError(() => new HttpApiError.InternalServerError({})),
      )

      return ChatResponse.make({ text })
    })

    return handlers.handle("send", send)
  }),
)
