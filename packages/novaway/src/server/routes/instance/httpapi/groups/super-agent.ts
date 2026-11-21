import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { ApiNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"

const root = "/super-agent"
const RunStatus = Schema.Literals([
  "draft",
  "planning",
  "ready",
  "running",
  "waiting_approval",
  "waiting_input",
  "waiting_external",
  "paused",
  "needs_review",
  "verifying",
  "cancelling",
  "cancelled",
  "failed",
  "completed",
])

const PlannedTask = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  title: Schema.String,
  objective: Schema.String,
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  input: Schema.optional(Schema.Any),
  acceptanceCriteria: Schema.optional(
    Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String, required: Schema.optional(Schema.Boolean) })),
  ),
  retryPolicy: Schema.optional(
    Schema.Struct({ maxAttempts: Schema.Number, backoffMs: Schema.Number, retryable: Schema.Boolean }),
  ),
})

const Goal = Schema.Struct({
  text: Schema.String,
  constraints: Schema.optional(Schema.Array(Schema.String)),
  acceptanceCriteria: Schema.optional(
    Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String, required: Schema.optional(Schema.Boolean) })),
  ),
  plan: Schema.optional(Schema.Array(PlannedTask)),
  planningMode: Schema.optional(Schema.Literals(["deterministic", "model"])),
  requestedBy: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["user", "trigger", "plugin", "api", "agent"])),
  goalId: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
})

