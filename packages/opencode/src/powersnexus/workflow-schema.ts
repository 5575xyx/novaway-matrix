import { Schema } from "effect"
import { Sha256 } from "./schema"

export const ChangeName = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,79}$/))
export type ChangeName = Schema.Schema.Type<typeof ChangeName>
export const WorkflowLevel = Schema.Literals(["L0", "L1", "L2", "L3", "L4"])
export type WorkflowLevel = Schema.Schema.Type<typeof WorkflowLevel>

export const WorkflowPhase = Schema.Literals([
  "uninitialized",
  "needs_classification",
  "needs_clarification",
  "needs_specification",
  "needs_design",
  "needs_plan",
  "ready_to_implement",
  "implementing",
  "needs_traceability",
  "needs_delivery_config",
  "ready_to_verify",
  "verifying",
  "repairing",
  "ready_to_archive",
  "archiving",
  "completed",
  "blocked",
])
export type WorkflowPhase = Schema.Schema.Type<typeof WorkflowPhase>

export const WorkflowStatus = Schema.Literals([
  "idle",
  "running",
  "blocked",
  "failed",
  "completed-local",
  "completed",
])
export type WorkflowStatus = Schema.Schema.Type<typeof WorkflowStatus>

export const RequirementState = Schema.Struct({
  id: Schema.String,
  module: Schema.String,
  status: Schema.Literals(["planned", "implementing", "verified", "blocked"]),
  implementationFiles: Schema.Array(Schema.String),
  testFiles: Schema.Array(Schema.String),
})

export const WorkflowTask = Schema.Struct({
  id: Schema.String,
  requirementIDs: Schema.Array(Schema.String),
  title: Schema.String,
  status: Schema.Literals(["pending", "in_progress", "completed", "cancelled", "blocked"]),
  dependsOn: Schema.Array(Schema.String),
  sessionID: Schema.optional(Schema.String),
})
export type WorkflowTask = Schema.Schema.Type<typeof WorkflowTask>

export const WorkflowAction = Schema.Struct({
  action: Schema.String,
  label: Schema.String,
  automatic: Schema.Boolean,
  requiresAuthority: Schema.optional(Schema.Literals(["user", "admin", "external-system"])),
})
export type WorkflowAction = Schema.Schema.Type<typeof WorkflowAction>

export const WorkflowBlocker = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  recoverable: Schema.Boolean,
  evidence: Schema.optional(Schema.Array(Schema.String)),
  recoveryActions: Schema.Array(Schema.String),
})

export const DeliveryState = Schema.Struct({
  profile: Schema.String,
  status: Schema.Literals(["unconfigured", "ready", "running", "failed", "passed", "expired"]),
  activeRunID: Schema.optional(Schema.String),
  verifiedAt: Schema.optional(Schema.String),
  fingerprint: Schema.optional(Sha256),
})

export const WorkflowSnapshot = Schema.Struct({
  protocolVersion: Schema.Literal("1.0"),
  powersnexusVersion: Schema.String,
  powersnexusDigest: Sha256,
  bindingID: Schema.String,
  projectID: Schema.String,
  projectRoot: Schema.String,
  worktree: Schema.String,
  changeName: ChangeName,
  profile: Schema.optional(Schema.Literals(["application", "library", "web"])),
  level: WorkflowLevel,
  phase: WorkflowPhase,
  status: WorkflowStatus,
  revision: Schema.Int,
  artifactDigest: Sha256,
  requirements: Schema.Array(RequirementState),
  tasks: Schema.Array(WorkflowTask),
  delivery: Schema.optional(DeliveryState),
  nextAction: Schema.optional(WorkflowAction),
  blockers: Schema.Array(WorkflowBlocker),
  updatedAt: Schema.String,
}).annotate({ identifier: "PowersNexusWorkflowSnapshot" })
export type WorkflowSnapshot = Schema.Schema.Type<typeof WorkflowSnapshot>

export const WorkflowEvent = Schema.Literals([
  "user.requirement",
  "classification.completed",
  "clarification.required",
  "clarification.completed",
  "artifacts.valid",
  "design.valid",
  "plan.valid",
  "authorization.local",
  "tasks.completed",
  "trace.valid",
  "delivery.configured",
  "verify.started",
  "step.failed",
  "patch.completed",
  "delivery.passed",
  "archive.approved",
  "archive.completed",
  "unrecoverable.error",
])
export type WorkflowEvent = Schema.Schema.Type<typeof WorkflowEvent>

export * as PowersNexusWorkflowSchema from "./workflow-schema"
