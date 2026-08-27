import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { described } from "./metadata"

const root = "/session/:sessionId/workflows"

export const WorkflowApi = HttpApiGroup.make("workflow")
  .add(
    HttpApiEndpoint.get("listWorkflows", root, {
      success: Schema.Array(Schema.Any),
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("createWorkflow", root, {
      payload: Schema.Struct({
        name: Schema.String,
        description: Schema.optional(Schema.String),
        steps: Schema.Array(Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          type: Schema.Literals(["agent", "tool", "skill", "condition", "parallel"]),
          config: Schema.Record(Schema.String, Schema.Unknown),
          next: Schema.optional(Schema.String),
          nextTrue: Schema.optional(Schema.String),
          nextFalse: Schema.optional(Schema.String),
          steps: Schema.optional(Schema.Array(Schema.String)),
        })),
      }),
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("getWorkflow", "/workflows/:workflowId", {
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateWorkflow", "/workflows/:workflowId", {
      payload: Schema.Struct({
        name: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
        steps: Schema.optional(Schema.Array(Schema.Unknown)),
        status: Schema.optional(Schema.Literals(["draft", "running", "paused", "completed", "failed"])),
      }),
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteWorkflow", "/workflows/:workflowId", {
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("startWorkflow", "/workflows/:workflowId/start", {
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("listWorkflowRuns", "/workflows/:workflowId/runs", {
      success: Schema.Array(Schema.Any),
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("listWorkflowTemplates", "/workflow-templates", {
      success: Schema.Array(Schema.Any),
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("createWorkflowFromTemplate", "/session/:sessionId/workflows/from-template", {
      payload: Schema.Struct({
        template: Schema.String,
        name: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
      }),
      success: Schema.Any,
      error: Schema.Never,
    }),
  )