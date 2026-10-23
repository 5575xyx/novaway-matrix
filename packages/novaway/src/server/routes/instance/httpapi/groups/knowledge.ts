import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { ApiNotFoundError } from "../errors"
import { described } from "./metadata"
import { QueryBoolean } from "./query"

const root = "/knowledge"

// 知识库的错误需要把「名字重复/内容为空/目录不存在」等具体原因带回 UI，
// 内置 BadRequest 只有 _tag，借 Git 组的做法定义一个带 message 的 400。
export class KnowledgeError extends Schema.ErrorClass<KnowledgeError>("KnowledgeError")(
  {
    name: Schema.Literal("KnowledgeError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}

export const knowledgeError = (message: string) => new KnowledgeError({ name: "KnowledgeError", data: { message } })

export const KnowledgeCollection = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  scope: Schema.optional(Schema.Literals(["global", "project"])),
  projectID: Schema.optional(Schema.String),
  readOnly: Schema.optional(Schema.Boolean),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  documentCount: Schema.Number,
}).annotate({ identifier: "KnowledgeCollection" })

export const KnowledgeDocumentMeta = Schema.Struct({
  id: Schema.String,
  collectionID: Schema.String,
  title: Schema.String,
  source: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Number),
  size: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "KnowledgeDocumentMeta" })

export const KnowledgeDocument = Schema.Struct({
  id: Schema.String,
  collectionID: Schema.String,
  title: Schema.String,
  source: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Number),
  content: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "KnowledgeDocument" })

export const TrashItem = Schema.Struct({
  document: KnowledgeDocument,
  deletedAt: Schema.Number,
}).annotate({ identifier: "KnowledgeTrashItem" })

export const KnowledgeHit = Schema.Struct({
  collectionID: Schema.String,
  documentID: Schema.String,
  title: Schema.String,
  snippet: Schema.String,
  score: Schema.Number,
  chunk: Schema.Number,
  /** 切片在原文中的起始偏移：UI 据此精确高亮，不必按关键词猜位置。 */
  offset: Schema.optional(Schema.Number),
}).annotate({ identifier: "KnowledgeHit" })

export const CreateCollectionPayload = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.Literals(["global", "project"])),
  readOnly: Schema.optional(Schema.Boolean),
  /** 模板 id：只用于 UI 的初始建议与示例用例，不影响集合本身。 */
  template: Schema.optional(Schema.String),
  /** 写入模板自带的示例文档，方便立刻试检索。 */
  sample: Schema.optional(Schema.Boolean),
})

export const UpdateCollectionPayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  scope: Schema.optional(Schema.Literals(["global", "project"])),
  readOnly: Schema.optional(Schema.Boolean),
})

export const AddDocumentPayload = Schema.Struct({
  title: Schema.String,
  content: Schema.String,
  source: Schema.optional(Schema.String),
})

export const UpdateDocumentPayload = Schema.Struct({
  title: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
})

export const UploadDocumentPayload = Schema.Struct({
  name: Schema.String,
  /** base64 编码的文件内容（PDF/DOCX/PPTX/XLSX/TXT…）。 */
  data: Schema.String,
})

export const ImportFilePayload = Schema.Struct({
  name: Schema.String,
  data: Schema.String,
})

export const ImportPayload = Schema.Struct({
  files: Schema.Array(ImportFilePayload),
  /** 后台执行：立即返回 jobID，用 /knowledge/imports/:jobID 轮询进度。 */
  background: Schema.optional(Schema.Boolean),
})

export const ImportResult = Schema.Struct({
  imported: Schema.Number,
  updated: Schema.Number,
  duplicates: Schema.Number,
  failed: Schema.Array(Schema.Struct({ name: Schema.String, error: Schema.String })),
  /** 后台导入时返回的任务 id。 */
  jobID: Schema.optional(Schema.String),
}).annotate({ identifier: "KnowledgeImportResult" })

export const ImportJob = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["running", "completed", "error", "cancelled"]),
  title: Schema.optional(Schema.String),
  startedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  progress: Schema.Struct({
    total: Schema.Number,
    processed: Schema.Number,
    imported: Schema.Number,
    updated: Schema.Number,
    duplicates: Schema.Number,
    failed: Schema.Number,
    current: Schema.optional(Schema.String),
  }),
}).annotate({ identifier: "KnowledgeImportJob" })

