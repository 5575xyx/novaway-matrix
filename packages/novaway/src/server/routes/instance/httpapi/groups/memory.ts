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

export const RelationListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  entity: Schema.optional(Schema.String),
  relation: Schema.optional(Schema.String),
  includeArchived: Schema.optional(QueryBoolean),
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
  embeddingStatus: `${root}/embedding/status`,
  embeddingSetupLocal: `${root}/embedding/setup-local`,
  relations: `${root}/relations`,
  relationsRemove: `${root}/relations/:relationID`,
  relationsForMemory: `${root}/:memoryID/relations`,
  get: `${root}/:memoryID`,
  update: `${root}/:memoryID`,
  remove: `${root}/:memoryID`,
} as const

const OllamaPhase = Schema.Literals([
  "idle",
  "checking",
  "installing",
  "starting",
  "pulling",
  "ready",
  "needs_manual",
  "error",
])

export const EmbeddingStatus = Schema.Struct({
  platform: Schema.String,
  baseURL: Schema.String,
  preferredModel: Schema.String,
  cliInstalled: Schema.Boolean,
  cliPath: Schema.optional(Schema.String),
  installDir: Schema.optional(Schema.String),
  cliVersion: Schema.optional(Schema.String),
  modelsDir: Schema.String,
  daemonRunning: Schema.Boolean,
  models: Schema.Array(Schema.String),
  hasEmbedModel: Schema.Boolean,
  selectedModel: Schema.optional(Schema.String),
  ready: Schema.Boolean,
  phase: OllamaPhase,
  message: Schema.String,
  hint: Schema.optional(Schema.String),
  installCommand: Schema.optional(Schema.String),
  downloadURL: Schema.String,
  /** Currently resolved embedder backend label from auto/local/provider/ollama */
  activeBackendLabel: Schema.String,
  activeBackendKind: Schema.Literals(["local", "provider", "ollama", "off"]),
  activeBackendModelId: Schema.String,
}).annotate({ identifier: "MemoryEmbeddingStatus" })

export const EmbeddingSetupStep = Schema.Struct({
  step: Schema.String,
  status: Schema.Literals(["running", "ok", "skip", "error", "manual"]),
  detail: Schema.optional(Schema.String),
})

export const EmbeddingSetupLocalPayload = Schema.Struct({
  allowInstall: Schema.optional(Schema.Boolean),
  model: Schema.optional(Schema.String),
  baseURL: Schema.optional(Schema.String),
  installDir: Schema.optional(Schema.String),
  modelsDir: Schema.optional(Schema.String),
  /** When true, also write memory.embedding_* into resolved config defaults for this response guidance */
  applyConfig: Schema.optional(Schema.Boolean),
})

export const EmbeddingSetupLocalResult = Schema.Struct({
  ok: Schema.Boolean,
  status: EmbeddingStatus,
  steps: Schema.Array(EmbeddingSetupStep),
  config: Schema.optional(
    Schema.Struct({
      embedding_mode: Schema.Literals(["ollama"]),
      embedding_ollama_url: Schema.String,
      embedding_ollama_model: Schema.String,
      embedding_ollama_install_dir: Schema.optional(Schema.String),
      embedding_ollama_models_dir: Schema.optional(Schema.String),
    }),
  ),
}).annotate({ identifier: "MemoryEmbeddingSetupLocalResult" })

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
      HttpApiEndpoint.get("embeddingStatus", MemoryPaths.embeddingStatus, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: EmbeddingStatus,
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("embeddingSetupLocal", MemoryPaths.embeddingSetupLocal, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: EmbeddingSetupLocalPayload,
        success: EmbeddingSetupLocalResult,
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.get("listRelations", MemoryPaths.relations, {
        query: RelationListQuery,
        success: Schema.Array(MemorySchema.Relation),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("addRelation", MemoryPaths.relations, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: MemorySchema.ManualRelationInput,
        success: MemorySchema.Relation,
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }),
      HttpApiEndpoint.delete("removeRelation", MemoryPaths.relationsRemove, {
        params: { relationID: MemorySchema.RelationID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: Schema.Boolean,
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }),
      HttpApiEndpoint.get("relationsForMemory", MemoryPaths.relationsForMemory, {
        params: { memoryID: MemorySchema.MemoryID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: Schema.Array(MemorySchema.Relation),
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
        payload: Schema.Struct({ scope: Schema.optional(MemorySchema.Scope) }),
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
