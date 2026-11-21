import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiError } from "effect/unstable/httpapi"
import { ApiNotFoundError } from "../errors"
import { ExecutionConfigSchema } from "@/session/goal"

const root = "/session/:sessionId/goals"

export const GoalApi = HttpApiGroup.make("goal")
  .add(
    HttpApiEndpoint.get("listGoals", root, {
      params: { sessionId: Schema.String },
      success: Schema.Array(Schema.Any),
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("createGoal", root, {
      params: { sessionId: Schema.String },
      payload: Schema.Struct({
        title: Schema.String,
        description: Schema.optional(Schema.String),
        parentId: Schema.optional(Schema.String),
        priority: Schema.optional(Schema.Literals(["high", "medium", "low"])),
        successCriteria: Schema.optional(Schema.Array(Schema.String)),
        status: Schema.optional(Schema.Literals(["pending", "in_progress"])),
        deadline: Schema.optional(Schema.String),
        tags: Schema.optional(Schema.Array(Schema.String)),
        executionConfig: Schema.optional(ExecutionConfigSchema),
      }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("createAndLaunchGoal", `${root}/launch`, {
      params: { sessionId: Schema.String },
      payload: Schema.Struct({
        idempotencyKey: Schema.String,
        title: Schema.String,
        description: Schema.optional(Schema.String),
        priority: Schema.optional(Schema.Literals(["high", "medium", "low"])),
        successCriteria: Schema.optional(Schema.Array(Schema.String)),
        deadline: Schema.optional(Schema.String),
        tags: Schema.optional(Schema.Array(Schema.String)),
        executionConfig: Schema.optional(ExecutionConfigSchema),
        text: Schema.optional(Schema.String),
        planningMode: Schema.optional(Schema.Literals(["deterministic", "model"])),
        budget: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
      }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("launchGoal", `${root}/:goalId/launch`, {
      params: { sessionId: Schema.String, goalId: Schema.String },
      payload: Schema.Struct({
        text: Schema.optional(Schema.String),
        planningMode: Schema.optional(Schema.Literals(["deterministic", "model"])),
        budget: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
      }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.get("getGoal", `${root}/:goalId`, {
      params: { sessionId: Schema.String, goalId: Schema.String },
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateGoal", `${root}/:goalId`, {
      params: { sessionId: Schema.String, goalId: Schema.String },
      payload: Schema.Struct({
        title: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
        status: Schema.optional(Schema.Literals(["pending", "in_progress", "paused", "cancelled"])),
        priority: Schema.optional(Schema.Literals(["high", "medium", "low"])),
        successCriteria: Schema.optional(Schema.Array(Schema.String)),
        deadline: Schema.optional(Schema.String),
        tags: Schema.optional(Schema.Array(Schema.String)),
        executionConfig: Schema.optional(ExecutionConfigSchema),
      }),
      success: Schema.Any,
      error: [HttpApiError.BadRequest, ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteGoal", `${root}/:goalId`, {
      params: { sessionId: Schema.String, goalId: Schema.String },
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.get("getGoalProgress", `${root}/:goalId/progress`, {
      params: { sessionId: Schema.String, goalId: Schema.String },
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
