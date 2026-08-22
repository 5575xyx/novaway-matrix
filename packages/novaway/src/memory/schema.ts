import { Schema } from "effect"
import { ProjectID } from "@/project/schema"
import { SessionID, MessageID } from "@/session/schema"
import { Identifier } from "@/id/id"
import { withStatics } from "@novaway/core/schema"
import { memoryKinds } from "./kind"

export const MemoryID = Schema.String.check(Schema.isStartsWith("mem")).pipe(
  Schema.brand("MemoryID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(id ?? Identifier.create("mem", "ascending")),
  })),
)
export type MemoryID = Schema.Schema.Type<typeof MemoryID>

export const ReviewCandidateID = Schema.String.check(Schema.isStartsWith("mrc")).pipe(
  Schema.brand("ReviewCandidateID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(id ?? Identifier.create("mrc", "ascending")),
  })),
)
export type ReviewCandidateID = Schema.Schema.Type<typeof ReviewCandidateID>

export const Target = Schema.Literals(["memory", "user"])
export type Target = Schema.Schema.Type<typeof Target>

export const Scope = Schema.Literals(["global", "project", "session"])
export type Scope = Schema.Schema.Type<typeof Scope>

export const Domain = Schema.Literals(["general", "coding", "office", "personal", "research", "ops"])
export type Domain = Schema.Schema.Type<typeof Domain>

export const Kind = Schema.Literals(memoryKinds)
export type Kind = Schema.Schema.Type<typeof Kind>

export const Entity = Schema.Struct({
  name: Schema.String,
  type: Schema.optional(Schema.String),
})
export type Entity = Schema.Schema.Type<typeof Entity>

export const RelationID = Schema.String.check(Schema.isStartsWith("rel")).pipe(
  Schema.brand("RelationID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(id ?? Identifier.create("rel", "ascending")),
  })),
)
export type RelationID = Schema.Schema.Type<typeof RelationID>

export const Relation = Schema.Struct({
  id: RelationID,
  memoryID: MemoryID,
  projectID: Schema.optional(ProjectID),
  sessionID: Schema.optional(SessionID),
  source: Schema.String,
  sourceType: Schema.optional(Schema.String),
  relation: Schema.String,
  target: Schema.String,
  targetType: Schema.optional(Schema.String),
  confidence: Schema.Number,
  validFrom: Schema.optional(Schema.Number),
  validTo: Schema.optional(Schema.Number),
  lastConfirmed: Schema.optional(Schema.Number),
  originMessageID: Schema.optional(MessageID),
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
  }),
}).annotate({ identifier: "MemoryRelation" })
export type Relation = Schema.Schema.Type<typeof Relation>

export const RelationInput = Schema.Struct({
  source: Schema.String,
  sourceType: Schema.optional(Schema.String),
  relation: Schema.String,
  target: Schema.String,
  targetType: Schema.optional(Schema.String),
  confidence: Schema.optional(Schema.Number),
  validFrom: Schema.optional(Schema.Number),
  validTo: Schema.optional(Schema.Number),
}).annotate({ identifier: "MemoryRelationInput" })
export type RelationInput = Schema.Schema.Type<typeof RelationInput>

export const ManualRelationInput = Schema.Struct({
  memoryID: MemoryID,
  source: Schema.String,
  sourceType: Schema.optional(Schema.String),
  relation: Schema.String,
  target: Schema.String,
  targetType: Schema.optional(Schema.String),
  confidence: Schema.optional(Schema.Number),
  validFrom: Schema.optional(Schema.Number),
  validTo: Schema.optional(Schema.Number),
}).annotate({ identifier: "MemoryManualRelationInput" })
export type ManualRelationInput = Schema.Schema.Type<typeof ManualRelationInput>

export const RelationListInput = Schema.Struct({
  projectID: Schema.optional(ProjectID),
  sessionID: Schema.optional(SessionID),
  entity: Schema.optional(Schema.String),
  relation: Schema.optional(Schema.String),
  includeArchived: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Number),
}).annotate({ identifier: "MemoryRelationListInput" })
export type RelationListInput = Schema.Schema.Type<typeof RelationListInput>

