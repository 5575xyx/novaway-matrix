import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi"

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
      params: { sessionId: Schema.String },
      success: Schema.Array(Schema.Any),
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("createOrchestratorPlan", root, {
      params: { sessionId: Schema.String },
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
      params: { planId: Schema.String },
      success: Schema.Any,
      error: HttpApiError.NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("executeOrchestratorPlan", "/orchestrator/plans/:planId/execute", {
      params: { planId: Schema.String },
      success: Schema.Any,
      error: HttpApiError.NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteOrchestratorPlan", "/orchestrator/plans/:planId", {
      params: { planId: Schema.String },
      success: Schema.Any,
      error: Schema.Never,
    }),
  )