export const ExportDocument = Schema.Struct({
  title: Schema.String,
  source: Schema.optional(Schema.String),
  content: Schema.String,
  version: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export const CollectionExport = Schema.Struct({
  format: Schema.Literal("novaway.knowledge.v1"),
  exportedAt: Schema.Number,
  collection: Schema.Struct({ name: Schema.String, description: Schema.optional(Schema.String) }),
  documents: Schema.Array(ExportDocument),
  signature: Schema.optional(
    Schema.Struct({
      algorithm: Schema.Literal("sha256"),
      documents: Schema.Number,
      value: Schema.String,
    }),
  ),
}).annotate({ identifier: "KnowledgeCollectionExport" })

export const RestorePayload = Schema.Struct({
  documents: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      source: Schema.optional(Schema.String),
      content: Schema.String,
    }),
  ),
  /** 导出包自带的校验和；有就校验，不匹配整包拒绝。 */
  signature: Schema.optional(
    Schema.Struct({
      algorithm: Schema.optional(Schema.String),
      value: Schema.optional(Schema.String),
      documents: Schema.optional(Schema.Number),
    }),
  ),
})

export const RestoreResult = Schema.Struct({
  imported: Schema.Number,
  updated: Schema.Number,
  skipped: Schema.Number,
}).annotate({ identifier: "KnowledgeRestoreResult" })

export const RelatedQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  collectionID: Schema.String,
  documentID: Schema.String,
  limit: Schema.optional(Schema.NumberFromString),
})

export const RelatedDocument = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  shared: Schema.Array(Schema.String),
  score: Schema.Number,
})

export const OcrStatus = Schema.Struct({
  kind: Schema.Literals(["rapid", "cli", "wasm", "vision", "none"]),
  label: Schema.String,
  languages: Schema.Array(Schema.String),
  hint: Schema.String,
}).annotate({ identifier: "KnowledgeOcrStatus" })

export const KnowledgeEmbeddingStatus = Schema.Struct({
  kind: Schema.Literals(["local", "provider", "ollama", "off"]),
  label: Schema.String,
  modelId: Schema.String,
  /** 稠密向量是否参与检索。 */
  dense: Schema.Boolean,
  hint: Schema.String,
}).annotate({ identifier: "KnowledgeEmbeddingStatus" })

export const CollectionTemplate = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  icon: Schema.String,
  hint: Schema.String,
  examples: Schema.Array(Schema.Struct({ query: Schema.String, hint: Schema.String })),
}).annotate({ identifier: "KnowledgeCollectionTemplate" })

export const KnowledgeOverview = Schema.Struct({
  collections: Schema.Number,
  enabled: Schema.Number,
  documents: Schema.Number,
  characters: Schema.Number,
  chunks: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "KnowledgeOverview" })

export const RecentQuery = Schema.Struct({
  query: Schema.String,
  at: Schema.Number,
  hits: Schema.Number,
}).annotate({ identifier: "KnowledgeRecentQuery" })

export const OcrInstallPayload = Schema.Struct({
  /** 重新安装：覆盖已有的内置运行环境。 */
  reinstall: Schema.optional(Schema.Boolean),
})

export const OcrInstallJob = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["running", "completed", "error", "cancelled"]),
  startedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
  phase: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  hint: Schema.optional(Schema.String),
  log: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "KnowledgeOcrInstallJob" })

export const CollectionStats = Schema.Struct({
  documents: Schema.Number,
  chunks: Schema.Number,
  characters: Schema.Number,
}).annotate({ identifier: "KnowledgeCollectionStats" })

export const EvalCase = Schema.Struct({
  id: Schema.String,
  query: Schema.String,
  expected: Schema.Array(Schema.String),
  notes: Schema.optional(Schema.String),
  createdAt: Schema.Number,
}).annotate({ identifier: "KnowledgeEvalCase" })

export const EvalCaseResult = Schema.Struct({
  id: Schema.String,
  query: Schema.String,
  expected: Schema.Array(Schema.String),
  hits: Schema.Array(Schema.String),
  rank: Schema.Number,
  reciprocalRank: Schema.Number,
  recall: Schema.Number,
  latencyMs: Schema.Number,
}).annotate({ identifier: "KnowledgeEvalCaseResult" })

