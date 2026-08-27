import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi"

const root = "/session/:sessionId/checkpoints"

export const CheckpointApi = HttpApiGroup.make("checkpoint")
  .add(
    HttpApiEndpoint.get("listCheckpoints", root, {
      params: { sessionId: Schema.String },
      success: Schema.Array(Schema.Any),
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("createCheckpoint", root, {
      params: { sessionId: Schema.String },
      payload: Schema.Struct({
        name: Schema.String,
        reason: Schema.optional(Schema.String),
        tags: Schema.optional(Schema.Array(Schema.String)),
      }),
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("getCheckpoint", "/checkpoints/:checkpointId", {
      params: { checkpointId: Schema.String },
      success: Schema.Any,
      error: HttpApiError.NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("restoreCheckpoint", "/checkpoints/:checkpointId/restore", {
      params: { checkpointId: Schema.String },
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteCheckpoint", "/checkpoints/:checkpointId", {
      params: { checkpointId: Schema.String },
      success: Schema.Any,
      error: Schema.Never,
    }),
  )

