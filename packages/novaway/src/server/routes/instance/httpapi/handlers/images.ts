import { ImageGeneratePayload, ImageGenerateResponse } from "../groups/images"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const imagesHandlers = HttpApiBuilder.group(InstanceHttpApi, "images", (handlers) =>
  Effect.gen(function* () {
    const generate = Effect.fn("ImagesHttpApi.generate")(function* (ctx: {
      payload: typeof ImageGeneratePayload.Type
    }) {
      const apiKey = process.env.AGNES_API_KEY
      if (!apiKey) {
        return yield* Effect.fail(new HttpApiError.BadRequest({}))
      }

      const model = ctx.payload.model || "agnes-image-2.1-flash"

      // Call Agnes Image API
      const url = "https://api.agnes-ai.cn/v1/images/generations"
      const body = {
        model,
        prompt: ctx.payload.prompt,
        size: ctx.payload.size || "1024x768",
        extra_body: {
          image: ctx.payload.image,
          response_format: "url",
          ...ctx.payload.options,
        },
      }

      const response = yield* Effect.tryPromise(() =>
        fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }).then((r) => r.json()),
      ).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))

      const data = response as { data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> }
      const images = (data.data ?? []).map((item) => ({
        url: item.url ?? undefined,
        base64: item.b64_json ?? undefined,
        revisedPrompt: item.revised_prompt ?? undefined,
      }))

      return ImageGenerateResponse.make({ images })
    })

    return handlers.handle("generate", generate)
  }),
)
