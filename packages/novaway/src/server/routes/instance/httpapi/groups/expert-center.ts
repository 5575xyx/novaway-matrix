import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const TaskVerificationView = Schema.Struct({
  status: Schema.Literals(["pending", "verified", "partial", "failed"]),
  passed: Schema.Number,
  failed: Schema.Number,
  unverified: Schema.Number,
  stale: Schema.Number,
}).annotate({ identifier: "TaskVerificationView" })

const TaskChangeView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
}).annotate({ identifier: "TaskChangeView" })
export const ExpertCenterTaskView = Schema.Struct({
  id: Schema.String,
  goal: Schema.String,
  state: Schema.Literals(["planning", "needs-you", "working", "paused", "completed", "partial", "failed"]),
  phase: Schema.Literals(["understanding", "planning", "working", "reviewing", "delivering"]),
  executor: Schema.Struct({
    mode: Schema.Literals(["auto", "expert", "team"]),
    name: Schema.optional(Schema.String),
    count: Schema.optional(Schema.Number),
  }),
  summary: Schema.optional(Schema.String),
  verification: Schema.optional(TaskVerificationView),
  changes: Schema.optional(Schema.Array(TaskChangeView)),
  nextAction: Schema.optional(Schema.Struct({ kind: Schema.String, label: Schema.String })),
  artifacts: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      path: Schema.optional(Schema.String),
    }),
  ),
  updatedAt: Schema.Number,
}).annotate({ identifier: "ExpertCenterTaskView" })

export const ExpertTeamCardView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  capabilities: Schema.Array(Schema.String),
  scenarios: Schema.Array(Schema.String),
  memberCount: Schema.Number,
  memberPreview: Schema.Array(Schema.Struct({ name: Schema.String, role: Schema.String })),
  autoEligible: Schema.Boolean,
  recommended: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "ExpertTeamCardView" })

export const ExpertCardView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  available: Schema.Boolean,
}).annotate({ identifier: "ExpertCardView" })

export const ExpertCenterOverview = Schema.Struct({
  tasks: Schema.Array(ExpertCenterTaskView),
  teams: Schema.Array(ExpertTeamCardView),
  experts: Schema.Array(ExpertCardView),
}).annotate({ identifier: "ExpertCenterOverview" })

const root = "/expert-center"

export const ExpertCenterTaskCreatePayload = Schema.Struct({
  goal: Schema.String,
  mode: Schema.optional(Schema.Literals(["auto", "team"])),
  teamID: Schema.optional(Schema.String),
  employeeID: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  brief: Schema.optional(
    Schema.Struct({
      scope: Schema.optional(Schema.Array(Schema.String)),
      files: Schema.optional(Schema.Array(Schema.String)),
      constraints: Schema.optional(Schema.Array(Schema.String)),
      context: Schema.optional(Schema.String),
    }),
  ),
}).annotate({ identifier: "ExpertCenterTaskCreatePayload" })

export const ExpertCenterApprovePayload = Schema.Struct({
  planVersion: Schema.Number,
  budget: Schema.Struct({
    tokens: Schema.optional(Schema.Number),
    cost: Schema.optional(Schema.Number),
    wallMs: Schema.optional(Schema.Number),
  }),
}).annotate({ identifier: "ExpertCenterApprovePayload" })

export const ExpertCenterDecisionPayload = Schema.Struct({
  action: Schema.Literals(["approve", "dismiss"]),
  note: Schema.optional(Schema.String),
}).annotate({ identifier: "ExpertCenterDecisionPayload" })

export const ExpertCenterTaskActionResult = Schema.Struct({
  task: ExpertCenterTaskView,
  action: Schema.Literals(["created", "approved", "paused", "resumed", "retried", "decision"]),
}).annotate({ identifier: "ExpertCenterTaskActionResult" })

