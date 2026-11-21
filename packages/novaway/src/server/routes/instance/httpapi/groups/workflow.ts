import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"

const root = "/session/:sessionId/workflows"

const WorkflowMetricsSchema = Schema.Struct({
  sessionID: Schema.String,
  route: Schema.optional(Schema.String),
  phase: Schema.optional(Schema.String),
  routeDistribution: Schema.Record(Schema.String, Schema.Number),
  phaseDistribution: Schema.Record(Schema.String, Schema.Number),
  escalationCount: Schema.Number,
  questionCalls: Schema.Number,
  questionBudget: Schema.Number,
  questionMisuseCount: Schema.Number,
  blockedToolCount: Schema.Number,
  verification: Schema.Struct({ status: Schema.optional(Schema.String), passed: Schema.Number, failed: Schema.Number, unverified: Schema.Number }),
  delivery: Schema.Struct({ status: Schema.optional(Schema.String), completed: Schema.Number, blocked: Schema.Number }),
  phaseTransitions: Schema.Number,
  firstEventAt: Schema.optional(Schema.String),
  lastEventAt: Schema.optional(Schema.String),
})

export const WorkflowApi = HttpApiGroup.make("workflow")
  .add(
    HttpApiEndpoint.post("githubWorkflowWebhook", "/session/:sessionId/workflow-webhooks/github", {
      params: { sessionId: Schema.String },
      payload: Schema.Struct({ event: Schema.String, deliveryID: Schema.optional(Schema.String), payload: Schema.Record(Schema.String, Schema.Unknown) }),
      success: Schema.Struct({ accepted: Schema.Boolean, duplicate: Schema.Boolean, memoryID: Schema.optional(Schema.String) }),
      error: HttpApiError.BadRequest,
    }),
  )
  .add(
    HttpApiEndpoint.post("recordWorkflowEvidence", "/session/:sessionId/workflow-evidence", {
      params: { sessionId: Schema.String },
      payload: Schema.Struct({ memoryID: Schema.optional(Schema.String), source: Schema.String, evidence: Schema.Record(Schema.String, Schema.Unknown) }),
      success: Schema.Any, error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("recordWorkflowIntegration", "/session/:sessionId/workflow-integrations", {
      params: { sessionId: Schema.String },
      payload: Schema.Struct({
        kind: Schema.Literals(["commit", "pull_request", "check"]),
        payload: Schema.Record(Schema.String, Schema.Unknown),
      }),
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateWorkflowState", "/session/:sessionId/workflow-state", {
      params: { sessionId: Schema.String },
      payload: Schema.Struct({ expectedRevision: Schema.Number, patch: Schema.Struct({ route: Schema.optional(Schema.String), phase: Schema.optional(Schema.String), verificationStatus: Schema.optional(Schema.String), deliveryStatus: Schema.optional(Schema.String) }) }),
      success: Schema.Any, error: HttpApiError.Conflict,
    }),
  )
  .add(
    HttpApiEndpoint.get("getWorkflowState", "/session/:sessionId/workflow-state", {
      params: { sessionId: Schema.String },
      success: Schema.NullOr(Schema.Any),
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("listWorkflowEvents", "/session/:sessionId/workflow-events", {
      params: { sessionId: Schema.String },
      success: Schema.Array(Schema.Any),
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("getWorkflowMetrics", "/session/:sessionId/workflow-metrics", {
      params: { sessionId: Schema.String },
      success: WorkflowMetricsSchema,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("listWorkflows", root, {
      params: { sessionId: Schema.String },
      success: Schema.Array(Schema.Any),
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("createWorkflow", root, {
      params: { sessionId: Schema.String },
      payload: Schema.Struct({
        name: Schema.String,
        description: Schema.optional(Schema.String),
        steps: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            name: Schema.String,
            type: Schema.Literals(["agent", "tool", "skill", "condition", "parallel"]),
            config: Schema.Record(Schema.String, Schema.Unknown),
            next: Schema.optional(Schema.String),
            nextTrue: Schema.optional(Schema.String),
            nextFalse: Schema.optional(Schema.String),
            steps: Schema.optional(Schema.Array(Schema.String)),
          }),
        ),
      }),
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("getWorkflow", "/workflows/:workflowId", {
      params: { workflowId: Schema.String },
      success: Schema.Any,
      error: HttpApiError.NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateWorkflow", "/workflows/:workflowId", {
      params: { workflowId: Schema.String },
      payload: Schema.Struct({
        name: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
        steps: Schema.optional(Schema.Array(Schema.Unknown)),
        status: Schema.optional(Schema.Literals(["draft", "running", "paused", "completed", "failed"])),
      }),
      success: Schema.Any,
      error: HttpApiError.NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteWorkflow", "/workflows/:workflowId", {
      params: { workflowId: Schema.String },
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.post("startWorkflow", "/workflows/:workflowId/start", {
      params: { workflowId: Schema.String },
      success: Schema.Any,
      error: HttpApiError.NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.get("listWorkflowRuns", "/workflows/:workflowId/runs", {
      params: { workflowId: Schema.String },
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
      params: { sessionId: Schema.String },
      payload: Schema.Struct({
        template: Schema.String,
        name: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
      }),
      success: Schema.Any,
      error: HttpApiError.NotFound,
    }),
  )
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)
