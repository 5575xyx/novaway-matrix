import { MemorySchema } from "@/memory/schema"
import { Schema, Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { ApiNotFoundError } from "../errors"
import { QueryBoolean } from "./query"

const root = "/memory"

export const ListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  target: Schema.optional(MemorySchema.Target),
  scope: Schema.optional(MemorySchema.Scope),
  search: Schema.optional(Schema.String),
  includeArchived: Schema.optional(QueryBoolean),
  limit: Schema.optional(Schema.NumberFromString),
})

export const AddPayload = Schema.Struct(Struct.omit(MemorySchema.AddInput.fields, ["projectID", "sessionID"]))
export const UpdatePayload = Schema.Struct(Struct.omit(MemorySchema.UpdateInput.fields, ["id"]))
export const ReviewPayload = Schema.Struct(Struct.omit(MemorySchema.ReviewInput.fields, ["projectID"]))

export const ReviewCandidateQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  status: Schema.optional(MemorySchema.ReviewCandidateStatus),
  limit: Schema.optional(Schema.NumberFromString),
})

export const MemoryPaths = {
  list: root,
  status: `${root}/status`,
  review: `${root}/review`,
  reviewStatus: `${root}/review/status`,
  reviewCandidate: `${root}/review/candidate`,
  reviewCandidateApply: `${root}/review/candidate/:candidateID/apply`,
  reviewCandidateDismiss: `${root}/review/candidate/:candidateID/dismiss`,
  get: `${root}/:memoryID`,
  update: `${root}/:memoryID`,
  remove: `${root}/:memoryID`,
} as const

export const MemoryApi = HttpApi.make("memory").add(
  HttpApiGroup.make("memory")
    .add(
      HttpApiEndpoint.get("list", MemoryPaths.list, {
        query: ListQuery,
        success: described(Schema.Array(MemorySchema.Info), "List persistent memory entries"),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.get("status", MemoryPaths.status, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: Schema.Struct({
          total: Schema.Number,
          active: Schema.Number,
          archived: Schema.Number,
          latest: Schema.optional(Schema.Number),
        }),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("add", MemoryPaths.list, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: AddPayload,
        success: MemorySchema.Info,
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.get("reviewStatus", MemoryPaths.reviewStatus, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: MemorySchema.ReviewStatus,
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("review", MemoryPaths.review, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: ReviewPayload,
        success: Schema.Array(MemorySchema.ReviewCandidate),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.get("listReviewCandidates", MemoryPaths.reviewCandidate, {
        query: ReviewCandidateQuery,
        success: Schema.Array(MemorySchema.ReviewCandidate),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("applyReviewCandidate", MemoryPaths.reviewCandidateApply, {
        params: { candidateID: MemorySchema.ReviewCandidateID },
        success: MemorySchema.Info,
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }),
      HttpApiEndpoint.post("dismissReviewCandidate", MemoryPaths.reviewCandidateDismiss, {
        params: { candidateID: MemorySchema.ReviewCandidateID },
        success: MemorySchema.ReviewCandidate,
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }),
      HttpApiEndpoint.patch("update", MemoryPaths.update, {
        params: { memoryID: MemorySchema.MemoryID },
        payload: UpdatePayload,
        success: MemorySchema.Info,
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }),
      HttpApiEndpoint.delete("remove", MemoryPaths.remove, {
        params: { memoryID: MemorySchema.MemoryID },
        success: Schema.Boolean,
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }),
    )
    .annotateMerge(OpenApi.annotations({ title: "memory", description: "Persistent memory routes." }))
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)

export * as MemoryGroup from "./memory"
