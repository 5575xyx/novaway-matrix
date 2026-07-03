import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Tool } from "./tool"

interface Metadata {
  prompt: string
  model: string
  size?: string
  imageUrl?: string
}

const Parameters = Schema.Struct({
  prompt: Schema.String,
  model: Schema.optional(Schema.String),
  size: Schema.optional(Schema.String),
  image: Schema.optional(Schema.Array(Schema.String)),
})

const ImageGenerateRequest = Schema.Struct({
  model: Schema.String,
  prompt: Schema.String,
  size: Schema.optional(Schema.String),
  image: Schema.optional(Schema.Array(Schema.String)),
})

const ImageGenerateResponse = Schema.Struct({
  data: Schema.optional(
    Schema.Array(
      Schema.Struct({
        url: Schema.optional(Schema.String),
        b64_json: Schema.optional(Schema.String),
        revised_prompt: Schema.optional(Schema.String),
      }),
    ),
  ),
})

export const GenerateImageTool = Tool.define(
  "generate_image",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(http)

    return {
      description:
        "Generate images from text prompts using AI image generation models. Supports text-to-image and image-to-image workflows.",
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const model = args.model || "agnes-image-2.1-flash"
          const apiKey = process.env.AGNES_API_KEY
          if (!apiKey) {
            throw new Error("AGNES_API_KEY environment variable is not set. Please configure your API key.")
          }

          yield* ctx.metadata({
            title: `Image generation: ${args.prompt.slice(0, 50)}`,
            metadata: { prompt: args.prompt, model, size: args.size },
          })

          // Call Agnes Image API
          const url = "https://apihub.agnes-ai.com/v1/images/generations"

          const request = yield* HttpClientRequest.post(url).pipe(
            HttpClientRequest.bearerToken(apiKey),
            HttpClientRequest.bodyJson({
              model,
              prompt: args.prompt,
              size: args.size || "1024x768",
              image: args.image,
            }),
          )

          const response = yield* httpOk.execute(request)
          const result = yield* HttpClientResponse.schemaBodyJson(ImageGenerateResponse)(response)

          const images = (result.data ?? []).map((item) => ({
            url: item.url ?? undefined,
            base64: item.b64_json ?? undefined,
            revisedPrompt: item.revised_prompt ?? undefined,
          }))

          if (images.length === 0) {
            throw new Error("No images were generated")
          }

          const imageUrl = images[0]?.url

          return {
            title: `Generated image: ${args.prompt.slice(0, 50)}`,
            output: imageUrl ?? "Image generated successfully (base64)",
            metadata: {
              prompt: args.prompt,
              model,
              size: args.size,
              imageUrl: imageUrl ?? "",
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