export const EvalMetrics = Schema.Struct({
  cases: Schema.Number,
  k: Schema.Number,
  hitRate: Schema.Number,
  recall: Schema.Number,
  mrr: Schema.Number,
  avgLatencyMs: Schema.Number,
}).annotate({ identifier: "KnowledgeEvalMetrics" })

export const EvalRun = Schema.Struct({
  ranAt: Schema.Number,
  k: Schema.Number,
  metrics: EvalMetrics,
  results: Schema.Array(EvalCaseResult),
}).annotate({ identifier: "KnowledgeEvalRun" })

export const SaveEvalCasePayload = Schema.Struct({
  id: Schema.optional(Schema.String),
  query: Schema.String,
  expected: Schema.Array(Schema.String),
  notes: Schema.optional(Schema.String),
})

export const RunEvalPayload = Schema.Struct({
  k: Schema.optional(Schema.Number),
})

export const EvalHistoryEntry = Schema.Struct({
  id: Schema.String,
  ranAt: Schema.Number,
  k: Schema.Number,
  metrics: EvalMetrics,
  cases: Schema.Number,
  results: Schema.optional(
    Schema.Array(Schema.Struct({ id: Schema.String, query: Schema.String, rank: Schema.Number })),
  ),
}).annotate({ identifier: "KnowledgeEvalHistoryEntry" })

export const EvalDiffCase = Schema.Struct({
  id: Schema.String,
  query: Schema.String,
  before: Schema.optional(Schema.Number),
  after: Schema.optional(Schema.Number),
  status: Schema.Literals(["improved", "regressed", "still-hit", "still-miss", "new", "removed"]),
}).annotate({ identifier: "KnowledgeEvalDiffCase" })

export const EvalDiff = Schema.Struct({
  from: Schema.Struct({ id: Schema.String, ranAt: Schema.Number, k: Schema.Number }),
  to: Schema.Struct({ id: Schema.String, ranAt: Schema.Number, k: Schema.Number }),
  summary: Schema.Struct({
    improved: Schema.Number,
    regressed: Schema.Number,
    new: Schema.Number,
    removed: Schema.Number,
    unchanged: Schema.Number,
  }),
  cases: Schema.Array(EvalDiffCase),
}).annotate({ identifier: "KnowledgeEvalDiff" })

export const EvalReportQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  k: Schema.optional(Schema.NumberFromString),
})

export const EvalReport = Schema.Struct({
  markdown: Schema.String,
}).annotate({ identifier: "KnowledgeEvalReport" })

export const EvalDiffQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  from: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  k: Schema.optional(Schema.NumberFromString),
})

export const EvalHistory = Schema.Struct({
  runs: Schema.Array(EvalHistoryEntry),
}).annotate({ identifier: "KnowledgeEvalHistory" })

export const SuggestCasesPayload = Schema.Struct({
  /** true 时把建议直接写进用例列表（已存在的用例不会被覆盖）。 */
  apply: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Number),
})

export const SuggestedCase = Schema.Struct({
  query: Schema.String,
  expected: Schema.Array(Schema.String),
  reason: Schema.Literals(["title", "terms"]),
  terms: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "KnowledgeSuggestedCase" })

export const SuggestCasesResult = Schema.Struct({
  cases: Schema.Array(SuggestedCase),
  saved: Schema.Number,
}).annotate({ identifier: "KnowledgeSuggestCasesResult" })

export const SessionMountPayload = Schema.Struct({
  collectionIDs: Schema.Array(Schema.String),
})

export const GraphQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  collectionID: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
})

export const KnowledgeGraphNode = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  type: Schema.Literal("term"),
  documents: Schema.Number,
  weight: Schema.Number,
})

export const KnowledgeGraphEdge = Schema.Struct({
  source: Schema.String,
  target: Schema.String,
  weight: Schema.Number,
})

export const KnowledgeGraph = Schema.Struct({
  nodes: Schema.Array(KnowledgeGraphNode),
  edges: Schema.Array(KnowledgeGraphEdge),
}).annotate({ identifier: "KnowledgeGraph" })

export const DocumentListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  q: Schema.optional(Schema.String),
  sort: Schema.optional(Schema.Literals(["updated", "created", "title"])),
  limit: Schema.optional(Schema.NumberFromString),
  offset: Schema.optional(Schema.NumberFromString),
  searchContent: Schema.optional(QueryBoolean),
})

