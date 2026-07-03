import { ProviderID, ModelID } from "@/provider/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/images"

export const ImageGeneratePayload = Schema.Struct({
  prompt: Schema.String,
  model: Schema.optional(Schema.String),
  size: Schema.optional(Schema.String),
  n: Schema.optional(Schema.Number),
  image: Schema.optional(Schema.Array(Schema.String)),
  options: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "ImageGeneratePayload" })

export const ImageGenerateResponse = Schema.Struct({
  images: Schema.Array(
    Schema.Struct({
      url: Schema.optional(Schema.String),
      base64: Schema.optional(Schema.String),
      revisedPrompt: Schema.optional(Schema.String),
    }),
  ),
}).annotate({ identifier: "ImageGenerateResponse" })

export const ImagesApi = HttpApi.make("images")
  .add(
    HttpApiGroup.make("images")
      .add(
        HttpApiEndpoint.post("generate", `${root}/generate`, {
          query: WorkspaceRoutingQuery,
          payload: ImageGeneratePayload,
          success: described(ImageGenerateResponse, "Generated images"),
          error: [HttpApiError.BadRequest, HttpApiError.InternalServerError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "images.generate",
            summary: "Generate images from text prompt",
            description:
              "Generate images using AI image generation models. Supports text-to-image and image-to-image workflows.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "Images",
          description: "Image generation API.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Images",
      version: "0.0.1",
      description: "Image generation API.",
    }),
  )
