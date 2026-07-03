import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/videos"

export const VideoGeneratePayload = Schema.Struct({
  prompt: Schema.String,
  model: Schema.optional(Schema.String),
  height: Schema.optional(Schema.Number),
  width: Schema.optional(Schema.Number),
  numFrames: Schema.optional(Schema.Number),
  frameRate: Schema.optional(Schema.Number),
  image: Schema.optional(Schema.String),
  options: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "VideoGeneratePayload" })

export const VideoGenerateResponse = Schema.Struct({
  taskId: Schema.String,
  status: Schema.String,
}).annotate({ identifier: "VideoGenerateResponse" })

export const VideoStatusResponse = Schema.Struct({
  taskId: Schema.String,
  status: Schema.String,
  progress: Schema.optional(Schema.Number),
  videoUrl: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "VideoStatusResponse" })

export const VideosApi = HttpApi.make("videos")
  .add(
    HttpApiGroup.make("videos")
      .add(
        HttpApiEndpoint.post("generate", `${root}/generate`, {
          query: WorkspaceRoutingQuery,
          payload: VideoGeneratePayload,
          success: described(VideoGenerateResponse, "Video generation task created"),
          error: [HttpApiError.BadRequest, HttpApiError.InternalServerError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "videos.generate",
            summary: "Create video generation task",
            description:
              "Create an asynchronous video generation task. Use the task ID to poll for completion.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "Videos",
          description: "Video generation API.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Videos",
      version: "0.0.1",
      description: "Video generation API.",
    }),
  )
