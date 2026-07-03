import { EvolutionSchema } from "@/evolution/schema"
import { Schema, Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { ApiNotFoundError } from "../errors"

const root = "/evolution"

export const ReviewPayload = Schema.Struct(Struct.omit(EvolutionSchema.ReviewInput.fields, ["projectID"]))
export const CandidateUpdatePayload = EvolutionSchema.CandidateUpdate

export const CandidateQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  kind: Schema.optional(EvolutionSchema.Kind),
  status: Schema.optional(EvolutionSchema.Status),
  limit: Schema.optional(Schema.NumberFromString),
})

export const EvolutionPaths = {
  status: `${root}/status`,
  review: `${root}/review`,
  candidate: `${root}/candidate`,
  candidateUpdate: `${root}/candidate/:candidateID`,
  candidatePreview: `${root}/candidate/:candidateID/preview`,
  candidateDryRun: `${root}/candidate/:candidateID/dry-run`,
  candidateApply: `${root}/candidate/:candidateID/apply`,
  candidateApplyFile: `${root}/candidate/:candidateID/apply-file`,
  candidateDismiss: `${root}/candidate/:candidateID/dismiss`,
} as const

export const EvolutionApi = HttpApi.make("evolution").add(
  HttpApiGroup.make("evolution")
    .add(
      HttpApiEndpoint.get("status", EvolutionPaths.status, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: EvolutionSchema.StatusSummary,
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("review", EvolutionPaths.review, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: ReviewPayload,
        success: Schema.Array(EvolutionSchema.Candidate),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.get("listCandidates", EvolutionPaths.candidate, {
        query: CandidateQuery,
        success: described(Schema.Array(EvolutionSchema.Candidate), "List self-evolution candidates"),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.patch("updateCandidate", EvolutionPaths.candidateUpdate, {
        params: { candidateID: EvolutionSchema.EvolutionCandidateID },
        payload: CandidateUpdatePayload,
        success: EvolutionSchema.Candidate,
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }),
      HttpApiEndpoint.get("previewCandidate", EvolutionPaths.candidatePreview, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        params: { candidateID: EvolutionSchema.EvolutionCandidateID },
        success: EvolutionSchema.CandidatePreview,
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }),
      HttpApiEndpoint.get("dryRunCandidate", EvolutionPaths.candidateDryRun, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        params: { candidateID: EvolutionSchema.EvolutionCandidateID },
        success: EvolutionSchema.CandidateDryRun,
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }),
      HttpApiEndpoint.post("applyCandidate", EvolutionPaths.candidateApply, {
        params: { candidateID: EvolutionSchema.EvolutionCandidateID },
        success: EvolutionSchema.Candidate,
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }),
      HttpApiEndpoint.post("applyFileCandidate", EvolutionPaths.candidateApplyFile, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        params: { candidateID: EvolutionSchema.EvolutionCandidateID },
        success: EvolutionSchema.CandidateFileApply,
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }),
      HttpApiEndpoint.post("dismissCandidate", EvolutionPaths.candidateDismiss, {
        params: { candidateID: EvolutionSchema.EvolutionCandidateID },
        success: EvolutionSchema.Candidate,
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }),
    )
    .annotateMerge(OpenApi.annotations({ title: "evolution", description: "Self-evolution candidate routes." }))
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)

export * as EvolutionGroup from "./evolution"