export const DocumentPage = Schema.Struct({
  total: Schema.Number,
  offset: Schema.Number,
  limit: Schema.Number,
  items: Schema.Array(KnowledgeDocumentMeta),
}).annotate({ identifier: "KnowledgeDocumentPage" })

export const BulkDocumentPayload = Schema.Struct({
  ids: Schema.Array(Schema.String),
})

export const BulkRemoveResult = Schema.Struct({
  removed: Schema.Array(Schema.String),
  missing: Schema.Array(Schema.String),
}).annotate({ identifier: "KnowledgeBulkRemoveResult" })

export const MoveDocumentsPayload = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  ids: Schema.Array(Schema.String),
})

export const BulkMoveResult = Schema.Struct({
  moved: Schema.Array(Schema.String),
  duplicates: Schema.Array(Schema.String),
  missing: Schema.Array(Schema.String),
}).annotate({ identifier: "KnowledgeBulkMoveResult" })

export const IntegrityIssue = Schema.Struct({
  kind: Schema.Literals(["orphan-sidecar", "bad-json", "duplicate-content", "missing-document"]),
  collectionID: Schema.String,
  documentID: Schema.optional(Schema.String),
  detail: Schema.String,
}).annotate({ identifier: "KnowledgeIntegrityIssue" })

export const IntegrityReport = Schema.Struct({
  collections: Schema.Number,
  documents: Schema.Number,
  issues: Schema.Array(IntegrityIssue),
}).annotate({ identifier: "KnowledgeIntegrityReport" })

export const LibraryDocument = Schema.Struct({
  title: Schema.String,
  source: Schema.optional(Schema.String),
  content: Schema.String,
  version: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export const LibraryExport = Schema.Struct({
  format: Schema.Literal("novaway.knowledge.library.v1"),
  exportedAt: Schema.Number,
  collections: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optional(Schema.String),
      enabled: Schema.optional(Schema.Boolean),
      documents: Schema.Array(LibraryDocument),
    }),
  ),
}).annotate({ identifier: "KnowledgeLibraryExport" })

export const LibraryImportResult = Schema.Struct({
  collections: Schema.Number,
  imported: Schema.Number,
  updated: Schema.Number,
  skipped: Schema.Number,
}).annotate({ identifier: "KnowledgeLibraryImportResult" })

export const DocumentChunk = Schema.Struct({
  index: Schema.Number,
  text: Schema.String,
  length: Schema.Number,
}).annotate({ identifier: "KnowledgeDocumentChunk" })

export const SearchQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  q: Schema.String,
  collectionID: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
})

export const KnowledgePaths = {
  collections: `${root}/collections`,
  overview: `${root}/overview`,
  queries: `${root}/collections/:collectionID/queries`,
  imports: `${root}/collections/:collectionID/imports`,
  importJob: `${root}/imports/:jobID`,
  templates: `${root}/templates`,
  collection: `${root}/collections/:collectionID`,
  documents: `${root}/collections/:collectionID/documents`,
  document: `${root}/collections/:collectionID/documents/:documentID`,
  documentsPage: `${root}/collections/:collectionID/documents/page`,
  documentsBulkRemove: `${root}/collections/:collectionID/documents/bulk-remove`,
  documentsMove: `${root}/documents/move`,
  trash: `${root}/collections/:collectionID/trash`,
  trashRestore: `${root}/collections/:collectionID/trash/:documentID/restore`,
  integrity: `${root}/integrity`,
  integrityRepair: `${root}/integrity/repair`,
  libraryExport: `${root}/library/export`,
  libraryImport: `${root}/library/import`,
  documentChunks: `${root}/collections/:collectionID/documents/:documentID/chunks`,
  search: `${root}/search`,
  upload: `${root}/collections/:collectionID/documents/upload`,
  import: `${root}/collections/:collectionID/import`,
  stats: `${root}/collections/:collectionID/stats`,
  reindex: `${root}/collections/:collectionID/reindex`,
  ocr: `${root}/ocr`,
  ocrInstall: `${root}/ocr/install`,
  ocrInstallJob: `${root}/ocr/install/:jobID`,
  embedding: `${root}/embedding`,
  export: `${root}/collections/:collectionID/export`,
  restore: `${root}/collections/:collectionID/restore`,
  related: `${root}/related`,
  session: `${root}/session/:sessionID`,
  eval: `${root}/collections/:collectionID/eval`,
  evalCase: `${root}/collections/:collectionID/eval/:caseID`,
  evalRun: `${root}/collections/:collectionID/eval/run`,
  evalSuggest: `${root}/collections/:collectionID/eval/suggest`,
  evalHistory: `${root}/collections/:collectionID/eval/history`,
  evalDiff: `${root}/collections/:collectionID/eval/diff`,
  evalReport: `${root}/collections/:collectionID/eval/report`,
  graph: `${root}/graph`,
} as const

