import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { described } from "./metadata"

const root = "/session/:sessionId/goals"

export const GoalApi = HttpApiGroup.make("goal")
  .add(
    HttpApiEndpoint.get("listGoals", root)
      .annotate(described, { summary: "获取会话目标列表" }),
  )
  .add(
    HttpApiEndpoint.post("createGoal", root)
      .annotate(described, { summary: "创建目标" })
      .payload(
        Schema.Struct({
          title: Schema.String,
          description: Schema.optional(Schema.String),
          parentId: Schema.optional(Schema.String),
          priority: Schema.optional(Schema.Literals(["high", "medium", "low"])),
          successCriteria: Schema.optional(Schema.Array(Schema.String)),
          deadline: Schema.optional(Schema.String),
          tags: Schema.optional(Schema.Array(Schema.String)),
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("getGoal", "/goals/:goalId")
      .annotate(described, { summary: "获取目标详情" }),
  )
  .add(
    HttpApiEndpoint.patch("updateGoal", "/goals/:goalId")
      .annotate(described, { summary: "更新目标" })
      .payload(
        Schema.Struct({
          title: Schema.optional(Schema.String),
          description: Schema.optional(Schema.String),
          status: Schema.optional(Schema.Literals(["pending", "in_progress", "completed", "cancelled"])),
          priority: Schema.optional(Schema.Literals(["high", "medium", "low"])),
          successCriteria: Schema.optional(Schema.Array(Schema.String)),
          deadline: Schema.optional(Schema.String),
          tags: Schema.optional(Schema.Array(Schema.String)),
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("deleteGoal", "/goals/:goalId")
      .annotate(described, { summary: "删除目标" }),
  )
  .add(
    HttpApiEndpoint.get("getGoalProgress", "/goals/:goalId/progress")
      .annotate(described, { summary: "获取目标进度" }),
  )
