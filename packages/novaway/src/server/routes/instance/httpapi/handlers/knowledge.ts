import { BackgroundJob } from "@/background/job"
import { KnowledgeStore } from "@/knowledge"
import { Identifier } from "@/id/id"
import { ConfigMemory } from "@/config/memory"
import { resolveEmbedder } from "@/memory/embedder"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Auth } from "@/auth"
import { generateText } from "ai"
import { detectOcr, resetOcrDetection } from "@/knowledge/ocr"
import { installRapidOcr } from "@/knowledge/ocr-install"
import {
  appendHistory,
  clearHistory,
  diffRuns,
  listCases,
  listHistory,
  removeCase,
  renderReport,
  runEval,
  saveCase,
} from "@/knowledge/eval"
import { parseGraphJson } from "@/knowledge/graph-llm"
import { suggestCases } from "@/knowledge/suggest"
import { COLLECTION_TEMPLATES, findTemplate } from "@/knowledge/templates"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { notFound } from "../errors"
import {
  AddDocumentPayload,
  BulkDocumentPayload,
  CreateCollectionPayload,
  DocumentListQuery,
  LibraryExport,
  MoveDocumentsPayload,
  GraphQuery,
  ImportPayload,
  OcrInstallPayload,
  TrashItem,
  EvalDiffQuery,
  EvalReportQuery,
  RelatedQuery,
  RestorePayload,
  RunEvalPayload,
  SaveEvalCasePayload,
  SuggestCasesPayload,
  knowledgeError,
  SearchQuery,
  SessionMountPayload,
  UpdateCollectionPayload,
  UpdateDocumentPayload,
  UploadDocumentPayload,
} from "../groups/knowledge"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const knowledgeHandlers = HttpApiBuilder.group(InstanceHttpApi, "knowledge", (handlers) =>
  Effect.gen(function* () {
    // 项目作用域：project 级集合只在本项目可见，global 级对所有项目可见。
    const backgroundSvc = yield* BackgroundJob.Service

    const projectID = Effect.fnUntraced(function* () {
      return (yield* InstanceState.context).project.id
    })

    const templates = Effect.fn("KnowledgeHttpApi.templates")(function* () {
      return COLLECTION_TEMPLATES.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        icon: item.icon,
        hint: item.hint,
        examples: item.examples,
      }))
    })

    const overview = Effect.fn("KnowledgeHttpApi.overview")(function* () {
      const project = yield* projectID()
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.overview(undefined, { projectID: project }),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const recentQueries = Effect.fn("KnowledgeHttpApi.recentQueries")(function* (ctx: {
      params: { collectionID: string }
    }) {
      return yield* Effect.promise(() => KnowledgeStore.recentQueries(ctx.params.collectionID))
    })

    const clearQueries = Effect.fn("KnowledgeHttpApi.clearQueries")(function* (ctx: {
      params: { collectionID: string }
    }) {
      yield* Effect.promise(() => KnowledgeStore.clearQueries(ctx.params.collectionID))
      return true
    })

    const collections = Effect.fn("KnowledgeHttpApi.collections")(function* () {
      const project = yield* projectID()
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.listCollections(undefined, { projectID: project }),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const createCollection = Effect.fn("KnowledgeHttpApi.createCollection")(function* (ctx: {
      payload: typeof CreateCollectionPayload.Type
    }) {
      const project = yield* projectID()
      const created = yield* Effect.tryPromise({
        try: () =>
          KnowledgeStore.createCollection({
            name: ctx.payload.name,
            description: ctx.payload.description,
            scope: ctx.payload.scope,
            readOnly: ctx.payload.readOnly,
            projectID: project,
          }),
        catch: (error) => knowledgeError(message(error)),
      })
      // 模板只影响描述建议；示例用例在文档导入后由「生成用例」补齐。
      const template = findTemplate(ctx.payload.template)
      let result = created
      if (template) {
        if (!created.description) {
          const withHint = yield* Effect.promise(() =>
            KnowledgeStore.updateCollection(created.id, { description: template.hint }),
          )
          if (withHint) result = withHint
        }
        // 附带示例文档：让用户导入后立刻能搜到东西，而不是面对空集合。
        if (ctx.payload.sample) {
          yield* Effect.promise(() =>
            KnowledgeStore.addDocument(created.id, {
              title: template.sample.title,
              content: template.sample.content,
              source: "sample.md",
            }),
          ).pipe(Effect.ignore)
          return { ...result, documentCount: 1 }
        }
      }
      return { ...result, documentCount: 0 }
    })

    const updateCollection = Effect.fn("KnowledgeHttpApi.updateCollection")(function* (ctx: {
      params: { collectionID: string }
      payload: typeof UpdateCollectionPayload.Type
    }) {
      const result = yield* Effect.tryPromise({
        try: () => KnowledgeStore.updateCollection(ctx.params.collectionID, ctx.payload),
        catch: (error) => knowledgeError(message(error)),
      })
      if (!result) return yield* notFound("Collection not found")
      const documents = yield* Effect.promise(() => KnowledgeStore.listDocuments(ctx.params.collectionID))
      return { ...result, documentCount: documents.length }
    })

    const removeCollection = Effect.fn("KnowledgeHttpApi.removeCollection")(function* (ctx: {
      params: { collectionID: string }
    }) {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.removeCollection(ctx.params.collectionID),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const documentsPage = Effect.fn("KnowledgeHttpApi.documentsPage")(function* (ctx: {
      params: { collectionID: string }
      query: typeof DocumentListQuery.Type
    }) {
      return yield* Effect.tryPromise({
        try: () =>
          KnowledgeStore.listDocumentsPage(ctx.params.collectionID, {
            q: ctx.query.q,
            sort: ctx.query.sort,
            limit: ctx.query.limit,
            offset: ctx.query.offset,
            searchContent: ctx.query.searchContent === true,
          }),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const bulkRemoveDocuments = Effect.fn("KnowledgeHttpApi.bulkRemoveDocuments")(function* (ctx: {
      params: { collectionID: string }
      payload: typeof BulkDocumentPayload.Type
    }) {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.removeDocuments(ctx.params.collectionID, Array.from(ctx.payload.ids)),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const listTrash = Effect.fn("KnowledgeHttpApi.listTrash")(function* (ctx: { params: { collectionID: string } }) {
      const items = yield* Effect.promise(() => KnowledgeStore.listTrash(ctx.params.collectionID))
      // 只回传 schema 声明的字段：store 里还带 hash 等内部字段。
      return items.map((item) => ({
        deletedAt: item.deletedAt,
        document: {
          id: item.document.id,
          collectionID: item.document.collectionID,
          title: item.document.title,
          ...(item.document.source ? { source: item.document.source } : {}),
          ...(item.document.version !== undefined ? { version: item.document.version } : {}),
          content: item.document.content,
          createdAt: item.document.createdAt,
          updatedAt: item.document.updatedAt,
        },
      }))
    })

    const restoreTrash = Effect.fn("KnowledgeHttpApi.restoreTrash")(function* (ctx: {
      params: { collectionID: string; documentID: string }
    }) {
      const document = yield* Effect.tryPromise({
        try: () => KnowledgeStore.restoreDocument(ctx.params.collectionID, ctx.params.documentID),
        catch: (error) => knowledgeError(message(error)),
      })
      if (!document) return yield* notFound("Trashed document not found")
      return document
    })

    const emptyTrash = Effect.fn("KnowledgeHttpApi.emptyTrash")(function* (ctx: { params: { collectionID: string } }) {
      const removed = yield* Effect.promise(() => KnowledgeStore.emptyTrash(ctx.params.collectionID))
      return { removed }
    })

    const moveDocuments = Effect.fn("KnowledgeHttpApi.moveDocuments")(function* (ctx: {
      payload: typeof MoveDocumentsPayload.Type
    }) {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.moveDocuments(ctx.payload.from, ctx.payload.to, Array.from(ctx.payload.ids)),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const integrity = Effect.fn("KnowledgeHttpApi.integrity")(function* () {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.integrity(),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const repairIntegrity = Effect.fn("KnowledgeHttpApi.repairIntegrity")(function* () {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.repair(),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const exportLibrary = Effect.fn("KnowledgeHttpApi.exportLibrary")(function* () {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.exportLibrary(),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const importLibrary = Effect.fn("KnowledgeHttpApi.importLibrary")(function* (ctx: {
      payload: typeof LibraryExport.Type
    }) {
      return yield* Effect.tryPromise({
        try: () =>
          KnowledgeStore.importLibrary({
            format: "novaway.knowledge.library.v1",
            exportedAt: ctx.payload.exportedAt,
            collections: ctx.payload.collections.map((collection) => ({
              name: collection.name,
              description: collection.description,
              enabled: collection.enabled,
              documents: collection.documents.map((document) => ({
                title: document.title,
                source: document.source,
                content: document.content,
                version: document.version,
                createdAt: document.createdAt,
                updatedAt: document.updatedAt,
              })),
            })),
          }),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const documentChunks = Effect.fn("KnowledgeHttpApi.documentChunks")(function* (ctx: {
      params: { collectionID: string; documentID: string }
    }) {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.documentChunks(ctx.params.collectionID, ctx.params.documentID),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const documents = Effect.fn("KnowledgeHttpApi.documents")(function* (ctx: { params: { collectionID: string } }) {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.listDocuments(ctx.params.collectionID),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const addDocument = Effect.fn("KnowledgeHttpApi.addDocument")(function* (ctx: {
      params: { collectionID: string }
      payload: typeof AddDocumentPayload.Type
    }) {
      const result = yield* Effect.tryPromise({
        try: () => KnowledgeStore.addDocument(ctx.params.collectionID, ctx.payload),
        catch: (error) => knowledgeError(message(error)),
      })
      return result.document
    })

    const uploadDocument = Effect.fn("KnowledgeHttpApi.uploadDocument")(function* (ctx: {
      params: { collectionID: string }
      payload: typeof UploadDocumentPayload.Type
    }) {
      const visionFn = yield* vision()
      const graphFn = yield* llmGraph()
      const data = Buffer.from(ctx.payload.data, "base64")
      if (data.byteLength === 0) return yield* knowledgeError("File is empty")
      if (data.byteLength > 8 * 1024 * 1024) return yield* knowledgeError("File is too large (max 8MB)")
      const result = yield* Effect.tryPromise({
        try: () =>
          KnowledgeStore.addDocumentFromFile(ctx.params.collectionID, {
            name: ctx.payload.name,
            data,
            vision: visionFn,
            extractGraph: graphFn,
          }),
        catch: (error) => knowledgeError(message(error)),
      })
      if (!result.document) return yield* knowledgeError(result.warning ?? "No text extracted from the file")
      return result.document
    })

    const importDocuments = Effect.fn("KnowledgeHttpApi.importDocuments")(function* (ctx: {
      params: { collectionID: string }
      payload: typeof ImportPayload.Type
    }) {
      const visionFn = yield* vision()
      const graphFn = yield* llmGraph()
      if (ctx.payload.files.length === 0) {
        return { imported: 0, updated: 0, duplicates: 0, failed: [] }
      }
      if (ctx.payload.files.length > 50) return yield* knowledgeError("一次最多导入 50 个文件")

      const collectionID = ctx.params.collectionID
      const files = ctx.payload.files.map((file) => ({ name: file.name, data: Buffer.from(file.data, "base64") }))
      const total = files.reduce((sum, file) => sum + file.data.byteLength, 0)
      if (total > 64 * 1024 * 1024) return yield* knowledgeError("本次导入总大小超过 64MB")

      // 逐文件导入，并在每一步写回进度；后台模式与同步模式共用这段逻辑。
      const runImport = Effect.fnUntraced(function* (jobID: string | undefined) {
        let imported = 0
        let updated = 0
        let duplicates = 0
        const failed: Array<{ name: string; error: string }> = []
        for (const [index, file] of files.entries()) {
          if (jobID) {
            yield* backgroundSvc
              .update(jobID, {
                output: index + "/" + files.length + " " + file.name,
                metadata: {
                  total: files.length,
                  processed: index,
                  imported,
                  updated,
                  duplicates,
                  failed: failed.length,
                  current: file.name,
                },
              })
              .pipe(Effect.ignore)
          }
          try {
            const result = yield* Effect.promise(() =>
              KnowledgeStore.addDocumentFromFile(collectionID, {
                name: file.name,
                data: file.data,
                vision: visionFn,
                extractGraph: graphFn,
              }),
            )
            if (!result.document) {
              failed.push({ name: file.name, error: result.warning ?? "没有提取到文本" })
              continue
            }
            if (result.duplicate) duplicates++
            else if (result.updated) updated++
            else imported++
          } catch (error) {
            failed.push({ name: file.name, error: message(error) })
          }
        }
        if (jobID) {
          yield* backgroundSvc
            .update(jobID, {
              output: files.length + "/" + files.length,
              metadata: {
                total: files.length,
                processed: files.length,
                imported,
                updated,
                duplicates,
                failed: failed.length,
              },
            })
            .pipe(Effect.ignore)
        }
        return { imported, updated, duplicates, failed }
      })

      if (!ctx.payload.background) return yield* runImport(undefined)

      const jobID = Identifier.ascending("job")
      const started = yield* backgroundSvc.start({
        id: jobID,
        type: "knowledge.import",
        title: "导入知识库",
        metadata: {
          collectionID,
          total: files.length,
          processed: 0,
          imported: 0,
          updated: 0,
          duplicates: 0,
          failed: 0,
        },
        run: runImport(jobID).pipe(
          Effect.map(
            (result) =>
              "imported=" +
              result.imported +
              " updated=" +
              result.updated +
              " duplicates=" +
              result.duplicates +
              " failed=" +
              result.failed.length,
          ),
        ),
      })
      return { imported: 0, updated: 0, duplicates: 0, failed: [], jobID: started.id }
    })

    // 导入任务视图：把后台 job 的 metadata 摊平成 UI 直接可用的进度结构。
    const jobView = (job: {
      id: string
      status: string
      title?: string
      started_at: number
      completed_at?: number
      error?: string
      metadata?: Record<string, unknown>
    }) => {
      const metadata = job.metadata ?? {}
      return {
        id: job.id,
        status: job.status as "running" | "completed" | "error" | "cancelled",
        ...(job.title ? { title: job.title } : {}),
        startedAt: job.started_at,
        ...(job.completed_at !== undefined ? { completedAt: job.completed_at } : {}),
        ...(job.error ? { error: job.error } : {}),
        progress: {
          total: Number(metadata.total ?? 0),
          processed: Number(metadata.processed ?? 0),
          imported: Number(metadata.imported ?? 0),
          updated: Number(metadata.updated ?? 0),
          duplicates: Number(metadata.duplicates ?? 0),
          failed: Number(metadata.failed ?? 0),
          ...(typeof metadata.current === "string" ? { current: metadata.current } : {}),
        },
      }
    }

    const importJobs = Effect.fn("KnowledgeHttpApi.importJobs")(function* (ctx: { params: { collectionID: string } }) {
      const jobs = yield* backgroundSvc.list()
      return jobs
        .filter((job) => job.metadata?.collectionID === ctx.params.collectionID)
        .map(jobView)
        .toReversed()
    })

    const importJob = Effect.fn("KnowledgeHttpApi.importJob")(function* (ctx: { params: { jobID: string } }) {
      const job = yield* backgroundSvc.get(ctx.params.jobID)
      return job ? jobView(job) : null
    })

    const cancelImportJob = Effect.fn("KnowledgeHttpApi.cancelImportJob")(function* (ctx: {
      params: { jobID: string }
    }) {
      const job = yield* backgroundSvc.cancel(ctx.params.jobID)
      return job ? jobView(job) : null
    })

    const stats = Effect.fn("KnowledgeHttpApi.stats")(function* (ctx: { params: { collectionID: string } }) {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.stats(ctx.params.collectionID),
        catch: (error) => knowledgeError(message(error)),
      })
    })
    const reindex = Effect.fn("KnowledgeHttpApi.reindex")(function* (ctx: { params: { collectionID: string } }) {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.reindex(ctx.params.collectionID),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const exportCollection = Effect.fn("KnowledgeHttpApi.exportCollection")(function* (ctx: {
      params: { collectionID: string }
    }) {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.exportCollection(ctx.params.collectionID),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const restoreCollection = Effect.fn("KnowledgeHttpApi.restoreCollection")(function* (ctx: {
      params: { collectionID: string }
      payload: typeof RestorePayload.Type
    }) {
      return yield* Effect.tryPromise({
        try: () =>
          KnowledgeStore.restoreCollection(ctx.params.collectionID, {
            documents: ctx.payload.documents.map((document) => ({
              title: document.title,
              source: document.source,
              content: document.content,
            })),
            signature: ctx.payload.signature,
          }),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const related = Effect.fn("KnowledgeHttpApi.related")(function* (ctx: { query: typeof RelatedQuery.Type }) {
      return yield* Effect.tryPromise({
        try: () =>
          KnowledgeStore.related({
            collectionID: ctx.query.collectionID,
            documentID: ctx.query.documentID,
            limit: ctx.query.limit,
          }),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    // 视觉 OCR 兜底：本机没有 tesseract 时，用支持图片输入的多模态模型转写。
    const provider = yield* Provider.Service
    const config = yield* Config.Service
    const auth = yield* Auth.Service

    const visionModel = Effect.fnUntraced(function* () {
      const cfg = yield* config.get()
      const providers = yield* provider.list()
      // 1) 配置里显式指定的默认模型（优先）
      const configured = typeof cfg.model === "string" ? cfg.model.split("/") : []
      if (configured[0] && configured[1]) {
        const info = providers[configured[0] as keyof typeof providers]
        const model = info?.models?.[configured[1]]
        if (model?.capabilities?.input?.image) {
          return { providerID: configured[0], modelID: configured[1] }
        }
      }
      // 2) 任一已连接且支持图片输入的模型
      for (const [providerID, info] of Object.entries(providers)) {
        if (!info?.models) continue
        for (const [modelID, model] of Object.entries(info.models)) {
          if (model?.capabilities?.input?.image) return { providerID, modelID }
        }
      }
    })

    const vision = Effect.fnUntraced(function* () {
      const target = yield* visionModel()
      if (!target) return undefined
      return (input: { data: Buffer; mimeType: string }) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = yield* provider.getModel(target.providerID as never, target.modelID as never)
            const language = yield* provider.getLanguage(model)
            const info = yield* provider.getProvider(target.providerID as never)
            yield* auth.get(target.providerID as never).pipe(Effect.catch(() => Effect.succeed(undefined)))
            const options = ProviderTransform.options({
              model,
              providerOptions: info?.options,
              sessionID: "knowledge-ocr",
            })
            const result = yield* Effect.promise(() =>
              generateText({
                model: language,
                temperature: 0,
                maxOutputTokens: 4096,
                providerOptions: ProviderTransform.providerOptions(model, options),
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text:
                          "Transcribe every piece of text visible in this image. " +
                          "Preserve reading order and line breaks. " +
                          "If it is a table, keep rows on separate lines and separate cells with a tab. " +
                          "Output only the transcribed text, with no commentary.",
                      },
                      { type: "image", image: input.data, mediaType: input.mimeType },
                    ],
                  },
                ],
              }),
            )
            return (result.text ?? "").trim()
          }),
        )
    })

    const embedding = Effect.fn("KnowledgeHttpApi.embedding")(function* () {
      const cfg = yield* config.get()
      const resolved = yield* Effect.promise(() => resolveEmbedder(ConfigMemory.resolve(cfg.memory)))
      const dense = typeof resolved.embed === "function"
      const hint =
        resolved.kind === "ollama"
          ? "本地 Ollama 向量模型已启用，检索会同时使用语义相似度。"
          : resolved.kind === "provider"
            ? "云端向量模型已启用。"
            : cfg.memory?.embedding_mode === "off"
              ? "向量检索已关闭，仅使用关键词与本地语义。"
              : "未检测到向量模型：可在「设置 → 记忆与进化」一键安装 Ollama 的 embedding 模型，启用后检索质量会明显提升。"
      return {
        kind: resolved.kind as "local" | "provider" | "ollama" | "off",
        label: resolved.label,
        modelId: resolved.modelId,
        dense,
        hint,
      }
    })

    // LLM 图谱抽取（可选）：默认关闭，NOVAWAY_KNOWLEDGE_LLM_GRAPH=1 时在导入后抽取关系。
    const graphEnabled = () =>
      ["1", "true", "yes"].includes((process.env.NOVAWAY_KNOWLEDGE_LLM_GRAPH ?? "").toLowerCase())

    const anyModel = Effect.fnUntraced(function* () {
      const providers = yield* provider.list()
      const cfg = yield* config.get()
      const configured = typeof cfg.model === "string" ? cfg.model.split("/") : []
      if (
        configured[0] &&
        configured[1] &&
        providers[configured[0] as keyof typeof providers]?.models?.[configured[1]]
      ) {
        return { providerID: configured[0], modelID: configured[1] }
      }
      for (const [providerID, info] of Object.entries(providers)) {
        const modelID = info?.models ? Object.keys(info.models)[0] : undefined
        if (modelID) return { providerID, modelID }
      }
    })

    const llmGraph = Effect.fnUntraced(function* () {
      if (!graphEnabled()) return undefined
      const target = yield* anyModel()
      if (!target) return undefined
      return (input: { title: string; content: string }) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = yield* provider.getModel(target.providerID as never, target.modelID as never)
            const language = yield* provider.getLanguage(model)
            const info = yield* provider.getProvider(target.providerID as never)
            yield* auth.get(target.providerID as never).pipe(Effect.catch(() => Effect.succeed(undefined)))
            const options = ProviderTransform.options({
              model,
              providerOptions: info?.options,
              sessionID: "knowledge-graph",
            })
            const result = yield* Effect.promise(() =>
              generateText({
                model: language,
                temperature: 0,
                maxOutputTokens: 2048,
                providerOptions: ProviderTransform.providerOptions(model, options),
                system: [
                  "Extract a knowledge graph from the document.",
                  'Return ONLY JSON: {"entities":[{"name":"..."}],"relations":[{"source":"...","target":"...","relation":"..."}]}',
                  "Entities must be concrete nouns, systems, products, teams, people or processes.",
                  "Relations must connect two entities that appear in the entity list.",
                  "Prefer 5-30 entities and at most 40 relations. No commentary.",
                ].join(" "),
                messages: [
                  {
                    role: "user",
                    content: "Title: " + input.title + String.fromCharCode(10, 10) + input.content.slice(0, 12_000),
                  },
                ],
              }),
            )
            return parseGraphJson(result.text ?? "")
          }),
        )
    })

    const ocrJobView = (job: {
      id: string
      status: string
      started_at: number
      completed_at?: number
      error?: string
      metadata?: Record<string, unknown>
    }) => {
      const metadata = job.metadata ?? {}
      return {
        id: job.id,
        status: job.status as "running" | "completed" | "error" | "cancelled",
        startedAt: job.started_at,
        ...(job.completed_at !== undefined ? { completedAt: job.completed_at } : {}),
        ...(typeof metadata.phase === "string" ? { phase: metadata.phase } : {}),
        ...(typeof metadata.message === "string" ? { message: metadata.message } : {}),
        ...(typeof metadata.hint === "string" && metadata.hint ? { hint: metadata.hint } : {}),
        ...(typeof metadata.log === "string" && metadata.log ? { log: metadata.log } : {}),
        ...(job.error ? { error: job.error } : {}),
      }
    }

    // 一键安装：装进独立 venv，用户不需要碰系统 Python。
    const installOcr = Effect.fn("KnowledgeHttpApi.installOcr")(function* (ctx: {
      payload: typeof OcrInstallPayload.Type
    }) {
      const running = (yield* backgroundSvc.list()).find(
        (job) => job.type === "knowledge.ocr.install" && job.status === "running",
      )
      if (running) return { jobID: running.id }

      const jobID = Identifier.ascending("job")
      const controller = new AbortController()
      const info = yield* backgroundSvc.start({
        id: jobID,
        type: "knowledge.ocr.install",
        title: "安装 RapidOCR",
        metadata: { target: "ocr", phase: "detect", message: "正在准备安装" },
        cancel: Effect.sync(() => controller.abort()),
        run: Effect.gen(function* () {
          // 每次进度变化都写回 job，UI 轮询即可看到阶段与日志。
          const report = (phase: string, message: string, log?: string, hint?: string) => {
            void Effect.runPromise(
              backgroundSvc.update(jobID, {
                metadata: {
                  target: "ocr",
                  phase,
                  message,
                  ...(log !== undefined ? { log } : {}),
                  ...(hint ? { hint } : {}),
                },
              }),
            ).catch(() => undefined)
          }

          const result = yield* Effect.promise(() =>
            installRapidOcr({
              signal: controller.signal,
              reinstall: ctx.payload.reinstall === true,
              onProgress: (event) => report(event.phase, event.message, event.log),
            }),
          )

          if (!result.ok) {
            // 失败信息要等写回完成再结束 job，否则 update 会因为 job 已结束而被丢弃。
            yield* backgroundSvc
              .update(jobID, {
                metadata: {
                  target: "ocr",
                  phase: "error",
                  message: result.error ?? "安装失败",
                  ...(result.hint ? { hint: result.hint } : {}),
                },
              })
              .pipe(Effect.ignore)
            return yield* Effect.fail(new Error(result.error ?? "安装失败"))
          }

          // 清掉探测缓存，状态接口立刻变成 rapid。
          resetOcrDetection()
          yield* backgroundSvc
            .update(jobID, { metadata: { target: "ocr", phase: "done", message: "RapidOCR 已可用" } })
            .pipe(Effect.ignore)
          return "installed " + (result.python ?? "")
        }),
      })
      return { jobID: info.id }
    })

    const ocrInstallJob = Effect.fn("KnowledgeHttpApi.ocrInstallJob")(function* (ctx: { params: { jobID: string } }) {
      const job = yield* backgroundSvc.get(ctx.params.jobID)
      return job ? ocrJobView(job) : null
    })

    const cancelOcrInstall = Effect.fn("KnowledgeHttpApi.cancelOcrInstall")(function* (ctx: {
      params: { jobID: string }
    }) {
      const job = yield* backgroundSvc.cancel(ctx.params.jobID)
      return job ? ocrJobView(job) : null
    })

    const ocr = Effect.fn("KnowledgeHttpApi.ocr")(function* () {
      const backend = yield* Effect.promise(() => detectOcr())
      const visionTarget = yield* visionModel()
      const kind: "rapid" | "cli" | "wasm" | "vision" | "none" =
        backend.kind === "none" && visionTarget ? "vision" : backend.kind
      const label = kind === "vision" ? "视觉模型 (" + visionTarget!.modelID + ")" : backend.label
      const hint =
        kind === "none"
          ? "点击知识库右上角的「未配置 OCR」即可一键安装 RapidOCR（自带中英文模型，自动准备运行环境）。"
          : kind === "vision"
            ? "没有本地 OCR，图片与扫描件会交给支持视觉的模型转写。"
            : "扫描件与图片会先用 RapidOCR / tesseract 识别，再把文本写入知识库。"
      return { kind, label, languages: backend.languages, hint }
    })

    const sessionMount = Effect.fn("KnowledgeHttpApi.sessionMount")(function* (ctx: { params: { sessionID: string } }) {
      return yield* Effect.promise(() => KnowledgeStore.getSessionCollections(ctx.params.sessionID))
    })

    const setSessionMount = Effect.fn("KnowledgeHttpApi.setSessionMount")(function* (ctx: {
      params: { sessionID: string }
      payload: typeof SessionMountPayload.Type
    }) {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.setSessionCollections(ctx.params.sessionID, Array.from(ctx.payload.collectionIDs)),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const graph = Effect.fn("KnowledgeHttpApi.graph")(function* (ctx: { query: typeof GraphQuery.Type }) {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.graph({ collectionID: ctx.query.collectionID, limit: ctx.query.limit }),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const document = Effect.fn("KnowledgeHttpApi.document")(function* (ctx: {
      params: { collectionID: string; documentID: string }
    }) {
      const result = yield* Effect.tryPromise({
        try: () => KnowledgeStore.getDocument(ctx.params.collectionID, ctx.params.documentID),
        catch: (error) => knowledgeError(message(error)),
      })
      if (!result) return yield* notFound("Document not found")
      return result
    })

    const updateDocument = Effect.fn("KnowledgeHttpApi.updateDocument")(function* (ctx: {
      params: { collectionID: string; documentID: string }
      payload: typeof UpdateDocumentPayload.Type
    }) {
      const result = yield* Effect.tryPromise({
        try: () => KnowledgeStore.updateDocument(ctx.params.collectionID, ctx.params.documentID, ctx.payload),
        catch: (error) => knowledgeError(message(error)),
      })
      if (!result) return yield* notFound("Document not found")
      return result
    })

    const removeDocument = Effect.fn("KnowledgeHttpApi.removeDocument")(function* (ctx: {
      params: { collectionID: string; documentID: string }
    }) {
      return yield* Effect.tryPromise({
        try: () => KnowledgeStore.removeDocument(ctx.params.collectionID, ctx.params.documentID),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const listEvalCases = Effect.fn("KnowledgeHttpApi.listEvalCases")(function* (ctx: {
      params: { collectionID: string }
    }) {
      return yield* Effect.tryPromise({
        try: () => listCases(ctx.params.collectionID),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const saveEvalCase = Effect.fn("KnowledgeHttpApi.saveEvalCase")(function* (ctx: {
      params: { collectionID: string }
      payload: typeof SaveEvalCasePayload.Type
    }) {
      return yield* Effect.tryPromise({
        try: () =>
          saveCase(ctx.params.collectionID, {
            ...ctx.payload,
            expected: Array.from(ctx.payload.expected),
          }),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const removeEvalCase = Effect.fn("KnowledgeHttpApi.removeEvalCase")(function* (ctx: {
      params: { collectionID: string; caseID: string }
    }) {
      return yield* Effect.tryPromise({
        try: () => removeCase(ctx.params.collectionID, ctx.params.caseID),
        catch: (error) => knowledgeError(message(error)),
      })
    })

    const suggestEvalCases = Effect.fn("KnowledgeHttpApi.suggestEvalCases")(function* (ctx: {
      params: { collectionID: string }
      payload: typeof SuggestCasesPayload.Type
    }) {
      const documents = yield* Effect.tryPromise({
        try: () => KnowledgeStore.allDocuments(ctx.params.collectionID),
        catch: (error) => knowledgeError(message(error)),
      })
      const cases = suggestCases(documents, ctx.payload.limit ?? 12)
      if (!ctx.payload.apply) return { cases, saved: 0 }

      // 已存在的用例保留；只补新的查询，避免覆盖用户手写的期望文档。
      const existing = yield* Effect.promise(() => listCases(ctx.params.collectionID))
      const known = new Set(existing.map((item) => item.query.trim().toLowerCase()))
      let saved = 0
      for (const item of cases) {
        if (known.has(item.query.trim().toLowerCase())) continue
        yield* Effect.promise(() =>
          saveCase(ctx.params.collectionID, {
            query: item.query,
            expected: item.expected,
            notes: "Auto-suggested baseline",
          }),
        )
        saved++
      }
      return { cases, saved }
    })

    const evaluate = Effect.fn("KnowledgeHttpApi.runEval")(function* (ctx: {
      params: { collectionID: string }
      payload: typeof RunEvalPayload.Type
    }) {
      const cfg = yield* config.get()
      const embedder = yield* Effect.promise(() =>
        resolveEmbedder(ConfigMemory.resolve(cfg.memory)).catch(() => undefined),
      )
      const run = yield* Effect.tryPromise({
        try: () =>
          runEval({
            collectionID: ctx.params.collectionID,
            k: ctx.payload.k,
            // 评测与线上检索保持一致：同一个集合、同一套混合召回、同样开图谱扩展。
            search: (query) =>
              KnowledgeStore.search({
                query,
                collectionID: ctx.params.collectionID,
                limit: ctx.payload.k ?? 5,
                embedder,
                expand: true,
              }),
          }),
        catch: (error) => knowledgeError(message(error)),
      })
      // 每次运行都留一条历史，用于趋势对比。
      yield* Effect.promise(() => appendHistory(ctx.params.collectionID, run))
      return run
    })

    const evalHistory = Effect.fn("KnowledgeHttpApi.evalHistory")(function* (ctx: {
      params: { collectionID: string }
    }) {
      const runs = yield* Effect.promise(() => listHistory(ctx.params.collectionID))
      return { runs }
    })

    const evalReport = Effect.fn("KnowledgeHttpApi.evalReport")(function* (ctx: {
      params: { collectionID: string }
      query: typeof EvalReportQuery.Type
    }) {
      const collection = (yield* Effect.promise(() => KnowledgeStore.listCollections())).find(
        (item) => item.id === ctx.params.collectionID,
      )
      if (!collection) return yield* notFound("Collection not found")
      const runs = yield* Effect.promise(() => listHistory(ctx.params.collectionID))
      const k = ctx.query.k ?? runs[runs.length - 1]?.k ?? 5
      const latest = runs.filter((run) => run.k === k).at(-1)
      if (!latest) return yield* knowledgeError("No evaluation runs for this collection yet")
      const earlier = runs.filter((run) => run.k === k).at(-2)
      return {
        markdown: renderReport({
          collection: collection.name,
          run: { ranAt: latest.ranAt, k: latest.k, metrics: latest.metrics },
          history: runs,
          ...(earlier ? { diff: diffRuns(earlier, latest) } : {}),
        }),
      }
    })

    const evalDiff = Effect.fn("KnowledgeHttpApi.evalDiff")(function* (ctx: {
      params: { collectionID: string }
      query: typeof EvalDiffQuery.Type
    }) {
      const runs = yield* Effect.promise(() => listHistory(ctx.params.collectionID))
      const byId = new Map(runs.map((run) => [run.id, run]))
      const from = ctx.query.from ? byId.get(ctx.query.from) : undefined
      const to = ctx.query.to ? byId.get(ctx.query.to) : undefined
      if (ctx.query.from && !from) return yield* notFound("Run not found")
      if (ctx.query.to && !to) return yield* notFound("Run not found")

      // 默认：最近两次「同 k」的运行（k 取最新一次运行的值，可被 query.k 覆盖）。
      if (runs.length === 0) return null
      const k = ctx.query.k ?? (to ?? runs[runs.length - 1]).k
      const sameK = runs.filter((run) => run.k === k)
      if (sameK.length === 0) return null

      const target = to ?? sameK[sameK.length - 1]
      if (!target) return null
      // 同名 k、且在目标之前（或就是目标本身之前）的最近一条作为基线。
      const earlier = sameK.filter((run) => run.id !== target.id && run.ranAt <= target.ranAt)
      const baseline = from ?? earlier[earlier.length - 1]
      // 没有可比的基线（只跑过一次）时返回 null，UI 显示"暂无可对比记录"。
      if (!baseline || baseline.id === target.id) return null
      return diffRuns(baseline, target)
    })

    const clearEvalHistory = Effect.fn("KnowledgeHttpApi.clearEvalHistory")(function* (ctx: {
      params: { collectionID: string }
    }) {
      yield* Effect.promise(() => clearHistory(ctx.params.collectionID))
      return true
    })

    const search = Effect.fn("KnowledgeHttpApi.search")(function* (ctx: { query: typeof SearchQuery.Type }) {
      if (!ctx.query.q.trim()) return []
      // UI 搜索也走同一套混合召回：有关量模型就一起用，没有会自动降级。
      const cfg = yield* config.get()
      const embedder = yield* Effect.promise(() =>
        resolveEmbedder(ConfigMemory.resolve(cfg.memory)).catch(() => undefined),
      )
      const hits = yield* Effect.tryPromise({
        try: () =>
          KnowledgeStore.search({
            query: ctx.query.q,
            collectionID: ctx.query.collectionID,
            limit: ctx.query.limit,
            embedder,
            expand: true,
          }),
        catch: (error) => knowledgeError(message(error)),
      })
      // 记录最近查询：只记有结果的，避免把错别字留在历史里。
      const collectionID = ctx.query.collectionID
      if (collectionID && hits.length > 0) {
        yield* Effect.promise(() =>
          KnowledgeStore.rememberQuery(collectionID, { query: ctx.query.q, hits: hits.length }),
        ).pipe(Effect.ignore)
      }
      return hits
    })

    return handlers
      .handle("overview", overview)
      .handle("recentQueries", recentQueries)
      .handle("clearQueries", clearQueries)
      .handle("documentsPage", documentsPage)
      .handle("bulkRemoveDocuments", bulkRemoveDocuments)
      .handle("listTrash", listTrash)
      .handle("restoreTrash", restoreTrash)
      .handle("emptyTrash", emptyTrash)
      .handle("moveDocuments", moveDocuments)
      .handle("integrity", integrity)
      .handle("repairIntegrity", repairIntegrity)
      .handle("exportLibrary", exportLibrary)
      .handle("importLibrary", importLibrary)
      .handle("documentChunks", documentChunks)
      .handle("templates", templates)
      .handle("collections", collections)
      .handle("createCollection", createCollection)
      .handle("updateCollection", updateCollection)
      .handle("removeCollection", removeCollection)
      .handle("documents", documents)
      .handle("addDocument", addDocument)
      .handle("document", document)
      .handle("updateDocument", updateDocument)
      .handle("removeDocument", removeDocument)
      .handle("uploadDocument", uploadDocument)
      .handle("importDocuments", importDocuments)
      .handle("importJobs", importJobs)
      .handle("importJob", importJob)
      .handle("cancelImportJob", cancelImportJob)
      .handle("stats", stats)
      .handle("reindex", reindex)
      .handle("exportCollection", exportCollection)
      .handle("restoreCollection", restoreCollection)
      .handle("related", related)
      .handle("embedding", embedding)
      .handle("installOcr", installOcr)
      .handle("ocrInstallJob", ocrInstallJob)
      .handle("cancelOcrInstall", cancelOcrInstall)
      .handle("ocr", ocr)
      .handle("listEvalCases", listEvalCases)
      .handle("saveEvalCase", saveEvalCase)
      .handle("removeEvalCase", removeEvalCase)
      .handle("runEval", evaluate)
      .handle("suggestEvalCases", suggestEvalCases)
      .handle("evalHistory", evalHistory)
      .handle("evalReport", evalReport)
      .handle("evalDiff", evalDiff)
      .handle("clearEvalHistory", clearEvalHistory)
      .handle("sessionMount", sessionMount)
      .handle("setSessionMount", setSessionMount)
      .handle("graph", graph)
      .handle("search", search)
  }),
)
