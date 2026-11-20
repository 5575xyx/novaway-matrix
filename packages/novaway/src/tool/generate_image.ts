import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Tool } from "./tool"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"
import { generateImage } from "@/image/generate"

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
  ratio: Schema.optional(Schema.String),
  image: Schema.optional(Schema.Array(Schema.String)),
})

export const GenerateImageTool = Tool.define(
  "generate_image",
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const auth = yield* Auth.Service
    const http = yield* HttpClient.HttpClient
    return {
      description:
        "Generate images from text prompts using AI image generation models. Supports text-to-image and image-to-image workflows.",
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const result = yield* generateImage({
            prompt: args.prompt,
            model: args.model,
            size: args.size,
            ratio: args.ratio,
            image: args.image,
          }).pipe(
            Effect.provideService(Provider.Service, provider),
            Effect.provideService(Auth.Service, auth),
            Effect.provideService(HttpClient.HttpClient, http),
          )

          const firstImage = result.images[0]
          if (!firstImage) {
            return yield* Effect.fail(new Error("No images were generated"))
          }

          const imageUrl = firstImage.url
          const fallbackNote = result.fallbackFrom
            ? ` (requested model ${result.fallbackFrom} is not supported by the gateway; generated with ${result.model})`
            : ""

          return {
            title: `Generated image: ${args.prompt.slice(0, 50)}`,
            output: (imageUrl ?? "Image generated successfully (base64)") + fallbackNote,
            metadata: {
              prompt: args.prompt,
              model: result.model,
              size: args.size,
              imageUrl: imageUrl ?? "",
            } as Metadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)