export const Source = Schema.Literals(["manual", "tool", "turn", "review", "compaction"])
export type Source = Schema.Schema.Type<typeof Source>

export const MemoryOperation = Schema.Literals(["add", "update", "archive", "confirm"])
export type MemoryOperation = Schema.Schema.Type<typeof MemoryOperation>

export const ReviewCandidateStatus = Schema.Literals(["pending", "applied", "dismissed"])
export type ReviewCandidateStatus = Schema.Schema.Type<typeof ReviewCandidateStatus>

export const ReviewCandidateSource = Schema.Literals(["explicit", "background", "compaction", "session-end"])
export type ReviewCandidateSource = Schema.Schema.Type<typeof ReviewCandidateSource>

export const Info = Schema.Struct({
  id: MemoryID,
  projectID: Schema.optional(ProjectID),
  sessionID: Schema.optional(SessionID),
  target: Target,
  scope: Scope,
  domain: Domain,
  kind: Schema.optional(Kind),
  entities: Schema.optional(Schema.Array(Entity)),
  content: Schema.String,
  summary: Schema.optional(Schema.String),
  tags: Schema.Array(Schema.String),
  importance: Schema.Number,
  confidence: Schema.Number,
  factKey: Schema.optional(Schema.String),
  version: Schema.Number,
  supersedesID: Schema.optional(MemoryID),
  source: Source,
  originMessageID: Schema.optional(MessageID),
  createdBy: Schema.optional(Schema.String),
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
    archived: Schema.optional(Schema.Number),
    validFrom: Schema.optional(Schema.Number),
    validTo: Schema.optional(Schema.Number),
    lastConfirmed: Schema.optional(Schema.Number),
  }),
  /** Dense embedding vector when cloud/Ollama backend is active. */
  embedding: Schema.optional(Schema.Array(Schema.Number)),
  embeddingModel: Schema.optional(Schema.String),
}).annotate({ identifier: "Memory" })
export type Info = Schema.Schema.Type<typeof Info>

export const ListInput = Schema.Struct({
  projectID: Schema.optional(ProjectID),
  sessionID: Schema.optional(SessionID),
  includeGlobal: Schema.optional(Schema.Boolean),
  target: Schema.optional(Target),
  scope: Schema.optional(Scope),
  domain: Schema.optional(Domain),
  kind: Schema.optional(Kind),
  entities: Schema.optional(Schema.Array(Entity)),
  search: Schema.optional(Schema.String),
  includeArchived: Schema.optional(Schema.Boolean),
  includeExpired: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Number),
}).annotate({ identifier: "MemoryListInput" })
export type ListInput = Schema.Schema.Type<typeof ListInput>

export const AddInput = Schema.Struct({
  projectID: Schema.optional(ProjectID),
  sessionID: Schema.optional(SessionID),
  target: Schema.optional(Target),
  scope: Schema.optional(Scope),
  domain: Schema.optional(Domain),
  kind: Schema.optional(Kind),
  entities: Schema.optional(Schema.Array(Entity)),
  content: Schema.String,
  summary: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  importance: Schema.optional(Schema.Number),
  confidence: Schema.optional(Schema.Number),
  factKey: Schema.optional(Schema.String),
  operation: Schema.optional(MemoryOperation),
  source: Schema.optional(Source),
  originMessageID: Schema.optional(MessageID),
  createdBy: Schema.optional(Schema.String),
  validFrom: Schema.optional(Schema.Number),
  validTo: Schema.optional(Schema.Number),
}).annotate({ identifier: "MemoryAddInput" })
export type AddInput = Schema.Schema.Type<typeof AddInput>

export const UpdateInput = Schema.Struct({
  id: MemoryID,
  content: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  importance: Schema.optional(Schema.Number),
  confidence: Schema.optional(Schema.Number),
  domain: Schema.optional(Domain),
  kind: Schema.optional(Kind),
  entities: Schema.optional(Schema.Array(Entity)),
  factKey: Schema.optional(Schema.String),
  scope: Schema.optional(Scope),
  archived: Schema.optional(Schema.Boolean),
  validFrom: Schema.optional(Schema.Number),
  validTo: Schema.optional(Schema.Number),
  confirm: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "MemoryUpdateInput" })
