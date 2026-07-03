import { VideoGeneratePayload, VideoGenerateResponse } from "../groups/videos"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const videosHandlers = HttpApiBuilder.group(InstanceHttpApi, "videos", (handlers) =>
  Effect.gen(function* () {
    const generate = Effect.fn("VideosHttpApi.generate")(function* (ctx: {
      payload: typeof VideoGeneratePayload.Type
    }) {
      const apiKey = process.env.AGNES_API_KEY
      if (!apiKey) {
        return yield* Effect.fail(
          new HttpApiError.BadRequest({}),
        )
      }

      const model = ctx.payload.model || "agnes-video-v2.0"

      // Create video generation task
      const createUrl = "https://apihub.agnes-ai.com/v1/videos"
      const createBody = {
        model,
        prompt: ctx.payload.prompt,
        height: ctx.payload.height || 768,
        width: ctx.payload.width || 1152,
        num_frames: ctx.payload.numFrames || 121,
        frame_rate: ctx.payload.frameRate || 24,
        image: ctx.payload.image,
      }

      const response = yield* Effect.tryPromise(() =>
        fetch(createUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(createBody),
        }).then((r) => r.json()),
      ).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))

      const data = response as { id?: string; status?: string }
      return VideoGenerateResponse.make({
        taskId: data.id ?? "",
        status: data.status ?? "queued",
      })
    })

    return handlers.handle("generate", generate)
  }),
)
