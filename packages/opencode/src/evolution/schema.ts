import { Schema } from "effect"
import { ProjectID } from "@/project/schema"
import { SessionID, MessageID } from "@/session/schema"
import { Identifier } from "@/id/id"
import { withStatics } from "@opencode-ai/core/schema"

export const EvolutionCandidateID = Schema.String.check(Schema.isStartsWith("evc")).pipe(
  Schema.brand("EvolutionCandidateID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(id ?? Identifier.create("evc", "ascending")),
  })),
)
export type EvolutionCandidateID = Schema.Schema.Type<typeof EvolutionCandidateID>

export const Kind = Schema.Literals([
  "skill",
  "agent",
  "workflow",
  "prompt",
  "tool",
  "project",
  "strategy",
  "habit",
  "knowledge",
])
export type Kind = Schema.Schema.Type<typeof Kind>

export const Status = Schema.Literals(["pending", "applied", "dismissed"])
export type Status = Schema.Schema.Type<typeof Status>

export const CandidateSource = Schema.Literals(["background", "session-end"])
export type CandidateSource = Schema.Schema.Type<typeof CandidateSource>

export const ContentFormat = Schema.Literals(["content", "unified_diff"])
export type ContentFormat = Schema.Schema.Type<typeof ContentFormat>

export const Domain = Schema.Literals(["general", "coding", "office", "personal", "research", "ops"])
export type Domain = Schema.Schema.Type<typeof Domain>

export const ValidationStatus = Schema.Literals(["pending", "validated", "failed"])
export type ValidationStatus = Schema.Schema.Type<typeof ValidationStatus>

export const Candidate = Schema.Struct({
  id: EvolutionCandidateID,
  projectID: Schema.optional(ProjectID),
  sessionID: Schema.optional(SessionID),
  kind: Kind,
  domain: Domain,
  target: Schema.String,
  title: Schema.String,
  content: Schema.String,
  contentFormat: ContentFormat,
  reason: Schema.String,
  tags: Schema.Array(Schema.String),
  expectedOutcomes: Schema.optional(Schema.Array(Schema.String)),
  sourceMessageID: Schema.optional(MessageID),
  status: Status,
  validationStatus: ValidationStatus,
  validationNote: Schema.optional(Schema.String),
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
    applied: Schema.optional(Schema.Number),
  }),
}).annotate({ identifier: "EvolutionCandidate" })
export type Candidate = Schema.Schema.Type<typeof Candidate>

export const CandidateProposal = Schema.Struct({
  kind: Kind,
  domain: Schema.optional(Domain),
  scope: Schema.optional(Schema.Literals(["global", "project"])),
  target: Schema.String,
  title: Schema.String,
  content: Schema.String,
  contentFormat: Schema.optional(ContentFormat),
  reason: Schema.String,
  tags: Schema.optional(Schema.Array(Schema.String)),
  expectedOutcomes: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "EvolutionCandidateProposal" })
export type CandidateProposal = Schema.Schema.Type<typeof CandidateProposal>

export const CandidateUpdate = Schema.Struct({
  kind: Schema.optional(Kind),
  target: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  contentFormat: Schema.optional(ContentFormat),
  reason: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  expectedOutcomes: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "EvolutionCandidateUpdate" })
export type CandidateUpdate = Schema.Schema.Type<typeof CandidateUpdate>

export const CandidatePreview = Schema.Struct({
  id: EvolutionCandidateID,
  kind: Kind,
  target: Schema.String,
  title: Schema.String,
  diff: Schema.String,
  note: Schema.String,
}).annotate({ identifier: "EvolutionCandidatePreview" })
export type CandidatePreview = Schema.Schema.Type<typeof CandidatePreview>

export const CandidateDryRunFile = Schema.Struct({
  path: Schema.String,
  exists: Schema.Boolean,
  before: Schema.String,
  after: Schema.String,
  diff: Schema.String,
}).annotate({ identifier: "EvolutionCandidateDryRunFile" })
export type CandidateDryRunFile = Schema.Schema.Type<typeof CandidateDryRunFile>

export const CandidateDryRun = Schema.Struct({
  id: EvolutionCandidateID,
  kind: Kind,
  target: Schema.String,
  title: Schema.String,
  files: Schema.Array(CandidateDryRunFile),
  note: Schema.String,
}).annotate({ identifier: "EvolutionCandidateDryRun" })
export type CandidateDryRun = Schema.Schema.Type<typeof CandidateDryRun>

export const CandidateFileApply = Schema.Struct({
  candidate: Candidate,
  dryRun: CandidateDryRun,
}).annotate({ identifier: "EvolutionCandidateFileApply" })
export type CandidateFileApply = Schema.Schema.Type<typeof CandidateFileApply>

export const ReviewInput = Schema.Struct({
  projectID: Schema.optional(ProjectID),
  sessionID: Schema.optional(SessionID),
  sourceMessageID: Schema.optional(MessageID),
  proposals: Schema.Array(CandidateProposal),
}).annotate({ identifier: "EvolutionReviewInput" })
export type ReviewInput = Schema.Schema.Type<typeof ReviewInput>

export const ListInput = Schema.Struct({
  projectID: Schema.optional(ProjectID),
  sessionID: Schema.optional(SessionID),
  includeGlobal: Schema.optional(Schema.Boolean),
  kind: Schema.optional(Kind),
  status: Schema.optional(Status),
  limit: Schema.optional(Schema.Number),
}).annotate({ identifier: "EvolutionCandidateListInput" })
export type ListInput = Schema.Schema.Type<typeof ListInput>

const SourceCounts = Schema.Struct({
  all: Schema.Number,
  background: Schema.Number,
  "session-end": Schema.Number,
})

export const StatusSummary = Schema.Struct({
  pending: Schema.Number,
  applied: Schema.Number,
  dismissed: Schema.Number,
  total: Schema.Number,
  latest: Schema.optional(Schema.Number),
  source: SourceCounts,
  sourceByStatus: Schema.Struct({
    pending: SourceCounts,
    applied: SourceCounts,
    dismissed: SourceCounts,
  }),
}).annotate({ identifier: "EvolutionStatus" })
export type StatusSummary = Schema.Schema.Type<typeof StatusSummary>

export * as EvolutionSchema from "./schema"