export const ExpertCenterApi = HttpApi.make("expert-center")
  .add(
    HttpApiGroup.make("expert-center")
      .add(
        HttpApiEndpoint.get("overview", `${root}/overview`, {
          query: WorkspaceRoutingQuery,
          success: described(ExpertCenterOverview, "Expert center overview"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "expert-center.overview",
            summary: "Get expert center overview",
            description: "Return user-facing task, expert team, and expert summaries for a workspace.",
          }),
        ),
        HttpApiEndpoint.get("tasks", `${root}/tasks`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(ExpertCenterTaskView), "Expert center tasks"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "expert-center.tasks",
            summary: "List expert center tasks",
            description: "List task summaries without exposing internal assignments or tool arguments.",
          }),
        ),
        HttpApiEndpoint.get("task", `${root}/tasks/:taskID`, {
          params: { taskID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(ExpertCenterTaskView, "Expert center task"),
          error: [HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "expert-center.task",
            summary: "Get an expert center task",
            description: "Read the user-facing summary of one orchestration task.",
          }),
        ),
        HttpApiEndpoint.get("teams", `${root}/teams`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(ExpertTeamCardView), "Expert teams"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "expert-center.teams",
            summary: "List expert teams",
            description: "List selectable expert team cards and capabilities.",
          }),
        ),
        HttpApiEndpoint.get("experts", `${root}/experts`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(ExpertCardView), "Experts"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "expert-center.experts",
            summary: "List experts",
            description: "List selectable experts without exposing prompts or credentials.",
          }),
        ),
        HttpApiEndpoint.post("createTask", `${root}/tasks`, {
          query: WorkspaceRoutingQuery,
          payload: ExpertCenterTaskCreatePayload,
          success: described(ExpertCenterTaskActionResult, "Created expert center task"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "expert-center.tasks.create",
            summary: "Create an expert center task",
            description: "Create a user-facing task and its orchestration run.",
          }),
        ),
        HttpApiEndpoint.post("approveTask", `${root}/tasks/:taskID/approve`, {
          params: { taskID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: ExpertCenterApprovePayload,
          success: described(ExpertCenterTaskActionResult, "Approved expert center task"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound, HttpApiError.Conflict],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "expert-center.tasks.approve",
            summary: "Approve an expert center task",
            description: "Approve the current plan version using the existing run authorization boundary.",
          }),
        ),
        HttpApiEndpoint.post("pauseTask", `${root}/tasks/:taskID/pause`, {
          params: { taskID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(ExpertCenterTaskActionResult, "Paused expert center task"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound, HttpApiError.Conflict],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "expert-center.tasks.pause",
            summary: "Pause an expert center task",
            description: "Pause a task at a safe orchestration boundary.",
          }),
        ),
        HttpApiEndpoint.post("resumeTask", `${root}/tasks/:taskID/resume`, {
          params: { taskID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(ExpertCenterTaskActionResult, "Resumed expert center task"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound, HttpApiError.Conflict],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "expert-center.tasks.resume",
            summary: "Resume an expert center task",
            description: "Resume a paused or blocked task through the run state machine.",
          }),
        ),
        HttpApiEndpoint.post("retryTask", `${root}/tasks/:taskID/retry`, {
          params: { taskID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(ExpertCenterTaskActionResult, "Retried expert center task"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound, HttpApiError.Conflict],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "expert-center.tasks.retry",
            summary: "Retry an expert center task",
            description: "Retry a task that is paused or waiting for a decision.",
          }),
        ),
        HttpApiEndpoint.post("resolveTaskDecision", `${root}/tasks/:taskID/decisions/:decisionID`, {
          params: { taskID: Schema.String, decisionID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: ExpertCenterDecisionPayload,
          success: described(ExpertCenterTaskActionResult, "Resolved expert center decision"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound, HttpApiError.Conflict],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "expert-center.tasks.decision",
            summary: "Resolve an expert center task decision",
            description: "Record a user decision and continue only through a valid run transition.",
          }),
        ),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "expert-center", description: "User-facing expert team workspace projections." }),
  )
