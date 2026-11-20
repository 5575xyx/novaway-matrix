import { ImageGeneratePayload, ImageGenerateResponse } from "../groups/images"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"
import { generateImage, isUnsupportedImageModel } from "@/image/generate"

export const imagesHandlers = HttpApiBuilder.group(InstanceHttpApi, "images", (handlers) =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const auth = yield* Auth.Service
    const http = yield* HttpClient.HttpClient

    const generate = Effect.fn("ImagesHttpApi.generate")(function* (ctx: {
      payload: typeof ImageGeneratePayload.Type
    }) {
      const result = yield* generateImage({
        prompt: ctx.payload.prompt,
        model: ctx.payload.model,
        size: ctx.payload.size,
        n: ctx.payload.n,
        image: ctx.payload.image,
        options: ctx.payload.options,
        // 对话框需要知道真实使用的模型以便透明提示，回退由前端显式发起。
        allowFallback: false,
      }).pipe(
        Effect.provideService(Provider.Service, provider),
        Effect.provideService(Auth.Service, auth),
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.mapError((error) => {
          const message = error instanceof Error ? error.message : String(error)
          if (/No image generation provider configured/i.test(message) || isUnsupportedImageModel(error)) {
            return new HttpApiError.BadRequest({})
          }
          return new HttpApiError.InternalServerError({})
        }),
      )

      return ImageGenerateResponse.make({
        images: result.images.map((item) => ({
          url: item.url,
          base64: item.base64,
          revisedPrompt: item.revisedPrompt,
        })),
      })
    })

    return handlers.handle("generate", generate)
  }),
)