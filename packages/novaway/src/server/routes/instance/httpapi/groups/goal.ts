import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { described } from "./metadata"

const root = "/session/:sessionId/goals"

export const GoalApi = HttpApiGroup.make("goal")
  .add(
    HttpApiEndpoint.get("listGoals", root, {
      success: Schema.Array(Schema.Any),
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("createGoal", root, {
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
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateGoal", "/goals/:goalId", {
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
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("getGoalProgress", "/goals/:goalId/progress", {
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
