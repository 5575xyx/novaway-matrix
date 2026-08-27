import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"

const root = "/session/:sessionId/orchestrator/plans"

const TaskInput = Schema.Struct({
  name: Schema.String,
  type: Schema.Literals(["agent", "tool", "skill"]),
  config: Schema.Record(Schema.String, Schema.Unknown),
  dependencies: Schema.Array(Schema.String),
})

export const OrchestratorApi = HttpApiGroup.make("orchestrator")
  .add(
    HttpApiEndpoint.get("listOrchestratorPlans", root, {
      success: Schema.Array(Schema.Any),
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("createOrchestratorPlan", root, {
      payload: Schema.Struct({
        name: Schema.String,
        tasks: Schema.Array(TaskInput),
      }),
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("getOrchestratorPlan", "/orchestrator/plans/:planId", {
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("executeOrchestratorPlan", "/orchestrator/plans/:planId/execute", {
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteOrchestratorPlan", "/orchestrator/plans/:planId", {
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
