import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi"

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
        deadline: Schema.optional(Schema.String),
        tags: Schema.optional(Schema.Array(Schema.String)),
      }),
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("getGoal", "/goals/:goalId", {
      params: { goalId: Schema.String },
      success: Schema.Any,
      error: HttpApiError.NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateGoal", "/goals/:goalId", {
      params: { goalId: Schema.String },
      payload: Schema.Struct({
        title: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
        status: Schema.optional(Schema.Literals(["pending", "in_progress", "completed", "cancelled"])),
        priority: Schema.optional(Schema.Literals(["high", "medium", "low"])),
        successCriteria: Schema.optional(Schema.Array(Schema.String)),
        deadline: Schema.optional(Schema.String),
        tags: Schema.optional(Schema.Array(Schema.String)),
      }),
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteGoal", "/goals/:goalId", {
      params: { goalId: Schema.String },
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("getGoalProgress", "/goals/:goalId/progress", {
      params: { goalId: Schema.String },
      success: Schema.Any,
      error: Schema.Never,
    }),
  )

