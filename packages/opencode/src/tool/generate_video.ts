import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Tool } from "./tool"

interface Metadata {
  prompt: string
  model: string
  imageUrl: string
}

const Parameters = Schema.Struct({
  prompt: Schema.String,
  model: Schema.optional(Schema.String),
  image: Schema.Array(Schema.String),
})

const VideoGenerateRequest = Schema.Struct({
  model: Schema.String,
  prompt: Schema.String,
  height: Schema.Number,
  width: Schema.Number,
  num_frames: Schema.Number,
  frame_rate: Schema.Number,
  image: Schema.Array(Schema.String),
})

const VideoGenerateResponse = Schema.Struct({
  id: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
})

export const GenerateVideoTool = Tool.define(
  "generate_video",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(http)

    return {
      description:
        "Generate videos from text prompts and/or images using AI video generation models.",
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const model = args.model || "agnes-video-v2.0"
          const apiKey = process.env.AGNES_API_KEY

          if (!apiKey) {
            throw new Error("AGNES_API_KEY environment variable is not set.")
          }

          yield* ctx.metadata({
            title: `Video generation: ${args.prompt.slice(0, 50)}`,
            metadata: { prompt: args.prompt, model },
          })

          // Step 1: Create video generation task
          const createUrl = "https://apihub.agnes-ai.com/v1/videos"

          const request = yield* HttpClientRequest.post(createUrl).pipe(
            HttpClientRequest.bearerToken(apiKey),
            HttpClientRequest.bodyJson({
              model,
              prompt: args.prompt,
              height: 768,
              width: 1152,
              num_frames: 121,
              frame_rate: 24,
              image: args.image,
            }),
          )

          const response = yield* httpOk.execute(request)
          const result = yield* HttpClientResponse.schemaBodyJson(VideoGenerateResponse)(response)

          if (!result.id) {
            throw new Error("Failed to create video generation task")
          }

          return {
            title: `Video task created: ${result.id}`,
            output: `Video generation task ${result.id} created. Use the API to check status.`,
            metadata: {
              prompt: args.prompt,
              model,
              imageUrl: `Task ID: ${result.id}`,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