export const KnowledgeApi = HttpApi.make("knowledge")
  .add(
    HttpApiGroup.make("knowledge")
      .add(
        HttpApiEndpoint.get("overview", KnowledgePaths.overview, {
          query: WorkspaceRoutingQuery,
          success: described(KnowledgeOverview, "Knowledge base overview"),
          error: [KnowledgeError],
        }),
        HttpApiEndpoint.get("recentQueries", KnowledgePaths.queries, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(RecentQuery), "Recent searches"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.delete("clearQueries", KnowledgePaths.queries, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Cleared"),
        }),
        HttpApiEndpoint.get("importJobs", KnowledgePaths.imports, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(ImportJob), "Import jobs of this collection"),
        }),
        HttpApiEndpoint.get("importJob", KnowledgePaths.importJob, {
          params: { jobID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.NullOr(ImportJob), "Import job"),
        }),
        HttpApiEndpoint.delete("cancelImportJob", KnowledgePaths.importJob, {
          params: { jobID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.NullOr(ImportJob), "Cancelled import job"),
        }),
        HttpApiEndpoint.get("documentsPage", KnowledgePaths.documentsPage, {
          params: { collectionID: Schema.String },
          query: DocumentListQuery,
          success: described(DocumentPage, "Document page"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.post("bulkRemoveDocuments", KnowledgePaths.documentsBulkRemove, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: BulkDocumentPayload,
          success: described(BulkRemoveResult, "Removed documents"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.get("listTrash", KnowledgePaths.trash, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(TrashItem), "Trashed documents"),
        }),
        HttpApiEndpoint.post("restoreTrash", KnowledgePaths.trashRestore, {
          params: { collectionID: Schema.String, documentID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.NullOr(KnowledgeDocument), "Restored document"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.delete("emptyTrash", KnowledgePaths.trash, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Struct({ removed: Schema.Number }), "Emptied trash"),
        }),
        HttpApiEndpoint.post("moveDocuments", KnowledgePaths.documentsMove, {
          query: WorkspaceRoutingQuery,
          payload: MoveDocumentsPayload,
          success: described(BulkMoveResult, "Moved documents"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.get("integrity", KnowledgePaths.integrity, {
          query: WorkspaceRoutingQuery,
          success: described(IntegrityReport, "Integrity report"),
          error: [KnowledgeError],
        }),
        HttpApiEndpoint.post("repairIntegrity", KnowledgePaths.integrityRepair, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Struct({ removed: Schema.Number }), "Repair result"),
          error: [KnowledgeError],
        }),
        HttpApiEndpoint.get("exportLibrary", KnowledgePaths.libraryExport, {
          query: WorkspaceRoutingQuery,
          success: described(LibraryExport, "Whole library export"),
          error: [KnowledgeError],
        }),
        HttpApiEndpoint.post("importLibrary", KnowledgePaths.libraryImport, {
          query: WorkspaceRoutingQuery,
          payload: LibraryExport,
          success: described(LibraryImportResult, "Library import summary"),
          error: [KnowledgeError],
        }),
        HttpApiEndpoint.get("documentChunks", KnowledgePaths.documentChunks, {
          params: { collectionID: Schema.String, documentID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(DocumentChunk), "Document chunks"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.get("templates", KnowledgePaths.templates, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(CollectionTemplate), "Collection templates"),
        }),
        HttpApiEndpoint.get("collections", KnowledgePaths.collections, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(KnowledgeCollection), "Knowledge collections"),
          error: KnowledgeError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.collections",
            summary: "List knowledge collections",
            description: "List local knowledge base collections with document counts.",
          }),
        ),
        HttpApiEndpoint.post("createCollection", KnowledgePaths.collections, {
          query: WorkspaceRoutingQuery,
          payload: CreateCollectionPayload,
          success: described(KnowledgeCollection, "Created collection"),
          error: KnowledgeError,
        }),
        HttpApiEndpoint.patch("updateCollection", KnowledgePaths.collection, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: UpdateCollectionPayload,
          success: described(KnowledgeCollection, "Updated collection"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.delete("removeCollection", KnowledgePaths.collection, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Collection removed"),
          error: KnowledgeError,
        }),
        HttpApiEndpoint.get("documents", KnowledgePaths.documents, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(KnowledgeDocumentMeta), "Documents in a collection"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.post("addDocument", KnowledgePaths.documents, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: AddDocumentPayload,
          success: described(KnowledgeDocument, "Created document"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.get("document", KnowledgePaths.document, {
          params: { collectionID: Schema.String, documentID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(KnowledgeDocument, "Document"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.patch("updateDocument", KnowledgePaths.document, {
          params: { collectionID: Schema.String, documentID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: UpdateDocumentPayload,
          success: described(KnowledgeDocument, "Updated document"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.delete("removeDocument", KnowledgePaths.document, {
          params: { collectionID: Schema.String, documentID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Document removed"),
          error: KnowledgeError,
        }),
        HttpApiEndpoint.post("uploadDocument", KnowledgePaths.upload, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: UploadDocumentPayload,
          success: described(KnowledgeDocument, "Extracted document"),
          error: [KnowledgeError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.upload",
            summary: "Upload and extract a document",
            description:
              "Upload a base64 file; the server extracts text from PDF, DOCX, PPTX, XLSX and plain text formats.",
          }),
        ),
        HttpApiEndpoint.post("importDocuments", KnowledgePaths.import, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: ImportPayload,
          success: described(ImportResult, "Import summary"),
          error: [KnowledgeError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.import",
            summary: "Batch import files",
            description: "Import up to 50 base64 files in one request and return a per-file summary.",
          }),
        ),
        HttpApiEndpoint.get("stats", KnowledgePaths.stats, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(CollectionStats, "Index stats"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.post("reindex", KnowledgePaths.reindex, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(CollectionStats, "Index stats"),
          error: [KnowledgeError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.reindex",
            summary: "Rebuild collection index",
            description: "Drop the in-memory index and cached embeddings so the next search rebuilds them.",
          }),
        ),
        HttpApiEndpoint.get("exportCollection", KnowledgePaths.export, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(CollectionExport, "Collection export"),
          error: [KnowledgeError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.export",
            summary: "Export a collection",
            description: "Export every document of a collection as JSON for backup or migration.",
          }),
        ),
        HttpApiEndpoint.post("restoreCollection", KnowledgePaths.restore, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: RestorePayload,
          success: described(RestoreResult, "Restore summary"),
          error: [KnowledgeError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.restore",
            summary: "Restore a collection",
            description: "Import documents from an exported backup; same source files update in place.",
          }),
        ),
        HttpApiEndpoint.get("related", KnowledgePaths.related, {
          query: RelatedQuery,
          success: described(Schema.Array(RelatedDocument), "Related documents"),
          error: [KnowledgeError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.related",
            summary: "Related documents",
            description: "Documents sharing entities with the given document.",
          }),
        ),
        HttpApiEndpoint.get("ocr", KnowledgePaths.ocr, {
          query: WorkspaceRoutingQuery,
          success: described(OcrStatus, "OCR backend status"),
        }),
        HttpApiEndpoint.post("installOcr", KnowledgePaths.ocrInstall, {
          query: WorkspaceRoutingQuery,
          payload: OcrInstallPayload,
          success: described(Schema.Struct({ jobID: Schema.String }), "OCR install job"),
          error: [KnowledgeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.ocr.install",
            summary: "Install RapidOCR",
            description:
              "Install RapidOCR into an isolated venv under the NovaWay data directory. Runs in the background; poll the job for progress.",
          }),
        ),
        HttpApiEndpoint.get("ocrInstallJob", KnowledgePaths.ocrInstallJob, {
          params: { jobID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.NullOr(OcrInstallJob), "OCR install job"),
          error: [KnowledgeError],
        }),
        HttpApiEndpoint.delete("cancelOcrInstall", KnowledgePaths.ocrInstallJob, {
          params: { jobID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.NullOr(OcrInstallJob), "Cancelled OCR install job"),
        }),
        HttpApiEndpoint.get("embedding", KnowledgePaths.embedding, {
          query: WorkspaceRoutingQuery,
          success: described(KnowledgeEmbeddingStatus, "Embedding backend status"),
        }),
        HttpApiEndpoint.get("listEvalCases", KnowledgePaths.eval, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(EvalCase), "Eval cases"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.put("saveEvalCase", KnowledgePaths.eval, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: SaveEvalCasePayload,
          success: described(EvalCase, "Saved eval case"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.delete("removeEvalCase", KnowledgePaths.evalCase, {
          params: { collectionID: Schema.String, caseID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Removed"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.post("runEval", KnowledgePaths.evalRun, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: RunEvalPayload,
          success: described(EvalRun, "Eval run"),
          error: [KnowledgeError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.eval.run",
            summary: "Run retrieval evaluation",
            description: "Score every saved case against the current retrieval pipeline.",
          }),
        ),
        HttpApiEndpoint.post("suggestEvalCases", KnowledgePaths.evalSuggest, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: SuggestCasesPayload,
          success: described(SuggestCasesResult, "Suggested eval cases"),
          error: [KnowledgeError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.eval.suggest",
            summary: "Suggest retrieval eval cases",
            description:
              "Generate baseline cases from the collection documents (title or distinctive terms). Apply them to seed the eval list.",
          }),
        ),
        HttpApiEndpoint.get("evalHistory", KnowledgePaths.evalHistory, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(EvalHistory, "Evaluation history"),
          error: [KnowledgeError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.eval.history",
            summary: "Evaluation history",
            description: "Recent evaluation runs, oldest first. Compare runs to see whether retrieval changes helped.",
          }),
        ),
        HttpApiEndpoint.get("evalDiff", KnowledgePaths.evalDiff, {
          params: { collectionID: Schema.String },
          query: EvalDiffQuery,
          success: described(Schema.NullOr(EvalDiff), "Case-level differences between two runs"),
          error: [KnowledgeError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.eval.diff",
            summary: "Compare two evaluation runs",
            description:
              "Case-level diff. Defaults to the two most recent runs with the same k; pass from/to run ids to compare specific runs.",
          }),
        ),
        HttpApiEndpoint.get("evalReport", KnowledgePaths.evalReport, {
          params: { collectionID: Schema.String },
          query: EvalReportQuery,
          success: described(EvalReport, "Markdown evaluation report"),
          error: [KnowledgeError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.eval.report",
            summary: "Export evaluation report",
            description: "Markdown report with metrics, trend, case-level changes and per-case ranks.",
          }),
        ),
        HttpApiEndpoint.delete("clearEvalHistory", KnowledgePaths.evalHistory, {
          params: { collectionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Cleared"),
          error: [KnowledgeError, ApiNotFoundError],
        }),
        HttpApiEndpoint.get("sessionMount", KnowledgePaths.session, {
          params: { sessionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Schema.String), "Mounted collection ids"),
          error: [KnowledgeError],
        }),
        HttpApiEndpoint.put("setSessionMount", KnowledgePaths.session, {
          params: { sessionID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: SessionMountPayload,
          success: described(Schema.Array(Schema.String), "Mounted collection ids"),
          error: KnowledgeError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.session.mount",
            summary: "Mount collections to a session",
            description: "Restrict a session knowledge search to the given collections. Empty clears the mount.",
          }),
        ),
        HttpApiEndpoint.get("graph", KnowledgePaths.graph, {
          query: GraphQuery,
          success: described(KnowledgeGraph, "Knowledge graph"),
          error: [KnowledgeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.graph",
            summary: "Knowledge graph",
            description: "Entity co-occurrence graph across collections.",
          }),
        ),
        HttpApiEndpoint.get("search", KnowledgePaths.search, {
          query: SearchQuery,
          success: described(Schema.Array(KnowledgeHit), "Knowledge search hits"),
          error: KnowledgeError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "knowledge.search",
            summary: "Search the knowledge base",
            description:
              "Keyword search across local knowledge base documents. Omit collectionID to search all collections.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "knowledge", description: "Local knowledge base routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(OpenApi.annotations({ title: "Knowledge", version: "0.0.1" }))

export * as KnowledgeGroup from "./knowledge"