export type UpdateInput = Schema.Schema.Type<typeof UpdateInput>

export const PrefetchInput = Schema.Struct({
  query: Schema.String,
  projectID: ProjectID,
  sessionID: SessionID,
  limit: Schema.optional(Schema.Number),
  maxChars: Schema.optional(Schema.Number),
}).annotate({ identifier: "MemoryPrefetchInput" })
export type PrefetchInput = Schema.Schema.Type<typeof PrefetchInput>

export const ReviewCandidate = Schema.Struct({
  id: ReviewCandidateID,
  projectID: Schema.optional(ProjectID),
  sessionID: Schema.optional(SessionID),
  target: Target,
  scope: Scope,
  domain: Domain,
  kind: Schema.optional(Kind),
  entities: Schema.optional(Schema.Array(Entity)),
  content: Schema.String,
  summary: Schema.optional(Schema.String),
  tags: Schema.Array(Schema.String),
  importance: Schema.Number,
  confidence: Schema.Number,
  factKey: Schema.optional(Schema.String),
  operation: MemoryOperation,
  reason: Schema.String,
  sourceMessageID: Schema.optional(MessageID),
  status: ReviewCandidateStatus,
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
    applied: Schema.optional(Schema.Number),
  }),
}).annotate({ identifier: "MemoryReviewCandidate" })
export type ReviewCandidate = Schema.Schema.Type<typeof ReviewCandidate>

export const ReviewCandidateProposal = Schema.Struct({
  target: Schema.optional(Target),
  scope: Schema.optional(Scope),
  domain: Schema.optional(Domain),
  kind: Schema.optional(Kind),
  entities: Schema.optional(Schema.Array(Entity)),
  content: Schema.String,
  summary: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  importance: Schema.optional(Schema.Number),
  confidence: Schema.optional(Schema.Number),
  factKey: Schema.optional(Schema.String),
  operation: Schema.optional(MemoryOperation),
  reason: Schema.optional(Schema.String),
}).annotate({ identifier: "MemoryReviewCandidateProposal" })
export type ReviewCandidateProposal = Schema.Schema.Type<typeof ReviewCandidateProposal>

export const ReviewInput = Schema.Struct({
  projectID: Schema.optional(ProjectID),
  sessionID: Schema.optional(SessionID),
  userContent: Schema.String,
  assistantContent: Schema.optional(Schema.String),
  sourceMessageID: Schema.optional(MessageID),
  agent: Schema.optional(Schema.String),
  dryRun: Schema.optional(Schema.Boolean),
  candidates: Schema.optional(Schema.Array(ReviewCandidateProposal)),
}).annotate({ identifier: "MemoryReviewInput" })
export type ReviewInput = Schema.Schema.Type<typeof ReviewInput>

export const ReviewCandidateListInput = Schema.Struct({
  projectID: Schema.optional(ProjectID),
  sessionID: Schema.optional(SessionID),
  status: Schema.optional(ReviewCandidateStatus),
  limit: Schema.optional(Schema.Number),
}).annotate({ identifier: "MemoryReviewCandidateListInput" })
export type ReviewCandidateListInput = Schema.Schema.Type<typeof ReviewCandidateListInput>

const ReviewSourceCounts = Schema.Struct({
  all: Schema.Number,
  explicit: Schema.Number,
  background: Schema.Number,
  compaction: Schema.Number,
  "session-end": Schema.Number,
})

export const ReviewStatus = Schema.Struct({
  pending: Schema.Number,
  applied: Schema.Number,
  dismissed: Schema.Number,
  total: Schema.Number,
  latest: Schema.optional(Schema.Number),
  source: ReviewSourceCounts,
  sourceByStatus: Schema.Struct({
    pending: ReviewSourceCounts,
    applied: ReviewSourceCounts,
    dismissed: ReviewSourceCounts,
  }),
}).annotate({ identifier: "MemoryReviewStatus" })
export type ReviewStatus = Schema.Schema.Type<typeof ReviewStatus>

export * as MemorySchema from "./schema"