export const SuperAgentApi = HttpApiGroup.make("super-agent")
  .add(
    HttpApiEndpoint.post("createSuperAgentRun", `${root}/runs`, {
      payload: Schema.Struct({ goal: Goal, budget: Schema.optional(Schema.Record(Schema.String, Schema.Number)) }),
      success: Schema.Any,
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("listSuperAgentRuns", `${root}/runs`, {
      success: Schema.Array(Schema.Any),
      error: Schema.Never,
    }),
  )
  .add(
    HttpApiEndpoint.get("getSuperAgentRun", `${root}/runs/:runID`, {
      params: { runID: Schema.String },
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.get("listSuperAgentEvents", `${root}/runs/:runID/events`, {
      params: { runID: Schema.String },
      query: Schema.Struct({
        after: Schema.optional(Schema.NumberFromString),
        limit: Schema.optional(Schema.NumberFromString),
      }),
      success: Schema.Array(Schema.Any),
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("startSuperAgentRun", `${root}/runs/:runID/start`, {
      params: { runID: Schema.String },
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("pauseSuperAgentRun", `${root}/runs/:runID/pause`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({ reason: Schema.optional(Schema.String) }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("resumeSuperAgentRun", `${root}/runs/:runID/resume`, {
      params: { runID: Schema.String },
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("cancelSuperAgentRun", `${root}/runs/:runID/cancel`, {
      params: { runID: Schema.String },
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.get("getSuperAgentGraph", `${root}/runs/:runID/graph`, {
      params: { runID: Schema.String },
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.put("updateSuperAgentGraph", `${root}/runs/:runID/graph`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({ expectedVersion: Schema.Number, graph: Schema.Any }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("approveSuperAgentRequest", `${root}/runs/:runID/approve`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({
        requestID: Schema.String,
        status: Schema.Literals(["approved", "rejected"]),
        decidedBy: Schema.String,
        reason: Schema.optional(Schema.String),
      }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("answerSuperAgentInput", `${root}/runs/:runID/input`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({ requestID: Schema.String, answer: Schema.String }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.get("listSuperAgentApprovals", `${root}/runs/:runID/approvals`, {
      params: { runID: Schema.String },
      success: Schema.Array(Schema.Any),
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("createSuperAgentApproval", `${root}/runs/:runID/approvals`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({
        id: Schema.String,
        taskID: Schema.String,
        reason: Schema.String,
        scope: Schema.String,
        expiresAt: Schema.optional(Schema.Number),
      }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.get("listSuperAgentInputs", `${root}/runs/:runID/inputs`, {
      params: { runID: Schema.String },
      success: Schema.Array(Schema.Any),
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("recordSuperAgentEvidence", `${root}/runs/:runID/evidence`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({
        id: Schema.String,
        taskID: Schema.String,
        kind: Schema.Literals(["test", "file", "http", "screenshot", "log", "artifact", "human", "external"]),
        source: Schema.String,
        acceptanceIDs: Schema.optional(Schema.Array(Schema.String)),
        contentHash: Schema.optional(Schema.String),
        measured: Schema.optional(Schema.String),
        expiresAt: Schema.optional(Schema.Number),
      }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.get("listSuperAgentEvidence", `${root}/runs/:runID/evidence`, {
      params: { runID: Schema.String },
      success: Schema.Array(Schema.Any),
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.get("listSuperAgentVerifications", `${root}/runs/:runID/verifications`, {
      params: { runID: Schema.String },
      success: Schema.Array(Schema.Any),
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("executeSuperAgentTool", `${root}/runs/:runID/execute-tool`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({
        taskID: Schema.String,
        tool: Schema.String,
        input: Schema.Any,
        sessionID: Schema.String,
        messageID: Schema.String,
        agent: Schema.optional(Schema.String),
        instructionID: Schema.optional(Schema.String),
        idempotencyKey: Schema.optional(Schema.String),
        evidenceKind: Schema.optional(
          Schema.Literals(["test", "file", "http", "screenshot", "log", "artifact", "human", "external"]),
        ),
        timeoutMs: Schema.optional(Schema.Number),
        leaseMs: Schema.optional(Schema.Number),
      }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("recoverSuperAgentRun", `${root}/runs/:runID/recover`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({ at: Schema.optional(Schema.Number) }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("delegateSuperAgentAgents", `${root}/runs/:runID/delegate`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({
        taskID: Schema.String,
        runtimeType: Schema.String,
        agentID: Schema.optional(Schema.String),
        instruction: Schema.optional(Schema.String),
        calls: Schema.optional(Schema.Array(Schema.Struct({ agentID: Schema.String, instruction: Schema.String }))),
        timeoutMs: Schema.optional(Schema.Number),
        childBudget: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
      }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("createSuperAgentRepairTask", `${root}/runs/:runID/repair`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({
        sourceTaskID: Schema.optional(Schema.String),
        failedVerificationIDs: Schema.Array(Schema.String),
        strategyID: Schema.String,
        input: Schema.optional(Schema.Unknown),
      }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.get("listSuperAgentTaskMutations", `${root}/runs/:runID/task-mutations`, {
      params: { runID: Schema.String },
      query: Schema.Struct({ taskID: Schema.optional(Schema.String), limit: Schema.optional(Schema.NumberFromString) }),
      success: Schema.Array(Schema.Any),
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("executeSuperAgentRepairTask", `${root}/runs/:runID/repair/execute`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({
        taskID: Schema.String,
        sessionID: Schema.String,
        messageID: Schema.String,
        agent: Schema.optional(Schema.String),
        evidenceKind: Schema.optional(
          Schema.Literals(["test", "file", "http", "screenshot", "log", "artifact", "human", "external"]),
        ),
        timeoutMs: Schema.optional(Schema.Number),
        leaseMs: Schema.optional(Schema.Number),
        verifyAfter: Schema.optional(Schema.Boolean),
        verifierID: Schema.optional(Schema.String),
        summary: Schema.optional(Schema.String),
      }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("verifyAndFinishSuperAgentRun", `${root}/runs/:runID/verify-finish`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({ verifierID: Schema.String, summary: Schema.String }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("transitionSuperAgentRun", `${root}/runs/:runID/transition`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({ status: RunStatus }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("recordSuperAgentVerification", `${root}/runs/:runID/verifications`, {
      params: { runID: Schema.String },
      payload: Schema.Struct({
        id: Schema.String,
        taskID: Schema.optional(Schema.String),
        acceptanceID: Schema.String,
        verifierID: Schema.String,
        verifierVersion: Schema.String,
        outcome: Schema.Literals(["pass", "fail", "unverified", "stale", "needs_review"]),
        measured: Schema.optional(Schema.String),
        evidenceIDs: Schema.Array(Schema.String),
        reason: Schema.String,
      }),
      success: Schema.Any,
      error: [ApiNotFoundError],
    }),
  )
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)
