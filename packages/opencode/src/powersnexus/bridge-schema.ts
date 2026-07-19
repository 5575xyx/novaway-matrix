import { Schema } from "effect"
import { Sha256 } from "./schema"

const ChangeName = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,79}$/))
const Requirement = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^REQ-[0-9]+$/)),
  module: Schema.String,
})
const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.Literals(["pending", "completed"]),
})
export const Blocker = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  recoverable: Schema.Boolean,
  evidence: Schema.optional(Schema.Array(Schema.String)),
  recoveryActions: Schema.Array(Schema.String),
})

export const ArtifactSnapshot = Schema.Struct({
  protocolVersion: Schema.String,
  powersnexusVersion: Schema.String,
  changeName: ChangeName,
  level: Schema.Union([Schema.Literals(["L0", "L1", "L2", "L3", "L4"]), Schema.Null]),
  phase: Schema.Literals([
    "needs_proposal",
    "needs_spec",
    "needs_design",
    "needs_plan",
    "implementing",
    "needs_traceability",
    "needs_delivery_config",
    "ready_to_verify",
    "ready_to_archive",
    "completed",
  ]),
  status: Schema.Literals(["ready", "running", "blocked", "completed"]),
  revision: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  artifactDigest: Sha256,
  requirements: Schema.Array(Requirement),
  tasks: Schema.Array(Task),
  blockers: Schema.Array(Blocker),
  nextAction: Schema.Union([Schema.String, Schema.Null]),
  delivery: Schema.Union([Schema.Record(Schema.String, Schema.Unknown), Schema.Null]),
  updatedAt: Schema.String,
}).annotate({ identifier: "PowersNexusBridgeArtifactSnapshot" })
export type ArtifactSnapshot = Schema.Schema.Type<typeof ArtifactSnapshot>

export const ValidationResult = Schema.Struct({
  valid: Schema.Boolean,
  errors: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      message: Schema.String,
      evidence: Schema.Array(Schema.String),
    }),
  ),
  snapshot: ArtifactSnapshot,
})
export type ValidationResult = Schema.Schema.Type<typeof ValidationResult>

export const ActionRequest = Schema.Struct({
  actionID: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._:-]{8,128}$/)),
  expectedRevision: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  bindingID: Schema.optional(Schema.String),
  action: Schema.String,
  input: Schema.Record(Schema.String, Schema.Unknown),
})
export type ActionRequest = Schema.Schema.Type<typeof ActionRequest>

export const ActionStarted = Schema.Struct({
  protocolVersion: Schema.String,
  type: Schema.Literal("action.started"),
  actionID: Schema.String,
})

export const ActionCompleted = Schema.Struct({
  protocolVersion: Schema.String,
  type: Schema.Literal("action.completed"),
  actionID: Schema.String,
  accepted: Schema.Boolean,
  replayed: Schema.Boolean,
  snapshot: ArtifactSnapshot,
})
export type ActionCompleted = Schema.Schema.Type<typeof ActionCompleted>

export const BridgeFailure = Schema.Struct({
  protocolVersion: Schema.String,
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
    recoverable: Schema.Boolean,
    evidence: Schema.Array(Schema.String),
  }),
})

export * as PowersNexusBridgeSchema from "./bridge-schema"
