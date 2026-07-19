import { BusEvent } from "@/bus/bus-event"
import { Schema } from "effect"
import { WorkflowPhase, WorkflowSnapshot } from "./workflow-schema"

const Context = {
  projectID: Schema.String,
  worktree: Schema.String,
  bindingID: Schema.String,
  revision: Schema.Int,
  timestamp: Schema.String,
}

export const Event = {
  SnapshotChanged: BusEvent.define("powersnexus.snapshot.changed", WorkflowSnapshot),
  PhaseChanged: BusEvent.define(
    "powersnexus.phase.changed",
    Schema.Struct({ ...Context, from: WorkflowPhase, to: WorkflowPhase }),
  ),
  BindingChanged: BusEvent.define(
    "powersnexus.binding.changed",
    Schema.Struct({ ...Context, changeName: Schema.String }),
  ),
  Blocked: BusEvent.define(
    "powersnexus.blocked",
    Schema.Struct({ ...Context, errorCode: Schema.String, message: Schema.String }),
  ),
  RunStarted: BusEvent.define(
    "powersnexus.run.started",
    Schema.Struct({ runID: Schema.String, bindingID: Schema.String, action: Schema.String, timestamp: Schema.String }),
  ),
  StepStarted: BusEvent.define(
    "powersnexus.step.started",
    Schema.Struct({ runID: Schema.String, stepID: Schema.String, timestamp: Schema.String }),
  ),
  StepCompleted: BusEvent.define(
    "powersnexus.step.completed",
    Schema.Struct({
      runID: Schema.String,
      stepID: Schema.String,
      status: Schema.String,
      exitCode: Schema.optional(Schema.Number),
      evidenceDigest: Schema.optional(Schema.String),
      timestamp: Schema.String,
    }),
  ),
  RunCompleted: BusEvent.define(
    "powersnexus.run.completed",
    Schema.Struct({
      runID: Schema.String,
      bindingID: Schema.String,
      status: Schema.String,
      errorCode: Schema.optional(Schema.String),
      timestamp: Schema.String,
    }),
  ),
  EvidenceAdded: BusEvent.define(
    "powersnexus.evidence.added",
    Schema.Struct({ runID: Schema.String, bindingID: Schema.String, fingerprint: Schema.String, timestamp: Schema.String }),
  ),
  Archived: BusEvent.define(
    "powersnexus.archived",
    Schema.Struct({
      bindingID: Schema.String,
      changeName: Schema.String,
      archivePath: Schema.String,
      timestamp: Schema.String,
    }),
  ),
}

export * as PowersNexusEvents from "./events"
