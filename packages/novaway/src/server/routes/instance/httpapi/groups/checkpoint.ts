import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { described } from "./metadata"

const root = "/session/:sessionId/checkpoints"

export const CheckpointApi = HttpApiGroup.make("checkpoint")
  .add(
    HttpApiEndpoint.get("listCheckpoints", root, {
      success: Schema.Array(Schema.Any),
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("createCheckpoint", root, {
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
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("restoreCheckpoint", "/checkpoints/:checkpointId/restore", {
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteCheckpoint", "/checkpoints/:checkpointId", {
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
